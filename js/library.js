"use strict";
/* ---------- EXERCISES / PBs ---------- */
// A yyyy-mm-dd key N days back, in the same shape as core.js's todayKey() — used
// to threshold "recent" without pulling in a date library.
function daysAgoKey(n){
  const d = new Date(); d.setDate(d.getDate()-n);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}

// One pass over every workout, building last-trained date / hard-set session
// count / most-recent top set per exercise. The old flat list called pbFor()
// per row, which is already O(1) thanks to core.js's lookup() cache — but the
// grouped view also wants "when" and "how often", which lookup() doesn't
// carry, so this is a second single pass rather than a per-row scan (the same
// fix core.js applied to pbFor/lastSession, applied here to the new signal).
function exActivity(){
  const lastDate = {}, count = {}, lastTop = {};
  const asc = [...DB.workouts].sort((a,b)=> a.date<b.date?-1:a.date>b.date?1:0);
  for(const w of asc){
    for(const en of w.entries){
      const work = en.sets.filter(isHardSet);
      if(!work.length) continue;
      count[en.exId] = (count[en.exId]||0) + 1;
      lastDate[en.exId] = w.date;          // ascending order → last write wins = most recent
      const top = work.reduce((a,b)=> (b.weight>a.weight||(b.weight===a.weight&&b.reps>a.reps))?b:a, work[0]);
      lastTop[en.exId] = { weight:top.weight, reps:top.reps };
    }
  }
  return { lastDate, count, lastTop };
}

// Muscle-group accordion state — which groups the user has manually expanded
// or collapsed this session. Lazily seeded per group with a sensible default
// (see exGroupDefaultOpen) the first time it's seen, then left alone so a tap
// sticks across re-renders (a PB add, a search that clears, etc).
let _exGroupOpen = null;
function exGroupDefaultOpen(rows){
  if(rows.length <= 3) return true;                 // nothing worth hiding
  const cutoff = daysAgoKey(14);
  return rows.some(r => r.last && r.last >= cutoff); // a group you're mid-cycle on stays open
}
function groupIsOpen(mg, rows, isSearch){
  if(isSearch) return true;                          // search results are never collapsed
  if(!_exGroupOpen) _exGroupOpen = {};
  if(!(mg in _exGroupOpen)) _exGroupOpen[mg] = exGroupDefaultOpen(rows);
  return _exGroupOpen[mg];
}

// A compact card for "trained in the last two weeks", newest first — the
// question someone standing in the gym actually asks before "show me
// everything", so it sits above the muscle groups rather than as one more
// group among twelve.
function recentStripHTML(rows){
  const cutoff = daysAgoKey(14);
  const recents = rows.filter(r => r.last && r.last >= cutoff && r.top)
                       .sort((a,b)=> b.last.localeCompare(a.last))
                       .slice(0, 10);
  if(!recents.length) return "";
  const cards = recents.map(r => `<div class="card tap ex-recent-card" data-ex-detail="${r.ex.id}">
    <div class="ellip" style="font-weight:700;font-size:13px">${esc(r.ex.name)}</div>
    <div class="tiny muted" style="margin-top:3px">${fmtKg(r.top.weight)} × ${r.top.reps}</div>
    <div class="tiny faint" style="margin-top:1px">${dateLabel(r.last)}</div>
  </div>`).join("");
  return `<div class="grouphdr" style="margin-top:2px">RECENTLY TRAINED</div>
    <div class="ex-recent-strip">${cards}</div>`;
}

// One exercise row: name + PB (the two things worth a glance), plus a
// recency/frequency caption when there's history — "most trained" and
// "stale" both fall out of the same line rather than needing their own
// sections (see the muscle-group sort below for how recency also orders
// the list itself).
function exRowHTML(r){
  const pb = pbFor(r.ex.id);
  const pbHtml = pb
    ? `<span class="pbbig">${fmtKg(pb.weight)} <small>×${pb.reps}</small></span>`
    : `<span class="faint small">no PB yet</span>`;
  const cap = r.count ? `${dateLabel(r.last)} · ${r.count} session${r.count===1?"":"s"}` : "";
  return `<div class="card tap ex-row-card" data-ex-detail="${r.ex.id}">
    <div class="ex-row"><span class="grow ellip" style="font-weight:600">${esc(r.ex.name)}</span>${pbHtml}</div>
    ${cap ? `<div class="tiny faint" style="margin-top:3px">${esc(cap)}</div>` : ""}
  </div>`;
}

