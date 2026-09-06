"use strict";
/* ============================================================
   Lift Log — single-file PWA gym tracker
   ============================================================ */

/* ---------- Supabase ---------- */
const SUPABASE_URL = 'https://bqntqspsaobkeelaqjbw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxbnRxc3BzYW9ia2VlbGFxamJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMTc0MjIsImV4cCI6MjA5Njg5MzQyMn0.XFaVcixhNaYuE2OW8MXVW7v9hYvOnD1PLR7bHtglgPA';
// If the library is missing or fails to construct, sb stays null and the app
// runs as a fully working local-only tracker. It must never throw here: this is
// top-level, so an exception would abort the entire script and leave a dead shell.
let sb = null;
try{
  if(typeof supabase !== "undefined" && supabase.createClient)
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}catch(err){ sb = null; }
if(!sb) console.warn("Lift Log: cloud sync unavailable — running local-only.");
let currentUser = null;

const MUSCLES = ["Chest","Back","Shoulders","Biceps","Triceps","Quads","Hamstrings","Glutes","Calves","Core","Forearms","Other"];
const COACH_GROUPS = ["Back","Chest","Arms","Legs","Other"];
const KEY = "liftlog.v1";
const PLAN_KEY = "liftlog.coach";
const LIB = (typeof CATALOG !== "undefined") ? CATALOG : [];

/* ---------- Storage ---------- */
let DB = load();
function load(){
  try{
    const raw = localStorage.getItem(KEY);
    if(raw){
      const obj = JSON.parse(raw);
      // `deleted` was added after initial release — existing stored DBs won't have it
      if(!Array.isArray(obj.deleted)) obj.deleted = [];
      // `bodyweights` added for bodyweight tracking — default empty on old devices
      if(!Array.isArray(obj.bodyweights)) obj.bodyweights = [];
      // `settings` added for user preferences — defaults filled lazily via getSetting()
      if(!obj.settings || typeof obj.settings !== 'object') obj.settings = {};
      // `routines` + their own tombstone list, added with the Home screen
      if(!Array.isArray(obj.routines)) obj.routines = [];
      if(!Array.isArray(obj.deletedRoutines)) obj.deletedRoutines = [];
      return obj;
    }
  }catch(e){}
  return { exercises:[], workouts:[], deleted:[], bodyweights:[], settings:{},
           routines:[], deletedRoutines:[] };
}
// The single write path. Everything that mutates DB goes through here, so the
// lookup index can't go stale and a failed write can't pass silently.
function persist(){
  invalidateLookup();
  try{
    localStorage.setItem(KEY, JSON.stringify(DB));
  }catch(err){
    console.error("Lift Log: save failed", err);
    toast("⚠️ Couldn't save — storage full?");
    return false;
  }
  return true;
}

// Write + mark for sync, with no clock side-effects. The session controls use
// this: routing Finish through save() ran touchSession(), which read the
// just-set endedAt as "logged again" and resumed the clock it had just stopped.
function markDirty(){
  const w = workoutFor(editDate, false);
  // Stamp the edit clock here rather than in touchSession(): that one bails out
  // early for back-filled workouts and for the very first set, so a history edit
  // or a Finish would never be timestamped and the other device's older copy
  // would look fresher. markDirty() is the one path every mutation goes through.
  if(w) w.updatedAt = Date.now();
  if(w && currentUser) w._sync = 'pending';
  persist();
  if(currentUser) scheduleSyncPending();
}

// For actual data edits — logging, deleting, retagging. Advances the clock.
function save(){
  touchSession();
  markDirty();
}

/* ---------- Settings helpers ---------- */
// User preferences live in DB.settings so they ride along with export/import
// and the same persist() path as everything else — a separate localStorage key
// would silently not be in the backup.
//
// DEFAULT_SETTINGS is the single declaration of every key and its default.
// getSetting() falls back to it, so adding a setting never needs a migration.
const DEFAULT_SETTINGS = {
  restDefaultSec:  90,    // rest after an isolation set, seconds (0 = timer off)
  restCompoundSec: 180,   // rest after a compound set
  barKg:           20,    // barbell weight the plate calculator subtracts
  plates:          [25, 20, 15, 10, 5, 2.5, 1.25],   // one side's plate stock, kg
};

