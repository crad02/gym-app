"use strict";
/* ---------- Session clock ---------- */
// The clock ticks by patching one text node — a full render() would tear down
// the set form mid-typing.
let _clockTimer = null;
function tickClock(){
  const w = activeWorkout(false);
  const el = $("#sessClock");
  if(!el || activeTab!=="log"){ clearInterval(_clockTimer); _clockTimer=null; return; }
  if(sessionState(w)!=="running"){ clearInterval(_clockTimer); _clockTimer=null; render(); return; }
  el.textContent = fmtClock(sessionMs(w));
}

function renderSessionBar(w, isToday){
  const st = sessionState(w);
  const bar = $("#sessionBar");
  clearInterval(_clockTimer); _clockTimer = null;

  if(st==="none"){
    bar.innerHTML = isToday
      ? `<button class="btn ghost full" id="startSessionBtn" style="margin-bottom:14px;color:var(--accent)">▶︎ Start workout</button>`
      : "";
    return;
  }
  if(st==="done"){
    bar.innerHTML = `<div class="sess done">
      <span class="sess-l">Duration</span>
      <span class="sess-v">${fmtDur(sessionMs(w))}</span>
      ${isToday ? `<button class="link small" id="resumeSessionBtn" style="color:var(--accent)">resume</button>
                   <button class="link small" id="clearSessionBtn" style="color:var(--faint)">clear</button>` : ""}
    </div>`;
    return;
  }
  const stale = st==="stale";
  bar.innerHTML = `<div class="sess ${stale?"stale":"live"}">
    <span class="sess-l">${stale ? "Last set was a while ago" : "In progress"}</span>
    <span class="sess-v" id="sessClock">${stale ? fmtDur(sessionMs(w)) : fmtClock(sessionMs(w))}</span>
    <button class="btn sm primary" id="finishSessionBtn">Finish</button>
  </div>`;
  if(!stale) _clockTimer = setInterval(tickClock, 1000);
}
