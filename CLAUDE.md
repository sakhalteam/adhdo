# adhdo — ADHD-friendly galaxy brain-dump/todo app

> Parent context: `../CLAUDE.md` has universal preferences and conventions. Keep it updated with anything universal you learn here.

## What this is

A personal todo/brain-dump app for Nic (who has ADHD). Floating blobby "globs" drift in a galaxy-themed space. Zero-friction capture, optional organization, everything malleable. The anti-Notion. (Formerly also "the anti-Todoist" — since 2026-09-16 the **mobile** layout is deliberately a Todoist clone, because on a phone that shape actually works; the desktop galaxy remains defiantly itself.)

## Stack

- Vite + React 19 + TypeScript + Tailwind v4 (via `@tailwindcss/vite` plugin, NOT PostCSS)
- `base: '/adhdo/'` in vite.config.ts
- Deployed to sakhalteam.github.io/adhdo/

## Architecture

- **App.tsx**: all state + CRUD operations (addGlob, addTask, deleteGlob, createCluster, mergeClusters, connectClusters, setGlobDueDate, setGlobPriority, etc), plus all cloud sync. Passes callbacks to Galaxy / MobileApp. **deleteGlob keeps emptied clusters** (since 2026-09-16): on mobile a cluster is a first-class project and must survive its last task; desktop still has explicit delete/dissolve paths.
- **Galaxy.tsx**: desktop rendering + physics loop (rAF) + all interaction handlers (drag, drop, connect, shake detect, context menus). Uses `handleDropRef` pattern to avoid stale closures in pointer events.
- **MobileApp.tsx**: the phone UI — a Todoist-shaped task app, not the galaxy. Same state, same App callbacks. Mounted instead of Galaxy when `useIsMobile()`. See "Mobile" below.
- **AppChrome.tsx**: shared chrome used by both layouts (HomeButton, AuthButton, UndoRedoBar, CaptureBar, MicButton, VoiceOverlay, indicators).
- **useVoiceCapture.ts**: hands-free dictation session. Owned by App.tsx (not the capture bars) so the two layouts can never open two mic sessions.
- **agenda.ts**: `buildAgenda(globs)` — the one definition of overdue / today / upcoming, called by BOTH the phone's Today+Upcoming tabs and the desktop agenda dock. Deliberately outside either layout: the moment each computed its own buckets they'd drift, and a task that shows on the phone but not the laptop is worse than no panel at all. Only open, dated to-dos land on an agenda.
- **dates.ts**: local-calendar due-date arithmetic (`'YYYY-MM-DD'` strings, never UTC Dates), `formatDue` (label + tone for the shared due-chip), and `parseQuickAdd` (the "call mum tomorrow p2" natural-language lift-out). Shared by MobileApp and GalaxyChrome so both layouts speak identical dates.
- **store.ts**: factory functions (makeGlob, makeCluster, makeConnection), localStorage load/save, cloud save/load + merge + repair, color palette.
- **types.ts**: Glob, Cluster, Connection, Priority (1–4), GalaxyState (globs[], clusters[], connections[]).
- **index.css**: ALL styles live here. Nebula background, blob morph keyframes, frosted glass, context menus, modals, etc. Minimal Tailwind utility usage in JSX.

### ⚠️ Class-name collisions between the galaxy and the mobile app

Both live in one stylesheet, so a bare galaxy class like `.cluster` (which is
`position: absolute` + `transform: translate(-50%,-50%)` + `min-width: 200px`) will hit
any mobile element that reuses the name. This shipped broken once: the mobile cluster
header used `className="mobile-section-head cluster"` and got yanked out of flow.
**Mobile modifiers are prefixed `is-`** (`.mobile-browse-row.is-add`, `.mobile-group-head.is-overdue`).
Keep it that way, and never give a mobile element a bare galaxy class name. The one
deliberately shared class is `.due-chip` — defined once in the shared section, worn by
galaxy rows, free globs, and mobile task rows alike.

## Current features (as of 2026-03-16)