function getSetting(key){
  const val = DB.settings[key];
  return val !== undefined ? val : DEFAULT_SETTINGS[key];
}
function setSetting(key, value){
  DB.settings[key] = value;
  persist();
}

/* ---------- Routines ---------- */
// A routine is a saved running order of exercises. It holds no weights: the
// numbers come from ghost sets, which read your actual history. `sets`/`reps`
// are only a target for a lift you've never done before.
//
// Shape:
//   { id, name, note, source, exercises:[{ exId, name, muscle, sets, reps }],
//     createdAt, updatedAt, _sync }
// `source` is "user" or "starter:<slug>" — it records where a routine came from
// so an adopted template can be told apart from one built by hand, and stays
// meaningful after the template itself is edited.

function routineById(id){ return DB.routines.find(r => r.id === id); }

// The one write path for routines, mirroring markDirty() for workouts.
function saveRoutine(r){
  r.updatedAt = Date.now();
  if(currentUser) r._sync = 'pending';
  if(!DB.routines.includes(r)) DB.routines.push(r);
  persist();
  if(currentUser) scheduleSyncPending();
}

function deleteRoutine(id){
  const r = routineById(id);
  if(!r) return null;
  DB.routines = DB.routines.filter(x => x.id !== id);
  // tombstone so the delete reaches the cloud too, the same way workouts do
  if(!DB.deletedRoutines.includes(id)) DB.deletedRoutines.push(id);
  persist();
  if(currentUser) scheduleSyncPending();
  // caller gets a restore closure for Undo — symmetric with snapshotWorkout()
  return () => {
    DB.routines.push(r);
    DB.deletedRoutines = DB.deletedRoutines.filter(x => x !== id);
    persist();
  };
}

// Turn a starter template into a real routine the user owns. Exercises resolve
// by name through ensureExercise(), because exIds are minted per-device.
function adoptStarter(slug){
  const t = STARTER_ROUTINES.find(x => x.slug === slug);
  if(!t) return null;
  const r = {
    id: uid(),
    name: t.name,
    note: t.blurb || "",
    source: "starter:" + t.slug,
    exercises: t.exercises.map(e => {
      const ex = ensureExercise(e.name, e.muscle);
      return { exId: ex.id, name: ex.name, muscle: ex.muscle, sets: e.sets, reps: e.reps };
    }),
    createdAt: Date.now(),
  };
  saveRoutine(r);
  return r;
}

// Load a routine into today's workout. Exercises the workout already has are
// left alone rather than duplicated, so starting the same routine twice — or
// starting one on top of a session already underway — is safe.
//
// No sets are created here. The routine decides *what* you're doing; ghost sets
// decide the numbers, seeded from your history and falling back to the
// routine's target only for a lift with none.
function startRoutine(id){
  const r = routineById(id);
  if(!r) return 0;
  setEditDate(todayKey());
  const w = workoutFor(todayKey(), true);
  let added = 0;
  for(const re of r.exercises){
    if(w.entries.some(en => en.exId === re.exId)) continue;
    w.entries.push({ exId: re.exId, name: re.name, sets: [] });
    added++;
  }
  // Remember where the session came from: it labels the workout in History and
  // it's how ghostSeedFor() finds a target for a lift with no history.
  w.routineId = r.id;
  markDirty();
  return added;
}

// The routine's own target for one exercise, or null. Used as the last resort
// when seeding ghost sets for a lift that has never been logged.
function routineTargetFor(routineId, exId){
  const r = routineById(routineId);
  if(!r) return null;
  const e = r.exercises.find(x => x.exId === exId);
  return (e && e.sets > 0 && e.reps > 0) ? { sets:e.sets, reps:e.reps } : null;
}

/* ---------- Supabase: auth + sync ---------- */
let _syncTimer = null;
function scheduleSyncPending(){
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(syncPending, 2000);
}

