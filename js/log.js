"use strict";
/* ---------- LOG ---------- */
// Accordion state: which entry is in "lift mode". null = auto (last entry —
// the exercise you're currently working through). editingSet = tap-to-edit.
let openEntry = null;
let editingSet = null;   // {ei, si} | null

// The active plan's focus row for an exercise name (joined via the lab's
// app_exercise field, falling back to the lab's own name).
function coachAimFor(exName){
  let plan = null;
  try{ plan = JSON.parse(localStorage.getItem(PLAN_KEY)); }catch(_){}
  if(!plan?.groups || !exName) return null;
  const ln = exName.toLowerCase();
  for(const g of Object.values(plan.groups))
    for(const f of (g.focus||[]))
      if((f.app_exercise||'').toLowerCase()===ln || (f.exercise||'').toLowerCase()===ln)
        return f;
  return null;
}

/* ---------- Session note ---------- */
// Optional free text on the workout. Collapsed to a single line until used, so
// it costs nothing on the screen you're looking at mid-set.
let editingNote = false;

function renderNotesCard(w){
  const el = $("#notesCard");
  if(!w || !w.entries.length){ el.innerHTML = ""; editingNote = false; return; }
  const note = w.note || "";

  if(editingNote){
    el.innerHTML = `<div class="card">
      <div class="grouphdr" style="margin:0 0 8px 0">SESSION NOTE</div>
      <textarea class="in note-ta" id="noteTA" rows="3" maxlength="600"
        placeholder="How did it feel? Energy, niggles, sleep…">${esc(note)}</textarea>
      <div class="row" style="gap:8px;margin-top:9px">
        <button class="btn primary grow" id="noteSave">Save</button>
        <button class="btn ghost" id="noteCancel">Cancel</button>
      </div>
    </div>`;
    return;
  }

  el.innerHTML = note
    ? `<div class="card tap" id="noteOpen">
         <div class="row between" style="margin-bottom:6px">
           <span class="grouphdr" style="margin:0">SESSION NOTE</span>
           <span class="tiny faint">tap to edit</span>
         </div>
         <div class="note-body">${esc(note)}</div>
       </div>`
    : `<button class="btn ghost full sm" id="noteOpen" style="color:var(--muted)">✎ Add a note</button>`;
}

$("#notesCard").addEventListener("click", e=>{
  if(e.target.closest("#noteOpen")){
    editingNote = true; render();
    const ta = $("#noteTA");
    if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    return;
  }
  if(e.target.closest("#noteCancel")){ editingNote = false; render(); return; }
  if(e.target.closest("#noteSave")){
    const w = activeWorkout(false); if(!w) return;
    const v = ($("#noteTA").value || "").trim();
    if(v) w.note = v; else delete w.note;      // empty note leaves no trace
    editingNote = false;
    save(); render();
    toast(v ? "Note saved" : "Note cleared");
  }
});

/* ============================================================
   WEIGHT INCREMENT INFERENCE
   ============================================================ */
