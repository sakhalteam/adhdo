# adhdo — ADHD-friendly galaxy brain-dump/todo app

> Parent context: `../CLAUDE.md` has universal preferences and conventions. Keep it updated with anything universal you learn here.

## What this is

A personal todo/brain-dump app for Nic (who has ADHD). Floating blobby "globs" drift in a galaxy-themed space. Zero-friction capture, optional organization, everything malleable. The anti-Notion. The anti-Todoist.

## Stack

- Vite + React 19 + TypeScript + Tailwind v4 (via `@tailwindcss/vite` plugin, NOT PostCSS)
- `base: '/adhdo/'` in vite.config.ts
- Deployed to sakhalteam.github.io/adhdo/

## Architecture

- **App.tsx**: all state + CRUD operations (addGlob, deleteGlob, createCluster, mergeClusters, connectClusters, etc), plus all cloud sync. Passes callbacks to Galaxy / MobileApp.
- **Galaxy.tsx**: desktop rendering + physics loop (rAF) + all interaction handlers (drag, drop, connect, shake detect, context menus). Uses `handleDropRef` pattern to avoid stale closures in pointer events.
- **MobileApp.tsx**: the phone UI — a list, not the galaxy. Same state, same App callbacks. Mounted instead of Galaxy when `useIsMobile()`.
- **AppChrome.tsx**: shared chrome used by both layouts (HomeButton, AuthButton, UndoRedoBar, CaptureBar, MicButton, VoiceOverlay, indicators).
- **useVoiceCapture.ts**: hands-free dictation session. Owned by App.tsx (not the capture bars) so the two layouts can never open two mic sessions.
- **store.ts**: factory functions (makeGlob, makeCluster, makeConnection), localStorage load/save, cloud save/load + merge + repair, color palette.
- **types.ts**: Glob, Cluster, Connection, GalaxyState (globs[], clusters[], connections[]).
- **index.css**: ALL styles live here. Nebula background, blob morph keyframes, frosted glass, context menus, modals, etc. Minimal Tailwind utility usage in JSX.

### ⚠️ Class-name collisions between the galaxy and the mobile list

Both live in one stylesheet, so a bare galaxy class like `.cluster` (which is
`position: absolute` + `transform: translate(-50%,-50%)` + `min-width: 200px`) will hit
any mobile element that reuses the name. This shipped broken once: the mobile cluster
header used `className="mobile-section-head cluster"` and got yanked out of flow.
**Mobile modifiers are prefixed `is-`** (`.mobile-section-head.is-cluster`). Keep it that
way, and never give a mobile element a bare galaxy class name.

## Current features (as of 2026-03-16)

- Floating globs with perpetual drift physics (damping, repulsion, wall bounce, min-speed nudge)
- Bottom capture bar + right-click-to-create at cursor position
- Clusters: drag two globs together, frosted glass cards, anchored in place, collapse/expand
- Cluster handles: move (left), link (right) — hover-reveal with 1s linger
- Click-to-rename titles and glob text (auto-select-all)
- Connections: drag link handle between clusters → persistent dashed tether lines
- Merge (two paths, **same modal**): (a) hover tether midpoint → merge button → rename modal → combines clusters; (b) drag a cluster onto another, hold ~0.75s until target glows, release → rename modal (same as path a). Both call `mergeClusters(c1, c2, newName)`. **Merge preserves external connections**: links to either source cluster are redirected to the merged result; the direct c1↔c2 link (if any) is dropped to avoid a self-loop; parallel edges (e.g., A↔c1 + A↔c2) are deduped via a sorted-pair key. Connection IDs of the surviving edges are preserved.
- Cluster-item dragged out onto a free-floating glob → forms a new cluster from the two. If the source cluster had only that one item, the now-empty source cluster is deleted (no prompt — user already made a clear choice).
- Drag-to-trash (bottom-right), shake-to-dissolve, drag item outside cluster to release
- Context menus: glob (edit/flag/todo/duplicate/recolor/delete), cluster (rename/collapse/convert-all-to-todos/recolor-border/recolor-all-items/dissolve/delete — opens from right-click on header, drag handle, OR border; "delete" reuses the trash-drop confirm toast so user can still pick "release globs" instead), empty space (create glob)
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
- Ctrl/Cmd+click shortcut: on a free glob → auto-clusters it + toggles todo; on a cluster item → toggles todo; on the cluster body (anywhere not an item) → toggles ALL items as todos (set-all semantics: if any item isn't a todo, all become todos; if all are todos, all flip back). Suppresses macOS native ctrl+click contextmenu so the shortcut wins.
- localStorage persistence, 300ms debounced auto-save

## Mobile / PWA (2026-08-22)

- **Installable PWA.** `public/manifest.webmanifest` + `public/sw.js` (network-first for navigations so deploys land, cache-first for hashed `/assets/`, everything else straight to network — Supabase must never be cached). Registered in `main.tsx` **only under `import.meta.env.PROD`**; a worker in dev fights Vite HMR. Icons are generated by `node scripts/make-icons.mjs` — a dependency-free PNG encoder (zlib + hand-rolled CRC) that draws three globs and a tether. Edit the script, never the PNGs.
- **Safe areas.** `--safe-t/b/l/r` vars in `:root`; `index.html` has `viewport-fit=cover` + `apple-mobile-web-app-status-bar-style=black-translucent`. Every fixed edge (chrome, capture bar, bulk bar, sheets) pays them back.
- **Voice capture** (`useVoiceCapture.ts`, mic in both capture bars). Not a one-shot: it's a dictation *session* — `continuous` + auto-restart on `onend` (iOS ends a session after every pause), and each `isFinal` result is committed as its own glob immediately, so an interrupted session keeps everything said before it. Confirms with a WebAudio blip because the user is driving and not looking. Holds a Wake Lock while listening. Feature-detected; the button hides where there's no `SpeechRecognition`.
- **Select mode** on mobile: long-press (450ms, cancelled by any real movement) → checkboxes + bulk bar (To-do / Flag / File… / Delete). `moveGlobsToCluster` and `toggleFlagGlobs` in App.tsx exist so a batch is **one** undo step, not N.
- **Search + filter chips** (All / To-do / Flagged / Done), shown once there are >6 thoughts. A filter overrides `collapsed`, or the thing you searched for hides inside a folded cluster.
- **Row gestures** are axis-locked: a pointer is classified once as swipe (decisive leftward) or scroll, never both, with pointer capture so pointerup can't be missed. A gesture sets a `consumed` ref that an `onClickCapture` swallows, so a swipe can't also open the editor.

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

`node scripts/group-drag-check.mjs` — 76 assertions covering the band → carry-selection
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

`node scripts/smoke.mjs` — 20 end-to-end assertions (capture, voice button, long-press select, bulk file, single-undo-per-batch, search, filters, swipe-delete, scroll-doesn't-delete, state repair, desktop galaxy intact). Needs `npm i --no-save playwright-core`; drives installed Edge via `channel: 'msedge'`.

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