// Routines push on the same schedule as workouts. They're small and rarely
// change, so there's no merge rule here: last write wins. Losing a reordered
// routine costs you a drag; losing a logged set costs you the set — which is
// why only workouts get the union treatment.
async function syncRoutines(){
  if(!sb || !currentUser) return;
  const pending  = DB.routines.filter(r => r._sync === 'pending');
  const toDelete = [...(DB.deletedRoutines || [])];
  if(!pending.length && !toDelete.length) return;

  for(const r of pending){
    try{
      const { error } = await sb.from('routines').upsert({
        user_id:   currentUser.id,
        client_id: r.id,
        payload: {
          name: r.name, note: r.note ?? null, source: r.source ?? 'user',
          createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null,
          // carry name + muscle so a restore can rebuild exercises it lacks
          exercises: r.exercises.map(e => ({
            exId:e.exId, name:e.name,
            muscle: e.muscle || (exById(e.exId)||{}).muscle || 'Other',
            sets:e.sets ?? null, reps:e.reps ?? null
          })),
        }
      }, { onConflict: 'user_id,client_id' });
      if(!error) r._sync = 'synced';
    }catch(_){}
  }
  // one at a time, so a failed delete is retried next pass instead of
  // aborting the batch — same as the workout tombstones
  for(const id of toDelete){
    try{
      const { error } = await sb.from('routines').delete()
        .eq('user_id', currentUser.id).eq('client_id', id);
      if(!error) DB.deletedRoutines = DB.deletedRoutines.filter(x => x !== id);
    }catch(_){}
  }
  persist();
}

async function syncPending(){
  if(!sb || !currentUser) return;
  syncRoutines();
  // _demo rows are localhost fixtures — they must never reach the real account
  const pending = DB.workouts.filter(w => w._sync === 'pending' && w.entries.length && !w._demo);
  // flush tombstones: each is a client_id we deleted locally and need gone from the cloud too
  const toDelete = [...(DB.deleted || [])];
  if(!pending.length && !toDelete.length) return;
  let synced = 0;
  for(const w of pending){
    try{
      const { error } = await sb.from('workouts').upsert({
        user_id: currentUser.id,
        client_id: w.id,
        date: w.date,
        // denormalize each exercise's muscle into the payload so it survives a
        // device move (the exercises list itself isn't synced — only workouts).
        payload: {
          note: w.note ?? null,
          // session clock — epoch ms, null when the workout was never clocked
          startedAt: w.startedAt ?? null,
          endedAt: w.endedAt ?? null,
          lastActivityAt: w.lastActivityAt ?? null,
          // updatedAt lets the merge in restoreFromCloud() pick the fresher side
          updatedAt: w.updatedAt ?? null,
          entries: w.entries.map(en => ({
            ...en, muscle: (exById(en.exId) || {}).muscle || 'Other'
          })) }
      }, { onConflict: 'user_id,client_id' });
      if(!error){ w._sync = 'synced'; synced++; }
    }catch(_){}
  }
  // process tombstones one at a time; a failed delete stays in the list and is
  // retried on the next sync rather than aborting the whole batch
  let deleted = 0;
  for(const id of toDelete){
    try{
      const { error } = await sb.from('workouts').delete()
        .eq('user_id', currentUser.id).eq('client_id', id);
      if(!error){
        DB.deleted = DB.deleted.filter(x => x !== id);
        deleted++;
      }
    }catch(_){}
  }
  if(synced || deleted){
    persist();
    render();
    const stillPending = DB.workouts.filter(w => w._sync === 'pending');
    if(!stillPending.length && !DB.deleted.length) toast('Workouts synced ✓');
  }
}

function markNewWorkoutsPending(){
  DB.workouts.forEach(w => { if(w.entries.length && !w._sync && !w._demo) w._sync = 'pending'; });
  persist();
}

async function fetchLatestPlan(){
  if(!sb || !currentUser) return;
  try{
    const { data, error } = await sb.from('plans')
      .select('plan, generated_at')
      .eq('user_id', currentUser.id)
      .eq('active', true)
      .order('generated_at', { ascending: false })
      .limit(1)
      .single();
    if(data && !error){
      localStorage.setItem(PLAN_KEY, JSON.stringify({ ...data.plan, generated_at: data.generated_at }));
      if(activeTab === 'coach') renderCoach();
    }
  }catch(_){}
}

