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

/* ---------- shared neutral silhouette (identical in both views) ----------
   One skeleton, stated once, so the muscle shapes below can be nested inside
   it rather than floating over it. Every limb has explicit outer/inner bounds
   and each muscle is inset a couple of units from them — that is the whole
   trick to this drawing reading as a body instead of stickers on a mannequin.

     centre x = 60          torso  x 36→60 (shoulder), 46→60 (waist)
     upper arm x 24→36      forearm x 20→31
     thigh     x 36→56      shin    x 39→52

   Authored for the SCREEN-LEFT half only and mirrored about x=60 at render
   time — the mirror is also what splits the chest and abs down the sternum,
   so those need no centre line of their own. */
const BG_NECK_D  = "M54,26 C54,31 55,35 57,38 L63,38 C65,35 66,31 66,26 Z";
const BG_TORSO_D = "M60,40 C51,40 43,43 38,50 C35,57 35,66 37,76 C39,88 42,100 44,112 " +
                   "C45,124 45,138 46,150 L60,150 Z";
const BG_UPARM_D = "M36,46 C28,49 22,58 20,70 C18,82 17,93 16,103 L28,105 " +
                   "C30,93 31,82 33,71 C35,62 37,53 38,46 Z";
const BG_FARM_D  = "M16,105 C14,115 13,127 14,139 C15,146 17,150 19,152 L26,150 " +
                   "C26,140 27,128 27,117 C27,112 27,108 28,105 Z";
const BG_THIGH_D = "M46,152 C41,158 38,168 37,180 C36,192 37,203 38,214 L52,214 " +
                   "C52,203 53,191 54,179 C55,168 56,158 57,152 Z";
const BG_SHIN_D  = "M39,216 C37,228 37,242 38,254 C39,262 40,268 41,272 L50,272 " +
                   "C51,264 52,254 52,242 C52,230 52,222 52,216 Z";

/* ---------- muscle regions, left half only (mirrored at render time) ----------
   Each shape sits INSIDE its limb's bounds above. Placement carries the read
   at thumbnail size: biceps on the inner/front of the upper arm, triceps on
   the outer/rear, lats as a V tapering into the waist, quads a teardrop
   widest at the hip, calves the diamond high on the shin. */
const BG_SHOULDER_D  = "M39,43 C31,44 24,50 22,60 C21,67 25,72 31,70 C36,67 39,60 40,52 C40,48 40,45 39,43 Z";
// pec: sternum edge at x=59, so the mirror closes it into a two-lobed chest
const BG_CHEST_D     = "M57,47 C49,47 43,51 40,58 C39,65 42,72 47,76 C51,79 55,79 57,78 Z";
const BG_BICEP_D     = "M31,55 C27,60 25,68 24,78 C23,86 26,93 31,91 C35,88 36,81 36,72 C36,64 34,58 33,55 Z";
const BG_TRICEP_D    = "M27,56 C23,62 21,71 20,81 C20,89 23,95 28,93 C32,90 33,83 33,74 C33,66 31,60 29,56 Z";
const BG_FOREARM_D   = "M16,109 C15,117 14,127 15,137 C16,143 20,145 23,143 " +
                        "C24,134 25,123 26,113 C23,109 19,108 16,109 Z";
const BG_QUAD_D      = "M47,158 C42,164 40,174 39,185 C38,195 40,204 44,207 " +
                        "C48,209 52,206 53,199 C54,188 54,176 54,167 C54,162 52,159 50,157 Z";
const BG_CORE_D      = "M53,84 C51,96 51,114 53,128 C56,135 64,135 67,128 " +
                        "C69,114 69,96 67,84 C63,81 57,81 53,84 Z";
// lat: broad across the shoulder blade, tapering into the waist — the V
const BG_BACK_D      = "M58,46 C50,47 44,52 42,60 C41,69 44,80 49,90 C52,96 55,100 58,101 Z";
const BG_GLUTE_D     = "M48,118 C43,121 40,128 40,136 C41,145 48,148 53,144 " +
                        "C56,138 56,129 53,121 C51,118 49,117 48,118 Z";
const BG_HAMSTRING_D = "M47,158 C42,164 40,174 39,185 C38,195 40,204 44,207 " +
                        "C48,209 52,206 53,199 C54,188 54,176 54,167 C54,162 52,160 50,158 Z";
const BG_CALF_D      = "M41,220 C39,229 39,240 41,249 C44,254 49,253 50,247 " +
                        "C51,239 51,229 49,220 C46,217 43,217 41,220 Z";

const BG_FRONT_MUSCLES = [
  { muscle:"Shoulders", d: BG_SHOULDER_D },
  { muscle:"Chest",     d: BG_CHEST_D },
  { muscle:"Biceps",    d: BG_BICEP_D },
  { muscle:"Forearms",  d: BG_FOREARM_D },
  { muscle:"Quads",     d: BG_QUAD_D },
];
const BG_BACK_MUSCLES = [
  { muscle:"Shoulders",  d: BG_SHOULDER_D },
  { muscle:"Back",       d: BG_BACK_D },
  { muscle:"Triceps",    d: BG_TRICEP_D },
  { muscle:"Forearms",   d: BG_FOREARM_D },
  { muscle:"Glutes",     d: BG_GLUTE_D },
  { muscle:"Hamstrings", d: BG_HAMSTRING_D },
  { muscle:"Calves",     d: BG_CALF_D },
];

/* ---------- band + markup helpers ---------- */
// Mirrors coach.js's volumeStripHTML() thresholds exactly, plus the 0-set
// "untrained" floor a filled shape needs (see file header).
function bgBand(n){
  if(!n) return "untrained";
  if(n >= VOL_HIGH) return "vol-high";
  if(n >= VOL_MIN) return "vol-good";
  return "vol-under";
}