- Floating globs with perpetual drift physics (damping, repulsion, wall bounce, min-speed nudge)
- Bottom capture bar + right-click-to-create at cursor position — right-clicking empty space opens a two-button `CanvasSpawnMenu` (**glob** → the new-thought input; **cluster** → an empty cluster via `addCluster(name, {x, y})`, focused and dropped straight into rename mode)
- Clusters: drag two globs together, frosted glass cards, anchored in place, collapse/expand (a collapsed card opens on a plain click anywhere on it, name included — a press-to-click distance check keeps a border drag from counting; once open, clicking the name renames)
- Cluster handles: move (left), link (right) — hover-reveal with 1s linger
- Click-to-rename titles and glob text (auto-select-all)
- Connections: drag link handle between clusters → persistent dashed tether lines
- Merge (two paths, **same modal**): (a) hover tether midpoint → merge button → rename modal → combines clusters; (b) drag a cluster onto another, hold ~0.75s until target glows, release → rename modal (same as path a). Both call `mergeClusters(c1, c2, newName)`. **Merge preserves external connections**: links to either source cluster are redirected to the merged result; the direct c1↔c2 link (if any) is dropped to avoid a self-loop; parallel edges (e.g., A↔c1 + A↔c2) are deduped via a sorted-pair key. Connection IDs of the surviving edges are preserved.
- Cluster-item dragged out onto a free-floating glob → forms a new cluster from the two. If the source cluster had only that one item, the now-empty source cluster is deleted (no prompt — user already made a clear choice).
- Drag-to-trash (bottom-right), shake-to-dissolve, drag item outside cluster to release
- Context menus: glob (edit/flag/todo/duplicate/recolor/delete), cluster (rename/collapse/convert-all-to-todos/recolor-border/recolor-all-items/dissolve/delete — opens from right-click on header, drag handle, OR border; "delete" reuses the trash-drop confirm toast so user can still pick "release globs" instead), empty space (glob / cluster picker)
- **Cluster header ✕ → inline `release | destroy`**, no question and no "no": release = `dissolveCluster` (globs go free), destroy = `destroyCluster` (cluster AND its globs, one undo step). Backing out is a click elsewhere or Esc (`closeMenus` clears `dissolveConfirm`). An empty cluster shows only destroy. Destroy renders exactly where the ✕ was, so it ignores clicks for 350ms after opening — the second click of a double-click on ✕ can't wipe the cluster. The trash-drop / context-menu "delete all" toast uses the same `destroyCluster` (it used to loop `deleteGlob`, one undo snapshot per glob).
- Recolor uses a swatch popover (PALETTE exported from store.ts, 6×2 grid). Glob recolor sets the glob's color. Cluster recolor border affects only the cluster's border. Cluster recolor all items repaints every item in the cluster (items keep no relation to the border).
- **Rubber-band selection — no mode** (reworked 2026-08-29):
  - **There is no tool column and no V/M modes any more.** They existed only because `.marquee-overlay` was a full-screen z-250 div that swallowed every pointerdown; an overlay you have to opt into *is* a mode. Deleting the overlay deleted the mode.
  - `.galaxy` now routes its own presses: `onPointerDown` starts a band **only when `e.target === e.currentTarget`** (bare background) and `e.button === 0`, then `setPointerCapture`s itself. Anything else on the galaxy is somebody's drag and falls through untouched.
  - A bare press on background clears the selection *on pointerdown* — not on click. The click that ends a band would otherwise wipe what it just selected (the overlay used to eat it). For the same reason the window-click listener is **`closeMenus`** (menus only); `closeTransientUi` (menus + selection) is Esc's.
  - Modifiers on the band: none = replace, **Shift** = add, **Ctrl/Cmd** = remove (Blender-style).
  - Selected items get the maximalist visual: cluster-color-tinted background + cluster-color border + 5px left accent + a glow that **breathes on one shared clock** (see below).
  - Right-click inside a live multi-selection opens the **bulk-action context menu**: convert all to todos / recolor all (opens swatch popover with `bulk` target) / **transfer to new cluster** (creates a fresh cluster from the selection, removing items from their source clusters) / delete all. Free globs and cluster items share one `openGlobMenu` helper in Galaxy.tsx so the rule can't drift between them — this used to live on the overlay, which meant free globs never got it.
  - `App.tsx` exposes the bulk primitives: `recolorGlobs`, `toggleAllTodosInGlobs`, `deleteGlobs`, `transferToNewCluster`, `moveGlobsToCluster`.
  - **Carry the selection** (`useGroupDrag.ts`): press on any *already selected* item and drag to move the whole selection. `.galaxy` offers every press to `tryStart()` **in the capture phase**, so the gesture is claimed before the glob or cluster underneath starts its own drag; it declines unless ≥2 are selected and the press landed on a selected item, and it declines outright when ⌃/⌘/Shift is held so those shortcuts keep their meaning. The globs never move — a `GroupDragGhost` (stack icon + count) follows the cursor and the drop is what mutates. Three drop targets: a cluster → `moveGlobsToCluster` + `.group-target` glow; the **trash** → one `TrashConfirmToast` for the whole set → `deleteGlobs` (checked *before* `clusterAt`, since the trash floats over the galaxy); empty space → `NewClusterPromptModal` → `transferToNewCluster(ids, name, {x, y})`. Hit-testing uses `document.elementsFromPoint` (plural) so nothing needs its `pointer-events` toggled mid-gesture. `Esc` cancels.
  - ⚠️ **A multi-selected cluster item sets `draggable={false}`.** Its native HTML5 drag would otherwise race the carry gesture, and `pointerdown.stopPropagation()` cannot cancel a `dragstart`. This is why dragging a selection to the trash trashes *all* of it instead of only the row you happened to grab.
  - **`data-glob-id` used to be on cluster items only**, so the marquee could not see free-floating globs at all — you could only ever rubber-band things already inside a cluster, which is backwards. `FreeGlob` now carries it (and a `selected` class).