// ─── Two-device merge rule ──────────────────────────────────────────────────
// The rule, in one sentence: the side with the newer `updatedAt` wins the
// workout's metadata, but entries and sets are always unioned, so a set logged
// on either device survives the merge.
//
// Why a union and not last-write-wins: the two devices are the same person's
// phone and tablet, and the thing they most often disagree about is "how many
// sets are in this workout". Dropping the loser's sets destroys real training
// data with no way to get it back. A duplicated set, by contrast, is visible in
// the log and takes one tap to delete — so every ambiguous case resolves toward
// keeping data.
//
// Called once per remote row during restoreFromCloud(). `local` is the workout
// already in DB; `remote` is the Supabase row. Returns { workout, kept } where
// `kept` is true when local-only data survived (so the result must be pushed
// back up), or null when there is nothing to change.
function mergeWorkout(local, remote){
  const rp = remote.payload || {};
  const remoteUpdatedAt = rp.updatedAt || 0;
  const localUpdatedAt  = local.updatedAt || 0;

  // Remote is not newer — keep local untouched. Note this is also the path
  // every pre-`updatedAt` record takes (0 <= 0), so devices that haven't
  // written since the upgrade keep the old insert-only behaviour.
  if(remoteUpdatedAt <= localUpdatedAt) return null;

  const remoteEntries = rp.entries || [];
  if(!local.entries.length) return { workout: buildFromRemote(remote), kept: false };

  // Index the local side by exId so a shared exercise merges its sets rather
  // than one copy replacing the other.
  const localByExId = new Map();
  for(const en of local.entries) localByExId.set(en.exId, en);

  let kept = false;
  const entries = remoteEntries.map(ren => {
    const len = localByExId.get(ren.exId);
    if(!len) return ren;
    localByExId.delete(ren.exId);
    const sets = mergeSets(len.sets || [], ren.sets || []);
    if(sets.length > (ren.sets || []).length) kept = true;
    return { ...ren, sets };
  });
  // Whole exercises the remote never saw.
  for(const len of localByExId.values()){ entries.push(len); kept = true; }

  return {
    workout: {
      ...local,
      // the remote saw action more recently, so its metadata is the fresher read
      note:           rp.note ?? local.note,
      startedAt:      rp.startedAt ?? local.startedAt,
      endedAt:        rp.endedAt ?? local.endedAt,
      lastActivityAt: rp.lastActivityAt ?? local.lastActivityAt,
      updatedAt:      remoteUpdatedAt,
      entries,
      // Only clean if the remote already holds everything we do. If we kept
      // local-only data the cloud copy is now incomplete, so it has to go back
      // up — marking this 'synced' would strand those sets on this device.
      _sync:          kept ? 'pending' : 'synced',
    },
    kept
  };
}

// Sets carry no stable id, so identity has to be positional. Two devices
// editing the same exercise share a prefix — the sets that existed before they
// diverged — and differ only in what each added afterwards. Keep the prefix
// once, then both tails.
function mergeSets(localSets, remoteSets){
  const n = Math.min(localSets.length, remoteSets.length);
  let common = 0;
  while(common < n && sameSet(localSets[common], remoteSets[common])) common++;
  return [...remoteSets, ...localSets.slice(common)];
}
function sameSet(a, b){
  return !!a && !!b && a.type === b.type && a.weight === b.weight && a.reps === b.reps
      && (a.drops || []).length === (b.drops || []).length;
}

// Builds a local workout object from a raw Supabase row.
function buildFromRemote(r){
  const p = r.payload || {};
  return {
    id:             r.client_id,
    date:           r.date,
    note:           p.note ?? undefined,
    startedAt:      p.startedAt ?? null,
    endedAt:        p.endedAt ?? null,
    lastActivityAt: p.lastActivityAt ?? null,
    updatedAt:      p.updatedAt ?? null,
    entries:        p.entries || [],
    _sync:          'synced',
  };
}

