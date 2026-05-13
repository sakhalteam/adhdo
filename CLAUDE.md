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
- Merge (two paths, **same modal**): (a) hover tether midpoint → merge button → rename modal → combines clusters; (b) drag a cluster onto another, hold ~1.5s until target glows, release → rename modal (same as path a). Both call `mergeClusters(c1, c2, newName)`.
- Cluster-item dragged out onto a free-floating glob → forms a new cluster from the two. If the source cluster had only that one item, the now-empty source cluster is deleted (no prompt — user already made a clear choice).
- Drag-to-trash (bottom-right), shake-to-dissolve, drag item outside cluster to release
- Context menus: glob (edit/flag/todo/duplicate/recolor/delete), cluster (rename/collapse/dissolve), empty space (create glob)
- Todo mode with checkboxes, done state (line-through)
- Ctrl/Cmd+click shortcut: on a free glob → auto-clusters it + toggles todo; on a cluster item → toggles todo. Suppresses macOS native ctrl+click contextmenu so the shortcut wins.
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
