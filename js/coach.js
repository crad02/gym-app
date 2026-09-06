"use strict";
/* ---------- COACH ---------- */
/* ---------- live weekly volume ---------- */
// Coach group → the local (app-taxonomy) muscles that roll up into it. Mirrors
// the lab's muscle→group map at the app's coarser granularity (the app can't
// split delts, so all "Shoulders" sits with the pressing group).
const GROUP_MUSCLES = {
  Back:  ["Back"],
  Chest: ["Chest","Shoulders"],
  Arms:  ["Biceps","Triceps","Forearms"],
  Legs:  ["Quads","Hamstrings","Glutes","Calves"],
  Other: ["Core"],
};
const VOL_MIN = 10, VOL_HIGH = 20;   // hypertrophy landmarks, same as the lab

// Monday (ISO week start) of the current week, as a yyyy-mm-dd key.
function weekStartKey(){
  const d = new Date(); d.setHours(0,0,0,0);
  const dow = (d.getDay()+6)%7;            // Mon=0 … Sun=6
  d.setDate(d.getDate()-dow);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}

// Hard (work) sets logged so far this week, tallied by local muscle.
function weekWorkSetsByMuscle(){
  const start = weekStartKey();
  const tally = {};
  for(const w of DB.workouts){
    if(w.date < start) continue;           // ISO date strings sort chronologically
    for(const en of w.entries){
      const ex = exById(en.exId);
      const muscle = ex ? ex.muscle : "Other";
      const n = en.sets.filter(isHardSet).length;   // a drop set = 1 hard set
      if(n) tally[muscle] = (tally[muscle]||0) + n;
    }
  }
  return tally;
}

function volumeStripHTML(groupName){
  const muscles = GROUP_MUSCLES[groupName] || [];
  if(!muscles.length) return "";
  const tally = weekWorkSetsByMuscle();
  const total = muscles.reduce((sum,m)=>sum+(tally[m]||0), 0);
  const rows = muscles.map(m=>{
    const n = tally[m] || 0;
    // bar spans the full 10–20 band; the tick marks the 10-set minimum (at 50%)
    const pct = Math.min(n/VOL_HIGH, 1)*100;
    let cls="vol-under", tag="build";
    if(n >= VOL_HIGH){ cls="vol-high"; tag="high"; }
    else if(n >= VOL_MIN){ cls="vol-good"; tag="on target"; }
    return `<div class="vol-row">
      <div class="vol-name">${esc(m)}</div>
      <div class="vol-bar"><div class="vol-tick"></div><div class="vol-fill ${cls}" style="width:${pct}%"></div></div>
      <div class="vol-count ${cls}">${n}<span class="vol-tag">${tag}</span></div>
    </div>`;
  }).join("");
  return `<div class="card vol-card">
    <div class="vol-head"><span>THIS WEEK · hard sets</span><span class="vol-sub">band ${VOL_MIN}–${VOL_HIGH} / muscle</span></div>
    ${total ? rows : `<div class="vol-empty">No sets logged yet this week — go bank some.</div>`}
  </div>`;
}

// Match a lab-provided app exercise name to the user's own exercise list.
function appExerciseByName(name){
  if(!name) return null;
  const ln = name.toLowerCase();
  return DB.exercises.find(e => e.name.toLowerCase() === ln) || null;
}

// Top work set (heaviest) of an exercise's last session, as "75kg × 8".
function lastTopSetLabel(exId){
  const last = lastSession(exId);
  if(!last || !last.sets.length) return null;
  const top = last.sets.reduce((a,b) => (b.weight||0) > (a.weight||0) ? b : a);
  return `${top.weight||0}kg × ${top.reps||0}`;
}

// The user's other exercises for the same muscle, most-recently-trained first —
// in-gym substitutions when the prescribed machine is taken.
function altExercises(ex, excludeName, n=2){
  if(!ex) return [];
  const lastDate = {};
  for(const w of DB.workouts)
    for(const en of w.entries)
      if(!lastDate[en.exId] || w.date > lastDate[en.exId]) lastDate[en.exId] = w.date;
  return DB.exercises
    .filter(e => e.muscle === ex.muscle && e.id !== ex.id
                 && e.name.toLowerCase() !== (excludeName||'').toLowerCase())
    .sort((a,b) => (lastDate[b.id]||'') < (lastDate[a.id]||'') ? -1 : 1)
    .slice(0, n);
}