function bgMuscleTitle(muscle, n){
  const tag = !n ? "not trained this week" : n >= VOL_HIGH ? "high" : n >= VOL_MIN ? "on target" : "building";
  return `${muscle} — ${n} hard set${n===1?"":"s"} this week (${tag})`;
}

function bgPath(muscle, d, tally){
  const n = tally[muscle] || 0;
  return `<path class="mg ${bgBand(n)}" data-muscle="${esc(muscle)}" d="${d}"><title>${esc(bgMuscleTitle(muscle,n))}</title></path>`;
}

// The neutral, always-quiet parts of the silhouette: outline of the arm,
// hand, leg and foot. Drawn under the tally-coloured muscle shapes so a
// fresh week (every muscle "untrained") still reads as a complete body, not
// gaps — see "renders as a quiet figure" in the brief.
const BG_NEUTRAL_LEFT =
  `<path class="mg-base" d="${BG_TORSO_D}"/>` +
  `<path class="mg-base" d="${BG_UPARM_D}"/><path class="mg-base" d="${BG_FARM_D}"/>` +
  `<ellipse class="mg-base" cx="20" cy="157" rx="5.5" ry="7.5"/>` +
  `<path class="mg-base" d="${BG_THIGH_D}"/><path class="mg-base" d="${BG_SHIN_D}"/>` +
  `<ellipse class="mg-base" cx="45" cy="278" rx="9" ry="6.5"/>`;

function bgLeftHalf(muscleDefs, tally){
  return BG_NEUTRAL_LEFT + muscleDefs.map(m => bgPath(m.muscle, m.d, tally)).join("");
}

// Front-only: abs, plus static (non-tally) six-pack lines — decoration, not
// a 13th muscle group, so they're never data-muscle-tagged or coloured.
function bgFrontCenter(tally){
  return bgPath("Core", BG_CORE_D, tally) +
    `<g class="mg-decor"><path d="M54,98 L66,98"/><path d="M55,110 L65,110"/><path d="M56,121 L64,121"/></g>`;
}

// One view (front or back): shared head/neck, the left half drawn once and
// mirrored with a transform (translate(120,0) scale(-1,1) reflects x about
// the viewBox's centre line, x=60, for any point — see file header), then
// whatever unpaired centre pieces that view has (abs, for front only).
function bgView(label, muscleDefs, centerHTML, tally){
  const left = bgLeftHalf(muscleDefs, tally);
  return `<div class="bodygraph-view">
    <svg viewBox="${BODYGRAPH_VIEWBOX}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(label)} view">
      <ellipse class="mg-base" cx="60" cy="16" rx="9" ry="11"/>
      <path class="mg-base" d="${BG_NECK_D}"/>
      <g>${left}</g>
      <g transform="translate(120,0) scale(-1,1)">${left}</g>
      ${centerHTML}
    </svg>
    <div class="bodygraph-view-label">${esc(label)}</div>
  </div>`;
}

function bgLegendHTML(){
  return `<div class="bodygraph-legend">
    <span class="bodygraph-legend-item"><i class="bodygraph-dot vol-under"></i>1–${VOL_MIN-1}</span>
    <span class="bodygraph-legend-item"><i class="bodygraph-dot vol-good"></i>${VOL_MIN}–${VOL_HIGH-1}</span>
    <span class="bodygraph-legend-item"><i class="bodygraph-dot vol-high"></i>${VOL_HIGH}+</span>
  </div>`;
}

/* ---------- public API — see the file-header comment for opts ---------- */
// The figure answers "which muscles", but not "how many sets" — and the bar
// list this replaced on Coach did carry that number. A <title> tooltip is no
// substitute on a phone, where there is no hover, so the counts are printed.
// Trained muscles only, heaviest first: the untrained ones are already
// legible as the quiet shapes on the figure above.
function bgCountsHTML(tally){
  // "Other" is excluded here — it has its own line beneath the figure, and
  // that line is the only place it can appear on Home, where counts are off.
  const rows = Object.keys(tally)
    .filter(m => tally[m] > 0 && m !== "Other")
    .sort((a,b) => tally[b] - tally[a]);
  if(!rows.length) return `<div class="bodygraph-empty">No hard sets logged yet this week — go bank some.</div>`;
  return `<div class="bodygraph-counts">${rows.map(m =>
    `<span class="bodygraph-count ${bgBand(tally[m])}">${esc(m)}<b>${tally[m]}</b></span>`
  ).join("")}</div>`;
}

function bodygraphHTML(tally, opts){
  opts = opts || {};
  tally = tally || {};
  const compact = !!opts.compact;
  const showLegend = opts.legend !== false;
  const heading = opts.heading || null;

  const frontHTML = bgView("Front", BG_FRONT_MUSCLES, bgFrontCenter(tally), tally);
  const backHTML  = bgView("Back", BG_BACK_MUSCLES, "", tally);
  const otherN = tally.Other || 0;

  return `<div class="card bodygraph-card${compact ? " bodygraph-compact" : ""}">
    ${heading ? `<div class="bodygraph-heading">${esc(heading)}</div>` : ""}
    <div class="bodygraph-views">${frontHTML}${backHTML}</div>
    ${showLegend ? bgCountsHTML(tally) + bgLegendHTML() : ""}
    ${otherN ? `<div class="bodygraph-other">+ ${otherN} hard set${otherN===1?"":"s"} logged as <b>Other</b> this week</div>` : ""}
  </div>`;
}