function renderEx(){
  const q = $("#exSearch").value.trim().toLowerCase();
  $("#exCount").textContent = DB.exercises.length ? DB.exercises.length+" total" : "";
  const body = $("#exBody");
  let list = DB.exercises.slice().sort((a,b)=>a.name.localeCompare(b.name));
  if(q) list = list.filter(e=>e.name.toLowerCase().includes(q) || e.muscle.toLowerCase().includes(q));

  if(!DB.exercises.length){
    body.innerHTML = `<div class="empty"><div class="big">📒</div>No exercises yet.<br>Tap "Add exercise / personal best" above to start.</div>`;
    return;
  }
  if(!list.length){ body.innerHTML = `<div class="empty">No matches.</div>`; return; }

  const act = exActivity();
  const enrich = e => ({ ex:e, last: act.lastDate[e.id]||null, count: act.count[e.id]||0, top: act.lastTop[e.id]||null });
  const enriched = list.map(enrich);

  const byM = {};
  for(const r of enriched){ (byM[r.ex.muscle]=byM[r.ex.muscle]||[]).push(r); }
  const order = MUSCLES.filter(m=>byM[m]);
  const isSearch = !!q;

  const groupsHTML = order.map(mg=>{
    // most-recently-trained first within a group; never-logged lifts fall to
    // the bottom, alphabetically, rather than cluttering the top with zeros
    const rows = byM[mg].sort((a,b)=> (b.last||"").localeCompare(a.last||"") || a.ex.name.localeCompare(b.ex.name));
    const open = groupIsOpen(mg, rows, isSearch);
    const freshest = rows.find(r=>r.last);
    const meta = freshest ? `${rows.length} · last ${dateLabel(freshest.last)}` : `${rows.length}`;
    const head = `<div class="exg-head${open?" open":""}" data-group-toggle="${esc(mg)}">
      <span class="exg-name">${esc(mg)}</span>
      <span class="exg-meta">${esc(meta)} <span class="caret">▼</span></span>
    </div>`;
    if(!open) return head;
    return head + rows.map(exRowHTML).join("");
  }).join("");

  const recentHTML = isSearch ? "" : recentStripHTML(enriched);
  body.innerHTML = recentHTML + groupsHTML;
}

let _pick = [];
function openAddExercise(opts){
  opts = opts || {};
  const onChoose = opts.onChoose || addEntry;
  const title = opts.title || "Add exercise";
  const wk = opts.markUsed===false ? null : activeWorkout(false);
  const used = new Set(wk ? wk.entries.map(en=>en.exId) : []);

  openSheet(`
    <h2>${title}</h2>
    <input class="in" id="exFilter" placeholder="Search ${LIB.length}+ exercises…" autocapitalize="words" autocomplete="off">
    <div id="pickList" style="margin-top:12px;max-height:46vh;overflow-y:auto"></div>
    <div id="createArea" style="display:none">
      <hr class="hr">
      <div class="field"><label>Muscle group</label>
        <select class="in" id="newMuscle">${MUSCLES.map(m=>`<option>${m}</option>`).join("")}</select>
      </div>
      <button class="btn primary full" id="createBtn">Create &amp; add</button>
    </div>
  `);

  const filter = $("#exFilter");
  function renderPicks(){
    const q = filter.value.trim().toLowerCase();
    const userNames = new Set(DB.exercises.map(e=>e.name.toLowerCase()));

    // coach picks: focus lifts from high-priority groups, not yet in today's
    // session — surfaced at the moment you're choosing what to do next
    const coach = [];
    if(!q){
      let plan = null;
      try{ plan = JSON.parse(localStorage.getItem(PLAN_KEY)); }catch(_){}
      if(plan?.groups){
        const usedNames = new Set(wk ? wk.entries.map(en=>(exById(en.exId)?.name||'').toLowerCase()) : []);
        for(const g of Object.values(plan.groups)){
          if(g.priority!=='high') continue;
          for(const f of (g.focus||[])){
            const nm = f.app_exercise || f.exercise;
            if(!nm || usedNames.has(nm.toLowerCase())) continue;
            const userEx = DB.exercises.find(e=>e.name.toLowerCase()===nm.toLowerCase());
            const libMuscle = LIB.find(c=>c.n.toLowerCase()===nm.toLowerCase())?.m;
            coach.push({type:userEx?"user":"lib", id:userEx?.id,
                        name:userEx?userEx.name:nm, muscle:userEx?userEx.muscle:(libMuscle||"Other"),
                        coach:true, aimLabel:`${fmtKg(f.target_weight)}×${f.target_reps}`});
          }
        }
      }
    }

    const mine = DB.exercises.filter(e=>(!q || e.name.toLowerCase().includes(q))
                                        && !coach.some(c=>c.id===e.id))
                             .sort((a,b)=>a.name.localeCompare(b.name));
    const lib = q ? LIB.filter(c=>c.n.toLowerCase().includes(q) && !userNames.has(c.n.toLowerCase())).slice(0,50) : [];

    _pick = [];
    coach.forEach(c=>_pick.push(c));
    mine.forEach(e=>_pick.push({type:"user", id:e.id, name:e.name, muscle:e.muscle}));
    lib.forEach(c=>_pick.push({type:"lib", name:c.n, muscle:c.m, equip:c.e}));

    const list = $("#pickList");
    if(!_pick.length){
      list.innerHTML = q
        ? `<div class="faint small center" style="padding:20px">No match — create "${esc(filter.value.trim())}" below.</div>`
        : `<div class="faint small center" style="padding:20px">Start typing to search the library,<br>or type a new name to create your own.</div>`;
    } else {
      const coachEnd = coach.length, mineEnd = coach.length + mine.length;
      const divLabel = t => `<div class="tiny faint" style="margin:10px 2px 6px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">${t}</div>`;
      list.innerHTML = _pick.map((it,i)=>{
        const pb = it.type==="user" ? pbFor(it.id) : null;
        const isUsed = it.type==="user" && used.has(it.id);
        const meta = [it.muscle, it.equip, pb?`PB ${fmtKg(pb.weight)}×${pb.reps}`:""].filter(Boolean).join(" · ");
        let divider = "";
        if(coachEnd && i===0) divider = divLabel("🎯 Coach suggests");
        else if(coachEnd && i===coachEnd && mine.length) divider = divLabel("Your exercises");
        else if(i===mineEnd && lib.length) divider = divLabel("Library");
        return divider + `<div class="pick" data-i="${i}" ${isUsed?'style="opacity:.4"':''}>
          <div class="grow"><div style="font-weight:600">${esc(it.name)}</div><div class="tiny muted">${esc(meta)}</div></div>
          ${it.coach?`<span class="coach-pick-tag">aim ${esc(it.aimLabel)}</span>`:''}
          ${isUsed?'<span class="tiny faint">added</span>':'<span class="muted" style="margin-left:8px">+</span>'}
        </div>`;
      }).join("");
    }

    const exact = userNames.has(q) || LIB.some(c=>c.n.toLowerCase()===q);
    $("#createArea").style.display = (q && !exact) ? "block":"none";
    if(q && !exact) $("#createBtn").textContent = `Create "${filter.value.trim()}" & add`;
  }

  filter.addEventListener("input", renderPicks);
  $("#pickList").addEventListener("click",e=>{
    const p = e.target.closest("[data-i]"); if(!p) return;
    if(p.style.opacity==="0.4") return;
    const it = _pick[+p.dataset.i];
    const ex = it.type==="user" ? exById(it.id) : ensureExercise(it.name, it.muscle);
    onChoose(ex.id);
  });
  $("#createBtn").addEventListener("click",()=>{
    const name = filter.value.trim(); if(!name) return;
    const ex = ensureExercise(name, $("#newMuscle").value);
    onChoose(ex.id);
  });

  renderPicks();
}