// "Plan 3d ago · data to 4 Jul" + a stale nudge when local logging has moved
// well past what the plan was built from.
function planFreshnessHTML(plan){
  if(!plan?.generated_at) return '';
  const genMs = new Date(plan.generated_at).getTime();
  const days = Math.max(0, Math.floor((Date.now() - genMs) / 864e5));
  const age = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`;
  const latestLocal = DB.workouts.length
    ? DB.workouts.map(w => w.date).sort().at(-1) : null;
  const behindDays = (plan.data_through && latestLocal && latestLocal > plan.data_through)
    ? Math.round((new Date(latestLocal) - new Date(plan.data_through)) / 864e5) : 0;
  const stale = days > 10 || behindDays > 5;
  const dataTo = plan.data_through
    ? new Date(plan.data_through).toLocaleDateString(undefined,{day:'numeric',month:'short'}) : null;
  return `<div class="freshness">
    <span>Plan ${age}${dataTo ? ` · data to ${esc(dataTo)}` : ''}</span>
    ${behindDays > 0 ? `<span>· ${behindDays}d of newer logs</span>` : ''}
    ${stale ? `<span class="stale">↻ worth a lab re-run</span>` : ''}
  </div>`;
}

function labChipsHTML(group){
  const muscles = group?.muscles || [];
  if(!muscles.length) return '';
  const chips = muscles.map(m => {
    const v = m.verdict || '';
    const cls = v.startsWith('below') ? 'build' : v.startsWith('above') ? 'high' : 'good';
    const tag = cls === 'build' ? 'build' : cls === 'high' ? 'ease off' : 'on target';
    return `<span class="lchip ${cls}">${esc(m.muscle)} <span class="ln">${m.sets_per_week}/wk · ${tag}</span></span>`;
  }).join('');
  return `<div class="lab-chips">${chips}</div>`;
}

function trendHTML(delta){
  if(delta === null || delta === undefined) return '';
  const cls = delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'flat';
  const sym = cls === 'up' ? '↑' : cls === 'down' ? '↓' : '→';
  return `<span class="trend ${cls}" title="expected 1RM change">${sym}</span>`;
}

// Turn "here's the plan" into "here's today's session" — the whole reason
// Coach is a screen you act from rather than a static report. Mirrors
// startRoutine()'s contract (js/core.js) on purpose: an exercise already in
// today's workout is left exactly as it is, so this is safe to tap again, or
// on top of a session you're already mid-way through logging.
//
// No sets are created here — the ghost-set contract in js/log.js is that an
// unlogged intention must never become a logged fact. ghostSeedFor() already
// calls coachAimFor(ex.name) *before* it falls back to a routine's target, and
// that matches on the very name ensureExercise() resolves to below — so a
// freshly-seeded exercise shows the coach's aim with no further wiring here.
//
// Deliberately NOT saved as a routine via saveRoutine(), even though it's
// available: the lab regenerates this plan every week, so freezing today's
// focus list into a routine would start going stale the moment priorities
// shift. Routines are for a session you want to repeat unchanged; Coach's
// entire value is staying current. w.coachGroup — not w.routineId, which
// would wrongly imply a real saved routine exists — is what History reads to
// caption the session (see sessionSourceLabel() in history.js).
function startCoachGroup(groupName){
  let plan = null;
  try{ plan = JSON.parse(localStorage.getItem(PLAN_KEY)); }catch(_){}
  const focus = plan?.groups?.[groupName]?.focus || [];
  if(!focus.length) return 0;

  setEditDate(todayKey());
  const w = workoutFor(todayKey(), true);
  const already = new Set(w.entries.map(en => en.exId));
  // Only matters the first time this exercise is ever seen: the lab's group is
  // coarser than the app's own muscle list (Chest also covers Shoulders here),
  // so this is a starting point to retag from, not a claim of precision.
  const fallbackMuscle = (GROUP_MUSCLES[groupName] || ["Other"])[0];

  let added = 0;
  for(const f of focus){
    const name = f.app_exercise || f.exercise;
    if(!name) continue;
    const ex = ensureExercise(name, fallbackMuscle);
    if(already.has(ex.id)) continue;
    w.entries.push({ exId: ex.id, name: ex.name, sets: [] });
    already.add(ex.id);
    added++;
  }
  // First group wins. Seeding a second group on top of a session that began as
  // Legs doesn't make it an "Other" session — History is captioning where the
  // workout came from, not the last button pressed.
  if(added && !w.coachGroup) w.coachGroup = groupName;
  markDirty();
  return added;
}

function renderCoach(){
  // tabs
  $("#coachTabs").innerHTML = COACH_GROUPS.map(g =>
    `<button class="gtab${g===activeCoachGroup?' on':''}" data-group="${g}">${g}</button>`
  ).join("");

  // load cached plan
  let plan = null;
  try{ plan = JSON.parse(localStorage.getItem(PLAN_KEY)); }catch(_){}

  // plan date subtitle
  const planDate = plan?.generated_at
    ? new Date(plan.generated_at).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})
    : '';
  $("#coachPlanDate").textContent = planDate ? `Updated ${planDate}` : '';

  // headline card — the whole-body read + freshness, above the group tabs
  const head = $("#coachHead");
  if(plan && (plan.headline || plan.generated_at)){
    const budget = plan.budget;
    head.innerHTML = `<div class="card coach-headline">
      ${plan.headline ? `<div class="hl-text">${esc(plan.headline)}</div>` : ''}
      ${budget?.median_sets_per_week ? `<div class="tiny faint" style="margin-top:6px">Your week: ~${budget.median_sets_per_week} hard sets over ~${budget.median_sessions_per_week} sessions</div>` : ''}
      ${planFreshnessHTML(plan)}
    </div>`;
  } else {
    head.innerHTML = '';
  }

  const body = $("#coachBody");

  // live weekly volume — pure local data, shown above the plan (and even before
  // the first lab run, so logging gives immediate feedback)
  const volHTML = volumeStripHTML(activeCoachGroup);

  if(!plan){
    body.innerHTML = volHTML + (!currentUser
      ? `<div class="empty"><div class="big">🔒</div>Sign in (More tab) to load your coaching plan.</div>`
      : `<div class="empty"><div class="big">🧪</div>No plan yet.<br><span class="small muted">Run the lab to generate your first coaching plan.</span></div>`);
    return;
  }

  const group = plan.groups?.[activeCoachGroup];
  if(!group){
    body.innerHTML = volHTML + `<div class="empty"><div class="big">—</div><span class="small muted">No plan data for ${esc(activeCoachGroup)} yet.</span></div>`;
    return;
  }

  const pClass = `priority-${(group.priority||'medium').toLowerCase()}`;
  const pLabel = (group.priority||'medium').toUpperCase();
  const focusList = group.focus || [];
  const focusRows = focusList.map(f => {
    const target = [
      f.target_weight ? f.target_weight+'kg' : '',
      f.target_reps   ? f.target_reps+' reps' : ''
    ].filter(Boolean).join(' × ');
    // join to local history via the app-side exercise name the lab attached
    const appEx = appExerciseByName(f.app_exercise);
    const last = appEx ? lastTopSetLabel(appEx.id) : null;
    const alts = altExercises(appEx, f.exercise);
    return `<div class="focus-row">
      <div class="row between">
        <div class="focus-ex">${esc(f.exercise)}${trendHTML(f.expected_change)}</div>
        ${target ? `<div class="focus-target">${esc(target)}</div>` : ''}
      </div>
      ${last ? `<div class="focus-last">last: <b>${esc(last)}</b>${target ? ` → aim: <b>${esc(target)}</b>` : ''}</div>` : ''}
      ${f.note  ? `<div class="focus-note">${esc(f.note)}</div>` : ''}
      ${alts.length ? `<div class="alt-line">machine taken? ${alts.map(a=>esc(a.name)).join(' · ')}</div>` : ''}
    </div>`;
  }).join('');

  body.innerHTML = volHTML + `<div class="card">
    <span class="priority-badge ${pClass}"><span class="pdot"></span>${pLabel} PRIORITY</span>
    ${labChipsHTML(group)}
    ${focusRows || '<div class="faint small">No specific exercises prescribed.</div>'}
    ${group.why ? `<div class="small muted" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">📌 ${esc(group.why)}</div>` : ''}
    ${focusList.length ? `<button class="btn primary full" data-start-group="${esc(activeCoachGroup)}" style="margin-top:14px">Start ${esc(activeCoachGroup)} session →</button>` : ''}
  </div>
  ${plan.generated_from?.valid_week ? `<div class="tiny faint center" style="margin-top:4px">Plan for week ${esc(plan.generated_from.valid_week)}</div>` : ''}`;
}

/* ---------- COACH EVENTS ---------- */
// coach group tabs
$("#coachTabs").addEventListener("click", e=>{
  const g = e.target.closest("[data-group]");
  if(g){ activeCoachGroup = g.dataset.group; renderCoach(); }
});

// "Start <group> session" — seed today's workout with this group's focus
// exercises, then land in Log, which is where you actually go lift. Always
// switches tabs even when nothing new was added (every focus exercise was
// already in today's workout) — the point is getting to Log, not the count.
$("#coachBody").addEventListener("click", e=>{
  const btn = e.target.closest("[data-start-group]");
  if(!btn) return;
  const added = startCoachGroup(btn.dataset.startGroup);
  toast(added ? `Added ${added} exercise${added===1?'':'s'} to today's session` : "Already in today's session");
  switchTab("log");
});
