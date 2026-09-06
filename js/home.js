"use strict";
/* ============================================================
   HOME — landing tab
   ============================================================
   Jobs: say where today stands, get into a workout (routine /
   starter template / empty), list + build + edit routines, and a
   small warm nod to recent activity. Everything here reads DB.routines
   and STARTER_ROUTINES through the contract in core.js / routines.js —
   this file never writes to DB directly except via saveRoutine() /
   deleteRoutine() / adoptStarter() / startRoutine().
*/

/* ---------- small helpers ---------- */
function homeGreeting(){
  const h = new Date().getHours();
  if(h < 5)  return "Still up?";
  if(h < 12) return "Good morning";
  if(h < 17) return "Good afternoon";
  if(h < 21) return "Good evening";
  return "Winding down?";
}

// Consecutive days (ending today or yesterday) with at least one logged
// exercise. An in-progress streak still counts before today's first set.
function currentStreak(){
  const days = new Set(DB.workouts.filter(w => w.entries.length).map(w => w.date));
  const keyOf = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  const d = new Date(); d.setHours(0,0,0,0);
  if(!days.has(keyOf(d))) d.setDate(d.getDate()-1);   // today not logged yet — count from yesterday
  let n = 0;
  while(days.has(keyOf(d))){ n++; d.setDate(d.getDate()-1); }
  return n;
}

// The routine most worth offering a one-tap restart: whichever routine
// most recently kicked off a workout, falling back to the first the user
// has. null when there are none yet.
function suggestedRoutine(){
  if(!DB.routines.length) return null;
  const used = [...DB.workouts].filter(w => w.routineId).sort((a,b)=> a.date<b.date?1:-1);
  for(const w of used){ const r = routineById(w.routineId); if(r) return r; }
  return DB.routines[0];
}

/* ---------- hero: where today stands ---------- */
function heroCardHTML(){
  const w = workoutFor(todayKey(), false);
  const st = sessionState(w);

  if(st === "done"){
    const sets = w.entries.reduce((a,en)=>a+en.sets.filter(isHardSet).length, 0);
    return `<div class="card">
      <div class="row between">
        <div class="grow" style="min-width:0">
          <div style="font-weight:800;font-size:17px">Today's workout is done</div>
          <div class="tiny muted" style="margin-top:3px">${esc(fmtDur(sessionMs(w)))} · ${sets} work set${sets===1?"":"s"}</div>
        </div>
        <button class="btn ghost sm" data-goto-log>View</button>
      </div>
    </div>`;
  }

  if(st === "running" || st === "stale"){
    const label = st === "stale" ? "Last set was a while ago" : "Workout in progress";
    const clock = st === "stale" ? fmtDur(sessionMs(w)) : fmtClock(sessionMs(w));
    return `<div class="card">
      <div class="row between">
        <div class="grow" style="min-width:0">
          <div style="font-weight:800;font-size:17px">${esc(label)}</div>
          <div class="tiny muted" style="margin-top:3px">${esc(clock)} elapsed</div>
        </div>
        <button class="btn primary sm" data-goto-log>Continue</button>
      </div>
    </div>`;
  }

  if(w && w.entries.length){
    return `<div class="card">
      <div class="row between">
        <div class="grow" style="min-width:0">
          <div style="font-weight:800;font-size:17px">Ready when you are</div>
          <div class="tiny muted" style="margin-top:3px">${w.entries.length} exercise${w.entries.length===1?"":"s"} queued</div>
        </div>
        <button class="btn primary sm" data-goto-log>Continue</button>
      </div>
    </div>`;
  }

  const sug = suggestedRoutine();
  if(sug){
    return `<div class="card">
      <div style="font-weight:800;font-size:17px">Ready to train?</div>
      <div class="tiny muted" style="margin-top:3px">Pick up where you left off, or start fresh.</div>
      <button class="btn primary full" data-start-routine="${sug.id}" style="margin-top:12px">▶ Start ${esc(sug.name)}</button>
      <button class="link small" data-start-empty style="margin-top:10px;display:block;width:100%;text-align:center;color:var(--accent)">or start an empty workout</button>
    </div>`;
  }
  return `<div class="card">
    <div style="font-weight:800;font-size:17px">Ready to train?</div>
    <div class="tiny muted" style="margin-top:3px">Build a routine below, grab a template, or jump straight in.</div>
    <button class="btn primary full" data-start-empty style="margin-top:12px">Start empty workout</button>
  </div>`;
}

