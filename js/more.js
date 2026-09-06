"use strict";
/* ---------- MORE ---------- */
function renderMore(){
  const pendingCount = DB.workouts.filter(w => w._sync === 'pending').length;
  const syncedCount  = DB.workouts.filter(w => w._sync === 'synced').length;

  let authHTML;
  if(currentUser){
    authHTML = `<div class="card">
      <div class="row between">
        <div>
          <div class="small" style="font-weight:700">${esc(currentUser.email)}</div>
          <div class="tiny" style="margin-top:3px">
            ${pendingCount
              ? `<span style="color:var(--gold)">↑ ${pendingCount} workout${pendingCount>1?'s':''} pending sync</span>`
              : `<span style="color:var(--good)">✓ All synced</span>`}
            ${syncedCount ? ` · ${syncedCount} in cloud` : ''}
          </div>
        </div>
        <button class="btn sm ghost" id="signOutBtn">Sign out</button>
      </div>
      ${pendingCount ? `<button class="btn full sm" id="syncNowBtn" style="margin-top:10px">Sync now</button>` : ''}
    </div>`;
  } else if(!sb){
    // library missing — logging still works, so say that rather than offer a dead button
    authHTML = `<div class="card" style="border-color:var(--gold-dim)">
      <div class="small" style="font-weight:700;color:var(--gold);margin-bottom:4px">Local-only mode</div>
      <div class="tiny muted">Cloud sync couldn't load. Everything you log is saved on this device —
        reconnect and reopen to sync.</div>
    </div>`;
  } else {
    authHTML = `<div class="card">
      <div class="small muted" style="margin-bottom:10px;font-weight:600">Sync workouts &amp; get coaching plans</div>
      <button class="btn primary full" id="signInBtn">Continue with Google</button>
    </div>`;
  }
  $("#authCard").innerHTML = authHTML;

  $("#statWorkouts").textContent = DB.workouts.filter(w=>w.entries.length).length;
  $("#statEx").textContent = DB.exercises.length;
  $("#statSets").textContent = DB.workouts.reduce((a,w)=>a+w.entries.reduce((b,en)=>b+en.sets.length,0),0);
  $("#devCard").style.display = isLocalDev ? "block" : "none";
  // the serving cache name, straight from the worker — the only reliable
  // answer to "did the update actually land?"
  $("#buildTag").textContent = _swCache ? `build ${_swCache.replace("liftlog-","")}` : "";
  askSWVersion();
}

/* ---------- MORE EVENTS ---------- */
// more tab — auth actions (event delegation)
$("#authCard").addEventListener("click", async e=>{
  if(!sb){ toast("Cloud sync unavailable offline"); return; }
  if(e.target.id === "signInBtn"){
    e.target.disabled = true; e.target.textContent = "Redirecting…";
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname }
    });
    if(error){ e.target.disabled = false; e.target.textContent = "Continue with Google"; toast("Error: " + error.message); }
    return;
  }
  if(e.target.id === "signOutBtn"){
    await sb.auth.signOut();
    currentUser = null;
    renderMore();
    return;
  }
  if(e.target.id === "syncNowBtn"){
    toast("Syncing…");
    await syncPending();
    renderMore();
    return;
  }
});

