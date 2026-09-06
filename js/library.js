"use strict";
/* ---------- EXERCISES / PBs ---------- */
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

  const byM = {};
  for(const e of list){ (byM[e.muscle]=byM[e.muscle]||[]).push(e); }
  const order = MUSCLES.filter(m=>byM[m]);
  body.innerHTML = order.map(mg=>{
    const rows = byM[mg].map(e=>{
      const pb = pbFor(e.id);
      const pbHtml = pb
        ? `<span class="pbbig">${fmtKg(pb.weight)} <small>×${pb.reps}</small></span>`
        : `<span class="faint small">no PB yet</span>`;
      return `<div class="card tap" data-ex-detail="${e.id}">
        <div class="ex-row"><span class="grow ellip" style="font-weight:600">${esc(e.name)}</span>${pbHtml}</div>
      </div>`;
    }).join("");
    return `<div class="grouphdr">${esc(mg)}</div>${rows}`;
  }).join("");
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
  if(d){ closePBPop(); switchTab("ex"); openExDetail(d.dataset.popdetail); }
});

function chartReadHTML(p, pbFlag, latest){
  return `<span class="cr-d">${latest?"Latest":""} ${dateLabel(p.date)}</span>
    <span class="cr-v">${fmtKg(p.top.weight)} <span class="muted">× ${p.top.reps}</span>${pbFlag?' <span class="pbflag">PB</span>':''}</span>`;
}

function openExDetail(exId){
  const ex = exById(exId); if(!ex) return;
  const pb = pbFor(exId);
  const hist = exHistory(exId);

  const rows = hist.length? hist.map(h=>{
    const isPB = pb && h.top.weight===pb.weight && h.top.reps===pb.reps;
    return `<div class="row between" style="padding:9px 0;border-top:1px solid var(--border)">
      <span class="small">${dateLabel(h.date)}</span>
      <span class="small"><b>${fmtKg(h.top.weight)}×${h.top.reps}</b> ${isPB?'<span class="pbflag">PB</span>':''} <span class="faint">· ${h.sets} sets</span></span>
    </div>`;
  }).join("") : '<div class="faint small" style="padding:14px 0">No working sets logged yet.</div>';

  openSheet(`
    <div class="row between" style="margin-bottom:4px">
      <h2 style="margin:0">${esc(ex.name)}</h2>
      <button class="link small" data-edit-ex="${ex.id}" style="white-space:nowrap">Edit</button>
    </div>
    <span class="chip"><span class="dot"></span>${esc(ex.muscle)}</span>
    <div class="card" style="margin-top:14px;text-align:center">
      <div class="small muted" style="font-weight:700;margin-bottom:4px">PERSONAL BEST</div>
      ${pb? `<div style="font-size:30px;font-weight:800">${fmtKg(pb.weight)} <span class="muted" style="font-size:18px">× ${pb.reps}</span></div><div class="faint small">${dateLabel(pb.date)}</div>`
          : '<div class="faint">Not set yet</div>'}
    </div>
    <div class="grouphdr" style="margin-left:0">ADD A RESULT</div>
    <div class="setform" style="margin-top:0">
      <div class="field" style="margin:0"><label>Weight (kg)</label><input class="in" inputmode="decimal" enterkeyhint="done" id="resW" placeholder="0"></div>
      <div class="field" style="margin:0"><label>Reps</label><input class="in" inputmode="numeric" enterkeyhint="done" id="resR" placeholder="0"></div>
      <button class="btn primary" id="resAdd" data-res="${ex.id}" style="height:46px">Add</button>
    </div>
    <div class="field" style="margin-top:10px"><label>Date</label>
      <input type="date" class="datepick" id="resDate" value="${todayKey()}" max="${todayKey()}" style="width:100%"></div>
    <div class="tiny faint" style="margin:8px 0 2px">Logs a working set on that date — updates your PB if it beats it.</div>
    <div class="grouphdr" style="margin-left:0">PROGRESSION <span class="faint" style="font-weight:600;text-transform:none;letter-spacing:0">· top set</span></div>
    ${progressChartHTML(hist, pb)}
    <div class="grouphdr" style="margin-left:0">SESSION HISTORY</div>
    ${rows}
    <hr class="hr">
    <button class="btn full danger ghost" data-del-ex="${ex.id}">Delete exercise &amp; its data</button>
  `);
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
$("#sheet").addEventListener("click",e=>{
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