/* ---------- warmth: a glance, not a wall ---------- */
function warmthCardHTML(){
  if(!DB.workouts.some(w => w.entries.length)) return "";
  const streak = currentStreak();
  const wk = weekStartKey();
  const weekCount = DB.workouts.filter(w => w.date >= wk && w.entries.length).length;
  return `<div class="card row" style="margin-top:12px;justify-content:center">
    <div class="home-stat"><div class="n">${streak}</div><div class="l">day streak</div></div>
    <div class="home-divider"></div>
    <div class="home-stat"><div class="n">${weekCount}</div><div class="l">this week</div></div>
  </div>`;
}

/* ---------- your routines ---------- */
function routineRowHTML(r){
  const names = r.exercises.map(e => e.name);
  const summary = names.length
    ? names.slice(0,3).join(" · ") + (names.length>3 ? ` +${names.length-3} more` : "")
    : "No exercises yet";
  return `<div class="card">
    <div class="row between">
      <div class="grow ellip" style="min-width:0">
        <div class="ellip" style="font-weight:700;font-size:16px">${esc(r.name)}</div>
        <div class="tiny muted ellip" style="margin-top:2px">${esc(summary)}</div>
      </div>
      <button class="btn primary sm" data-start-routine="${r.id}">Start</button>
    </div>
    <div class="row" style="margin-top:10px;gap:16px">
      <button class="link small" data-edit-routine="${r.id}" style="color:var(--accent)">Edit</button>
      <button class="link small" data-del-routine="${r.id}" style="color:var(--danger)">Delete</button>
    </div>
  </div>`;
}

function routinesSectionHTML(routines){
  return `
    <div class="row between" style="margin:22px 2px 10px">
      <div class="grouphdr" style="margin:0">YOUR ROUTINES</div>
      <button class="link small" data-new-routine style="color:var(--accent)">+ New</button>
    </div>
    ${routines.length
      ? routines.map(routineRowHTML).join("")
      : `<div class="faint small" style="padding:2px 2px 4px">No routines yet — build one, or grab a template below.</div>`}
  `;
}

/* ---------- starter templates ---------- */
function templateCardHTML(t, adopted){
  return `<div class="card">
    <div class="row between">
      <div class="grow" style="min-width:0">
        <div style="font-weight:700">${esc(t.name)}</div>
        <div class="tiny muted" style="margin-top:2px">${esc(t.blurb)}</div>
      </div>
      <button class="btn ${adopted?"ghost":"primary"} sm" data-start-template="${esc(t.slug)}">${adopted?"Added":"Start"}</button>
    </div>
  </div>`;
}

function templatesSectionHTML(routines){
  const adoptedSlugs = new Set(
    routines.filter(r => (r.source||"").startsWith("starter:")).map(r => r.source.slice(8))
  );
  const byTag = {};
  for(const t of STARTER_ROUTINES) (byTag[t.tag] = byTag[t.tag]||[]).push(t);
  const heading = routines.length ? "TRY A TEMPLATE" : "GET STARTED WITH A TEMPLATE";
  const groups = Object.entries(byTag).map(([tag, list]) => `
    <div class="tiny faint" style="margin:12px 2px 6px;font-weight:700;text-transform:uppercase;letter-spacing:.4px">${esc(tag)}</div>
    ${list.map(t => templateCardHTML(t, adoptedSlugs.has(t.slug))).join("")}
  `).join("");
  return `<div class="grouphdr" style="margin:22px 2px 10px">${heading}</div>${groups}`;
}

/* ---------- render ---------- */
function renderHome(){
  const titleEl = $("#homeTitle"), dateEl = $("#homeDate"), body = $("#homeBody");
  if(!titleEl || !body) return;
  titleEl.textContent = homeGreeting();
  if(dateEl) dateEl.textContent = fullDate(todayKey());

  const routines = DB.routines.slice().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  body.innerHTML = heroCardHTML() + warmthCardHTML()
    + routinesSectionHTML(routines) + templatesSectionHTML(routines);
}

/* ---------- start flows ---------- */
function startRoutineFlow(id){
  const r = routineById(id); if(!r) return;
  const added = startRoutine(id);
  switchTab("log");
  toast(added ? `Added ${added} exercise${added===1?"":"s"}`
             : (r.exercises.length ? "Already in today's workout" : "This routine has no exercises yet"));
}