/* ---------- Progression chart ---------- */
// Top-set weight across recent sessions. One measure on one axis — sets and
// volume stay in the list below rather than becoming a second y-scale, which
// would invent a correlation that isn't in the data.
const CHART_N = 12;
// More than one chart can be alive at once (the exercise sheet and the PB
// popover), so points are keyed per instance rather than held in one global.
let _charts = {}, _chartSeq = 0;

// Every session this exercise appears in, newest first — the shape both the
// chart and the detail list read.
function exHistory(exId){
  const hist = [];
  for(const w of DB.workouts){
    const en = w.entries.find(e=>e.exId===exId); if(!en) continue;
    const work = en.sets.filter(isHardSet); if(!work.length) continue;
    const top = work.reduce((a,b)=> (b.weight>a.weight||(b.weight===a.weight&&b.reps>a.reps))?b:a, work[0]);
    hist.push({ date:w.date, top, sets:en.sets.length, vol:en.sets.reduce((a,s)=>a+setVolume(s),0) });
  }
  hist.sort((a,b)=> a.date<b.date?1:-1);
  return hist;
}

function progressChartHTML(hist, pb){
  const pts = hist.slice(0, CHART_N).reverse();     // hist arrives newest-first
  const cid = "c"+(++_chartSeq);
  _charts[cid] = { pts, pb };
  for(const k of Object.keys(_charts)) if(+k.slice(1) < _chartSeq-3) delete _charts[k];
  if(pts.length < 2)
    return `<div class="faint small" style="padding:10px 0">Log this lift on two separate days to see a trend.</div>`;

  const W=320, H=134, L=30, R=42, T=16, B=26;       // B leaves room for the date band
  const iw=W-L-R, ih=H-T-B;
  const ws = pts.map(p=>p.top.weight);
  const maxW = Math.max(...ws), minW = Math.min(...ws);
  let lo=minW, hi=maxW;
  if(hi===lo){ hi=lo+1; lo=Math.max(0,lo-1); }      // a flat line sits mid-plot
  const pad=(hi-lo)*0.18; lo-=pad; hi+=pad;

  const X = i => L + i*iw/(pts.length-1);
  const Y = v => T + ih - (v-lo)/(hi-lo)*ih;
  const isPB = p => pb && p.top.weight===pb.weight && p.top.reps===pb.reps;

  const line = pts.map((p,i)=>`${X(i).toFixed(1)},${Y(p.top.weight).toFixed(1)}`).join(" ");
  const area = `${L},${T+ih} ${line} ${(L+iw).toFixed(1)},${T+ih}`;

  // hairline rules at the real high/low, not the padded bounds
  const rule = (v,label)=>`<line class="grid" x1="${L}" x2="${L+iw}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"></line>
    <text class="ax" x="${L-6}" y="${(Y(v)+3.5).toFixed(1)}" text-anchor="end">${label}</text>`;
  const grid = rule(maxW, maxW) + (minW!==maxW ? rule(minW, minW) : "");

  // visible dots first, then oversized transparent hit targets on top
  const dots = pts.map((p,i)=>
    `<circle class="pt${isPB(p)?" pb":""}" data-pt="${i}" cx="${X(i).toFixed(1)}" cy="${Y(p.top.weight).toFixed(1)}" r="4"></circle>`).join("")
    + pts.map((p,i)=>
    `<circle class="hit" data-pt="${i}" cx="${X(i).toFixed(1)}" cy="${Y(p.top.weight).toFixed(1)}" r="14"></circle>`).join("");

  const li = pts.length-1, last = pts[li];
  // one direct label — the endpoint. Every other value is in the list below.
  const endLabel = `<text class="end" x="${(X(li)+9).toFixed(1)}" y="${(Y(last.top.weight)+4).toFixed(1)}">${fmtKg(last.top.weight)}</text>`;

  const xLabels = `<text class="ax" x="${L}" y="${H-8}" text-anchor="start">${shortDate(pts[0].date)}</text>
    <text class="ax" x="${L+iw}" y="${H-8}" text-anchor="end">${shortDate(last.date)}</text>`;

  return `<div class="chart-wrap" data-chart="${cid}">
    <div class="chart-read">${chartReadHTML(last, isPB(last), true)}</div>
    <svg class="spark" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="Top-set weight over the last ${pts.length} sessions, ${minW} to ${maxW} kg">
      ${grid}
      <polygon class="fill" points="${area}"></polygon>
      <polyline class="ln" points="${line}"></polyline>
      ${dots}${endLabel}${xLabels}
    </svg>
  </div>`;
}

