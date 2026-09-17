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
- Clusters: drag two globs together, frosted glass cards, anchored in place, collapse/expand
- Cluster handles: move (left), link (right) — hover-reveal with 1s linger
- Click-to-rename titles and glob text (auto-select-all)
- Connections: drag link handle between clusters → persistent dashed tether lines
- Merge (two paths, **same modal**): (a) hover tether midpoint → merge button → rename modal → combines clusters; (b) drag a cluster onto another, hold ~0.75s until target glows, release → rename modal (same as path a). Both call `mergeClusters(c1, c2, newName)`. **Merge preserves external connections**: links to either source cluster are redirected to the merged result; the direct c1↔c2 link (if any) is dropped to avoid a self-loop; parallel edges (e.g., A↔c1 + A↔c2) are deduped via a sorted-pair key. Connection IDs of the surviving edges are preserved.
- Cluster-item dragged out onto a free-floating glob → forms a new cluster from the two. If the source cluster had only that one item, the now-empty source cluster is deleted (no prompt — user already made a clear choice).
- Drag-to-trash (bottom-right), shake-to-dissolve, drag item outside cluster to release
- Context menus: glob (edit/flag/todo/duplicate/recolor/delete), cluster (rename/collapse/convert-all-to-todos/recolor-border/recolor-all-items/dissolve/delete — opens from right-click on header, drag handle, OR border; "delete" reuses the trash-drop confirm toast so user can still pick "release globs" instead), empty space (glob / cluster picker)
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
- **Installable PWA.** `public/manifest.webmanifest` + `public/sw.js` (network-first for navigations so deploys land, cache-first for hashed `/assets/`, everything else straight to network — Supabase must never be cached). Registered in `main.tsx` **only under `import.meta.env.PROD`**; a worker in dev fights Vite HMR. Icons are generated by `node scripts/make-icons.mjs` — a dependency-free PNG encoder (zlib + hand-rolled CRC) that draws three globs and a tether. Edit the script, never the PNGs. The `?capture=1` home-screen shortcut now opens the quick-add sheet.
- **⚠️ Installed on iOS, `height: 100%` lies (fixed 2026-09-17).** In a home-screen web app with `black-translucent` + `viewport-fit=cover`, WebKit lays the page out from y=0 — correctly full-bleed under the Dynamic Island — but sizes the **initial containing block as screen MINUS the status bar**. A shell that can't scroll (`html, body, #root { height: 100%; overflow: hidden }`) is pinned to that short number with no content flow to push past it, so the app's box stopped exactly `safe-area-inset-top` (59px on a 15 Pro) above the screen bottom and the canvas painted the rest in body's `--bg` — the dead strip under the tab bar. Two halves to the fix, and **both are needed**: `@supports (height: 100dvh)` re-sizes `html/body/#root/.app` off the window instead of the ICB, *and* `.mobile-root { transform: translateZ(0) }` makes the app box the containing block for every fixed descendant — because `position: fixed; bottom: 0` obeys the same short ICB, so `dvh` alone would have left the tab bar floating. Sibling repo `traction` never hit this only because it is a normally-flowing scrollable document (`min-height: 100%`, no `overflow: hidden`), which gets a full-height ICB; its head tags are otherwise identical.
- **Safe areas.** `--safe-t/b/l/r` vars in `:root`; `index.html` has `viewport-fit=cover` + `apple-mobile-web-app-status-bar-style=black-translucent`. Every fixed edge (tab bar, FAB stack, bulk bar, sheets, undo pill) pays them back.

## Sync (rewritten 2026-08-22 — was losing data)

- **Was broken:** `saveRemote` had no compare-and-swap, and the pull compared timestamps with raw string `>`. Local stamps end in `Z`, Postgres returns `+00:00`, and `'Z' > '+'`, so a same-second cloud copy always looked older and the pull silently never happened. Combined with a fresh device stamping updated-at ~2s after boot (the autosave interval saw `stateSignature(state) !== ''`), **an empty install could flatten the entire cloud galaxy.** Adding the app to an iOS home screen creates exactly such a device — an installed PWA has its own storage sandbox.
- **Now:** `isNewer()` parses. `saveRemote` does a compare-and-swap against `adhdo-remote-seen` and returns `'saved' | 'stale' | 'error'`. `lastSavedRef` seeds from the loaded state so an untouched device never stamps.
- On `stale`, `mergeStates()` unions all three collections by id (cloud wins ties, local-only records always survive) then `repairState()`s the result. **No tombstones — an offline delete can resurrect.** Deliberate: a thought you delete twice beats a thought that vanishes.
- `repairState()` makes `cluster.globIds` (authoritative, ordered) and `glob.clusterId` agree. Without it a glob claiming a cluster that doesn't list it renders in *neither* the unsorted list nor the cluster — invisible but present. Runs on every hydrate, so it also heals old blobs.
- Dirty flag persists in localStorage (`adhdo-dirty`) so a save that failed with no signal retries after a reload. One `sync()` entry point — dirty pushes (merging on stale), clean pulls — fired on login, focus, visibilitychange and **`online`**. The old split pull/push effects could race.

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

⚠️ **Probe the handle gutter by asserting the *flip*, not the absolute state.** Once a
row is a to-do the checkbox moves into the left gutter, so "double-click the same spot
again" is not a valid way to reset between probes — the right square always is.

`node scripts/smoke.mjs` — 59 end-to-end assertions across both layouts: Today/Upcoming/Browse tabs, tab badge, quick-add NL parsing ("tomorrow p1" lifts out), checkbox + swipe-right complete, swipe-left schedule, scroll-doesn't-swipe, detail-sheet priority, project drill-in + Completed fold, long-press select, bulk move, single-undo-per-batch, search/filters, state repair, add-project, an Inbox to-do staying in the Inbox — then desktop: galaxy intact, due chips on rows and globs, priority-tinted todo-checks, the context-menu Schedule popover writing state, and the agenda dock (badge count, overdue/today split, a context-menu-scheduled task appearing in it, undated thoughts staying out, surviving a galaxy click, tick-to-complete, click-to-fly, Esc to close), the right-click glob/cluster picker (cluster lands in rename mode), and Make todo wrapping a free glob in a one-member cluster. Needs `npm i --no-save playwright-core`; drives installed Edge via `channel: 'msedge'`, or set `BROWSER_PATH=/path/to/chromium` (works for group-drag-check too). Both scripts need the dev server up, which needs Supabase env vars — a dummy `.env.local` (any URL/key) is enough for local runs.

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
- Search/filter on **desktop** beyond Cmd+K (mobile now has search + filter chips); keyboard shortcuts, export/import
- **Hyper-clusters** (deferred — own session): nested clusters-of-clusters with collapsible per-source headers, draggable back out to restore originals. Today's hold-to-merge uses simple absorb (target wins). Would need a new data shape (parentClusterId on Cluster, or a HyperCluster type), nested render/drag/persistence migration.
- **Galaxies: one hierarchy level above clusters** (Nic's ask, 2026-09-16 — deferred to its own session, overlaps with hyper-clusters above). Hierarchy becomes galaxies ≫ clusters ≫ globs; a Todoist analogy would be workspaces/folders ≫ projects ≫ tasks. Nic also floated going deeper — universe ≫ galaxy ≫ solar system ≫ planet ≫ biome — so if this gets built, design the data shape as arbitrary-depth nesting (a `parentId` on a generalized container type) rather than hard-coding one extra level, and let the UI decide how many levels to expose. Mobile Browse is naturally ready for it (folders above projects); desktop needs a zoom/level metaphor (the cluster browser or useClusterFocus zoom could become "enter a galaxy").
