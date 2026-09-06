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

function setChipsHTML(sets){
  if(!sets.length) return `<div class="set-chips faint">no sets yet — tap to log</div>`;
  const chips = sets.map(s=>{
    const label = `${fmtKg(s.weight)}×${s.reps}${s.type==='drop'?'+':''}`;
    return s.type==='warm' ? `<span class="warm">${label}</span>` : label;
  }).join(' · ');
  return `<div class="set-chips">${chips}</div>`;
}

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

function ctxStripHTML(en, ex, i){
  const pb = pbFor(en.exId);
  const last = lastSession(en.exId);
  const lastTop = last ? last.sets.reduce((a,b)=> b.weight>a.weight?b:a, last.sets[0]) : null;
  const aim = coachAimFor(ex.name);
  return `<div class="ctx-strip">
    <div class="ctx"><div class="cl">LAST</div><div class="cv">${lastTop ? `${fmtKg(lastTop.weight)}×${lastTop.reps}` : '—'}</div></div>
    ${aim ? `<div class="ctx aim" data-aim="${i}" data-aim-w="${aim.target_weight}" data-aim-r="${aim.target_reps}" title="Tap to use">
      <div class="cl">AIM${aim.expected_change!=null ? (aim.expected_change>0.5?' ↑':aim.expected_change<-0.5?' ↓':' →') : ''}</div>
      <div class="cv">${fmtKg(aim.target_weight)}×${aim.target_reps}</div></div>` : ''}
    <div class="ctx pbx tappable" data-pbpop="${en.exId}" title="Tap for progression">
      <div class="cl">PB ↗</div><div class="cv">${pb ? `${fmtKg(pb.weight)}×${pb.reps}` : '—'}</div></div>
  </div>`;
}

