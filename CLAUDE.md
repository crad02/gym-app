# Lift Log — gym app

A single-file, no-build PWA for logging lifts. Offline-first: localStorage is the
source of truth on-device, synced up to Supabase so the "lab" (a separate analysis
project) can read workouts and write back a coaching plan.

## Layout

| File | What it is |
|---|---|
| `index.html` | Markup only — `<link>` and `<script>` tags; no styles or logic |
| `css/app.css` | All styles (the former `<style>` block) |
| `js/core.js` | Supabase client + auth/sync, Storage, Utils, Data helpers, Lookup index, and the shared `render()` / `activeTab` / `editDate` state; also `openSheet` / `closeSheet` / `switchTab` and the `nav button` wiring |
| `js/session.js` | Session clock — `tickClock`, `renderSessionBar` |
| `js/log.js` | LOG screen, Session note, Supersets, and all `#logBody` / `#sessionBar` / `#notesCard` / `#addExerciseBtn` / `#logDate` handlers |
| `js/history.js` | HISTORY screen + its handlers |
| `js/library.js` | EXERCISES / PBs, the exercise picker sheet, edit/merge, the progression chart, the PB popover |
| `js/coach.js` | COACH screen + its group-tab handler |
| `js/more.js` | MORE screen, Backup, Dev seed |
| `js/boot.js` | Boot section + service worker registration |
| `exercises.js` | Seed exercise catalogue (`CATALOG` global) — stays at the repo root |
| `sw.js` | Service worker, stale-while-revalidate app-shell cache |
| `manifest.webmanifest`, `icons/` | PWA install metadata |
| `supabase/migrations/` | Schema for the `workouts` + `plans` tables |

Scripts load as **classic scripts** (no `type="module"`) so that top-level
globals (`DB`, `sb`, `currentUser`, `activeTab`, `editDate`, `$`, `$$`, …) are
shared across files without any import/export wiring. `"use strict"` is declared
at the top of every `js/` file.

Load order (bottom of `<body>`, in dependency order):
`exercises.js` → `vendor/supabase.js` → `core.js` → `session.js` → `log.js` →
`history.js` → `library.js` → `coach.js` → `more.js` → `boot.js`

## Data model

- `DB = { exercises:[], workouts:[], deleted:[], bodyweights:[], settings:{} }` in
  localStorage under `KEY`; `load()` / `save()`. Every field after `workouts` was
  added post-release, so `load()` defaults each one in — never assume a stored DB
  has them.
- `settings` is read through `getSetting()` / `setSetting()`; `DEFAULT_SETTINGS`
  in `core.js` is the single declaration of every key and its default, which is
  why adding a setting needs no migration. Keep preferences here rather than in
  their own localStorage key, or they fall out of the backup.
- `save()` marks the edited workout `_sync:'pending'` and schedules a push.
- `markDirty()` stamps `updatedAt` on the workout. It has to happen there and not
  in `touchSession()`, which returns early for back-filled workouts and for the
  first set of a session.
- Two-device sync: `restoreFromCloud()` merges rather than skipping. The newer
  `updatedAt` wins the workout's metadata, but entries and sets are always
  unioned, so a set logged on either device survives. A merge that kept
  local-only data is re-marked `pending` so the union goes back up.
- Supabase `workouts` upserts on `(user_id, client_id)` — `client_id` is the app's
  local `uid()`, so re-syncs update rather than duplicate. RLS scopes every row to
  the signed-in user.
- The Coach plan is written *by the lab* (service role) into `plans`; the app only
  reads the latest `active` row and caches it under `PLAN_KEY`.

## Development workflow

**GitHub Pages serves `main` at repo root — pushing to `main` is the deploy.**
So keep `main` deployable and iterate on a branch.

1. Work on `dev` (or a feature branch).
2. Serve locally and iterate:
   ```sh
   python3 -m http.server 8000 --directory /path/to/gym-app
   ```
   Open <http://localhost:8000>. Edit → refresh. The service worker is
   deliberately not registered on localhost (see `js/boot.js`), so there is no
   cache to fight.
3. When a batch is reviewed and good, merge to `main` and push once.

### Release checklist (merging to `main`)

- **Bump `CACHE` in `sw.js`** (`liftlog-vN` → `vN+1`) **and bump the `?v=N`
  query strings on every `<script>` and `<link>` tag in `index.html` and in
  `ASSETS` in `sw.js` to the same number.** Both must move together: the query
  string change makes `index.html`'s text differ (which fires the sw.js
  `before !== after` update notification), and the cache bump evicts the old
  cached files from every installed phone. Skipping either means phones either
  don't hear about the update, or hear about it but serve stale JS/CSS.

### Local sign-in

localhost is a separate origin, so localStorage starts empty there. To exercise the
app against real history, add `http://localhost:8000` to Supabase → Authentication →
URL Configuration → Redirect URLs.

⚠️ Once signed in on localhost you are reading and writing **live workout data**.
Fine for layout and UI work; anything that mutates or migrates records should be
guarded before running it locally.

## Conventions

- No build step, no framework, no dependencies beyond the Supabase UMD bundle off a
  CDN. Keep it that way — the whole point is that the app is one file you can open.
- Compact style: `$` / `$$` helpers for querySelector, template literals for markup,
  event delegation over per-node listeners.
- Comments explain *why*, not *what* — most of them record a bug that was already
  paid for once. Don't strip them when refactoring.
- Ghost (planned) sets are pure view state in `log.js` and must never reach `DB`.
  An unlogged intention must not become a logged fact.
- Theme is "Twilight" — mid blue-navy background, bright cyan accent, Plus Jakarta
  Sans. CSS custom properties are defined at the top of `css/app.css`.