// One delegated handler covers every chart on the page; all lookups are scoped
// to the tapped chart's own wrapper so the sheet and the popover never cross.
document.addEventListener("click", e=>{
  const pt = e.target.closest("[data-pt]");
  if(!pt) return;
  const wrap = pt.closest(".chart-wrap"); if(!wrap) return;
  const data = _charts[wrap.dataset.chart]; if(!data) return;
  const i = +pt.dataset.pt, p = data.pts[i]; if(!p) return;
  // radius via attribute, not CSS — the `r` geometry property isn't safe everywhere
  $$(".spark .pt", wrap).forEach(c=>{ c.classList.remove("on"); c.setAttribute("r","4"); });
  $$(`.spark .pt[data-pt="${i}"]`, wrap).forEach(c=>{ c.classList.add("on"); c.setAttribute("r","5.5"); });
  const isPB = data.pb && p.top.weight===data.pb.weight && p.top.reps===data.pb.reps;
  $(".chart-read", wrap).innerHTML = chartReadHTML(p, isPB, i===data.pts.length-1);
});

/* ---------- PB popover ---------- */
// A light anchored panel, not a sheet — reading a trend mid-workout shouldn't
// cover the set you're about to log.
function openPBPop(exId, anchorEl){
  const ex = exById(exId); if(!ex) return;
  const pb = pbFor(exId), hist = exHistory(exId);
  const pop = $("#pbPop"), card = $(".pop-card", pop);
  card.innerHTML = `
    <div class="pop-head">
      <div style="min-width:0">
        <div class="pop-name ellip">${esc(ex.name)}</div>
        <div class="tiny muted">${pb ? `PB ${fmtKg(pb.weight)}×${pb.reps} · ${dateLabel(pb.date)}` : "No PB yet"}</div>
      </div>
      <button class="iconbtn" data-popclose aria-label="Close">✕</button>
    </div>
    ${progressChartHTML(hist, pb)}
    <button class="link small" data-popdetail="${exId}" style="color:var(--accent);margin-top:6px">Full history →</button>`;

  pop.classList.add("open");
  // measure after it's displayed, then clamp inside the viewport
  const r = anchorEl.getBoundingClientRect();
  const cw = card.offsetWidth, ch = card.offsetHeight;
  const left = Math.max(10, Math.min(r.left + r.width/2 - cw/2, window.innerWidth - cw - 10));
  const below = r.bottom + 8;
  const top = (below + ch > window.innerHeight - 10) ? Math.max(10, r.top - ch - 8) : below;
  card.style.left = left+"px";
  card.style.top  = top+"px";
}
function closePBPop(){ $("#pbPop").classList.remove("open"); }

$("#pbPop").addEventListener("click", e=>{
  if(e.target.id === "pbPop" || e.target.closest("[data-popclose]")){ closePBPop(); return; }
  const d = e.target.closest("[data-popdetail]");
  // the link says "Full history" — land on that tab, not whatever the
  // exercise's default (Stats, usually) would otherwise pick
  if(d){ closePBPop(); switchTab("ex"); openExDetail(d.dataset.popdetail, "history"); }
});

function chartReadHTML(p, pbFlag, latest){
  return `<span class="cr-d">${latest?"Latest":""} ${dateLabel(p.date)}</span>
    <span class="cr-v">${fmtKg(p.top.weight)} <span class="muted">× ${p.top.reps}</span>${pbFlag?' <span class="pbflag">PB</span>':''}</span>`;
}

/* ---------- Exercise detail sheet: How-to / Stats / History ---------- */
// Which exercise the open sheet's tabs belong to, which tab is showing, and a
// token that invalidates a stale async How-to load (see loadFedb below) once
// the sheet has moved on to something else — reopened on a different
// exercise, or replaced by Edit. Plain module state, same pattern as
// activeCoachGroup in coach.js: this is UI state, not DB state.
let _exDetailId = null;
let _exDetailTab = "stats";
let _exDetailToken = 0;

