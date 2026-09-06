"use strict";
/* ---------- HISTORY ---------- */
// Where a session came from, or null. w.routineId is stamped by startRoutine()
// (js/core.js) — the routine can be gone by now (deleted, or the workout
// predates routines entirely), so routineById() returning nothing here is a
// normal case to fall through, not a bug to surface as "undefined". Coach
// seeding (js/coach.js) never creates a routine — its plan is regenerated
// weekly and would go stale as one — so it stamps w.coachGroup instead; that's
// the fallback rather than something checked ahead of routineId, since the two
// never both apply to the same seeding action.
function sessionSourceLabel(w){
  if(w.routineId){
    const r = routineById(w.routineId);
    if(r) return r.name;
  }
  return w.coachGroup ? `Coach · ${w.coachGroup}` : null;
}

function renderHistory(){
  const sum = $("#weekSummary");
  const body = $("#historyBody");
  const sorted = [...DB.workouts].filter(w=>w.entries.length).sort((a,b)=> a.date<b.date?1:-1);

  if(!sorted.length){
    sum.innerHTML="";
    body.innerHTML = `<div class="empty"><div class="big">📅</div>No workouts yet.</div>`;
    return;
  }

  const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-6); cutoff.setHours(0,0,0,0);
  const counts = {};
  for(const w of sorted){
    const [y,m,d]=w.date.split("-").map(Number);
    if(new Date(y,m-1,d) < cutoff) continue;
    for(const en of w.entries){
      const ex = exById(en.exId); const mg = ex? ex.muscle : "Other";
      counts[mg] = (counts[mg]||0)+1;
    }
  }
  const chips = Object.entries(counts).sort((a,b)=>b[1]-a[1])
    .map(([mg,c])=>`<span class="chip"><span class="dot"></span>${esc(mg)} <span class="faint">${c}</span></span>`).join("");
  sum.innerHTML = chips
    ? `<div class="card"><div class="small muted" style="margin-bottom:9px;font-weight:700">LAST 7 DAYS</div><div class="chips">${chips}</div></div>`
    : "";

  body.innerHTML = sorted.map(w=>{
    const muscles = [...new Set(w.entries.map(en=>(exById(en.exId)||{}).muscle||"Other"))];
    const nSets = w.entries.reduce((a,en)=>a+en.sets.length,0);
    const exLines = w.entries.map(en=>{
      const ex = exById(en.exId)||{name:en.name};
      const work = en.sets.filter(isHardSet);
      const top = work.length? work.reduce((a,b)=>b.weight>a.weight?b:a,work[0]) : null;
      const detail = top? `<span class="muted small">${fmtKg(top.weight)}×${top.reps} · ${en.sets.length} sets</span>`
                        : `<span class="faint small">${en.sets.length} sets</span>`;
      return `<div class="row between" style="padding:6px 0"><span class="ellip">${esc(ex.name)}</span>${detail}</div>`;
    }).join("");
    const syncDot = w._sync ? `<span class="sync-dot ${w._sync}"></span>` : '';
    const dur = w.startedAt ? ` · ${fmtDur(sessionMs(w))}` : '';
    const noteHTML = w.note ? `<div class="hist-note">${esc(w.note)}</div>` : '';
    const srcLabel = sessionSourceLabel(w);
    const srcHTML = srcLabel ? `<div class="tiny faint" style="margin:-4px 0 8px">from ${esc(srcLabel)}</div>` : '';
    return `<div class="card">
      <div class="row between" style="margin-bottom:8px">
        <span class="wk-date">${dateLabel(w.date)}</span>
        <span class="row" style="gap:8px">${syncDot}<span class="faint small">${w.entries.length} exercises · ${nSets} sets${dur}</span></span>
      </div>
      ${srcHTML}
      <div class="chips" style="margin-bottom:6px">${muscles.map(m=>`<span class="chip">${esc(m)}</span>`).join("")}</div>
      ${exLines}
      ${noteHTML}
      <div style="margin-top:8px"><button class="btn sm ghost danger" data-del-workout="${w.id}">Delete workout</button></div>
    </div>`;
  }).join("");
}

/* ---------- HISTORY EVENTS ---------- */
$("#addPastBtn").addEventListener("click",()=>{
  switchTab("log");
  const d = $("#logDate");
  try{ d.showPicker(); }catch(_){ d.focus(); }
  toast("Pick the date, then add exercises");
});

$("#historyBody").addEventListener("click",e=>{
  const d = e.target.closest("[data-del-workout]");
  if(d){
    if(!confirm("Delete this entire workout?")) return;
    const id = d.dataset.delWorkout;
    const target = DB.workouts.find(w => w.id === id);
    // tombstone before removing so the cloud row gets cleaned up on next sync
    if(target && !target._demo) DB.deleted.push(id);
    DB.workouts = DB.workouts.filter(w=>w.id!==id);
    save(); render(); toast("Deleted");
  }
});