/* ---------- Dev seed (localhost only) ---------- */
// Real history sits behind Google auth, which only redirects back to the
// deployed origin — so on localhost there's nothing to look at. This fabricates
// a believable 12-session block instead. Everything it creates carries _demo,
// which keeps it out of sync() and makes it removable in one go.
const DEMO_SESSIONS = [
  { lifts:[ ["Barbell Row","Back",60,2.5,8,4], ["Lat Pulldown","Back",50,2.5,10,3],
            ["Preacher Curl","Biceps",22.5,1.25,10,3], ["Hammer Curl","Biceps",14,1,12,3] ] },
  { lifts:[ ["Bench Press","Chest",70,2.5,8,4], ["Overhead Press","Shoulders",40,1.25,8,3],
            ["Cable Fly","Chest",15,1.25,12,3], ["Tricep Pushdown","Triceps",25,1.25,12,3] ] },
  { lifts:[ ["Back Squat","Quads",90,5,6,4], ["Romanian Deadlift","Hamstrings",80,2.5,8,3],
            ["Leg Curl","Hamstrings",40,2.5,12,3], ["Calf Raise","Calves",60,2.5,15,3] ] },
];
const DEMO_PLAN = {
  generated_at: new Date().toISOString(),
  groups: {
    Back:  { priority:"high", why:"Volume has been below target for two weeks running.",
             focus:[ {exercise:"Barbell Row", app_exercise:"Barbell Row", target_weight:70, target_reps:8, expected_change:2.5},
                     {exercise:"Lat Pulldown", app_exercise:"Lat Pulldown", target_weight:60, target_reps:10, expected_change:2.5} ] },
    Arms:  { priority:"medium", why:"Progressing steadily — hold the current ramp.",
             focus:[ {exercise:"Preacher Curl", app_exercise:"Preacher Curl", target_weight:26.25, target_reps:10, expected_change:1.25},
                     {exercise:"Hammer Curl", app_exercise:"Hammer Curl", target_weight:17, target_reps:12, expected_change:0} ] },
    Chest: { priority:"medium", why:"Bench is on track; keep press volume where it is.",
             focus:[ {exercise:"Bench Press", app_exercise:"Bench Press", target_weight:77.5, target_reps:8, expected_change:2.5} ] },
    Legs:  { priority:"high", why:"Squat has stalled — the last two sessions repeated a load.",
             focus:[ {exercise:"Back Squat", app_exercise:"Back Squat", target_weight:105, target_reps:6, expected_change:-2.5} ] },
  }
};

const round25 = n => Math.round(n*4)/4;
function demoDateKey(daysAgo){
  const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-daysAgo);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
function ensureDemoExercise(name, muscle){
  let ex = DB.exercises.find(e=>e.name.toLowerCase()===name.toLowerCase());
  if(!ex){ ex = { id:uid(), name, muscle, _demo:true }; DB.exercises.push(ex); }
  return ex;
}

function seedDemoData(){
  clearDemoData(true);
  const daysAgo = [40,37,33,30,26,23,19,16,12,9,5,2];      // oldest first, so loads climb
  daysAgo.forEach((ago,k)=>{
    const tpl = DEMO_SESSIONS[k % DEMO_SESSIONS.length];
    const cycle = Math.floor(k / DEMO_SESSIONS.length);     // 0..3 — one bump per cycle
    const start = new Date(); start.setDate(start.getDate()-ago); start.setHours(18,15,0,0);
    const durMin = 52 + ((k*7)%22);
    const w = { id:uid(), date:demoDateKey(ago), entries:[], _demo:true, _sync:'synced',
                startedAt:start.getTime(),
                lastActivityAt:start.getTime()+(durMin-3)*60000,
                endedAt:start.getTime()+durMin*60000 };
    tpl.lifts.forEach(([name,muscle,base,inc,reps,nsets],li)=>{
      const ex = ensureDemoExercise(name, muscle);
      // a stall every 4th session, so the chart isn't a synthetic straight line
      const weight = round25(base + inc*cycle - (k%4===3 ? inc : 0));
      const sets = [];
      if(li===0) sets.push({ type:"warm", weight:round25(weight*0.5), reps:10 });
      for(let s=0;s<nsets;s++) sets.push({ type:"work", weight, reps:Math.max(4, reps - (s>=2?1:0)) });
      if(li===tpl.lifts.length-1 && k%2===0)
        sets.push({ type:"drop", weight, reps,
                    drops:[{weight:round25(weight*0.75),reps:8},{weight:round25(weight*0.5),reps:6}] });
      w.entries.push({ exId:ex.id, name:ex.name, sets });
    });
    DB.workouts.push(w);
  });

  // pair the two curls on the latest session that actually has both, so
  // supersets have a subject (the most recent day is not always a pull day)
  const pull = [...DB.workouts].reverse().find(w=>
    w.entries.some(en=>en.name==="Preacher Curl") && w.entries.some(en=>en.name==="Hammer Curl"));
  if(pull){
    const g = uid();
    pull.entries.find(en=>en.name==="Preacher Curl").group = g;
    pull.entries.find(en=>en.name==="Hammer Curl").group = g;
  }

  persist();
  localStorage.setItem(PLAN_KEY, JSON.stringify(DEMO_PLAN));
  render();
}

