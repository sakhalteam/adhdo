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
- **Marquee selection tool** (Adobe/Blender-style):
  - Left-edge tool column with pointer (V) and marquee (M) buttons.
  - `M` enters marquee mode; `V` or `Esc` exits. Clicking the buttons does the same.
  - In marquee mode: click+drag draws a violet dashed rect. Any item whose bounding rect intersects is selected.
  - No modifier = replace selection. **Shift+drag** = add. **Ctrl/Cmd+drag** = remove (Blender-style).
  - Selected items get the maximalist visual: cluster-color-tinted background + cluster-color border + 5px left accent + pulsing glow (via `--cluster-color` CSS var).
  - Right-click on any selected item (when >1 selected) opens the **bulk-action context menu**: convert all to todos / recolor all (opens swatch popover with `bulk` target) / **transfer to new cluster** (creates a fresh cluster from the selection, removing items from their source clusters) / delete all.
  - `App.tsx` exposes the bulk primitives: `recolorGlobs`, `toggleAllTodosInGlobs`, `deleteGlobs`, `transferToNewCluster`, `moveGlobsToCluster`.
  - **Carry the selection** (`useGroupDrag.ts`, 2026-08-22): press on any *already selected* item and drag to move the whole selection. `.marquee-overlay` covers the galaxy and swallows every pointerdown into "start a new rubber band", so the overlay now offers each press to `tryStart()` first; it takes the gesture only when the press landed on a selected item, otherwise declines and the marquee behaves exactly as before. The globs never move — a `GroupDragGhost` (stack icon + count) follows the cursor and the drop is what mutates. Drop on a cluster → `moveGlobsToCluster` + `.group-target` glow; drop on empty space → `NewClusterPromptModal` → `transferToNewCluster(ids, name, {x, y})`. Hit-testing uses `document.elementsFromPoint` (plural) so nothing needs its `pointer-events` toggled mid-gesture. `Esc` cancels.
  - **`data-glob-id` used to be on cluster items only**, so the marquee could not see free-floating globs at all — you could only ever rubber-band things already inside a cluster, which is backwards. `FreeGlob` now carries it (and a `selected` class).
- **Cluster z-order: click-to-front like Windows.** Clusters rank by `lastInteraction` (already updated on drag/rename/edit/etc.), highest rank = highest z-index. Touching any cluster brings it to the foreground. Hover does NOT promote (would cause z-thrashing).
- Click anywhere inside a cluster item enters edit mode (was: only the text span). Drag-and-hold still becomes a reorder/pop-out drag via HTML5 dragstart.
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

## ⚠️ Local autosave and the physics loop

The autosave effect must **read `stateRef.current` with an empty dep array**. It used to
depend on `[state]`, and the galaxy's physics loop pushes a new state object every
animation frame — so the 2s interval was torn down and re-armed ~60×/second and **never
once fired**. Local saving on desktop was doing nothing; only `beforeunload` was writing,
so anything that ended the page without it lost the session. Fixed 2026-08-22. Same
reasoning for the `beforeunload` listener. `stateSignature` (which ignores x/y/velocity)
is what keeps the write itself cheap.

## Testing

`node scripts/group-drag-check.mjs` — 23 assertions for the marquee → carry-selection
gesture (both drop targets, the naming modal, cluster placement at the drop point, and
that a plain rubber band still works). Note it clicks the marquee **tool button** rather
than pressing `M`: the capture bar autofocuses, so the keystroke just types into it.

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