function startTemplate(slug){
  let r = DB.routines.find(x => x.source === "starter:"+slug);
  if(!r) r = adoptStarter(slug);
  if(!r) return;
  const added = startRoutine(r.id);
  switchTab("log");
  toast(added ? `Added ${added} exercise${added===1?"":"s"}` : "Already in today's workout");
}

function deleteRoutineFlow(id){
  const r = routineById(id); if(!r) return;
  const name = r.name;
  // Confirm first, like every other container delete in the app (a whole
  // workout, an exercise and its history). Undo alone is the pattern for
  // something cheap like a single set; a routine you built up is not that.
  // The second sentence is the bit worth saying: deleting a routine touches
  // no logged workout, and without that the dialog reads scarier than it is.
  const n = r.exercises.length;
  if(!confirm(`Delete the routine “${name}”${n ? ` and its ${n} exercise${n===1?"":"s"}` : ""}?\n\nYour logged workouts aren't affected.`)) return;
  const undo = deleteRoutine(id);
  renderHome();
  toastUndo(`Deleted "${name}"`, ()=>{ undo(); renderHome(); });
}

/* ---------- routine editor (sheet) ---------- */
// Working copy lives here rather than in the DOM, because opening the
// exercise picker (openAddExercise) replaces #sheet's whole innerHTML —
// the draft is how the editor survives that round trip.
let _routineDraft = null;

function openRoutineEditor(id){
  const existing = id ? routineById(id) : null;
  _routineDraft = existing
    ? JSON.parse(JSON.stringify(existing))
    : { id:null, name:"", note:"", exercises:[] };
  renderRoutineEditorSheet();
}

function routineDraftRowHTML(e, i, last){
  return `<div class="rt-ex-row">
    <div class="row between">
      <div class="grow ellip" style="font-weight:600">${esc(e.name)}</div>
      <button class="iconbtn" data-remove-ex="${i}" aria-label="Remove ${esc(e.name)}">✕</button>
    </div>
    <div class="tiny muted" style="margin-top:2px">${esc(e.muscle||"")}</div>
    <div class="row" style="margin-top:8px;gap:8px">
      <input class="in rt-num" inputmode="numeric" data-rt-sets="${i}" value="${e.sets||""}" placeholder="sets">
      <span class="tiny faint">×</span>
      <input class="in rt-num" inputmode="numeric" data-rt-reps="${i}" value="${e.reps||""}" placeholder="reps">
      <div class="rt-move">
        <button class="step-btn" data-move-up="${i}" ${i===0?"disabled":""} aria-label="Move up">↑</button>
        <button class="step-btn" data-move-down="${i}" ${i===last?"disabled":""} aria-label="Move down">↓</button>
      </div>
    </div>
  </div>`;
}

function renderRoutineEditorSheet(){
  const d = _routineDraft; if(!d) return;
  const last = d.exercises.length-1;
  const rows = d.exercises.map((e,i)=>routineDraftRowHTML(e,i,last)).join("");
  openSheet(`
    <h2>${d.id ? "Edit routine" : "New routine"}</h2>
    <div class="field"><label>Name</label>
      <input class="in" id="rtName" placeholder="e.g. Push day" value="${esc(d.name)}" autocapitalize="words" autocomplete="off"></div>
    <div class="field"><label>Note <span class="faint">(optional)</span></label>
      <input class="in" id="rtNote" placeholder="e.g. heaviest press first" value="${esc(d.note||"")}"></div>
    <div class="grouphdr" style="margin-left:0">EXERCISES</div>
    ${rows || `<div class="faint small" style="padding:8px 0">No exercises yet.</div>`}
    <button class="btn ghost full sm" id="rtAddExBtn" style="margin-top:4px">+ Add exercise</button>
    <button class="btn primary full" id="rtSaveBtn" style="margin-top:16px">Save routine</button>
    <button class="btn full ghost" id="rtCancelBtn" style="margin-top:8px">Cancel</button>
  `);
}

