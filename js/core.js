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
      return obj;
    }
  }catch(e){}
  return { exercises:[], workouts:[], deleted:[] };
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
  if(w && currentUser) w._sync = 'pending';
  persist();
  if(currentUser) scheduleSyncPending();
}

// For actual data edits — logging, deleting, retagging. Advances the clock.
function save(){
  touchSession();
  markDirty();
}

/* ---------- Supabase: auth + sync ---------- */
let _syncTimer = null;
function scheduleSyncPending(){
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(syncPending, 2000);
}

async function syncPending(){
  if(!sb || !currentUser) return;
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

// Pull the user's workouts down into local storage. The missing half of sync:
// localStorage is per-origin and per-device, so on a new domain / phone the
// history is empty until we hydrate it from the cloud. Insert-only by client_id
// — we never overwrite a local row, so unsynced local edits are always safe.
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

  const haveWorkout = new Set(DB.workouts.map(w => w.id));
  const tombstoned  = new Set(DB.deleted || []);  // don't resurrect rows we've tombstoned locally
  const haveExId    = new Set(DB.exercises.map(e => e.id));
  let added = 0;

  for(const r of rows){
    if(haveWorkout.has(r.client_id)) continue;   // never clobber local edits
    if(tombstoned.has(r.client_id)) continue;    // delete is pending sync — don't bring it back
    const entries = (r.payload && r.payload.entries) || [];
    DB.workouts.push({ id: r.client_id, date: r.date, entries,
                       note: r.payload?.note ?? undefined,
                       startedAt: r.payload?.startedAt ?? null,
                       endedAt: r.payload?.endedAt ?? null,
                       lastActivityAt: r.payload?.lastActivityAt ?? null,
                       _sync: 'synced' });
    haveWorkout.add(r.client_id);
    added++;
    // rebuild any referenced exercises we don't have locally, so the PB /
    // Exercises screens and muscle grouping work after a restore
    for(const en of entries){
      if(en.exId && !haveExId.has(en.exId)){
        // prefer the muscle carried in the payload (set on a device that knew
        // it), then the starter catalog by name, then Other as a last resort.
        DB.exercises.push({ id: en.exId, name: en.name,
                            muscle: en.muscle || muscleByName[(en.name||'').toLowerCase()] || 'Other' });
        haveExId.add(en.exId);
      }
    }
  }

  if(added){
    persist();
    render();
    toast(`Restored ${added} workout${added>1?'s':''} from cloud ✓`);
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
