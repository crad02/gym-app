"use strict";
/* ============================================================
   BODYGRAPH — weekly muscle heatmap figure
   ============================================================
   A hand-authored inline-SVG body (front + back) whose 12 muscle regions
   tint by this week's hard-set volume. Reads weekWorkSetsByMuscle() /
   weekStartKey() / VOL_MIN / VOL_HIGH straight from js/coach.js — this file
   defines no new storage, no new DB fields, and no new banding thresholds.
   coach.js loads before this file (see index.html), so those are real
   globals by the time anything here runs.

   bodygraphHTML(tally, opts) → HTML string
     tally   weekWorkSetsByMuscle()'s output: { [muscle]: hardSetCount }.
     opts    all optional —
       compact   boolean, default false. Smaller card padding and hides the
                 "Front"/"Back" sub-labels, for a card that's sharing the
                 screen with other content (Home's card stack). Does NOT by
                 itself hide the legend — that's `legend`, so a caller can
                 still ask for compact+legend if it wants both.
       legend    boolean, default true. Renders the band-colour key strip
                 (1–9 / 10–19 / 20+) beneath the figure.
       heading   string|null, default null. Optional small caption printed
                 above the figure (e.g. "THIS WEEK"). Omitted renders
                 nothing — the caller's own card heading is enough on Home.

   Both views share one viewBox (BODYGRAPH_VIEWBOX) so front and back scale
   identically side by side — see "Why side-by-side" below.

   Every muscle shape is authored ONLY for the screen-left half of the body,
   then reproduced with a mirror transform for the right half (bgView()
   below) — so a limb or lobe is only ever drawn, and only ever needs fixing,
   once. Two muscles are geometrically identical between views (the app's
   taxonomy can't split them — see GROUP_MUSCLES's comment in coach.js) and
   deliberately reuse the same 'd' string: Shoulders (front delt cap / rear
   delt cap read as the same 2D silhouette region) and Forearms (front and
   back of the forearm project to the same outline here). That's not a bug —
   both copies are driven by the one tally number there is for that muscle.

   Why side-by-side, not a toggle: the whole point is reading the week's
   spread at a glance mid-set — a toggle hides half the answer behind a tap.
   Chest/biceps/quads/abs/front-delts only read from the front; back/
   triceps/hamstrings/glutes/calves only from the back (CLAUDE.md brief), so
   a single view genuinely cannot show the week.

   "Other" has no home on a body (it's the catch-all for exercises tagged to
   no specific muscle) — it's excluded from the figure and, when present,
   surfaced as one plain-text line below the figure instead of silently
   dropped.

   Bands intentionally add a 4th, SVG-only state on top of coach.js's three:
   coach.js's volumeStripHTML() only ever has "vol-under" as its floor class
   (a muscle with 0 sets there just renders a 0%-width bar, so it reads as
   empty through the bar's width, not its colour). A filled body region has
   no "width" to shrink to nothing, so 0 sets needs its own quiet colour
   (the neutral surface tone, same as the untouched silhouette) or it would
   render gold — "a little trained" — for a muscle that's had zero sets.
   1–9 / 10–19 / 20+ still map to vol-under / vol-good / vol-high exactly as
   coach.js defines them, using the same CSS variables, so a week never
   reads two different ways on the two screens.
   ============================================================ */

const BODYGRAPH_VIEWBOX = "0 0 120 300";

/* ---------- muscle resolution ----------
   Two vocabularies meet here. The log stores one coarse group per exercise
   ("Back"); js/muscles.js knows what an exercise actually works ("lats",
   "middle back", "traps", "lower back"); and the artwork in js/bodymap.js is
   addressed by its own slugs. FINE_TO_SLUG is the join.

   lats and middle back both land on "upper-back" because that is the finest
   region the artwork actually draws — the split exists in the data and would
   be honoured the day a map with separate lat and rhomboid regions replaces
   this one. Nothing upstream needs to change for that. */
const FINE_TO_SLUG = {
  "quadriceps":"quadriceps", "hamstrings":"hamstring", "calves":"calves",
  "glutes":"gluteal", "abductors":"gluteal", "adductors":"adductors",
  "chest":"chest", "shoulders":"deltoids", "traps":"trapezius",
  "lats":"upper-back", "middle back":"upper-back", "lower back":"lower-back",
  "biceps":"biceps", "triceps":"triceps", "forearms":"forearm",
  "abdominals":"abs", "neck":"neck",
};

// Fallback for an exercise the user invented, which will never be in
// js/muscles.js. One coarse group, one region — worse resolution, but it
// still shows up on the body rather than vanishing from the week.
const COARSE_TO_SLUG = {
  Back:"upper-back", Chest:"chest", Shoulders:"deltoids", Quads:"quadriceps",
  Hamstrings:"hamstring", Glutes:"gluteal", Calves:"calves", Biceps:"biceps",
  Triceps:"triceps", Forearms:"forearm", Core:"abs",
};