const EX_DETAIL_TABS = ["howto","stats","history"];
function exTabLabel(t){ return t==="howto" ? "How-to" : t==="stats" ? "Stats" : "History"; }

// exId, and an optional tab to force open on — the PB popover's "Full
// history" link wants History specifically, everything else gets a sensible
// default: jump straight to the numbers for a lift you've logged before,
// otherwise open on how to actually do it.
function openExDetail(exId, tab){
  const ex = exById(exId); if(!ex) return;
  _exDetailId = exId;
  _exDetailTab = tab || (pbFor(exId) ? "stats" : "howto");
  _exDetailToken++;
  renderExDetailSheet();
}

function renderExDetailSheet(){
  const ex = exById(_exDetailId); if(!ex) return;
  openSheet(`
    <div class="row between" style="margin-bottom:4px">
      <h2 class="ellip" style="margin:0">${esc(ex.name)}</h2>
      <button class="link small" data-edit-ex="${ex.id}" style="white-space:nowrap;flex-shrink:0">Edit</button>
    </div>
    <span class="chip"><span class="dot"></span>${esc(ex.muscle)}</span>
    <div class="group-tabs" style="margin-top:14px">
      ${EX_DETAIL_TABS.map(t=>`<button class="gtab${_exDetailTab===t?" on":""}" data-ex-tab="${t}">${exTabLabel(t)}</button>`).join("")}
    </div>
    <div id="exDetailBody">${exDetailBodyHTML(ex)}</div>
    <hr class="hr">
    <button class="btn full danger ghost" data-del-ex="${ex.id}">Delete exercise &amp; its data</button>
  `);
}

function exDetailBodyHTML(ex){
  if(_exDetailTab === "howto") return howtoTabHTML(ex);
  if(_exDetailTab === "history") return historyTabHTML(ex);
  return statsTabHTML(ex);
}

/* ---- Stats tab: PB, session count, frequency, best set, the chart, add-result ---- */
// Distinct from PB (heaviest weight, reps as tiebreak — see core.js's
// lookup()): the single set with the highest weight×reps ever logged, which
// can be a different set entirely (a lighter set for more reps). Complements
// the PB rather than repeating it.
function bestSetByVolume(exId){
  let best = null;
  for(const w of DB.workouts){
    const en = w.entries.find(e=>e.exId===exId); if(!en) continue;
    for(const s of en.sets){
      if(!isHardSet(s)) continue;
      const v = setVolume(s);
      if(!best || v>best.vol) best = { weight:s.weight, reps:s.reps, vol:v };
    }
  }
  return best;
}

function statsTabHTML(ex){
  const pb = pbFor(ex.id);
  const hist = exHistory(ex.id);
  const best = bestSetByVolume(ex.id);
  const freq8w = hist.filter(h => h.date >= daysAgoKey(56)).length;
  return `
    <div class="card" style="margin-top:14px;text-align:center">
      <div class="small muted" style="font-weight:700;margin-bottom:4px">PERSONAL BEST</div>
      ${pb? `<div style="font-size:30px;font-weight:800">${fmtKg(pb.weight)} <span class="muted" style="font-size:18px">× ${pb.reps}</span></div><div class="faint small">${dateLabel(pb.date)}</div>`
          : '<div class="faint">Not set yet</div>'}
    </div>
    <div class="statgrid">
      <div class="stat"><div class="n">${hist.length}</div><div class="l">Sessions</div></div>
      <div class="stat"><div class="n">${freq8w}</div><div class="l">Last 8wk</div></div>
      <div class="stat"><div class="n">${best? fmtKg(best.weight)+"×"+best.reps : "—"}</div><div class="l">Best set · vol</div></div>
    </div>
    <div class="grouphdr" style="margin-left:0">PROGRESSION <span class="faint" style="font-weight:600;text-transform:none;letter-spacing:0">· top set</span></div>
    ${progressChartHTML(hist, pb)}
    <div class="grouphdr" style="margin-left:0">ADD A RESULT</div>
    <div class="setform" style="margin-top:0">
      <div class="field" style="margin:0"><label>Weight (kg)</label><input class="in" inputmode="decimal" enterkeyhint="done" id="resW" placeholder="0"></div>
      <div class="field" style="margin:0"><label>Reps</label><input class="in" inputmode="numeric" enterkeyhint="done" id="resR" placeholder="0"></div>
      <button class="btn primary" id="resAdd" data-res="${ex.id}" style="height:46px">Add</button>
    </div>
    <div class="field" style="margin-top:10px"><label>Date</label>
      <input type="date" class="datepick" id="resDate" value="${todayKey()}" max="${todayKey()}" style="width:100%"></div>
    <div class="tiny faint" style="margin:8px 0 2px">Logs a working set on that date — updates your PB if it beats it.</div>
  `;
}

/* ---- History tab: every session, newest first ---- */
function historyTabHTML(ex){
  const pb = pbFor(ex.id);
  const hist = exHistory(ex.id);
  if(!hist.length) return '<div class="faint small" style="padding:20px 0">No working sets logged yet.</div>';
  return `<div style="margin-top:14px">` + hist.map(h=>{
    const isPB = pb && h.top.weight===pb.weight && h.top.reps===pb.reps;
    return `<div class="row between" style="padding:9px 0;border-top:1px solid var(--border)">
      <span class="small">${dateLabel(h.date)}</span>
      <span class="small"><b>${fmtKg(h.top.weight)}×${h.top.reps}</b> ${isPB?'<span class="pbflag">PB</span>':''} <span class="faint">· ${h.sets} sets</span></span>
    </div>`;
  }).join("") + `</div>`;
}