// What does this lift actually go up by? Rather than assume 2.5 kg everywhere,
// read it off the user's own history: take each session's top work set in date
// order and find the most common jump between consecutive sessions. Someone
// microloading a press in 1 kg steps gets 1 kg steppers; someone adding 5 kg to
// a squat gets 5.
function inferWeightIncrement(exId){
  const sessions = [];
  for(const w of DB.workouts){
    const en = w.entries.find(e=>e.exId===exId); if(!en) continue;
    const work = en.sets.filter(s=>s.type==="work"); if(!work.length) continue;
    const top = work.reduce((a,b)=>b.weight>a.weight?b:a, work[0]);
    sessions.push({ date:w.date, weight:top.weight });
  }
  // Chronological, not by weight — the gap between two sorted weights isn't a
  // progression step, it's just a gap in the distribution.
  sessions.sort((a,b)=> a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  if(sessions.length < 3) return _fallbackIncrement(exId);

  const jumps = [];
  for(let i=1;i<sessions.length;i++){
    const d = Math.abs(sessions[i].weight - sessions[i-1].weight);
    if(d > 0.1 && d <= 10) jumps.push(d);
  }
  if(!jumps.length) return _fallbackIncrement(exId);

  // modal jump rounded to nearest 0.25
  const rounded = jumps.map(j=>Math.round(j*4)/4);
  const freq = {};
  for(const j of rounded) freq[j] = (freq[j]||0)+1;
  const modal = +Object.entries(freq).sort((a,b)=>b[1]-a[1])[0][0];
  // sanity: between 0.25 and 5
  return (modal >= 0.25 && modal <= 5) ? modal : _fallbackIncrement(exId);
}

function _fallbackIncrement(exId){
  // Simple heuristic: look at last logged weight for this exercise.
  // Heavy lifts (> 40 kg typically barbell) → 2.5, lighter → 1.25
  const last = lastSession(exId);
  if(last && last.sets.length){
    const top = last.sets.reduce((a,b)=>b.weight>a.weight?b:a, last.sets[0]);
    if((top.weight||0) >= 40) return 2.5;
    return 1.25;
  }
  return 2.5;
}

/* ============================================================
   PLATE CALCULATOR
   ============================================================ */
// Bar weight and plate stock come from DB.settings (DEFAULT_SETTINGS in core.js),
// so they're in the backup and editable in More.
//
// Which lifts get plate math is guessed from the muscle group: these are the
// ones usually loaded on a bar. It's a guess, so it's only ever a hint under
// the weight field — a dumbbell press on Chest will show plate math that
// doesn't apply, and nothing breaks if you ignore it.
const BARBELL_MUSCLES = new Set(["Back","Chest","Quads","Hamstrings","Glutes","Shoulders"]);

function getPlateSettings(){
  const barKg  = +getSetting("barKg");
  const plates = getSetting("plates");
  return {
    barKg:  barKg > 0 ? barKg : DEFAULT_SETTINGS.barKg,
    plates: (Array.isArray(plates) && plates.length) ? plates : DEFAULT_SETTINGS.plates
  };
}

// Returns null when the exercise doesn't use a barbell, or the weight minus bar
// is not achievable with available plates.
function plateCalc(exId, totalKg){
  const ex = exById(exId);
  if(!ex || !BARBELL_MUSCLES.has(ex.muscle)) return null;
  if(!(totalKg > 0)) return null;

  const { barKg, plates } = getPlateSettings();
  const perSide = (totalKg - barKg) / 2;
  if(perSide < 0) return null;                // lighter than bar — no plate calc

  // greedy
  let rem = perSide;
  const used = [];
  for(const p of [...plates].sort((a,b)=>b-a)){
    while(rem >= p - 0.01){
      used.push(p); rem -= p;
    }
  }
  if(rem > 0.15) return null;                 // not achievable with these plates
  if(!used.length) return null;

  // collapse: [20,20,15] → "20×2 + 15"
  const freq = {};
  const order = [];
  for(const p of used){
    if(!freq[p]){ freq[p]=0; order.push(p); }
    freq[p]++;
  }
  const label = order.map(p=> freq[p]>1 ? `${p}×${freq[p]}` : `${p}`).join(" + ");
  return label;
}

/* ============================================================
   GHOST SETS
   ============================================================ */
// Ghost sets are pure render state — they NEVER touch DB.
// A ghost row is seeded from last session's work sets for an exercise.
// Committing a ghost (tapping ✓) calls commitGhost() which calls addSet().

const SWIPE_THRESHOLD = 80;          // px before a ghost is killed

// Which planned rows have been dealt with, per exercise. A ghost is addressed
// by its *slot* — its index into the seed list — and slots are never
// renumbered, so committing or killing the first of three rows removes that
// row and leaves the other two where they were. (An earlier version stored a
// count, which always dropped the last row instead of the one you tapped.)
//
// Keyed by exId, not entry index: delEntry() splices the array and would shift
// every index under us. addEntry() refuses duplicates, so exId is unique here.
//
// This is pure view state — it is never written to DB. An unlogged intention
// must not survive as a logged fact.
let _ghostState = {};   // { [exId]: { done:Set<slot>, extra:number } }

function ghostStateFor(exId){
  if(!_ghostState[exId]) _ghostState[exId] = { done:new Set(), extra:0 };
  return _ghostState[exId];
}
function resetGhosts(exId){ delete _ghostState[exId]; }
function resetAllGhosts(){ _ghostState = {}; }

// Build the ghost seed list for an entry. Returns array of {weight,reps}.
// Only work sets from last session seed ghosts; warm-ups do NOT.
function ghostSeedFor(en){
  const last = lastSession(en.exId);
  if(last && last.sets.length){
    // last.sets is already filtered to work sets by the lookup index
    return last.sets.map(s=>({ weight:s.weight, reps:s.reps }));
  }
  // No history. The coach's aim is personalised, so it beats a routine's
  // generic target; the routine still gives us the right *number* of rows for a
  // lift you've never done, which is better than a single blank one.
  const ex = exById(en.exId);
  const aim = ex ? coachAimFor(ex.name) : null;
  if(aim && aim.target_weight && aim.target_reps){
    return [{ weight: aim.target_weight, reps: aim.target_reps }];
  }
  const w = activeWorkout(false);
  const target = w && w.routineId ? routineTargetFor(w.routineId, en.exId) : null;
  if(target){
    return Array.from({length: target.sets}, ()=>({ weight: null, reps: target.reps }));
  }
  return [{ weight: null, reps: null }];
}

// The slots still showing for this exercise: every seed plus any extras the
// user asked for, minus the ones already committed or swiped away.
function ghostSlots(exId, seeds){
  const st = ghostStateFor(exId);
  const total = seeds.length + st.extra;
  const out = [];
  for(let i=0;i<total;i++) if(!st.done.has(i)) out.push(i);
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
function ghostRowsHTML(en, ei, seeds){
  const slots = ghostSlots(en.exId, seeds);
  if(!slots.length) return "";
  const inc = inferWeightIncrement(en.exId);
  let html = "";
  for(const gi of slots){
    const seed = seeds[gi] || seeds[seeds.length-1] || { weight:null, reps:null };
    const wVal = seed.weight !== null ? seed.weight : '';
    const rVal = seed.reps  !== null ? seed.reps  : '';
    // No "previous" column here on purpose: the ghost's numbers ARE last
    // session's numbers, so a prev column would print them twice and crowd the
    // row off a phone screen. Logged rows below still carry theirs.
    const stepper = (field, val, display) => `
      <span class="ghost-stepper">
        <button class="step-btn" data-step="-1" data-field="${field}" data-gei="${ei}" data-ggi="${gi}" aria-label="Down">−</button>
        <span class="step-val" data-gval="${field}">${display}</span>
        <button class="step-btn" data-step="+1" data-field="${field}" data-gei="${ei}" data-ggi="${gi}" aria-label="Up">+</button>
      </span>`;
    html += `<div class="set ghost-row" data-ghost="${ei}:${gi}"
      data-ghost-w="${wVal}" data-ghost-r="${rVal}" data-ghost-inc="${inc}">
      <div class="ghost-reveal" aria-hidden="true">✕ Remove</div>
      <div class="ghost-body">
        <span class="typetag ghost-tag">PLAN</span>
        <span class="ghost-fields">
          ${stepper('w', wVal, wVal !== '' ? fmtKg(+wVal) : '—')}
          <span class="ghost-x">×</span>
          ${stepper('r', rVal, rVal !== '' ? rVal : '—')}
        </span>
        <button class="ghost-check" data-commit-ghost="${ei}:${gi}" aria-label="Confirm set">✓</button>
      </div>
    </div>`;
  }
  return html;
}

// Commit a ghost row as a real logged set. This is the one place a planned row
// crosses into DB — everything before it is view state.
function commitGhost(ei, gi){
  const wk = activeWorkout(true);
  if(!wk || !wk.entries[ei]) return;
  const en = wk.entries[ei];

  const seeds = ghostSeedFor(en);
  const seed  = seeds[gi] || seeds[seeds.length-1] || { weight:null, reps:null };

  // Read the steppers' current values off the row's dataset — that's what the
  // stepper writes to, and it survives the display formatting round-trip that
  // parsing the visible text would have to undo.
  const ghostEl = $(`[data-ghost="${ei}:${gi}"]`);
  let w = seed.weight, r = seed.reps;
  if(ghostEl){
    const dw = parseFloat(ghostEl.dataset.ghostW);
    const dr = parseInt(ghostEl.dataset.ghostR, 10);
    if(!isNaN(dw)) w = dw;
    if(!isNaN(dr)) r = dr;
  }

  if(!(w >= 0) || !(r > 0)){ toast("Set weight & reps first"); return; }

  const set = { type:"work", weight: w, reps: r };
  const prevPB = pbFor(en.exId);
  en.sets.push(set);
  ghostStateFor(en.exId).done.add(gi);      // this plan row is now a fact
  save();
  const newPB = pbFor(en.exId);
  render();

  startRestTimer(en.exId);

  const ex  = exById(en.exId);
  const aim = ex ? coachAimFor(ex.name) : null;
  if(newPB && (!prevPB || newPB.weight>prevPB.weight || (newPB.weight===prevPB.weight && newPB.reps>prevPB.reps))
     && newPB.weight===w && newPB.reps===r){
    toast("🏆 New PB!");
  } else if(aim && w>=aim.target_weight && r>=aim.target_reps){
    toast(`🎯 Aim hit — ${fmtKg(w)}×${r}`);
  } else {
    toast("Set logged ✓");
  }
}

// Swiping a ghost away just marks its slot done — nothing to undo, because
// nothing was ever written.
function killGhost(ei, gi){
  const wk = activeWorkout(false);
  const en = wk && wk.entries[ei];
  if(!en) return;
  ghostStateFor(en.exId).done.add(gi);
  render();
}

/* ============================================================
   TOUCH SWIPE FOR GHOST ROWS
   ============================================================ */
// Touch swipe on ghost rows — distinguishable from scroll by:
//   1. We only begin tracking if first move is more horizontal than vertical.
//   2. A swipe_threshold must be reached before delete fires.
//   3. The reveal shows as you drag — visual feedback.

let _swipeState = null;  // { el, ei, gi, startX, startY, committed }

function _onGhostTouchStart(e){
  const row = e.target.closest("[data-ghost]"); if(!row) return;
  const [ei, gi] = row.dataset.ghost.split(":").map(Number);
  _swipeState = { el:row, ei, gi,
    startX: e.touches[0].clientX,
    startY: e.touches[0].clientY,
    horizontal: false, committed: false, dx: 0 };
}

function _onGhostTouchMove(e){
  if(!_swipeState || _swipeState.committed) return;
  const dx = e.touches[0].clientX - _swipeState.startX;
  const dy = e.touches[0].clientY - _swipeState.startY;

  if(!_swipeState.horizontal){
    // Determine intent on first meaningful move
    if(Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    if(Math.abs(dy) > Math.abs(dx)){
      // Vertical scroll intent — disengage.
      _swipeState = null; return;
    }
    _swipeState.horizontal = true;
  }

  e.preventDefault();       // stop scroll while we're swiping
  _swipeState.dx = dx;

  // Only allow leftward swipes to delete (feels natural: swipe to dismiss).
  // Rightward swipe is clamped at 0 so it doesn't drift.
  const clampedDx = Math.min(0, dx);
  const revealPct = Math.min(1, Math.abs(clampedDx) / SWIPE_THRESHOLD);

  const body = $(".ghost-body", _swipeState.el);
  const reveal = $(".ghost-reveal", _swipeState.el);
  if(body) body.style.transform = `translateX(${clampedDx}px)`;
  if(reveal){ reveal.style.opacity = revealPct.toFixed(2); }
}

function _onGhostTouchEnd(){
  if(!_swipeState || !_swipeState.horizontal){ _swipeState = null; return; }
  const { el, ei, gi, dx } = _swipeState;
  _swipeState = null;

  const body = $(".ghost-body", el);
  const reveal = $(".ghost-reveal", el);

  if(dx < -SWIPE_THRESHOLD){
    // Animate out, then kill.
    if(body) body.style.transition = "transform .18s ease";
    if(body) body.style.transform  = "translateX(-110%)";
    if(reveal){ reveal.style.opacity = "1"; }
    setTimeout(()=> killGhost(ei, gi), 170);
  } else {
    // Snap back.
    if(body){ body.style.transition = "transform .18s ease"; body.style.transform = ""; }
    if(reveal){ reveal.style.opacity = "0"; }
    setTimeout(()=>{ if(body){ body.style.transition = ""; } }, 200);
  }
}

// Wire swipe listeners once on the log body (delegation).
(function(){
  const body = document.getElementById("logBody");
  if(!body) return;
  body.addEventListener("touchstart",  _onGhostTouchStart,  { passive:true  });
  body.addEventListener("touchmove",   _onGhostTouchMove,   { passive:false });
  body.addEventListener("touchend",    _onGhostTouchEnd,    { passive:true  });
  body.addEventListener("touchcancel", _onGhostTouchEnd,    { passive:true  });
})();

/* ============================================================
   STEPPERS — live DOM update, no full render
   ============================================================ */
// Stepper clicks update the ghost row's displayed value in-place.
// Weight steppers use the inferred increment; reps always step by 1.
function _handleStepperClick(btn){
  const field = btn.dataset.field;         // "w" or "r"
  const gei   = +btn.dataset.gei;
  const ggi   = +btn.dataset.ggi;
  const delta = +btn.dataset.step;         // -1 or +1

  const row = $(`[data-ghost="${gei}:${ggi}"]`); if(!row) return;
  const inc = parseFloat(row.dataset.ghostInc) || 2.5;

  const valEl = $(`[data-gval="${field}"]`, row); if(!valEl) return;

  if(field === "w"){
    let cur = parseFloat(row.dataset.ghostW);
    if(isNaN(cur)) cur = 0;
    cur = Math.max(0, cur + delta * inc);
    cur = Math.round(cur * 100) / 100;     // avoid floating-point drift
    row.dataset.ghostW = cur;
    valEl.textContent  = fmtKg(cur);
  } else {
    let cur = parseInt(row.dataset.ghostR, 10);
    if(isNaN(cur)) cur = 0;
    cur = Math.max(1, cur + delta);
    row.dataset.ghostR = cur;
    valEl.textContent  = cur;
  }
}

/* ============================================================
   RENDERING HELPERS
   ============================================================ */
function setChipsHTML(sets){
  if(!sets.length) return `<div class="set-chips faint">no sets yet</div>`;
  const chips = sets.map(s=>{
    const label = `${fmtKg(s.weight)}×${s.reps}${s.type==='drop'?'+':''}`;
    return s.type==='warm' ? `<span class="warm">${label}</span>` : label;
  }).join(' · ');
  return `<div class="set-chips">${chips}</div>`;
}

// Context strip: LAST shows per-set rather than only the top set.
function ctxStripHTML(en, ex, i){
  const pb  = pbFor(en.exId);
  const last = lastSession(en.exId);
  const aim  = coachAimFor(ex.name);
  // "LAST" summary: still shows the top set in the strip; per-set data is
  // shown inline in the set rows.
  const lastTop = last ? last.sets.reduce((a,b)=>b.weight>a.weight?b:a, last.sets[0]) : null;
  return `<div class="ctx-strip">
    <div class="ctx"><div class="cl">LAST</div><div class="cv">${lastTop ? `${fmtKg(lastTop.weight)}×${lastTop.reps}` : '—'}</div></div>
    ${aim ? `<div class="ctx aim" data-aim="${i}" data-aim-w="${aim.target_weight}" data-aim-r="${aim.target_reps}" title="Tap to use">
      <div class="cl">AIM${aim.expected_change!=null ? (aim.expected_change>0.5?' ↑':aim.expected_change<-0.5?' ↓':' →') : ''}</div>
      <div class="cv">${fmtKg(aim.target_weight)}×${aim.target_reps}</div></div>` : ''}
    <div class="ctx pbx tappable" data-pbpop="${en.exId}" title="Tap for progression">
      <div class="cl">PB ↗</div><div class="cv">${pb ? `${fmtKg(pb.weight)}×${pb.reps}` : '—'}</div></div>
  </div>`;
}

// Plate calculator snippet — appears beneath the weight stepper for barbell lifts.
function plateHintHTML(exId, weight){
  if(!(weight > 0)) return '';
  const label = plateCalc(exId, weight);
  if(!label) return '';
  return `<div class="plate-hint">
    <span class="plate-icon">🏋</span>
    <span>${label} / side</span>
  </div>`;
}

// Per-set "previous" column: row N shows what row N was last time.
function prevForRow(last, si){
  if(!last || !last.sets[si]) return null;
  return last.sets[si];
}

function setRowsHTML(en, i){
  const last = lastSession(en.exId);
  return en.sets.map((s,si)=>{
    const tag   = s.type==='work'?'work':s.type==='drop'?'drop':'warm';
    const label = s.type==='work'?'WORK':s.type==='drop'?'DROP':'WARMUP';
    const isEditing = editingSet && editingSet.ei===i && editingSet.si===si;
    const isPB  = (() => {
      if(!isHardSet(s)) return false;
      const pb = pbFor(en.exId);
      return pb && s.weight===pb.weight && s.reps===pb.reps;
    })();

    let valHtml;
    if(s.type==='drop'){
      const chain = [{weight:s.weight,reps:s.reps}, ...(s.drops||[])]
        .map(d=>`${fmtKg(d.weight)}<small>×${d.reps}</small>`).join(' <span class="faint">→</span> ');
      valHtml = `<span class="val" style="grid-column:2/5">${chain}</span>`;
    } else {
      // Per-set previous column
      const prev = prevForRow(last, si);
      const prevHtml = prev
        ? `<span class="set-prev">${fmtKg(prev.weight)}<small>×${prev.reps}</small></span>`
        : `<span class="set-prev faint">—</span>`;
      valHtml = `<span class="val">${fmtKg(s.weight)}</span>
        <span class="val">${s.reps} <small>reps</small></span>
        ${prevHtml}`;
    }
    return `<div class="set editable${isEditing?' editing':''}${isPB?' set-pb':''}" data-edit-set="${i}:${si}">
      <span class="typetag ${tag}">${label}</span>
      ${valHtml}
      <button class="iconbtn" data-dup-set="${i}:${si}" aria-label="Repeat set" style="color:var(--accent);font-size:18px">⧉</button>
      <button class="iconbtn" data-del-set="${i}:${si}" aria-label="Delete set">✕</button>
    </div>`;
  }).join("");
}

// prefill: the set being edited > this entry's last set > last session's top
function prefillFor(en, i){
  const editSet = (editingSet && editingSet.ei===i) ? en.sets[editingSet.si] : null;
  const prevSet = en.sets.length ? en.sets[en.sets.length-1] : null;
  if(editSet) return {type:editSet.type, w:editSet.weight, r:editSet.reps, drops:editSet.drops};
  // Never carry a set type forward: a warm-up precedes work, it doesn't repeat,
  // and a drop set isn't the default either. Weight/reps still prefill.
  if(prevSet) return {type:'work', w:prevSet.weight, r:prevSet.reps};
  const last = lastSession(en.exId);
  const lastTop = last ? last.sets.reduce((a,b)=>b.weight>a.weight?b:a, last.sets[0]) : null;
  return lastTop ? {type:'work', w:lastTop.weight, r:lastTop.reps} : {};
}

// Inline weight/reps steppers used in the set form (for the Add-set row).
function stepperHTML(field, val, exId){
  const inc = inferWeightIncrement(exId);
  const display = (field==='w') ? (val !== '' && val !== undefined ? fmtKg(+val) : '') : (val ?? '');
  return `<div class="form-stepper">
    <button class="step-btn form-step" data-fstep="${field}" data-fval="${field==='w'?inc:1}" data-fdir="-1" type="button">−</button>
    <input class="in stepper-in" inputmode="${field==='w'?'decimal':'numeric'}" enterkeyhint="done"
      data-${field} placeholder="${field==='w'?'kg':'reps'}" value="${val ?? ''}">
    <button class="step-btn form-step" data-fstep="${field}" data-fval="${field==='w'?inc:1}" data-fdir="+1" type="button">+</button>
  </div>`;
}

function setFormHTML(entryIdx, pre, editing, exId){
  pre = pre || {};
  const t = pre.type || 'work';
  const dropRows = (t==='drop' ? (pre.drops||[]) : []).map(d=>`
    <div class="droprow" data-droprow>
      <input class="in" inputmode="decimal" data-dw placeholder="drop kg" value="${d.weight ?? ''}">
      <input class="in" inputmode="numeric" data-dr placeholder="reps" value="${d.reps ?? ''}">
      <button class="iconbtn" data-deldrop aria-label="Remove drop">✕</button>
    </div>`).join('');

  // Plate hint for current weight value
  const wVal = pre.w !== undefined ? pre.w : '';
  const plateHtml = (t !== 'drop') ? plateHintHTML(exId, +wVal) : '';

  return `<div data-setform="${entryIdx}">
    <div class="typerow" data-typeseg>
      <div class="seg${t==='warm'?' warmon':''}${t==='drop'?' dropon':''}" data-segbox>
        <button data-type="work"${t==='work'||t==='warm'?' class="on"':''}>Working</button>
        <button data-type="drop"${t==='drop'?' class="on"':''}>Drop</button>
      </div>
      <button class="warmtog${t==='warm'?' on':''}" data-type="warm">Warm-up</button>
    </div>
    <div class="setform">
      <div class="field" style="margin:0">
        <label data-wlabel>${t==='drop'?'Top set (kg)':'Weight (kg)'}</label>
        ${stepperHTML('w', wVal, exId)}
        ${plateHtml}
      </div>
      <div class="field" style="margin:0">
        <label>Reps</label>
        ${stepperHTML('r', pre.r !== undefined ? pre.r : '', exId)}
      </div>
      <button class="btn primary" data-addset="${entryIdx}" style="height:48px">${editing?'Update':'Add'}</button>
    </div>
    <div data-dropwrap style="display:${t==='drop'?'block':'none'}">
      <div data-droprows>${dropRows}</div>
      <button class="link small" data-adddrop="${entryIdx}" style="margin-top:8px">+ add drop</button>
    </div>
  </div>`;
}

/* ============================================================
   RENDER LOG
   ============================================================ */
function renderLog(){
  const isToday = editDate===todayKey();
  $("#logTitle").textContent = isToday ? "Today" : "Past workout";
  const di = $("#logDate"); di.max = todayKey(); di.value = editDate;
  $("#logSub").innerHTML = isToday
    ? `<span class="faint small">${fullDate(editDate)}</span>`
    : `<span class="small muted">${fullDate(editDate)}</span> &nbsp;·&nbsp; <a class="link small" id="backToday">Back to today →</a>`;

  const w = activeWorkout(false);
  const body = $("#logBody");
  renderSessionBar(w, isToday);
  renderNotesCard(w);
  // the session bar owns Finish once a clock is running; this stays for
  // back-filled workouts, which are never clocked
  $("#finishBtn").style.display = (w && w.entries.length && sessionState(w)==="none") ? "block":"none";

  if(!w || !w.entries.length){
    body.innerHTML = `<div class="empty"><div class="big">🏋️</div>No exercises logged ${isToday?"today":"on this day"}.<br>Tap "Add exercise" to start.</div>`;
    return;
  }

  // today summary stats
  let workSets=0, volume=0;
  for(const en of w.entries) for(const s of en.sets) if(isHardSet(s)){ workSets++; volume += setVolume(s); }
  const volStr = volume>=1000 ? (volume/1000).toFixed(1)+"k" : Math.round(volume);
  const statRow = `<div class="statrow">
    <div class="stat"><div class="n">${w.entries.length}</div><div class="l">exercises</div></div>
    <div class="stat"><div class="n">${workSets}</div><div class="l">work sets</div></div>
    <div class="stat"><div class="n">${volStr}</div><div class="l">kg volume</div></div>
  </div>`;

  // paired exercises render as one card, so the accordion counts blocks, not
  // entries — openEntry is a block index
  const blocks = logBlocks(w.entries);
  const openIdx = openEntry===-1 ? -1
    : (openEntry!==null && openEntry>=0 && openEntry<blocks.length)
      ? openEntry : blocks.length-1;
  const openBlock = blocks[openIdx];
  if(editingSet && !(openBlock && openBlock.idxs.includes(editingSet.ei))) editingSet = null;

  // Ghost state only makes sense for the card you're looking at. Drop it for
  // every other exercise so a card re-seeds from last session when reopened,
  // and so a swipe-kill on Monday isn't still in effect on Tuesday.
  const openExIds = new Set((openBlock ? openBlock.idxs : []).map(i => w.entries[i].exId));
  for(const exId of Object.keys(_ghostState)){
    if(!openExIds.has(exId)) delete _ghostState[exId];
  }

  body.innerHTML = statRow + blocks.map((b,bi)=>
    b.idxs.length>1 ? supersetCardHTML(w, b, bi, bi===openIdx)
                    : entryCardHTML(w, b.idxs[0], bi, bi===openIdx)
  ).join("");
}

// Entries sharing a `group` are a superset and collapse into a single block.
function logBlocks(entries){
  const blocks = [], seen = new Set();
  entries.forEach((en,i)=>{
    if(seen.has(i)) return;
    if(en.group){
      const idxs = entries.reduce((a,e,j)=>(e.group===en.group && a.push(j), a), []);
      idxs.forEach(j=>seen.add(j));
      blocks.push({ group:en.group, idxs });
    } else { seen.add(i); blocks.push({ idxs:[i] }); }
  });
  return blocks;
}

function entryCardHTML(w, i, bi, isOpen){
  const en = w.entries[i];
  const ex = exById(en.exId) || {name:en.name,muscle:"Other"};

  // ── collapsed: one glance — name + the sets banked so far ──
  if(!isOpen){
    return `<div class="card ex-card">
      <div class="ex-head" data-card-head="${bi}">
        <div class="grow" style="min-width:0">
          <div class="ex-name">${esc(ex.name)}</div>
          ${setChipsHTML(en.sets)}
        </div>
        <span class="caret">▼</span>
      </div>
    </div>`;
  }

  // ── expanded: lift mode ──
  const seeds = ghostSeedFor(en);

  return `<div class="card ex-card open">
    <div class="ex-head" data-card-head="${bi}">
      <div class="grow" style="min-width:0">
        <div class="ex-name">${esc(ex.name)}</div>
        <div class="row" style="gap:6px;margin-top:5px"><span class="chip"><span class="dot"></span>${esc(ex.muscle)}</span></div>
      </div>
      <button class="iconbtn" data-del-entry="${i}">🗑</button>
      <span class="caret">▼</span>
    </div>
    ${ctxStripHTML(en, ex, i)}
    ${setRowsHTML(en, i)}
    ${ghostRowsHTML(en, i, seeds)}
    ${editingSet ? `<div class="edit-bar"><span>Editing set ${editingSet.si+1}</span><button class="link small" data-cancel-edit>cancel</button></div>` : ''}
    ${setFormHTML(i, prefillFor(en,i), !!editingSet, en.exId)}
    <button class="btn ghost full sm add-extra-btn" data-extra-ghost="${i}" style="margin-top:6px;color:var(--faint)">+ add extra set</button>
    <button class="btn ghost full sm superset-btn" data-superset="${i}">⇄ Superset with…</button>
  </div>`;
}

// A superset logs by round: one form, both lifts, one Add.
function supersetCardHTML(w, block, bi, isOpen){
  const ens  = block.idxs.map(i=>w.entries[i]);
  const exs  = ens.map(en=>exById(en.exId) || {name:en.name,muscle:"Other"});
  const names = exs.map(e=>esc(e.name)).join(' <span class="faint">⇄</span> ');

  if(!isOpen){
    return `<div class="card ex-card">
      <div class="ex-head" data-card-head="${bi}">
        <div class="grow" style="min-width:0">
          <div class="ss-tag">⇄ Superset</div>
          <div class="ex-name">${names}</div>
          ${setChipsHTML(ens.flatMap(en=>en.sets))}
        </div>
        <span class="caret">▼</span>
      </div>
    </div>`;
  }

  // rounds pair set N of each lift; a ragged tail just renders short
  const rounds = Math.max(0, ...ens.map(en=>en.sets.length));
  let roundsHTML = "";
  for(let r=0;r<rounds;r++){
    const lines = ens.map((en,k)=>{
      const s = en.sets[r];
      if(!s) return `<div class="rd-line faint"><span class="rd-n">${esc(exs[k].name)}</span><span>—</span></div>`;
      // no tap-to-edit inside a round — a per-set editor in a paired form is
      // ambiguous; delete the round and re-add instead
      return `<div class="rd-line">
        <span class="rd-n">${esc(exs[k].name)}</span>
        <span class="rd-v">${fmtKg(s.weight)} <small>× ${s.reps}</small></span>
      </div>`;
    }).join("");
    roundsHTML += `<div class="round">
      <div class="rd-head"><span class="rd-lbl">ROUND ${r+1}</span>
        <button class="iconbtn" data-del-round="${block.group}:${r}" aria-label="Delete round">✕</button></div>
      ${lines}
    </div>`;
  }

  const formRows = ens.map((en,k)=>{
    const pre = prefillFor(en, block.idxs[k]);
    return `<div class="rd-form" data-ssrow="${block.idxs[k]}">
      <span class="rd-n ellip">${esc(exs[k].name)}</span>
      <input class="in" inputmode="decimal" enterkeyhint="done" data-ssw placeholder="kg" value="${pre.w ?? ''}">
      <input class="in" inputmode="numeric" enterkeyhint="done" data-ssr placeholder="reps" value="${pre.r ?? ''}">
    </div>`;
  }).join("");

  return `<div class="card ex-card open">
    <div class="ex-head" data-card-head="${bi}">
      <div class="grow" style="min-width:0">
        <div class="ss-tag">⇄ Superset</div>
        <div class="ex-name">${names}</div>
      </div>
      <span class="caret">▼</span>
    </div>
    ${roundsHTML}
    <div class="grouphdr" style="margin:14px 0 8px 0">NEXT ROUND</div>
    <div data-ssform="${block.group}">${formRows}</div>
    <button class="btn primary full" data-addround="${block.group}" style="margin-top:10px">+ Add round</button>
    <button class="btn ghost full sm" data-unlink="${block.group}" style="margin-top:8px;color:var(--muted)">Unlink superset</button>
  </div>`;
}

/* ============================================================
   SUPERSET HELPERS
   ============================================================ */
// Pairing keeps the two entries adjacent so the block reads in the order you
// actually lift them.
function addSupersetPartner(anchorIdx, exId){
  const w = activeWorkout(true);
  const anchor = w.entries[anchorIdx];
  if(!anchor){ closeSheet(); return; }
  if(w.entries.some(en=>en.exId===exId)){ toast("Already in this workout"); closeSheet(); return; }
  const ex = exById(exId);
  const g = anchor.group || uid();
  anchor.group = g;
  w.entries.splice(anchorIdx+1, 0, { exId, name:ex.name, sets:[], group:g });
  save();
  editingSet = null;
  openEntry = logBlocks(w.entries).findIndex(b=>b.group===g);   // keep the pair open
  closeSheet();
  if(activeTab!=="log") switchTab("log"); else render();
  toast("Superset created");
}

function addRound(group){
  const w = activeWorkout(true);
  const form = $(`[data-ssform="${group}"]`);
  if(!form) return;
  const rows = $$("[data-ssrow]", form).map(row=>({
    i: +row.dataset.ssrow,
    weight: parseFloat($("[data-ssw]",row).value),
    reps: parseInt($("[data-ssr]",row).value,10),
  }));
  const valid = rows.filter(r=>r.weight>=0 && r.reps>0);
  if(!valid.length){ toast("Enter weight & reps"); return; }
  const prevPBs = valid.map(r=>pbFor(w.entries[r.i].exId));
  valid.forEach(r=>w.entries[r.i].sets.push({ type:"work", weight:r.weight, reps:r.reps }));
  save(); render();
  focusField($(`[data-ssform="${group}"] [data-ssrow] [data-ssr]`));   // straight into the next round
  const gotPB = valid.some((r,k)=>{
    const nb = pbFor(w.entries[r.i].exId), pb = prevPBs[k];
    return nb && (!pb || nb.weight>pb.weight || (nb.weight===pb.weight && nb.reps>pb.reps));
  });
  // Rest timer on round completion — use first exercise in superset.
  if(valid.length){
    startRestTimer(w.entries[valid[0].i].exId);
  }
  toast(gotPB ? "🏆 New PB!" : (valid.length<rows.length ? "Round added (one lift skipped)" : "Round added"));
}

// Deleting a round pulls set N from every lift in the pair, so they stay aligned.
function delRound(group, r){
  const w = activeWorkout(false); if(!w) return;
  const undo = snapshotWorkout(w);
  w.entries.forEach(en=>{ if(en.group===group && en.sets[r]) en.sets.splice(r,1); });
  editingSet = null;
  save(); render();
  toastUndo(`Round ${r+1} deleted`, undo);
}

function unlinkSuperset(group){
  const w = activeWorkout(false); if(!w) return;
  w.entries.forEach(en=>{ if(en.group===group) delete en.group; });
  editingSet = null; openEntry = null;
  save(); render(); toast("Unlinked");
}

function addEntry(exId){
  const w = activeWorkout(true);
  if(!w.entries.some(en=>en.exId===exId)){
    const ex = exById(exId);
    w.entries.push({ exId, name:ex.name, sets:[] });
    save();
  }
  openEntry = null; editingSet = null;   // auto-open the newest exercise
  closeSheet();
  if(activeTab!=="log") switchTab("log");
  else render();
  toast("Added");
}

/* ============================================================
   DATA MUTATIONS
   ============================================================ */
function addSet(entryIdx){
  const form = $(`[data-setform="${entryIdx}"]`);
  const type = formType(form);
  const wIn  = $("[data-w]",form);
  const rIn  = $("[data-r]",form);
  const w    = parseFloat(wIn ? wIn.value : "");
  const r    = parseInt(rIn ? rIn.value : "", 10);
  if(!(w>=0) || !(r>0)){ toast(type==="drop"?"Enter the top set":"Enter weight & reps"); return; }
  let set;
  if(type==="drop"){
    const drops = [];
    for(const row of $$("[data-droprow]",form)){
      const dw = parseFloat($("[data-dw]",row).value), dr = parseInt($("[data-dr]",row).value,10);
      if(dw>=0 && dr>0) drops.push({ weight:dw, reps:dr });
    }
    if(!drops.length){ toast("Add at least one drop"); return; }
    set = { type:"drop", weight:w, reps:r, drops };
  } else {
    set = { type, weight:w, reps:r };
  }
  const wk = activeWorkout(true);

  // tap-to-edit: replace in place instead of appending
  if(editingSet && editingSet.ei===entryIdx && wk.entries[entryIdx].sets[editingSet.si]){
    wk.entries[entryIdx].sets[editingSet.si] = set;
    editingSet = null;
    save(); render(); toast("Set updated");
    return;
  }

  const prevPB = pbFor(wk.entries[entryIdx].exId);
  wk.entries[entryIdx].sets.push(set);
  save();
  const newPB = pbFor(wk.entries[entryIdx].exId);
  render();

  focusField($(`[data-setform="${entryIdx}"] [data-r]`));

  // Rest timer on any work set.
  if(isHardSet(set)) startRestTimer(wk.entries[entryIdx].exId);

  const ex  = exById(wk.entries[entryIdx].exId);
  const aim = ex ? coachAimFor(ex.name) : null;
  if(isHardSet(set) && newPB && (!prevPB || newPB.weight>prevPB.weight || (newPB.weight===prevPB.weight && newPB.reps>prevPB.reps))
     && newPB.weight===w && newPB.reps===r){
    toast("🏆 New PB!");
  } else if(set.type==="work" && aim && w>=aim.target_weight && r>=aim.target_reps){
    toast(`🎯 Aim hit — ${fmtKg(w)}×${r}`);
  } else {
    toast(type==="drop"?"Drop set added":"Set added");
  }
}

function dupSet(entryIdx,setIdx){
  const w = activeWorkout(false); if(!w) return;
  const s = w.entries[entryIdx].sets[setIdx];
  const copy = {...s};
  if(s.drops) copy.drops = s.drops.map(d=>({...d}));
  w.entries[entryIdx].sets.splice(setIdx+1, 0, copy);
  save(); render(); toast("Set repeated");
}

function delSet(entryIdx,setIdx){
  const w = activeWorkout(false); if(!w) return;
  const undo = snapshotWorkout(w);
  w.entries[entryIdx].sets.splice(setIdx,1);
  editingSet = null;
  save(); render();
  toastUndo("Set deleted", undo);
}

function delEntry(entryIdx){
  const w = activeWorkout(false); if(!w) return;
  const name = (exById(w.entries[entryIdx].exId) || w.entries[entryIdx]).name || "Exercise";
  const n = w.entries[entryIdx].sets.length;
  if(!confirm(`Remove ${name}${n ? ` and its ${n} set${n===1?"":"s"}` : ""} from this workout?`)) return;
  const undo = snapshotWorkout(w);
  w.entries.splice(entryIdx,1);
  if(!w.entries.length){
    if(!w._demo && DB.deleted) DB.deleted.push(w.id);
    DB.workouts = DB.workouts.filter(x=>x!==w);
  }
  openEntry = null; editingSet = null;
  save(); render();
  toastUndo(`${name} removed`, undo);
}

/* ============================================================
   LOG EVENTS
   ============================================================ */
$("#addExerciseBtn").addEventListener("click", ()=>openAddExercise());
$("#logDate").addEventListener("change",()=>{ setEditDate($("#logDate").value); resetAllGhosts(); render(); });
$("#logSub").addEventListener("click",e=>{ if(e.target.id==="backToday"){ setEditDate(todayKey()); resetAllGhosts(); render(); } });

$("#finishBtn").addEventListener("click",()=>{
  toast("Saved to history");
  switchTab("history");
});

$("#sessionBar").addEventListener("click",e=>{
  if(e.target.closest("#startSessionBtn")){ startSession(); toast("Clock started ⏱"); return; }
  if(e.target.closest("#resumeSessionBtn")){ resumeSession(); toast("Clock resumed"); return; }
  if(e.target.closest("#clearSessionBtn")){ clearSession(); toast("Clock removed"); return; }
  if(e.target.closest("#finishSessionBtn")){
    const ms = finishSession();
    toast(`Finished · ${fmtDur(ms)}`);
    switchTab("history");
  }
});

$("#logBody").addEventListener("click",e=>{
  // Ghost: commit
  const commit = e.target.closest("[data-commit-ghost]");
  if(commit){
    const [ei,gi] = commit.dataset.commitGhost.split(":").map(Number);
    commitGhost(ei, gi); return;
  }

  // Stepper: ghost row step buttons
  const stepBtn = e.target.closest(".step-btn[data-gei]");
  if(stepBtn){ _handleStepperClick(stepBtn); return; }

  // Stepper: form step buttons (for the Add-set form)
  const fstep = e.target.closest(".form-step");
  if(fstep){
    const field = fstep.dataset.fstep;
    const inc   = parseFloat(fstep.dataset.fval) || 1;
    const dir   = +fstep.dataset.fdir;
    const form  = fstep.closest("[data-setform]"); if(!form) return;
    const inp   = $(`[data-${field}]`, form); if(!inp) return;
    const cur   = field==='w' ? (parseFloat(inp.value)||0) : (parseInt(inp.value,10)||0);
    const nxt   = field==='w' ? Math.max(0, Math.round((cur + dir*inc)*100)/100) : Math.max(1, cur + dir);
    inp.value   = nxt;
    // Update plate hint after weight stepper.
    if(field==='w'){
      const form2 = fstep.closest("[data-setform]"); if(!form2) return;
      const ei    = +form2.dataset.setform;
      const wk    = activeWorkout(false);
      const exId  = wk && wk.entries[ei] ? wk.entries[ei].exId : null;
      const plEl  = $(".plate-hint", form2);
      const container = $(".field", form2);
      if(exId && container){
        const newHint = plateHintHTML(exId, nxt);
        if(plEl) plEl.outerHTML = newHint || '';
        else if(newHint) container.insertAdjacentHTML('beforeend', newHint);
      }
    }
    return;
  }

  // Add extra ghost beyond the plan count
  const extra = e.target.closest("[data-extra-ghost]");
  if(extra){
    const ei = +extra.dataset.extraGhost;
    const wk = activeWorkout(false); if(!wk || !wk.entries[ei]) return;
    ghostStateFor(wk.entries[ei].exId).extra++;
    render(); return;
  }

  const seg = e.target.closest("[data-type]");
  if(seg){
    const wrap = seg.closest("[data-typeseg]");
    const box = $("[data-segbox]", wrap), warmBtn = $(".warmtog", wrap);
    if(seg.classList.contains("warmtog")){
      const on = !warmBtn.classList.contains("on");
      warmBtn.classList.toggle("on", on);
      // a warm-up is always a straight set, never a drop
      if(on) $$("button",box).forEach(b=>b.classList.toggle("on", b.dataset.type==="work"));
    } else {
      $$("button",box).forEach(b=>b.classList.remove("on"));
      seg.classList.add("on");
      warmBtn.classList.remove("on");        // picking Working/Drop clears warm-up
    }
    const type = formType(wrap);
    box.classList.toggle("warmon", type==="warm");
    box.classList.toggle("dropon", type==="drop");
    const form = seg.closest("[data-setform]");
    const dw = $("[data-dropwrap]", form);
    if(dw){
      dw.style.display = type==="drop" ? "block" : "none";
      $("[data-wlabel]", form).textContent = type==="drop" ? "Top set (kg)" : "Weight (kg)";
      if(type==="drop" && !$("[data-droprow]", form)) addDropRow(form);   // start with one drop
    }
    return;
  }

  const adrop = e.target.closest("[data-adddrop]");
  if(adrop){ addDropRow(adrop.closest("[data-setform]")); return; }
  const ddrop = e.target.closest("[data-deldrop]");
  if(ddrop){ ddrop.closest("[data-droprow]").remove(); return; }
  const add = e.target.closest("[data-addset]");
  if(add){ addSet(+add.dataset.addset); return; }
  const dup = e.target.closest("[data-dup-set]");
  if(dup){ const [ei,si]=dup.dataset.dupSet.split(":").map(Number); dupSet(ei,si); return; }
  const ds = e.target.closest("[data-del-set]");
  if(ds){ const [ei,si]=ds.dataset.delSet.split(":").map(Number); delSet(ei,si); return; }
  const de = e.target.closest("[data-del-entry]");
  if(de){ delEntry(+de.dataset.delEntry); return; }
  const cancel = e.target.closest("[data-cancel-edit]");
  if(cancel){ editingSet = null; render(); return; }
  const pbp = e.target.closest("[data-pbpop]");
  if(pbp){ openPBPop(pbp.dataset.pbpop, pbp); return; }
  const aim = e.target.closest("[data-aim]");
  if(aim){
    const form = $(`[data-setform="${aim.dataset.aim}"]`);
    if(form){
      const wIn = $("[data-w]",form), rIn = $("[data-r]",form);
      if(wIn) wIn.value = aim.dataset.aimW;
      if(rIn) rIn.value = aim.dataset.aimR;
    }
    toast("Aim loaded — hit Add"); return;
  }
  const ss = e.target.closest("[data-superset]");
  if(ss){
    openAddExercise({ title:"Pair with…", onChoose:(exId)=>addSupersetPartner(+ss.dataset.superset, exId) });
    return;
  }
  const round = e.target.closest("[data-addround]");
  if(round){ addRound(round.dataset.addround); return; }
  const delr = e.target.closest("[data-del-round]");
  if(delr){ const [g,r]=delr.dataset.delRound.split(":"); delRound(g,+r); return; }
  const unlink = e.target.closest("[data-unlink]");
  if(unlink){ unlinkSuperset(unlink.dataset.unlink); return; }
  const es = e.target.closest("[data-edit-set]");
  if(es && !e.target.closest("button")){
    const [ei,si] = es.dataset.editSet.split(":").map(Number);
    // tap the row you're already editing to cancel out of it
    editingSet = (editingSet && editingSet.ei===ei && editingSet.si===si) ? null : {ei,si};
    render(); return;
  }
  const head = e.target.closest("[data-card-head]");
  if(head && !e.target.closest("button")){
    const i  = +head.dataset.cardHead;
    const wk = activeWorkout(false);
    // openEntry is a *block* index (paired supersets collapse into one block),
    // so the default must be derived from the block list — not entries.length-1,
    // which would be wrong whenever a superset is present.
    const blocks = wk ? logBlocks(wk.entries) : [];
    const curOpen = (openEntry !== null) ? openEntry : (blocks.length > 0 ? blocks.length-1 : -1);
    // Drop ghost state for the card that's closing.
    if(curOpen >= 0 && curOpen < blocks.length){
      for(const ei of (blocks[curOpen].idxs || [])) resetGhosts(wk.entries[ei].exId);
    }
    openEntry = (i === curOpen) ? -1 : i;   // tap open card → collapse all
    editingSet = null;
    render(); return;
  }
});

// The set type is the segment choice (work|drop) unless the warm-up toggle
// overrides it — so it can't be read from a single ".on" button any more.
function formType(scope){
  const wrap = scope.matches && scope.matches("[data-typeseg]") ? scope : $("[data-typeseg]", scope);
  if(!wrap) return "work";
  if($(".warmtog", wrap).classList.contains("on")) return "warm";
  return ($("[data-segbox] [data-type].on", wrap) || {}).dataset?.type || "work";
}

// Focus + select, so typing replaces the prefilled value instead of appending
// to it. Called after re-renders too, which is why it tolerates a missing node.
function focusField(el){
  if(!el) return false;
  el.focus({ preventScroll:true });
  try{ el.select(); }catch(_){}
  return true;
}

// Enter advances weight → reps, and only submits from the last field. Firing
// the set from the weight box would log it against whatever reps was prefilled.
$("#logBody").addEventListener("keydown", e=>{
  if(e.key !== "Enter") return;
  const el = e.target;
  if(!el.matches || !el.matches("input")) return;
  e.preventDefault();

  // superset: weight → reps → next lift's weight → submit the round
  const ssRow = el.closest("[data-ssrow]");
  if(ssRow){
    if(el.matches("[data-ssw]")) return void focusField($("[data-ssr]", ssRow));
    const next = ssRow.nextElementSibling;
    if(next && next.matches("[data-ssrow]")) return void focusField($("[data-ssw]", next));
    return void addRound(ssRow.closest("[data-ssform]").dataset.ssform);
  }

  const form = el.closest("[data-setform]");
  if(!form) return;
  const dropRow = el.closest("[data-droprow]");
  if(dropRow && el.matches("[data-dw]")) return void focusField($("[data-dr]", dropRow));
  if(el.matches("[data-w]")) return void focusField($("[data-r]", form));
  addSet(+form.dataset.setform);
});

// Tapping a prefilled number should replace it, not drop a cursor mid-value.
$("#logBody").addEventListener("focusin", e=>{
  const el = e.target;
  if(el.matches && el.matches("[data-w],[data-r],[data-ssw],[data-ssr],[data-dw],[data-dr]"))
    requestAnimationFrame(()=>{ try{ el.select(); }catch(_){} });
});

function addDropRow(form){
  const rows = $("[data-droprows]", form);
  const div  = document.createElement("div");
  div.className = "droprow"; div.setAttribute("data-droprow","");
  div.innerHTML = `<input class="in" inputmode="decimal" data-dw placeholder="drop kg">
    <input class="in" inputmode="numeric" data-dr placeholder="reps">
    <button class="iconbtn" data-deldrop aria-label="Remove drop">✕</button>`;
  rows.appendChild(div);
}