/* ---------- name resolution ----------
   js/muscles.js is keyed by the dataset's formal names ("Barbell Bench Press -
   Medium Grip"). People log "Bench Press". Exact matching therefore resolves
   almost nothing in practice — 2 of 14 on a realistic set of exercises — even
   though every *catalogue* name matches, which is a measurement that flatters
   itself and hides the problem.

   So match on words instead: every word of what you typed must appear in the
   candidate, and the candidate with the fewest extra words wins. "Bench Press"
   finds the bench press; "Squat" finds a squat. Ties break alphabetically so
   the answer is stable between renders.

   Precision about *which* variant barely matters here: every bench press
   works chest primary and triceps/shoulders secondary, and that is all this
   map is asked for. Resolution is cached — it is a scan over 675 names and
   the heatmap redraws on every Home paint. */
const _muscleCache = new Map();
let _muscleIndex = null;

function _words(s){ return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean); }

function musclesForExercise(name, coarse){
  if(!name) return null;
  const key = name + "|" + (coarse || "");
  if(_muscleCache.has(key)) return _muscleCache.get(key);

  let hit = EXERCISE_MUSCLES[name] || null;
  if(!hit){
    if(!_muscleIndex){
      _muscleIndex = Object.keys(EXERCISE_MUSCLES).map(k => ({ k, w: _words(k) }));
      _muscleIndex.sort((a,b) => a.k < b.k ? -1 : 1);
    }
    const want = _words(name);
    if(want.length){
      // The word test alone can't tell a bench press from a close-grip bench
      // press, and picks whichever sorts first — which made "Bench Press" come
      // back triceps-primary. The exercise's own muscle tag settles it: a
      // candidate whose primary agrees with what you filed the lift under wins
      // over one that doesn't, however few extra words it has.
      const wantSlug = COARSE_TO_SLUG[coarse];
      let best = null, bestScore = null;
      for(const cand of _muscleIndex){
        if(!want.every(w => cand.w.includes(w))) continue;
        const prim = EXERCISE_MUSCLES[cand.k][0] || [];
        const agrees = wantSlug ? prim.some(m => FINE_TO_SLUG[m] === wantSlug) : true;
        const score = [agrees ? 0 : 1, cand.w.length - want.length];
        if(!bestScore || score[0] < bestScore[0] ||
           (score[0] === bestScore[0] && score[1] < bestScore[1])){
          bestScore = score; best = cand.k;
        }
      }
      if(best) hit = EXERCISE_MUSCLES[best];
    }
  }
  _muscleCache.set(key, hit);
  return hit;
}

// A set worked a muscle directly, or it worked it along the way. Counting the
// second at half weight is what makes the map read like training rather than
// bookkeeping: press day lights your triceps without a triceps exercise in it.
const SECONDARY_WEIGHT = 0.5;

// This week's volume per ARTWORK REGION, which is what the figure can draw.
// Same week window as weekWorkSetsByMuscle() — weekStartKey() is the reset.
function weekRegionLoad(){
  const start = weekStartKey();
  const load = {};
  const add = (slug, n) => { if(slug) load[slug] = (load[slug] || 0) + n; };

  for(const w of DB.workouts){
    if(w.date < start) continue;           // ISO date strings sort chronologically
    for(const en of w.entries){
      const n = en.sets.filter(isHardSet).length;
      if(!n) continue;
      const ex   = exById(en.exId);
      const fine = musclesForExercise((ex && ex.name) || en.name, ex && ex.muscle);
      if(fine){
        for(const m of fine[0]) add(FINE_TO_SLUG[m], n);
        for(const m of fine[1]) add(FINE_TO_SLUG[m], n * SECONDARY_WEIGHT);
      } else {
        add(COARSE_TO_SLUG[ex ? ex.muscle : "Other"], n);
      }
    }
  }
  return load;
}

// Region slug → the label a person recognises.
const SLUG_LABEL = {
  "chest":"Chest", "abs":"Abs", "obliques":"Obliques", "deltoids":"Shoulders",
  "biceps":"Biceps", "triceps":"Triceps", "forearm":"Forearms",
  "trapezius":"Traps", "upper-back":"Upper back", "lower-back":"Lower back",
  "gluteal":"Glutes", "quadriceps":"Quads", "hamstring":"Hamstrings",
  "calves":"Calves", "adductors":"Adductors", "tibialis":"Shins", "neck":"Neck",
};
// Drawn, but never tinted — they carry the figure, not the data.
const INERT_SLUGS = new Set(["head","hair","hands","feet","ankles","knees"]);

/* ---------- the continuous usage gradient ----------
   Four hard buckets threw away the difference between 3 sets and 9. The colour
   now moves continuously, but through the SAME landmarks the Coach tab uses,
   so the meaning is unchanged: amber below target, green at target, warm above
   it. Both ends read as "look here" — that is deliberate, this is not a
   more-is-better ramp. */