/* ---- How-to tab: free-exercise-db images + instructions ---- */
// exercises.js's CATALOG only kept n/m/e (see its header comment) — the id
// free-exercise-db needs for image paths was dropped. Matching by the exact
// name instead of re-deriving their id-slug sidesteps that entirely: CATALOG's
// "n" *is* free-exercise-db's "name" (that's where it came from), so a
// case-insensitive name match is exact for all 675 catalogue entries with no
// slugify edge cases to get wrong — measured against the live dataset:
//   675/675 catalogue names resolve this way.
// (A slug transform — replace spaces "/" with "_", but also strip "()'" —
// gets there too, and is what free-exercise-db's own ids look like, but it's
// one more thing to get subtly wrong for zero benefit once the JSON is
// already being fetched for `instructions` anyway.)
//
// The JSON is ~1MB, so it's fetched once, lazily, only when a How-to tab is
// actually opened, and cached here for the rest of the session — never on
// boot, never per render (see CLAUDE.md's "app must boot instantly offline").
// A failed fetch (offline) is remembered too, so a flaky connection doesn't
// get hammered again on every tab switch — the user can reload to retry.
const FEDB_JSON_URL = "https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/dist/exercises.json";
const FEDB_IMG_BASE = "https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/";
let _fedbIndex = null;      // Map<lowercased name, entry> once loaded
let _fedbFailed = false;
let _fedbLoading = false;
let _fedbWaiters = [];

function loadFedb(cb){
  if(_fedbIndex || _fedbFailed){ cb(); return; }
  _fedbWaiters.push(cb);
  if(_fedbLoading) return;                 // a fetch is already in flight — cb is queued, not dropped
  _fedbLoading = true;
  fetch(FEDB_JSON_URL).then(r => r.ok ? r.json() : Promise.reject())
    .then(data => { _fedbIndex = new Map(data.map(e => [String(e.name||"").trim().toLowerCase(), e])); })
    .catch(() => { _fedbFailed = true; })
    .finally(() => {
      _fedbLoading = false;
      const waiters = _fedbWaiters; _fedbWaiters = [];
      waiters.forEach(w => w());
    });
}
function fedbFor(name){ return _fedbIndex ? (_fedbIndex.get(String(name).trim().toLowerCase()) || null) : null; }
function capWord(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }

function howtoTabHTML(ex){
  if(_fedbIndex){
    const entry = fedbFor(ex.name);
    // No image, never a broken one: an exercise the user typed themselves
    // (or a catalogue name the dataset genuinely lacks) just has no guide.
    return entry
      ? howtoFoundHTML(ex, entry)
      : `<div class="faint small center" style="padding:32px 12px">No illustrated guide for this one — it isn't in the reference library.</div>`;
  }
  if(_fedbFailed){
    return `<div class="faint small center" style="padding:32px 12px">Step-by-step guide needs a connection.<br>It'll load next time you're online.</div>`;
  }
  // Kick off the (memoized) fetch and paint a static placeholder in the
  // meantime — not a spinner, since there's nothing animating and nothing
  // that can hang: the promise always settles, one way or the other.
  const token = _exDetailToken, exId = ex.id;
  loadFedb(() => {
    if(_exDetailToken !== token || _exDetailId !== exId || _exDetailTab !== "howto") return; // sheet moved on
    const el = $("#exDetailBody");
    if(el) el.innerHTML = howtoTabHTML(ex);          // now resolved (found, not-found, or offline) — repaint
  });
  return `<div class="faint small center" style="padding:32px 12px">Loading guide…</div>`;
}

// The dataset's two shots are start/end of the rep — held a beat each with a
// short crossfade between them reads as "form demo" rather than a flicker;
// prefers-reduced-motion drops it to the static start frame. Deliberately not
// a tap-to-toggle: this is reference material glanced at once, not something
// worth a control of its own.
function howtoFoundHTML(ex, entry){
  const imgs = (entry.images||[]).slice(0,2);
  const media = imgs.length ? `<div class="howto-media" data-howto-media>
      ${imgs.map((p,i)=>{
        const cls = imgs.length===2 ? `howto-frame f${i}` : "howto-frame single";
        const pos = i===0 ? "start" : "end";
        return `<img src="${esc(FEDB_IMG_BASE+p)}" alt="${esc(ex.name)} — ${pos} position" loading="lazy" class="${cls}" data-howto-img>`;
      }).join("")}
      <div class="howto-fallback tiny faint">Preview needs a connection</div>
    </div>` : "";
  const meta = [entry.mechanic, entry.force, entry.level].filter(Boolean)
    .map(t => `<span class="chip">${esc(capWord(t))}</span>`).join("");
  // instructions are free-text from an external dataset, not markup we wrote — esc() every line
  const steps = (entry.instructions||[]).filter(Boolean).map(s => `<li>${esc(s)}</li>`).join("");
  return `<div style="margin-top:14px">
    ${media}
    ${meta ? `<div class="chips" style="margin-bottom:12px">${meta}</div>` : ""}
    ${steps ? `<ol class="howto-steps">${steps}</ol>` : '<div class="faint small">No written instructions for this one either.</div>'}
  </div>`;
}