// Pull the user's workouts down into local storage. The missing half of sync:
// localStorage is per-origin and per-device, so on a new domain / phone the
// history is empty until we hydrate it from the cloud. Insert-only by client_id
// — we never overwrite a local row, so unsynced local edits are always safe.
// Where both sides have data, mergeWorkout() unions entries by exId and picks
// the fresher metadata, so no logged set is silently lost.
async function restoreFromCloud(){
  if(!sb || !currentUser) return;
  let rows;
  try{
    const { data, error } = await sb.from('workouts')
      .select('client_id, date, payload')
      .eq('user_id', currentUser.id);
    if(error || !data) return;
    rows = data;
  }catch(_){ return; }

  // name -> muscle from the starter catalog, to rebuild the exercises list
  // (cloud entries carry exId + name but not the muscle group)
  const muscleByName = {};
  for(const c of LIB) muscleByName[c.n.toLowerCase()] = c.m;

  const haveWorkout = new Map(DB.workouts.map(w => [w.id, w]));
  const tombstoned  = new Set(DB.deleted || []);  // don't resurrect rows we've tombstoned locally
  const haveExId    = new Set(DB.exercises.map(e => e.id));
  let added = 0, merged = 0, rescued = 0;

  for(const r of rows){
    if(tombstoned.has(r.client_id)) continue;    // delete is pending sync — don't bring it back
    if(haveWorkout.has(r.client_id)){
      // We already have this workout locally — merge instead of skipping it.
      const local  = haveWorkout.get(r.client_id);
      const result = mergeWorkout(local, r);
      if(result){
        Object.assign(local, result.workout);
        merged++;
        if(result.kept) rescued++;
        // ensure any newly merged exercises exist locally
        for(const en of result.workout.entries){
          if(en.exId && !haveExId.has(en.exId)){
            DB.exercises.push({ id: en.exId, name: en.name,
                                muscle: en.muscle || muscleByName[(en.name||'').toLowerCase()] || 'Other' });
            haveExId.add(en.exId);
          }
        }
      }
      continue;
    }
    // Brand new workout from the cloud — insert it.
    const w = buildFromRemote(r);
    DB.workouts.push(w);
    haveWorkout.set(r.client_id, w);
    added++;
    // rebuild any referenced exercises we don't have locally, so the PB /
    // Exercises screens and muscle grouping work after a restore
    for(const en of w.entries){
      if(en.exId && !haveExId.has(en.exId)){
        DB.exercises.push({ id: en.exId, name: en.name,
                            muscle: en.muscle || muscleByName[(en.name||'').toLowerCase()] || 'Other' });
        haveExId.add(en.exId);
      }
    }
  }

  await restoreRoutines(muscleByName, haveExId);

  if(added || merged){
    persist();
    render();
    const parts = [];
    if(added)  parts.push(`${added} workout${added>1?'s':''} restored`);
    if(merged) parts.push(`${merged} merged`);
    toast(parts.join(', ') + ' from cloud ✓');
    // A rescued workout holds sets the cloud copy is missing, so push it back
    // up — otherwise the union we just built only ever exists on this device.
    if(rescued) scheduleSyncPending();
  }
}

// Restore down first, then mark any local-only workouts pending and push up.
async function onSignedIn(){
  await restoreFromCloud();
  markNewWorkoutsPending();
  syncPending();
  fetchLatestPlan();
}

async function initAuth(){
  if(!sb){ currentUser = null; return; }      // local-only mode
  try{
    const { data:{ session } } = await sb.auth.getSession();
    currentUser = session?.user ?? null;
  }catch(_){ currentUser = null; }
  sb.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user ?? null;
    if(currentUser) onSignedIn();
    if(activeTab === 'more') renderMore();
    if(activeTab === 'coach') renderCoach();
  });
  if(currentUser) onSignedIn();
}