function bgFill(n){
  if(!(n > 0)) return null;                       // untrained keeps the base fill
  const stops = [
    { at: 0.5,      h: 43, s: 78, l: 52 },        // amber — barely touched
    { at: VOL_MIN,  h: 145, s: 50, l: 50 },       // green — on target
    { at: VOL_HIGH, h: 8,  s: 72, l: 60 },        // warm  — a lot of volume
  ];
  if(n <= stops[0].at) return `hsl(${stops[0].h} ${stops[0].s}% ${stops[0].l}%)`;
  for(let i = 1; i < stops.length; i++){
    const a = stops[i-1], b = stops[i];
    if(n <= b.at || i === stops.length - 1){
      const t = Math.min(1, (n - a.at) / (b.at - a.at));
      const mix = (x, y) => Math.round(x + (y - x) * t);
      return `hsl(${mix(a.h,b.h)} ${mix(a.s,b.s)}% ${mix(a.l,b.l)}%)`;
    }
  }
}

function bgRegionHTML(part, load){
  const slug = part.slug;
  const inert = INERT_SLUGS.has(slug);
  const n = inert ? 0 : (load[slug] || 0);
  const fill = inert ? null : bgFill(n);
  const label = SLUG_LABEL[slug];
  const title = (!inert && label)
    ? `<title>${esc(label)} — ${esc(bgSets(n))} this week</title>` : "";
  const style = fill ? ` style="fill:${fill}"` : "";
  const cls   = inert ? "mg-inert" : (n > 0 ? "mg mg-on" : "mg");
  return [...(part.left||[]), ...(part.right||[])]
    .map(d => `<path class="${cls}"${style} data-region="${esc(slug)}" d="${d}">${title}</path>`)
    .join("");
}

// Sets can be fractional once secondary work counts, so don't print "7.5 sets"
// as though it were counted that precisely — round for display only.
function bgSets(n){
  const r = Math.round(n);
  return !n ? "not trained" : `${r === 0 ? "<1" : r} hard set${r === 1 ? "" : "s"}`;
}

function bgView(label, view, load){
  const parts = BODYMAP[view] || [];
  return `<div class="bodygraph-view">
    <svg viewBox="${BODYMAP_VIEWBOX[view]}" xmlns="http://www.w3.org/2000/svg"
         role="img" aria-label="${esc(label)} view of muscles trained this week">
      ${parts.map(p => bgRegionHTML(p, load)).join("")}
    </svg>
    <div class="bodygraph-view-label">${esc(label)}</div>
  </div>`;
}

// The scale is continuous now, so the legend shows the ramp itself with the
// two landmarks marked on it, rather than three buckets that no longer exist.
function bgLegendHTML(){
  const ramp = [0.5, 3, 6, VOL_MIN, 14, 17, VOL_HIGH, VOL_HIGH*1.3]
    .map(n => `<i style="background:${bgFill(n)}"></i>`).join("");
  return `<div class="bodygraph-legend">
    <span class="bodygraph-legend-cap">less</span>
    <span class="bodygraph-ramp">${ramp}</span>
    <span class="bodygraph-legend-cap">more</span>
    <span class="bodygraph-legend-note">${VOL_MIN}–${VOL_HIGH} sets / muscle</span>
  </div>`;
}

/* ---------- public API — see the file-header comment for opts ---------- */
// The figure answers "which muscles", but not "how many sets" — and the bar
// list this replaced on Coach did carry that number. A <title> is worthless on
// a phone with no hover, so the counts are printed. Trained regions only,
// heaviest first: the untrained ones already read as the quiet shapes above.
function bgCountsHTML(load){
  const rows = Object.keys(load)
    .filter(k => load[k] > 0 && SLUG_LABEL[k])
    .sort((a,b) => load[b] - load[a]);
  if(!rows.length) return `<div class="bodygraph-empty">No hard sets logged yet this week — go bank some.</div>`;
  return `<div class="bodygraph-counts">${rows.map(k => {
    const n = Math.round(load[k]);
    return `<span class="bodygraph-count"><i style="background:${bgFill(load[k])}"></i>` +
           `${esc(SLUG_LABEL[k])}<b>${n === 0 ? "<1" : n}</b></span>`;
  }).join("")}</div>`;
}

// `load` is optional: callers that have nothing special to say just call
// bodygraphHTML() and get this week. It stays a parameter so a future caller
// can render some other window (last week, a single session) unchanged.
function bodygraphHTML(load, opts){
  opts = opts || {};
  load = load || weekRegionLoad();
  const compact = !!opts.compact;
  const showLegend = opts.legend !== false;
  const heading = opts.heading || null;

  return `<div class="card bodygraph-card${compact ? " bodygraph-compact" : ""}">
    ${heading ? `<div class="bodygraph-heading">${esc(heading)}</div>` : ""}
    <div class="bodygraph-views">${bgView("Front","front",load)}${bgView("Back","back",load)}</div>
    ${showLegend ? bgCountsHTML(load) + bgLegendHTML() : ""}
  </div>`;
}