// # of logged workouts that reference an exercise — used to size up a merge.
function exSessionCount(id){ return DB.workouts.filter(w=>w.entries.some(en=>en.exId===id)).length; }

function openEditExercise(exId){
  const ex = exById(exId); if(!ex) return;
  openSheet(`
    <h2 style="margin-bottom:14px">Edit exercise</h2>
    <div class="field"><label>Name</label>
      <input class="in" id="exEditName" value="${esc(ex.name)}" autocapitalize="words" autocomplete="off">
      <div id="exEditSug" style="margin-top:6px;max-height:32vh;overflow-y:auto"></div></div>
    <div class="field"><label>Muscle group</label>
      <select class="in" id="exEditMuscle">${MUSCLES.map(m=>`<option ${m===ex.muscle?"selected":""}>${m}</option>`).join("")}</select></div>
    <div id="exMergeNote" class="tiny" style="margin:0 2px 10px"></div>
    <button class="btn primary full" data-save-ex="${ex.id}" style="margin-top:6px">Save</button>
    <button class="btn full ghost" id="exEditBack" style="margin-top:8px">Cancel</button>
  `);

  const nameIn = $("#exEditName"), sugBox = $("#exEditSug");
  function refresh(){
    const q = nameIn.value.trim().toLowerCase();
    const note = $("#exMergeNote"), saveBtn = $("[data-save-ex]");
    // exact match against another of *my* exercises → this Save becomes a merge
    const target = DB.exercises.find(e=>e.id!==exId && e.name.toLowerCase()===q);
    if(target){
      note.innerHTML = `↪ Will <b>merge</b> into your existing “${esc(target.name)}” (${esc(target.muscle)}, ${exSessionCount(target.id)} session${exSessionCount(target.id)===1?"":"s"}). Both histories combine under it; this one is removed.`;
      note.style.color = "var(--accent)";
      saveBtn.textContent = "Merge";
    } else {
      note.textContent = ""; saveBtn.textContent = "Save";
    }
    // suggestions: my library first (merge targets), then the starter catalog
    const userNames = new Set(DB.exercises.map(e=>e.name.toLowerCase()));
    const mine = q ? DB.exercises.filter(e=>e.id!==exId && e.name.toLowerCase().includes(q) && e.name.toLowerCase()!==q)
                                 .map(e=>({name:e.name,muscle:e.muscle,kind:"user"})) : [];
    const lib = q ? LIB.filter(c=>c.n.toLowerCase().includes(q) && !userNames.has(c.n.toLowerCase()))
                       .map(c=>({name:c.n,muscle:c.m,kind:"lib"})) : [];
    const items = [...mine, ...lib].slice(0,8);
    sugBox.innerHTML = items.map(it=>`<div class="pick" data-sug="${esc(it.name)}" data-sugm="${esc(it.muscle)}" data-sugk="${it.kind}">
        <div class="grow"><div style="font-weight:600">${esc(it.name)}</div><div class="tiny muted">${esc(it.muscle)}${it.kind==="user"?" · in your library":""}</div></div>
        <span class="tiny faint">${it.kind==="user"?"merge":"use"}</span>
      </div>`).join("");
  }
  nameIn.addEventListener("input", refresh);
  sugBox.addEventListener("click", e=>{
    const s = e.target.closest("[data-sug]"); if(!s) return;
    nameIn.value = s.dataset.sug;
    // adopt a catalog suggestion's muscle; a library (merge) target keeps its own
    if(s.dataset.sugk==="lib"){ const sel=$("#exEditMuscle"); if([...sel.options].some(o=>o.value===s.dataset.sugm)) sel.value=s.dataset.sugm; }
    refresh();
  });
  refresh();
}

// Apply a name/muscle edit. Muscle is local-only; the name is denormalized into
// every workout entry (and synced to the cloud/lab), so renaming cascades to
// those entries and re-marks the touched workouts pending so the fix re-syncs.
// If the new name matches another existing exercise, this becomes a merge.
function saveExerciseEdit(exId){
  const ex = exById(exId); if(!ex) return;
  const name = $("#exEditName").value.trim();
  const muscle = $("#exEditMuscle").value;
  if(!name){ toast("Name can't be empty"); return; }
  const target = DB.exercises.find(e=>e.id!==exId && e.name.toLowerCase()===name.toLowerCase());
  if(target){ mergeExercises(exId, target.id); return; }

  const renamed = name !== ex.name;
  ex.name = name;
  ex.muscle = muscle;
  if(renamed){
    for(const w of DB.workouts){
      let touched = false;
      for(const en of w.entries){ if(en.exId===exId){ en.name = name; touched = true; } }
      if(touched && currentUser && w._sync === 'synced') w._sync = 'pending';
    }
  }
  persist();
  if(currentUser && renamed) scheduleSyncPending();
  render();
  openExDetail(exId);
  toast("Saved");
}