function clearDemoData(silent){
  DB.workouts = DB.workouts.filter(w=>!w._demo);
  const stillUsed = new Set(DB.workouts.flatMap(w=>w.entries.map(en=>en.exId)));
  DB.exercises = DB.exercises.filter(e=>!e._demo || stillUsed.has(e.id));
  persist();
  if(!silent){
    try{ if(JSON.parse(localStorage.getItem(PLAN_KEY))?.groups?.Back?.why === DEMO_PLAN.groups.Back.why)
      localStorage.removeItem(PLAN_KEY); }catch(_){}
    render();
  }
}

/* ---------- Backup ---------- */
$("#exportBtn").addEventListener("click",()=>{
  // strip internal _sync field from export
  const exportDB = {
    exercises: DB.exercises,
    workouts: DB.workouts.map(({ _sync, ...rest }) => rest)
  };
  const data = JSON.stringify(exportDB,null,2);
  const blob = new Blob([data],{type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=`liftlog-backup-${todayKey()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast("Backup downloaded");
});
$("#importBtn").addEventListener("click",()=>$("#importFile").click());
// Validate an imported backup object before it touches DB. Returns a string
// describing the first problem found, or null if the shape looks good.
function validateBackup(obj){
  if(!obj || typeof obj !== 'object') return "Not a valid JSON object.";
  if(!Array.isArray(obj.exercises)) return "Missing or invalid 'exercises' array.";
  if(!Array.isArray(obj.workouts))  return "Missing or invalid 'workouts' array.";
  for(let wi=0; wi<obj.workouts.length; wi++){
    const w = obj.workouts[wi];
    if(!w || typeof w !== 'object') return `Workout #${wi+1} is not an object.`;
    if(!w.id)   return `Workout #${wi+1} is missing an 'id'.`;
    if(!w.date) return `Workout #${wi+1} (id: ${w.id}) is missing a 'date'.`;
    if(!Array.isArray(w.entries)) return `Workout #${wi+1} (id: ${w.id}) has an invalid 'entries' array.`;
    for(let ei=0; ei<w.entries.length; ei++){
      const en = w.entries[ei];
      if(!en || typeof en !== 'object') return `Workout ${w.id}, entry #${ei+1} is not an object.`;
      if(!en.exId) return `Workout ${w.id}, entry #${ei+1} is missing 'exId'.`;
      if(!Array.isArray(en.sets)) return `Workout ${w.id}, entry #${ei+1} has an invalid 'sets' array.`;
      for(let si=0; si<en.sets.length; si++){
        const s = en.sets[si];
        if(!s || typeof s !== 'object') return `Workout ${w.id}, entry ${en.exId}, set #${si+1} is not an object.`;
        if(typeof s.weight !== 'number') return `Workout ${w.id}, entry ${en.exId}, set #${si+1}: 'weight' must be a number.`;
        if(typeof s.reps   !== 'number') return `Workout ${w.id}, entry ${en.exId}, set #${si+1}: 'reps' must be a number.`;
      }
    }
  }
  return null;
}

$("#importFile").addEventListener("change",e=>{
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    let obj;
    try{ obj = JSON.parse(reader.result); }
    catch(_){ alert("Invalid backup file — could not parse JSON."); e.target.value=""; return; }
    const problem = validateBackup(obj);
    if(problem){ alert(`Invalid backup file — ${problem}`); e.target.value=""; return; }
    if(!confirm("Replace ALL current data with this backup?")) { e.target.value=""; return; }
    if(!Array.isArray(obj.deleted)) obj.deleted = [];
    DB = obj;
    // mark all imported workouts as pending so they sync up
    if(currentUser) DB.workouts.forEach(w => { if(w.entries.length) w._sync = 'pending'; });
    persist();
    render();
    toast("Backup restored");
    if(currentUser) syncPending();
  };
  reader.readAsText(file);
  e.target.value="";
});
$("#wipeBtn").addEventListener("click",()=>{
  if(!confirm("Erase ALL data permanently? Export a backup first if unsure.")) return;
  if(!confirm("Really erase everything?")) return;
  // tombstone all cloud-synced workouts before wiping — the list survives the
  // reset so syncPending() can flush the deletes on the next sync pass
  const tombstones = DB.workouts.filter(w => !w._demo).map(w => w.id);
  DB = { exercises:[], workouts:[], deleted: tombstones };
  save(); render(); toast("All data erased");
});

$("#seedBtn").addEventListener("click",()=>{ seedDemoData(); toast("Demo data loaded"); });
$("#unseedBtn").addEventListener("click",()=>{ clearDemoData(false); toast("Demo data cleared"); });