function setRowsHTML(en, i){
  return en.sets.map((s,si)=>{
    const tag = s.type==='work'?'work':s.type==='drop'?'drop':'warm';
    const label = s.type==='work'?'WORK':s.type==='drop'?'DROP':'WARMUP';
    const isEditing = editingSet && editingSet.ei===i && editingSet.si===si;
    let valHtml;
    if(s.type==='drop'){
      const chain = [{weight:s.weight,reps:s.reps}, ...(s.drops||[])]
        .map(d=>`${fmtKg(d.weight)}<small>×${d.reps}</small>`).join(' <span class="faint">→</span> ');
      valHtml = `<span class="val" style="grid-column:2/4">${chain}</span>`;
    } else {
      valHtml = `<span class="val">${fmtKg(s.weight)}</span><span class="val">${s.reps} <small>reps</small></span>`;
    }
    return `<div class="set editable${isEditing?' editing':''}" data-edit-set="${i}:${si}">
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
  const lastTop = last ? last.sets.reduce((a,b)=> b.weight>a.weight?b:a, last.sets[0]) : null;
  return lastTop ? {type:'work', w:lastTop.weight, r:lastTop.reps} : {};
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
    ${editingSet ? `<div class="edit-bar"><span>Editing set ${editingSet.si+1}</span><button class="link small" data-cancel-edit>cancel</button></div>` : ''}
    ${setFormHTML(i, prefillFor(en,i), !!editingSet)}
    ${(!editingSet && en.sets.length) ? `<button class="btn ghost again-btn" data-again="${i}">↻ Same as last set</button>` : ''}
    <button class="btn ghost full sm superset-btn" data-superset="${i}">⇄ Superset with…</button>
  </div>`;
}

// A superset logs by round: one form, both lifts, one Add.
function supersetCardHTML(w, block, bi, isOpen){
  const ens = block.idxs.map(i=>w.entries[i]);
  const exs = ens.map((en,k)=>exById(en.exId) || {name:en.name,muscle:"Other"});
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
  const rounds = Math.max(...ens.map(en=>en.sets.length));
  let roundsHTML = "";
  for(let r=0;r<rounds;r++){
    const lines = ens.map((en,k)=>{
      const s = en.sets[r];
      const i = block.idxs[k];
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

function setFormHTML(entryIdx, pre, editing){
  pre = pre || {};
  const t = pre.type || 'work';
  const dropRows = (t==='drop' ? (pre.drops||[]) : []).map(d=>`
    <div class="droprow" data-droprow>
      <input class="in" inputmode="decimal" data-dw placeholder="drop kg" value="${d.weight ?? ''}">
      <input class="in" inputmode="numeric" data-dr placeholder="reps" value="${d.reps ?? ''}">
      <button class="iconbtn" data-deldrop aria-label="Remove drop">✕</button>
    </div>`).join('');
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
        <input class="in" inputmode="decimal" enterkeyhint="done" data-w placeholder="0" value="${pre.w ?? ''}">
      </div>
      <div class="field" style="margin:0">
        <label>Reps</label>
        <input class="in" inputmode="numeric" enterkeyhint="done" data-r placeholder="0" value="${pre.r ?? ''}">
      </div>
      <button class="btn primary" data-addset="${entryIdx}" style="height:46px">${editing?'Update':'Add'}</button>
    </div>
    <div data-dropwrap style="display:${t==='drop'?'block':'none'}">
      <div data-droprows>${dropRows}</div>
      <button class="link small" data-adddrop="${entryIdx}" style="margin-top:8px">+ add drop</button>
    </div>
  </div>`;
}

/* ---------- Supersets ---------- */
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
   LOG EVENTS
   ============================================================ */
$("#addExerciseBtn").addEventListener("click", ()=>openAddExercise());

$("#logDate").addEventListener("change",()=>{ setEditDate($("#logDate").value); render(); });
$("#logSub").addEventListener("click",e=>{ if(e.target.id==="backToday"){ setEditDate(todayKey()); render(); } });

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
  // ── log v2 interactions ──
  const cancel = e.target.closest("[data-cancel-edit]");
  if(cancel){ editingSet = null; render(); return; }
  const pbp = e.target.closest("[data-pbpop]");
  if(pbp){ openPBPop(pbp.dataset.pbpop, pbp); return; }
  const aim = e.target.closest("[data-aim]");
  if(aim){
    const form = $(`[data-setform="${aim.dataset.aim}"]`);
    if(form){ $("[data-w]",form).value = aim.dataset.aimW; $("[data-r]",form).value = aim.dataset.aimR; }
    toast("Aim loaded — hit Add");
    return;
  }
  // ── supersets ──
  const ss = e.target.closest("[data-superset]");
  if(ss){
    const anchor = +ss.dataset.superset;
    openAddExercise({ title:"Pair with…", onChoose:(exId)=>addSupersetPartner(anchor, exId) });
    return;
  }
  const round = e.target.closest("[data-addround]");
  if(round){ addRound(round.dataset.addround); return; }
  const delr = e.target.closest("[data-del-round]");
  if(delr){
    const [g, r] = delr.dataset.delRound.split(":");
    delRound(g, +r);
    return;
  }
  const unlink = e.target.closest("[data-unlink]");
  if(unlink){ unlinkSuperset(unlink.dataset.unlink); return; }
  const again = e.target.closest("[data-again]");
  if(again){
    const wk = activeWorkout(false); if(!wk) return;
    const ei = +again.dataset.again;
    const sets = wk.entries[ei]?.sets || [];
    if(sets.length) dupSet(ei, sets.length-1);
    return;
  }
  const es = e.target.closest("[data-edit-set]");
  if(es && !e.target.closest("button")){
    const [ei,si] = es.dataset.editSet.split(":").map(Number);
    editingSet = (editingSet && editingSet.ei===ei && editingSet.si===si) ? null : {ei,si};
    render();
    return;
  }
  const head = e.target.closest("[data-card-head]");
  if(head && !e.target.closest("button")){
    const i = +head.dataset.cardHead;
    const wk = activeWorkout(false);
    // openEntry is a *block* index (paired supersets collapse into one block),
    // so the default must be derived from the block list — not entries.length-1,
    // which would be wrong whenever a superset is present.
    const blocks = wk ? logBlocks(wk.entries) : [];
    const openIdx = (openEntry !== null) ? openEntry : (blocks.length > 0 ? blocks.length-1 : -1);
    openEntry = (i === openIdx) ? -1 : i;   // tap open card → collapse all
    editingSet = null;
    render();
    return;
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
  const div = document.createElement("div");
  div.className = "droprow"; div.setAttribute("data-droprow","");
  div.innerHTML = `<input class="in" inputmode="decimal" data-dw placeholder="drop kg">
    <input class="in" inputmode="numeric" data-dr placeholder="reps">
    <button class="iconbtn" data-deldrop aria-label="Remove drop">✕</button>`;
  rows.appendChild(div);
}

function addSet(entryIdx){
  const form = $(`[data-setform="${entryIdx}"]`);
  const type = formType(form);
  const w = parseFloat($("[data-w]",form).value);
  const r = parseInt($("[data-r]",form).value,10);
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
  // render() replaced the form, so put the cursor back — otherwise the keyboard
  // drops between every set. Reps, not weight: the load usually repeats and the
  // reps usually don't, and both are already prefilled.
  focusField($(`[data-setform="${entryIdx}"] [data-r]`));
  const ex = exById(wk.entries[entryIdx].exId);
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
  if(s.drops) copy.drops = s.drops.map(d=>({...d}));   // deep-copy a drop set's segments
  w.entries[entryIdx].sets.splice(setIdx+1, 0, copy);
  save(); render(); toast("Set repeated");
}
function delSet(entryIdx,setIdx){
  const w = activeWorkout(false); if(!w) return;
  const undo = snapshotWorkout(w);
  w.entries[entryIdx].sets.splice(setIdx,1);
  editingSet = null;   // indices shifted
  save(); render();
  toastUndo("Set deleted", undo);
}
// The one logging-flow delete that asks first: an entry takes every set with it,
// and unlike a single set there's no cheap way to eyeball what you're losing.
// Undo still stands behind the confirm.
function delEntry(entryIdx){
  const w = activeWorkout(false); if(!w) return;
  const name = (exById(w.entries[entryIdx].exId) || w.entries[entryIdx]).name || "Exercise";
  const n = w.entries[entryIdx].sets.length;
  if(!confirm(`Remove ${name}${n ? ` and its ${n} set${n===1?"":"s"}` : ""} from this workout?`)) return;
  const undo = snapshotWorkout(w);
  w.entries.splice(entryIdx,1);
  if(!w.entries.length){
    // tombstone so the cloud row gets deleted on next sync (snapshotWorkout's
    // restore closure will un-tombstone if the user hits Undo)
    if(!w._demo) DB.deleted.push(w.id);
    DB.workouts = DB.workouts.filter(x=>x!==w);
  }
  openEntry = null; editingSet = null;   // indices shifted; fall back to auto
  save(); render();
  toastUndo(`${name} removed`, undo);
}