/* ---------- Utils ---------- */
const isLocalDev = location.hostname === "localhost" || location.hostname === "127.0.0.1";
let _swCache = null;
function askSWVersion(){
  try{ navigator.serviceWorker.controller.postMessage({type:"version"}); }catch(_){}
}
const $ = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>[...el.querySelectorAll(s)];
const uid = ()=> Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const todayKey = ()=>{ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
function esc(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
const fmtKg = n => (Number.isInteger(n)? n : n.toFixed(1)) + "kg";

function dateLabel(key){
  const [y,m,d] = key.split("-").map(Number);
  const dt = new Date(y,m-1,d);
  const t = new Date(); t.setHours(0,0,0,0);
  const diff = Math.round((t - dt)/86400000);
  if(diff===0) return "Today";
  if(diff===1) return "Yesterday";
  const wd = dt.toLocaleDateString(undefined,{weekday:"short"});
  const md = dt.toLocaleDateString(undefined,{day:"numeric",month:"short"});
  return `${wd} ${md}`;
}
function fullDate(key){
  const [y,m,d]=key.split("-").map(Number);
  return new Date(y,m-1,d).toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"});
}
function shortDate(key){
  const [y,m,d]=key.split("-").map(Number);
  return new Date(y,m-1,d).toLocaleDateString(undefined,{day:"numeric",month:"short"});
}

function toast(msg){
  const t=$("#toast");
  t.textContent = msg;                      // also clears any Undo button
  t.classList.add("show"); t.classList.remove("has-action");
  _undo = null;
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove("show"),1700);
}

// Destructive actions in the logging flow get an Undo rather than a confirm —
// a confirm taxes every delete to protect the rare mistake; undo does the
// opposite. Held longer than a normal toast so there's time to react.
let _undo = null;
function toastAction(msg, label, fn, sticky){
  const t=$("#toast");
  _undo = fn;
  t.innerHTML = `<span>${esc(msg)}</span><button class="toast-undo" data-undo>${esc(label)}</button>`;
  t.classList.add("show","has-action");
  clearTimeout(t._t);
  if(!sticky) t._t = setTimeout(()=>{ t.classList.remove("show","has-action"); _undo = null; }, 5200);
}
function toastUndo(msg, restore){
  toastAction(msg, "Undo", ()=>{ restore(); toast("Restored"); });
}
$("#toast").addEventListener("click", e=>{
  if(!e.target.closest("[data-undo]") || !_undo) return;
  const fn = _undo; _undo = null;
  const t=$("#toast"); t.classList.remove("show","has-action"); clearTimeout(t._t);
  fn();
});

// A whole-workout snapshot is the safe unit to restore: set and entry indices
// shift under you, but the workout id doesn't.
function snapshotWorkout(w){
  const pos  = DB.workouts.indexOf(w);
  const copy = JSON.parse(JSON.stringify(w));
  return ()=>{
    const cur = DB.workouts.findIndex(x=>x.id===copy.id);
    if(cur>=0) DB.workouts[cur] = copy;
    else DB.workouts.splice(Math.min(pos<0?DB.workouts.length:pos, DB.workouts.length), 0, copy);
    // if a tombstone was recorded for this workout before Undo, clear it — otherwise
    // the workout comes back locally but then gets deleted from the cloud on next sync
    DB.deleted = (DB.deleted || []).filter(id => id !== copy.id);
    editingSet = null; editingNote = false;
    save(); render();
  };
}

/* ---------- Data helpers ---------- */
function exById(id){ return DB.exercises.find(e=>e.id===id); }

// A drop set counts as one hard set (its heavy segment is the top set); warmups
// don't. Volume (kg) sums the heavy segment plus every dropped continuation.
function isHardSet(s){ return s.type==="work" || s.type==="drop"; }
function setVolume(s){
  let v = (s.weight||0)*(s.reps||0);
  if(s.type==="drop" && s.drops) for(const d of s.drops) v += (d.weight||0)*(d.reps||0);
  return v;
}

function workoutFor(dateKey, create){
  let w = DB.workouts.find(w=>w.date===dateKey);
  if(!w && create){ w={ id:uid(), date:dateKey, entries:[] }; DB.workouts.push(w); }
  return w;
}
function activeWorkout(create){ return workoutFor(editDate, create); }

/* ---------- Session clock ---------- */
// Duration comes from Start → Finish, but neither press is required. Logging a
// set auto-starts the clock, and every edit stamps lastActivityAt — so a
// forgotten Finish settles at "last set logged" rather than running overnight.
const STALE_MS = 3*60*60*1000;   // no sets for 3h → you've left the gym

function sessionState(w){
  if(!w || !w.startedAt) return "none";
  if(w.endedAt) return "done";
  return (Date.now() - (w.lastActivityAt || w.startedAt) > STALE_MS) ? "stale" : "running";
}
// Elapsed time. A stale session is measured to its last set, never to now.
function sessionMs(w){
  if(!w || !w.startedAt) return 0;
  const end = w.endedAt || (sessionState(w)==="stale" ? (w.lastActivityAt || w.startedAt) : Date.now());
  return Math.max(0, end - w.startedAt);
}
function fmtDur(ms){
  const m = Math.round(ms/60000);
  return m<60 ? `${m} min` : `${Math.floor(m/60)}h ${String(m%60).padStart(2,"0")}m`;
}
function fmtClock(ms){
  const s = Math.floor(ms/1000), h = Math.floor(s/3600), m = Math.floor(s%3600/60);
  return h ? `${h}:${String(m).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`
           : `${m}:${String(s%60).padStart(2,"0")}`;
}

// Called from save() — the one choke point every data mutation passes through.
const totalSets = w => w.entries.reduce((a,en)=>a+en.sets.length, 0);

function touchSession(){
  if(editDate !== todayKey()) return;                 // never clock a back-filled workout
  const w = workoutFor(editDate, false);
  if(!w || !w.entries.length) return;
  const now = Date.now();
  if(!w.startedAt){
    // Only the workout's very first set starts the clock — totalSets === 1 means
    // exactly one set has just been logged. addEntry() calls save() with zero sets
    // on the new entry, so totalSets === 0 there and we correctly skip it.
    // Editing a workout logged earlier today must also not back-date a clock.
    if(totalSets(w) !== 1) return;
    w.startedAt = now;
  }
  if(w.endedAt && now - w.endedAt < STALE_MS) w.endedAt = null;   // logging again resumes
  if(!w.endedAt) w.lastActivityAt = now;
}

function startSession(){
  const w = activeWorkout(true);
  if(w.startedAt && !w.endedAt) return;
  w.startedAt = Date.now(); w.endedAt = null; w.lastActivityAt = w.startedAt;
  markDirty(); render();
}
function finishSession(){
  const w = activeWorkout(false);
  if(!w || !w.startedAt || w.endedAt) return 0;
  w.endedAt = sessionState(w)==="stale" ? (w.lastActivityAt || w.startedAt) : Date.now();
  const ms = sessionMs(w);
  markDirty(); render();          // never save() — that would resume what we just stopped
  return ms;
}
function resumeSession(){
  const w = activeWorkout(false);
  if(!w || !w.startedAt) return;
  w.endedAt = null; w.lastActivityAt = Date.now();
  markDirty(); render();
}
// Escape hatch for a clock that shouldn't be there — a stray auto-start, or a
// duration made meaningless by editing hours after the session.
function clearSession(){
  const w = activeWorkout(false); if(!w) return;
  delete w.startedAt; delete w.endedAt; delete w.lastActivityAt;
  markDirty(); render();
}

// On boot: close out any clock left running on an earlier day, and bin sessions
// that were started but never logged into.
function finalizeStaleSessions(){
  const today = todayKey();
  let changed = false;
  for(let i=DB.workouts.length-1; i>=0; i--){
    const w = DB.workouts[i];
    if(w.date === today || !w.startedAt) continue;
    if(!w.entries.length){
      // tombstone so the cloud row is cleaned up too — these were never worth keeping
      if(!w._demo) DB.deleted.push(w.id);
      DB.workouts.splice(i,1); changed = true; continue;
    }
    if(!w.endedAt){ w.endedAt = w.lastActivityAt || w.startedAt; changed = true; }
  }
  if(changed) persist();
}

// Pull routines down. Insert-only by client_id: a routine already on this
// device is never clobbered, so an unsynced rename survives a restore.
async function restoreRoutines(muscleByName, haveExId){
  if(!sb || !currentUser) return;
  let rows;
  try{
    const { data, error } = await sb.from('routines')
      .select('client_id, payload').eq('user_id', currentUser.id);
    if(error || !data) return;
    rows = data;
  }catch(_){ return; }

  const have       = new Set(DB.routines.map(r => r.id));
  const tombstoned = new Set(DB.deletedRoutines || []);
  let added = 0;

  for(const row of rows){
    if(have.has(row.client_id) || tombstoned.has(row.client_id)) continue;
    const p = row.payload || {};
    const exercises = (p.exercises || []).map(e => {
      // rebuild any exercise this device doesn't have, so a restored routine
      // isn't full of dead references
      if(e.exId && !haveExId.has(e.exId)){
        DB.exercises.push({ id:e.exId, name:e.name,
          muscle: e.muscle || muscleByName[(e.name||'').toLowerCase()] || 'Other' });
        haveExId.add(e.exId);
      }
      return { exId:e.exId, name:e.name, muscle:e.muscle,
               sets:e.sets ?? null, reps:e.reps ?? null };
    });
    DB.routines.push({
      id: row.client_id, name: p.name || 'Routine', note: p.note ?? '',
      source: p.source || 'user', exercises,
      createdAt: p.createdAt ?? null, updatedAt: p.updatedAt ?? null,
      _sync: 'synced',
    });
    have.add(row.client_id);
    added++;
  }
  if(added) persist();
}

/* ---------- Lookup index ---------- */
// pbFor and lastSession used to walk (and sort) the whole history on every
// call, and they're called once per rendered row — so a render was O(history ×
// rows). One pass builds both maps instead; the cost is now O(history) per
// render regardless of how many rows are on screen.
let _lookup = null;
function lookup(){
  if(_lookup) return _lookup;
  const pb = {}, last = {};
  const asc = [...DB.workouts].sort((a,b)=> a.date<b.date ? -1 : a.date>b.date ? 1 : 0);

  // forward pass — a strict > means a tied PB keeps the date you first hit it
  for(const w of asc)
    for(const en of w.entries)
      for(const s of en.sets){
        if(!isHardSet(s)) continue;
        const b = pb[en.exId];
        if(!b || s.weight>b.weight || (s.weight===b.weight && s.reps>b.reps))
          pb[en.exId] = { weight:s.weight, reps:s.reps, date:w.date };
      }

  // backward pass — first hit per exercise is the most recent qualifying session
  for(let i=asc.length-1; i>=0; i--){
    const w = asc[i];
    if(w.date === editDate) continue;          // "last time" means before today
    for(const en of w.entries){
      if(last[en.exId]) continue;
      const work = en.sets.filter(s=>s.type==="work");
      if(work.length) last[en.exId] = { date:w.date, sets:work };
    }
  }
  _lookup = { pb, last };
  return _lookup;
}
// Anything that mutates DB — or changes which date counts as "today" — must
// drop the index. render() clears it too, so a stale read isn't possible.
function invalidateLookup(){ _lookup = null; }

function pbFor(exId){ return lookup().pb[exId] || null; }
function lastSession(exId){ return lookup().last[exId] || null; }

/* ============================================================
   RENDER
   ============================================================ */
let activeTab = "log";
let editDate = todayKey();
// editDate participates in the lookup index ("last time" excludes today), so it
// must only ever change through here.
function setEditDate(d){ editDate = d || todayKey(); invalidateLookup(); }
let activeCoachGroup = "Back";

function render(){
  if(activeTab==="log") renderLog();
  else if(activeTab==="history") renderHistory();
  else if(activeTab==="ex") renderEx();
  else if(activeTab==="coach") renderCoach();
  else if(activeTab==="more") renderMore();
}

/* ============================================================
   SHEETS
   ============================================================ */
function openSheet(html){ $("#sheet").innerHTML = `<div class="grab"></div>`+html; $("#sheetBg").classList.add("open"); }
function closeSheet(){ $("#sheetBg").classList.remove("open"); }
$("#sheetBg").addEventListener("click",e=>{ if(e.target===$("#sheetBg")) closeSheet(); });

function ensureExercise(name, muscle){
  let ex = DB.exercises.find(e=>e.name.toLowerCase()===name.toLowerCase());
  if(!ex){ ex = { id:uid(), name, muscle }; DB.exercises.push(ex); save(); }
  return ex;
}

function switchTab(tab){
  activeTab = tab;
  $$("nav button").forEach(b=>b.classList.toggle("on", b.dataset.tab===tab));
  $$(".screen").forEach(s=>s.classList.remove("active"));
  $("#screen-"+tab).classList.add("active");
  window.scrollTo(0,0);
  if(tab === 'coach') fetchLatestPlan();
  render();
}
$$("nav button").forEach(b=> b.addEventListener("click",()=>{
  if(b.dataset.tab==="log") setEditDate(todayKey());
  switchTab(b.dataset.tab);
}) );