// Fold `fromId` into `toId`: repoint every workout entry, combining sets when a
// workout already logged both, then drop the now-empty exercise. Keeps the
// survivor's name + muscle (the canonical one the user picked).
function mergeExercises(fromId, toId){
  const to = exById(toId); if(!to || fromId===toId) return;
  for(const w of DB.workouts){
    if(!w.entries.some(en=>en.exId===fromId)) continue;
    let toEntry = w.entries.find(en=>en.exId===toId);
    for(const en of w.entries){
      if(en.exId!==fromId) continue;
      if(toEntry && toEntry!==en){ toEntry.sets.push(...en.sets); }   // same day → combine sets
      else { en.exId = toId; en.name = to.name; toEntry = en; }
    }
    w.entries = w.entries.filter(en=>en.exId!==fromId);               // drop folded duplicates
    if(currentUser && w._sync === 'synced') w._sync = 'pending';
  }
  DB.exercises = DB.exercises.filter(e=>e.id!==fromId);
  persist();
  if(currentUser) scheduleSyncPending();
  render();
  openExDetail(toId);
  toast(`Merged into ${to.name}`);
}

/* ---------- LIBRARY / EXERCISES EVENTS ---------- */
$("#addExToListBtn").addEventListener("click",()=>{
  openAddExercise({ markUsed:false, title:"Add exercise", onChoose:(id)=>{ render(); openExDetail(id); } });
});

$("#exSearch").addEventListener("input", renderEx);
$("#exBody").addEventListener("click",e=>{
  const g = e.target.closest("[data-group-toggle]");
  if(g){ const m = g.dataset.groupToggle; _exGroupOpen[m] = !_exGroupOpen[m]; renderEx(); return; }
  const d = e.target.closest("[data-ex-detail]");
  if(d) openExDetail(d.dataset.exDetail);
});
$("#sheet").addEventListener("focusin", e=>{
  if(e.target.id==="resW" || e.target.id==="resR")
    requestAnimationFrame(()=>{ try{ e.target.select(); }catch(_){} });
});
$("#sheet").addEventListener("keydown", e=>{
  if(e.key !== "Enter") return;
  const add = $("#resAdd");
  if(add && (e.target.id === "resW" || e.target.id === "resR")){ e.preventDefault(); add.click(); }
});
// `error` doesn't bubble, so this has to run in the capture phase to reach a
// delegated handler at all — the How-to tab's two <img> frames are the only
// thing in the sheet that can fail to load (see FEDB_IMG_BASE / howtoFoundHTML):
// they're cross-origin, so the service worker never caches them (sw.js), and a
// bad connection means a real load failure, not just a slow one.
$("#sheet").addEventListener("error", e=>{
  const img = e.target;
  if(!img || img.tagName !== "IMG" || !img.hasAttribute("data-howto-img")) return;
  const media = img.closest(".howto-media");
  if(media) media.classList.add("img-fail");
}, true);
$("#sheet").addEventListener("click",e=>{
  const tabBtn = e.target.closest("[data-ex-tab]");
  if(tabBtn){ _exDetailTab = tabBtn.dataset.exTab; renderExDetailSheet(); return; }
  const res = e.target.closest("[data-res]");
  if(res){
    const id = res.dataset.res;
    const date = $("#resDate").value || todayKey();
    const wv = parseFloat($("#resW").value), rv = parseInt($("#resR").value,10);
    if(!(wv>=0) || !(rv>0)){ toast("Enter weight & reps"); return; }
    const prevPB = pbFor(id);
    const wk = workoutFor(date, true);
    let en = wk.entries.find(x=>x.exId===id);
    if(!en){ const ex = exById(id); en = { exId:id, name:ex.name, sets:[] }; wk.entries.push(en); }
    en.sets.push({ type:"work", weight:wv, reps:rv });
    save();
    const newPB = pbFor(id);
    render();
    openExDetail(id);
    if(!prevPB || newPB.weight>prevPB.weight || (newPB.weight===prevPB.weight && newPB.reps>prevPB.reps)) toast("🏆 New PB!");
    else toast("Result added");
    return;
  }
  const editEx = e.target.closest("[data-edit-ex]");
  if(editEx){ openEditExercise(editEx.dataset.editEx); return; }
  if(e.target.id === "exEditBack"){ openExDetail($("[data-save-ex]").dataset.saveEx); return; }
  const saveEx = e.target.closest("[data-save-ex]");
  if(saveEx){ saveExerciseEdit(saveEx.dataset.saveEx); return; }
  const del = e.target.closest("[data-del-ex]");
  if(del){
    if(!confirm("Delete this exercise and remove it from all workouts? This cannot be undone.")) return;
    const id = del.dataset.delEx;
    DB.exercises = DB.exercises.filter(x=>x.id!==id);
    for(const w of DB.workouts){ w.entries = w.entries.filter(en=>en.exId!==id); }
    // tombstone any workouts that are now empty so their cloud rows get removed too
    for(const w of DB.workouts){ if(!w.entries.length && !w._demo) DB.deleted.push(w.id); }
    DB.workouts = DB.workouts.filter(w=>w.entries.length);
    save(); closeSheet(); render(); toast("Deleted");
  }
});