- **Cluster z-order: click-to-front like Windows.** Clusters rank by `lastInteraction` (already updated on drag/rename/edit/etc.), highest rank = highest z-index. Touching any cluster brings it to the foreground. Hover does NOT promote (would cause z-thrashing).
- Click anywhere inside a cluster item enters edit mode (was: only the text span). Drag-and-hold still becomes a reorder/pop-out drag via HTML5 dragstart.
- **Double-click a cluster item's *handle gutter* → toggles it to a to-do.** Not just the 16px grip icon (which only fades in on hover — too much to aim at in passing). `isHandleZone()` in GalaxyChrome.tsx measures the row's own box: the whole strip from the left edge through the grip plus `GRIP_SLACK` (5px) toward the text, **and** a `RIGHT_GUTTER` (24px) square at the right border, both full row height. Excluded by target, in this order: `.todo-check` (keeps its own job, and it sits inside the left gutter once the row *is* a to-do), `.cluster-glob-grip` (always in), `.cluster-glob-text-inner` — on the words themselves a click means "edit these words", at either end.
  - The row's `onClick` must **return early in the same zone**, or the first of the two clicks swaps the row for an `<input>` and the `dblclick` never lands. Cost: a single click in the gutter now does nothing instead of opening the editor. Deliberate.
  - **`.cluster-edge-hit.left/right` were re-biased outward** (`left/right: -8px; width: 10px`, was `-6px`/`12px`) so they reach 8px *outside* the card and only 2px inside. Otherwise they sat over the outer 6px of every row at `z-index: 2` and ate the gutter's best part. All three cluster handles live outside the left edge and nothing lives outside the right, so widening outward is free — but the border must stay grabbable, which `scripts/group-drag-check.mjs` asserts on both sides.
- **Cluster context menu → "🧹 Clear completed (n)"** deletes the ticked-off to-dos in that cluster in one undo step. Disabled at `n === 0`, and `clearCompletedInCluster` returns `prev` untouched in that case so an empty sweep pushes no undo snapshot.
- Context menus + recolor popover clamp to viewport so they never clip off-screen.
- Todo mode with checkboxes, done state (line-through)
- **Due dates + priorities (2026-09-16, the Todoist import).** `glob.dueDate` (`'YYYY-MM-DD'` local, null = undated) and `glob.priority` (1–4, Todoist semantics: 1 red / 2 orange / 3 blue / 4 none; absent on old records = 4). Scheduling or prioritizing something makes it a to-do (`isTodo` set alongside); clearing the date doesn't unset to-do. **Making a free glob a to-do on desktop wraps it in a one-member cluster** (`toggleTodoOnCanvas`, one undo step) — a free glob has no checkbox, so the to-do would otherwise be invisible. Mobile deliberately gets plain `toggleTodo`: there an unclustered glob *is* the Inbox and already shows a checkbox, so wrapping would pull it out of Inbox. Desktop surface: glob context menu → "📅 Due date…" (SchedulePopover: Today/Tomorrow/Weekend/Next week/date input/clear) and "⚑ Priority…" (PriorityPopover); cluster rows + free globs wear a `.due-chip` (tone-colored by `formatDue`: overdue red, today green, tomorrow orange, this-week violet); `.todo-check.p1/.p2/.p3` tints the checkbox. Priority hues are design knobs (`--p1/--p2/--p3` in index.css). ⚠️ These fields are in `stateSignature` — drop them there and scheduling stops persisting.
- **Agenda dock (2026-09-17)** — desktop's answer to the phone's Today tab, and the last piece of the mobile/desktop symmetry. Calendar button in the tool column (badged with overdue+today, the same number the phone puts on its tab) opens a right-docked panel: overdue / today / one section per upcoming day, off `buildAgenda`. Rows carry the priority-tinted checkbox (tick to complete in place), the flag, and the cluster they live in; clicking one calls `jumpToGlob` — expand its cluster, centre it, pulse the glob — which is now **shared with Cmd+K search** (`useGalaxySearch` returns it) so "show me where this lives" means one thing.
  - ⚠️ **It is a DOCK, not a menu.** It is absent from `closeMenus` on purpose — you tick things off while working the galaxy, so a stray background click must not dismiss it. Only its own ✕ or Esc (`closeTransientUi`) closes it. It also had to join `refocusInput`'s ignore list in App.tsx, or clicking a row yanks focus back to the capture bar.
  - ⚠️ **The panel stops at `bottom: 150px`, above the trash zone.** `isOverTrash()` computes its hit-box from `window.innerWidth/Height`, not from the DOM, so shifting the bin left to make room would move the picture and leave the hit-test behind. Ending the panel short is the honest fix.
  - Redundancy is suppressed per section: the today and per-day sections omit the due chip their own header already states; only overdue rows carry one.