// Re-reads every editable field — name, note, and each row's sets/reps —
// back into the draft before any structural change (add/remove/reorder/
// save) rebuilds the sheet's HTML. Without this, rebuilding the sheet
// regenerates the name/note inputs from the (stale) draft and silently
// discards whatever was typed but never blurred — e.g. naming a routine
// and then tapping "+ Add exercise" would wipe the name back to blank.
function syncDraftFromInputs(){
  if(!_routineDraft) return;
  const nameIn = $("#rtName"), noteIn = $("#rtNote");
  if(nameIn) _routineDraft.name = nameIn.value;
  if(noteIn) _routineDraft.note = noteIn.value;
  $$("[data-rt-sets]").forEach(inp=>{
    const i = +inp.dataset.rtSets, v = parseInt(inp.value,10);
    if(_routineDraft.exercises[i]) _routineDraft.exercises[i].sets = v>0 ? v : null;
  });
  $$("[data-rt-reps]").forEach(inp=>{
    const i = +inp.dataset.rtReps, v = parseInt(inp.value,10);
    if(_routineDraft.exercises[i]) _routineDraft.exercises[i].reps = v>0 ? v : null;
  });
}

function moveDraftExercise(i, dir){
  syncDraftFromInputs();
  const arr = _routineDraft.exercises, j = i+dir;
  if(j<0 || j>=arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  renderRoutineEditorSheet();
}

function removeDraftExercise(i){
  syncDraftFromInputs();
  _routineDraft.exercises.splice(i,1);
  renderRoutineEditorSheet();
}

// Called as the exercise picker's onChoose — by the time this fires the
// picker has already replaced #sheet's contents, so whoever opened the
// picker (the #rtAddExBtn handler) must have called syncDraftFromInputs()
// beforehand; there is no routine-editor DOM left here to read from.
function addExerciseToDraft(exId){
  if(_routineDraft.exercises.some(e=>e.exId===exId)){ toast("Already in this routine"); return; }
  const ex = exById(exId); if(!ex) return;
  _routineDraft.exercises.push({ exId, name:ex.name, muscle:ex.muscle, sets:3, reps:10 });
  renderRoutineEditorSheet();
}

function saveRoutineDraft(){
  syncDraftFromInputs();
  const name = (_routineDraft.name||"").trim();
  if(!name){ toast("Name your routine"); return; }
  const note = (_routineDraft.note||"").trim();
  let r = _routineDraft.id ? routineById(_routineDraft.id) : null;
  if(!r) r = { id: uid(), source:"user", createdAt: Date.now() };
  if(!r.source) r.source = "user";
  r.name = name;
  r.note = note;
  r.exercises = _routineDraft.exercises;
  saveRoutine(r);
  _routineDraft = null;
  closeSheet();
  renderHome();
  toast("Routine saved");
}

/* ---------- events ---------- */
// #homeBody and #sheet are static elements declared in index.html, so
// they always exist by the time this script runs — safe to bind here.
$("#homeBody").addEventListener("click", e=>{
  const startR = e.target.closest("[data-start-routine]");
  if(startR){ startRoutineFlow(startR.dataset.startRoutine); return; }
  const startT = e.target.closest("[data-start-template]");
  if(startT){ startTemplate(startT.dataset.startTemplate); return; }
  if(e.target.closest("[data-start-empty]")){ switchTab("log"); return; }
  if(e.target.closest("[data-goto-log]")){ switchTab("log"); return; }
  if(e.target.closest("[data-new-routine]")){ openRoutineEditor(null); return; }
  const editR = e.target.closest("[data-edit-routine]");
  if(editR){ openRoutineEditor(editR.dataset.editRoutine); return; }
  const delR = e.target.closest("[data-del-routine]");
  if(delR){ deleteRoutineFlow(delR.dataset.delRoutine); return; }
});

$("#sheet").addEventListener("click", e=>{
  if(!_routineDraft) return;   // some other sheet (exercise detail, etc.) is open
  if(e.target.closest("#rtAddExBtn")){
    syncDraftFromInputs();
    openAddExercise({ title:"Add to routine", markUsed:false, onChoose: addExerciseToDraft });
    return;
  }
  const up = e.target.closest("[data-move-up]");
  if(up){ moveDraftExercise(+up.dataset.moveUp, -1); return; }
  const down = e.target.closest("[data-move-down]");
  if(down){ moveDraftExercise(+down.dataset.moveDown, 1); return; }
  const rm = e.target.closest("[data-remove-ex]");
  if(rm){ removeDraftExercise(+rm.dataset.removeEx); return; }
  if(e.target.closest("#rtSaveBtn")){ saveRoutineDraft(); return; }
  if(e.target.closest("#rtCancelBtn")){ _routineDraft = null; closeSheet(); return; }
});
