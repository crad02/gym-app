"use strict";
/* ---------- Session clock + Rest timer ---------- */

// ── Workout clock ──────────────────────────────────────────────────────────
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

// ── Rest timer ─────────────────────────────────────────────────────────────
// Durations come from DB.settings (see DEFAULT_SETTINGS in core.js) so they're
// covered by backup/export like everything else. Compound lifts get the longer
// rest — judged by muscle group, which is a cheap stand-in for "this was heavy"
// that gets the big five right without asking you to tag anything.
const COMPOUND_MUSCLES = new Set(["Back","Quads","Hamstrings","Glutes","Chest"]);

// Rest duration in seconds for a given exercise. 0 means the timer is off.
function restDurFor(exId){
  const ex = exById(exId);
  const key = (ex && COMPOUND_MUSCLES.has(ex.muscle)) ? "restCompoundSec" : "restDefaultSec";
  const secs = +getSetting(key);
  return secs >= 0 ? secs : 0;
}

// Timer state — persists across tab switches (lives in module scope, not DOM).
let _restTarget = 0;      // epoch ms when the countdown hits zero
let _restExId   = null;   // which exercise triggered it (for duration lookup)
let _restTimer  = null;   // setInterval handle

function startRestTimer(exId){
  const dur = restDurFor(exId);
  if(!dur) return;                    // 0 = the user turned the timer off
  _restTarget = Date.now() + dur * 1000;
  _restExId   = exId;
  clearInterval(_restTimer);
  _restTimer  = setInterval(_tickRest, 500);
  _renderRestBar();
}

function skipRestTimer(){
  clearInterval(_restTimer); _restTimer = null;
  _restTarget = 0; _restExId = null;
  _renderRestBar();
}

function addRestTime(sec){
  if(!_restTarget) return;
  _restTarget += sec * 1000;
  _renderRestBar();
}

function restRemaining(){
  if(!_restTarget) return 0;
  return Math.max(0, _restTarget - Date.now());
}

function _tickRest(){
  const rem = restRemaining();
  _renderRestBar();
  if(rem <= 0){
    clearInterval(_restTimer); _restTimer = null;
    _restTarget = 0; _restExId = null;
    try{ navigator.vibrate([200, 100, 200]); }catch(_){}
    _renderRestBar();
  }
}

// The rest bar is a fixed element above the nav, rendered directly into the
// persistent #restBar div in the HTML. It must survive tab switches.
function _renderRestBar(){
  const bar = $("#restBar");
  if(!bar) return;
  const rem = restRemaining();
  if(!rem && !_restTimer){
    bar.classList.remove("active");
    bar.innerHTML = "";
    document.documentElement.style.removeProperty("--rest-pad");
    return;
  }
  // reserve scroll room so the bar never sits on top of the last set row
  document.documentElement.style.setProperty("--rest-pad", "52px");
  const totalSec = restDurFor(_restExId) || 1;
  const remSec   = Math.ceil(rem / 1000);
  const pct      = Math.max(0, Math.min(100, (rem / (totalSec * 1000)) * 100));
  const isUrgent = remSec <= 10;

  bar.classList.add("active");
  bar.innerHTML = `
    <div class="rest-inner${isUrgent?" urgent":""}">
      <div class="rest-progress" style="width:${pct.toFixed(1)}%"></div>
      <div class="rest-content">
        <span class="rest-label">REST</span>
        <span class="rest-val">${fmtClock(rem)}</span>
        <div class="rest-actions">
          <button class="rest-add" id="restAddBtn">+30s</button>
          <button class="rest-skip" id="restSkipBtn">Skip</button>
        </div>
      </div>
    </div>`;
}

// Wire buttons — delegation on the fixed bar element.
document.addEventListener("click", e=>{
  if(e.target.id === "restAddBtn"){ addRestTime(30); return; }
  if(e.target.id === "restSkipBtn"){ skipRestTimer(); return; }
});
