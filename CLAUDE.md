# adhdo — ADHD-friendly galaxy brain-dump/todo app

> Parent context: `../CLAUDE.md` has universal preferences and conventions. Keep it updated with anything universal you learn here.

## What this is

A personal todo/brain-dump app for Nic (who has ADHD). Floating blobby "globs" drift in a galaxy-themed space. Zero-friction capture, optional organization, everything malleable. The anti-Notion. The anti-Todoist.

## Stack

- Vite + React 19 + TypeScript + Tailwind v4 (via `@tailwindcss/vite` plugin, NOT PostCSS)
- `base: '/adhdo/'` in vite.config.ts
- Deployed to sakhalteam.github.io/adhdo/

## Architecture

- **App.tsx**: all state + CRUD operations (addGlob, deleteGlob, createCluster, mergeClusters, connectClusters, etc). Passes callbacks to Galaxy.
- **Galaxy.tsx**: rendering + physics loop (rAF) + all interaction handlers (drag, drop, connect, shake detect, context menus). Uses `handleDropRef` pattern to avoid stale closures in pointer events.
- **store.ts**: factory functions (makeGlob, makeCluster, makeConnection), localStorage load/save, color palette.
- **types.ts**: Glob, Cluster, Connection, GalaxyState (globs[], clusters[], connections[]).
- **index.css**: ALL styles live here. Nebula background, blob morph keyframes, frosted glass, context menus, modals, etc. Minimal Tailwind utility usage in JSX.

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
  - `App.tsx` exposes the bulk primitives: `recolorGlobs`, `toggleAllTodosInGlobs`, `deleteGlobs`, `transferToNewCluster`.
- **Cluster z-order: click-to-front like Windows.** Clusters rank by `lastInteraction` (already updated on drag/rename/edit/etc.), highest rank = highest z-index. Touching any cluster brings it to the foreground. Hover does NOT promote (would cause z-thrashing).
- Click anywhere inside a cluster item enters edit mode (was: only the text span). Drag-and-hold still becomes a reorder/pop-out drag via HTML5 dragstart.
- Context menus + recolor popover clamp to viewport so they never clip off-screen.
- Todo mode with checkboxes, done state (line-through)
- Ctrl/Cmd+click shortcut: on a free glob → auto-clusters it + toggles todo; on a cluster item → toggles todo; on the cluster body (anywhere not an item) → toggles ALL items as todos (set-all semantics: if any item isn't a todo, all become todos; if all are todos, all flip back). Suppresses macOS native ctrl+click contextmenu so the shortcut wins.
- localStorage persistence, 300ms debounced auto-save

## Design philosophy

- Zero friction. Capture fast, organize later (or never).
- "Gentle wife nudge" — patient, not forcing. If globs float too long, gently group them.
- Layers of depth invisible until you want them (connections, merge, todo mode).
- Headlessui.com aesthetic: indigo/violet/cyan gradients, frosted glass, subtle glows.

## Pending work

- Auto-cluster orphan globs (~1 week old) into gentle "lost thoughts" cluster
- Search/filter, keyboard shortcuts, export/import
- **Hyper-clusters** (deferred — own session): nested clusters-of-clusters with collapsible per-source headers, draggable back out to restore originals. Today's hold-to-merge uses simple absorb (target wins). Would need a new data shape (parentClusterId on Cluster, or a HyperCluster type), nested render/drag/persistence migration.