- Ctrl/Cmd+click shortcut: on a free glob → auto-clusters it + toggles todo; on a cluster item → toggles todo; on the cluster body (anywhere not an item) → toggles ALL items as todos (set-all semantics: if any item isn't a todo, all become todos; if all are todos, all flip back). Suppresses macOS native ctrl+click contextmenu so the shortcut wins.
- localStorage persistence, 300ms debounced auto-save

## Mobile: the Todoist-shaped app (rewritten 2026-09-16; PWA since 2026-08-22)

The old mobile view was the galaxy's data as a bare list — functional for capture,
frustrating for everything else. It's now a deliberate Todoist clone in UI and UX,
mapped 1:1 onto the shared state so desktop and phone are two windows on one galaxy:

| Todoist concept | adhdo state |
|---|---|
| project | cluster (color dot = `cluster.color`) |
| Inbox | unclustered globs |
| task | glob (checkbox circle on every row; plain thoughts stay non-todo) |
| due date / priority | `glob.dueDate` / `glob.priority` (see desktop reflection above) |

- **Bottom tabs: Today / Upcoming / Search / Browse.** Today = overdue section + due-today (undone todos only), badge on the tab counts both. Upcoming groups by calendar day. Search = live filter + chips (All/To-do/Flagged/Done) across everything, including inside projects. Browse = Inbox row, Flagged row, My Projects list (+ Add project → empty cluster via `addCluster`; empty clusters now survive, see App.tsx note).
- **Project drill-in** from Browse: active rows in `globIds` order, "＋ Add task" ghost row (quick add pre-targeted to the project), completed rows folded under a "Completed (n)" toggle, ⋯ menu (rename / color via PALETTE swatches / convert-all-todos / clear completed / delete-keep-thoughts / delete-with-thoughts).
- **Quick-add FAB** (the heart of it): floating + opens a bottom sheet that stays open for rapid fire. `parseQuickAdd` lifts natural language out of the text **live** — "water the ficus tomorrow p2" fills the date and priority chips as you type (word-bounded tokens only: today/tonight/tomorrow/tmrw/next week/full weekday names/p1–p4 — short weekday forms are deliberately not parsed, "sat down" must never schedule anything). Chips override parsing; project chip defaults to the open project, else Inbox. Undated/unprioritized captures stay plain thoughts — the brain-dump soul survives the Todoist skin.
- **Row gestures, Todoist grammar: swipe right = complete, swipe left = schedule** (opens the date sheet — deleting by flick is gone; delete lives in the detail sheet and select mode, which is the right friction for ADHD). Axis-locked exactly like before: a pointer is classified once as swipe or scroll, never both, with pointer capture, and a `consumed` ref + `onClickCapture` so a gesture can't also open the sheet.
- **Tap a row → detail sheet**: multiline text edit (commits on blur), project / due date / priority (P1–P4 inline) / flag / todo-toggle / delete rows. Sheets pointing at records deleted underneath them (undo, sync) close via an effect — never render a ghost.
- **Select mode**: long-press (450ms, cancelled by any real movement) → checkboxes + bulk bar (To-do / Flag / Move… / Delete). `moveGlobsToCluster` and `toggleFlagGlobs` in App.tsx exist so a batch is **one** undo step, not N.
- **Voice capture** (`useVoiceCapture.ts`; mic mini-FAB above the + on mobile, capture-bar mic on desktop). Not a one-shot: it's a dictation *session* — `continuous` + auto-restart on `onend` (iOS ends a session after every pause), and each `isFinal` result is committed as its own glob immediately, so an interrupted session keeps everything said before it. Confirms with a WebAudio blip because the user is driving and not looking. Holds a Wake Lock while listening. Feature-detected; the button hides where there's no `SpeechRecognition`.
- **Installable PWA.** `public/manifest.webmanifest` + `public/sw.js` (network-first for navigations so deploys land, cache-first for hashed `/assets/`, everything else straight to network — Supabase must never be cached). Registered in `main.tsx` **only under `import.meta.env.PROD`**; a worker in dev fights Vite HMR. Icons are generated by `node scripts/make-icons.mjs` — a dependency-free PNG encoder (zlib + hand-rolled CRC) that draws three globs and a tether. Edit the script, never the PNGs. **`scripts/how-to-make-iOS-icon.md` is the full guide** (swapping in custom art, the iOS art rules, and the two caches that hide a changed icon), and it covers the sibling repos too. ⚠️ `sw.js` serves `.png`/`.webmanifest` **cache-first**, so changing an icon without bumping `CACHE` (`adhdo-v1`) leaves every installed device on the old art forever. The `?capture=1` home-screen shortcut now opens the quick-add sheet.
- **⚠️ Installed on iOS, every height unit lies — `dvh` included (fixed 2026-09-20; the 2026-09-17 attempt did not work).** In a home-screen web app with `black-translucent` + `viewport-fit=cover`, WebKit lays the page out from y=0 — correctly full-bleed under the Dynamic Island — but sizes the **initial containing block from the unobscured content rect: screen MINUS the status bar**. `height: 100%`, `100vh` and **`100dvh` all resolve against it**, so they are all `safe-area-inset-top` (59px on a 15 Pro) short, and a shell that can't scroll has no content flow to push past it. The first fix reached for `dvh` and, believing `position: fixed` obeyed the same short box, added `.mobile-root { transform: translateZ(0) }` to re-anchor the phone's fixed chrome to the app box. Both premises were wrong, and the second one made it worse: the tab bar had been landing on the real screen edge and the transform dragged it 59px up, leaving body's `--bg` showing beneath it (Nic's screenshot, 2026-09-20 — the tab bar's bottom measured exactly 177 device px = 59pt above the screen edge on a 15 Pro).
  - **The fix: `position: fixed` measures the real window, so the shell is a fixed box.** `#root { position: fixed; inset: 0 }`, and `.app` / `.mobile-app` take 100% of *that*. No dvh, no JS measurement, no per-element arithmetic. Sibling repo `traction` is the proof the ICB and the fixed-positioning viewport disagree: same phone, same install mode, identical head tags, and its tab bar is a plain `position: fixed; bottom: 0` that lands flush.
  - ⚠️ **Never put a `transform` / `filter` / `perspective` / `will-change` on `#root`, `.app` or `.mobile-root`.** Any of them makes that element the containing block for its fixed descendants (tab bar, FAB stack, sheets, bulk bar, undo pill, home/auth buttons) and puts them straight back in the short box. `scripts/smoke.mjs` asserts it, along with `#root` being fixed and both the app box and the tab bar reaching the bottom of the window — a desktop browser can't reproduce the short ICB, so the structural facts the fix rests on are what get guarded.
- **Safe areas.** `--safe-t/b/l/r` vars in `:root`; `index.html` has `viewport-fit=cover` + `apple-mobile-web-app-status-bar-style=black-translucent`. Every fixed edge (tab bar, FAB stack, bulk bar, sheets, undo pill) pays them back.

## Sync (rewritten 2026-08-22, again 2026-09-17 — both times it was losing data)

- **First break (2026-08-22):** `saveRemote` had no compare-and-swap, and the pull compared timestamps with raw string `>`. Local stamps end in `Z`, Postgres returns `+00:00`, and `'Z' > '+'`, so a same-second cloud copy always looked older and the pull silently never happened. Combined with a fresh device stamping updated-at ~2s after boot (the autosave interval saw `stateSignature(state) !== ''`), **an empty install could flatten the entire cloud galaxy.** Adding the app to an iOS home screen creates exactly such a device — an installed PWA has its own storage sandbox.
- **Second break (2026-09-17): capture a few thoughts signed out, then sign in, and the galaxy is gone.** Two defects, and it took both:
  1. `loadRemote` marked the version **seen** on every read — even a read the caller then threw away. `adhdo-remote-seen` is the base of the compare-and-swap, so a discarded read disarmed the one guard against overwriting a copy we don't hold.
  2. The pull decided by **clock** (`cloudWins` = "is the cloud newer"). Capturing while signed out advances `adhdo-updated-at` without the cloud hearing a word, so the device that has seen the least of the galaxy looks like its freshest writer. The sign-in pull declined to adopt, the screen showed only the new notes, and five seconds later the debounced save walked through the now-disarmed guard and made those notes the whole cloud row.
- **Now: seen-ness is a promise, and the question is containment, not time.**
  - `markRemoteSeen(updatedAt, state)` is the only writer of `adhdo-remote-seen`, called from exactly two places — adopting a cloud copy, and a save the cloud accepted. `loadRemote` no longer stamps anything.
  - It also records `adhdo-remote-base`: the **ids** the cloud copy we hold was made of. That common ancestor is what lets a merge tell "captured here since the last sync" (keep) from "deleted on another device" (let go) — present-here-absent-there, which without it are the same shape.
  - `planSync(local, remote, {seen, base, mustPush})` is the whole decision, pure and out of the component: `hold` (seen === the row's stamp — we already contain it), `adopt`, or `merge`. Both directions go through it, which is the point: the pull and the save used to answer this question differently and that disagreement is what lost the data.
  - ⚠️ `seen` is compared with `===` and is **always a verbatim echo of Postgres's `updated_at`**. Never compare it against a locally generated `toISOString()` — that's the `'Z'` vs `'+00:00'` trap from the first break, one layer down.
- `reconcileWithRemote()` three-way merges by id: in both → the cloud's copy (it's the newer document); here only → keep unless it's in `base`; there only → keep unless it's in `base`. With **no** base (never synced, or storage evicted) it falls back to `mergeStates()`, a plain union — no tombstones, so an offline delete can resurrect. Deliberate: a thought you delete twice beats a thought that vanishes.
- `repairState()` makes `cluster.globIds` (authoritative, ordered) and `glob.clusterId` agree. Without it a glob claiming a cluster that doesn't list it renders in *neither* the unsorted list nor the cluster — invisible but present. Runs on every hydrate, so it also heals old blobs.
- Dirty flag persists in localStorage (`adhdo-dirty`) so a save that failed with no signal retries after a reload. One `sync()` entry point — dirty pushes (reconciling on stale), clean pulls — fired on login, focus, visibilitychange and **`online`**. The old split pull/push effects could race.
- **Rescue slot (`adhdo-rescue`).** Honouring a deletion and honouring a truncated cloud row are the same operation from inside a merge — it cannot tell a bulk delete from another client having overwritten the row with less than it held. So it doesn't try: whenever a reconcile is about to let go of records this device held (`Reconciliation.dropped`), the pre-merge state goes to a one-slot backup first, and the copy holding **more** records wins the slot so a second bad merge can't bury the good one. Restoring it is three console lines (in `saveRescue`'s doc comment) — restore the galaxy **and remove `adhdo-remote-seen` + `adhdo-remote-base`**. Clearing the base matters as much as the state: with an ancestor in hand the next reconcile reads the cloud's own records as things this device deleted and takes *those* away instead. Without one it falls back to the union, which keeps both sides.
- ⚠️ **Nothing signed out ever reaches the cloud, by design** (`setState` only calls `scheduleRemoteSave` `if (user)`), so signing in is always a merge of two histories, never a resume. Treat it as the hard case, not the happy path.
- ⚠️ Known, unfixed: **undo/redo go through `setStateRaw`, so they never schedule a cloud save.** An undo stays local until the next tracked edit pushes it. Not data loss (the `hold` check keeps a later pull from reverting it), but it is why an undone delete can sit unsynced.

## Backups (2026-09-17) — three layers, because one document is easy to lose

`galaxy_states` is one row per user and every save is an UPSERT, so until now the previous document died the instant the next one landed: when a bad write happened there was nothing to roll back to. **That was an adhdo gap, not a Supabase one** — and Supabase's own backups don't fill it: Free-plan projects get no automatic daily backups at all, and Pro's are a whole-project restore to a point up to 24h stale (PITR, the only thing with the right granularity, is a paid add-on). The `supabase-keepalive` workflow is the tell that this project is on Free.

1. **Version history (`galaxy_versions`).** ⚠️ **Needs one-time setup: run `supabase/galaxy_versions.sql` in the Supabase SQL editor.** There are no migrations in this repo — the schema was made by hand in the dashboard, so new tables are a manual step and the panel says so when the list is empty.
   - `saveRemote` archives **the row it is about to replace** — before the upsert, never after, since afterwards there is nothing left to copy. So a version really is "the previous save", not a copy of whatever the saving device happened to hold.
   - `shouldArchive` (pure, tested) decides: **any write that shrinks the galaxy** (the shape of every data loss this app has had — compared against `getRemoteBase()`, not our own previous state, or a device arriving with less than the cloud would slip through), else a 6-hourly cadence. ⚠️ Growth doesn't trip it, which is why **a restore passes `archive: true` explicitly** — a rollback you can't roll back is not a safety net.
   - Best-effort throughout: failing to keep a backup must never cost you the save.
   - ⚠️ **`archiveRemote` stamps the ATTEMPT, not the success, and does it first.** Because the SQL is a manual step, "no `galaxy_versions` table" is the default state, not a fault — and a stamp that only moved on success left `shouldArchive` seeing `null` for ever, so every save fetched the whole document and posted a doomed insert. On mobile data that is the entire galaxy downloaded per save. Stamping up front backs a missing table (or a flaky network) off to the ordinary cadence, and still self-heals: nothing to clear once the table exists, and a shrinking write ignores the stamp anyway. Not running the SQL is therefore genuinely free — `scripts/sync-check.mjs` asserts all four halves of that.
   - A Postgres trigger prunes to the newest 20 per user. In the database so a client that dies mid-save can't leave history unbounded. No UPDATE policy on the table — history is not editable in place.
2. **Export / import.** ⚠️ **Import MERGES, it does not replace.** It used to `setState(() => incoming)`, which made the recovery tool one more way to lose everything — pick a stale file and the thoughts you captured since are gone. `parseImport` also accepts a bare galaxy blob, because the thing you reach for in a panic is often localStorage copied out of a console.
3. **Rescue slot** — see the sync section above.

**`BackupsPanel` lives in AppChrome.tsx** (shared chrome), not in Galaxy or MobileApp: "where are my backups" must not mean two different things on two devices, and the day you need it is the day you're on whichever device is to hand. Desktop reaches it from the `?` panel's backup section, mobile from a Browse row. Its own `backups-` class namespace, so it collides with neither the galaxy's classes nor the phone's.

## ⚠️ One breathing clock, not N animations (2026-08-29)

Selected things pulse off a single animated custom property, **not** a per-element
`animation`. A CSS animation starts its clock the moment the class lands, so five items
picked up at five different moments breathed five different ways, and adding a sixth
made it worse. Instead `@property --breath { syntax: "<number>"; inherits: true }` is
animated once on `.galaxy.breathing` (4.4s ease-in-out, 0 → 1 → 0) and **inherited** by
every descendant; `.cluster-glob-item.selected` and `.glob.selected` interpolate their
own `box-shadow`/tint out of it with `calc()` inside `color-mix()`. Anything joining the
selection is already in time with its sisters, for free, with no JS ticker.

Two traps if you touch this:
- `.glob` sets `transition: box-shadow 0.25s`. `.glob.selected` **must** drop box-shadow
  from that transition or the glow lags and the blob falls out of step with the cluster
  items breathing beside it.
- A malformed `calc()` inside `color-mix()` doesn't warn — the whole `box-shadow`
  silently computes to `none`. `scripts/group-drag-check.mjs` asserts the shadow both
  resolves and moves.

## ⚠️ Local autosave and the physics loop

The autosave effect must **read `stateRef.current` with an empty dep array**. It used to
depend on `[state]`, and the galaxy's physics loop pushes a new state object every
animation frame — so the 2s interval was torn down and re-armed ~60×/second and **never
once fired**. Local saving on desktop was doing nothing; only `beforeunload` was writing,
so anything that ended the page without it lost the session. Fixed 2026-08-22. Same
reasoning for the `beforeunload` listener. `stateSignature` (which ignores x/y/velocity)
is what keeps the write itself cheap.

**It bites window listeners too, and more quietly** (2026-09-18). `BackupsPanel`'s Esc
handler depended on `[open, onClose]`, and callers pass `onClose` as an inline arrow — so
on desktop the effect re-ran every frame, removing and re-adding the `keydown` listener
~60×/second, and an Esc landing in one of those gaps was dropped. It failed roughly **one
run in six**, which is worse than failing always: it reads as a flaky test. Mobile never
saw it — no physics loop, no re-render storm. The fix is the same shape as the autosave
one: hold the callback in a ref, depend only on what actually gates the listener (`open`).
**Any effect that registers a window/document listener on this app's desktop path needs a
dep array that can't churn** — if a callback prop is in there, put it behind a ref.

## Testing

`node scripts/group-drag-check.mjs` — 77 assertions covering the band → carry-selection
gesture (all three drop targets: cluster / trash / empty space, the naming modal, cluster
placement at the drop point), clear-completed, the handle-gutter zone boundaries plus the
cluster borders they were widened out of, that modeless routing still lets a lone glob and
a cluster drag normally, and that the breathing clock runs and is shared. It just drags
from empty space — there is no tool button to click, and pressing `M` would only type into
the autofocused capture bar.

⚠️ **`stateSignature` ignores x/y/velocity, so a drag alone never reaches
localStorage.** Assert positions against the DOM (`boundingBox()`), not the saved state.

`node scripts/sync-check.mjs` — 63 assertions on the sync and backup layers. **No browser, no dev
server, no dependencies**: Node strips the types off `src/store.ts` on import, a Map
stands in for `localStorage` (one sandbox per simulated device, which is what an
installed PWA actually is), and a fake `galaxy_states` table hands back Postgres-shaped
`+00:00` stamps. Covers the compare-and-swap bookkeeping, the `planSync` decision table,
deletions in both directions with and without a common ancestor, and an end-to-end replay
of the morning that broke it — capture five notes signed out, sign in, and assert the
clusters are still there — plus the rescue slot and the restore procedure that gets a
wrongly-emptied galaxy back, the `shouldArchive` policy, a version-history round trip
(overwrite the galaxy, find the previous save in the list, load it back), the
missing-`galaxy_versions` path (no retry storm, saves unaffected, a shrinking write
still tried, and it heals when the table appears), and the export/import round trip. Restore either half of the 2026-09-17 sync bug and 8 assertions
fail, including one that prints the screenshot Nic sent: only the five notes.

The fake Supabase client serves **both** tables — `galaxy_states` (one row, upserted) and
`galaxy_versions` (append + a miniature of the pruning trigger). Its `galaxy_versions`
query object is thenable, because `listVersions` awaits the builder itself rather than
calling `.maybeSingle()`.

⚠️ **Probe the handle gutter by asserting the *flip*, not the absolute state.** Once a
row is a to-do the checkbox moves into the left gutter, so "double-click the same spot
again" is not a valid way to reset between probes — the right square always is.

`node scripts/smoke.mjs` — 74 end-to-end assertions across both layouts: Today/Upcoming/Browse tabs, tab badge, quick-add NL parsing ("tomorrow p1" lifts out), checkbox + swipe-right complete, swipe-left schedule, scroll-doesn't-swipe, detail-sheet priority, project drill-in + Completed fold, long-press select, bulk move, single-undo-per-batch, search/filters, state repair, add-project, an Inbox to-do staying in the Inbox, the iOS shell geometry (`#root` fixed, no transform on `.app`/`.mobile-root`, app box and tab bar flush with the window bottom) — then desktop: galaxy intact, due chips on rows and globs, priority-tinted todo-checks, the context-menu Schedule popover writing state, and the agenda dock (badge count, overdue/today split, a context-menu-scheduled task appearing in it, undated thoughts staying out, surviving a galaxy click, tick-to-complete, click-to-fly, Esc to close), the right-click glob/cluster picker (cluster lands in rename mode), Make todo wrapping a free glob in a one-member cluster, cluster ✕ release|destroy with a single-step undo, click-to-expand on a collapsed cluster, and the backups panel from both layouts (Browse row on mobile, `?` → version history on desktop, Esc to close) with an import proving it merges rather than replaces. Needs `npm i --no-save playwright-core`; drives installed Edge via `channel: 'msedge'`, or set `BROWSER_PATH=/path/to/chromium` (works for group-drag-check too). Both scripts need the dev server up, which needs Supabase env vars — a dummy `.env.local` (any URL/key) is enough for local runs.

Two gotchas when writing harnesses for this app:
1. **Seed localStorage with `context.addInitScript`, never "goto → set → reload".** adhdo saves on `beforeunload`, so the reload writes the empty state it booted with straight over your seed.
2. **Local persistence is a 2s interval**, so assertions that read localStorage need a ~2.4s settle first.

## Design philosophy

- Zero friction. Capture fast, organize later (or never).
- "Gentle wife nudge" — patient, not forcing. If globs float too long, gently group them.
- Layers of depth invisible until you want them (connections, merge, todo mode).
- Headlessui.com aesthetic: indigo/violet/cyan gradients, frosted glass, subtle glows.

## Pending work

- Auto-cluster orphan globs (~1 week old) into gentle "lost thoughts" cluster
- Search/filter on **desktop** beyond Cmd+K (mobile now has search + filter chips); keyboard shortcuts. (Export/import is **done** — see Backups above.)
- **Hyper-clusters** (deferred — own session): nested clusters-of-clusters with collapsible per-source headers, draggable back out to restore originals. Today's hold-to-merge uses simple absorb (target wins). Would need a new data shape (parentClusterId on Cluster, or a HyperCluster type), nested render/drag/persistence migration.
- **Galaxies: one hierarchy level above clusters** (Nic's ask, 2026-09-16 — deferred to its own session, overlaps with hyper-clusters above). Hierarchy becomes galaxies ≫ clusters ≫ globs; a Todoist analogy would be workspaces/folders ≫ projects ≫ tasks. Nic also floated going deeper — universe ≫ galaxy ≫ solar system ≫ planet ≫ biome — so if this gets built, design the data shape as arbitrary-depth nesting (a `parentId` on a generalized container type) rather than hard-coding one extra level, and let the UI decide how many levels to expose. Mobile Browse is naturally ready for it (folders above projects); desktop needs a zoom/level metaphor (the cluster browser or useClusterFocus zoom could become "enter a galaxy").
