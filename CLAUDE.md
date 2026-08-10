# Lift Log — gym app

A single-file, no-build PWA for logging lifts. Offline-first: localStorage is the
source of truth on-device, synced up to Supabase so the "lab" (a separate analysis
project) can read workouts and write back a coaching plan.

## Layout

| File | What it is |
|---|---|
| `index.html` | The entire app — styles, markup, and all JS in one file (~1800 lines) |
| `exercises.js` | Seed exercise catalogue |
| `sw.js` | Service worker, network-first app-shell cache |
| `manifest.webmanifest`, `icons/` | PWA install metadata |
| `supabase/migrations/` | Schema for the `workouts` + `plans` tables |

`index.html` is sectioned by `/* ---------- NAME ---------- */` banner comments:
Supabase → Storage → auth + sync → Utils → Data helpers → LOG → HISTORY →
EXERCISES / PBs → COACH → MORE → Backup → Boot. Five tabs, driven by
`nav button[data-tab]`.

## Data model

- `DB = { exercises:[], workouts:[] }` in localStorage under `KEY`; `load()` / `save()`.
- `save()` marks the edited workout `_sync:'pending'` and schedules a push.
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
   python3 -m http.server 8000
   ```
   Open <http://localhost:8000>. Edit → refresh. The service worker is
   deliberately not registered on localhost (see the Boot section), so there is no
   cache to fight.
3. When a batch is reviewed and good, merge to `main` and push once.

### Release checklist (merging to `main`)

- **Bump `CACHE` in `sw.js`** (`liftlog-vN` → `vN+1`). This is what forces already-
  installed phones onto the new version. Easy to forget, and skipping it means the
  change ships but nobody sees it.

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
- Theme is "Twilight" — mid blue-navy background, bright cyan accent, Plus Jakarta
  Sans. CSS custom properties are defined at the top of the `<style>` block.
