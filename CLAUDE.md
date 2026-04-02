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
- Clusters: drag two globs together, frosted glass cards, idle drift, collapse/expand
- Cluster handles: move (left), link (right) — hover-reveal with 1s linger
- Click-to-rename titles and glob text (auto-select-all)
- Connections: drag link handle between clusters → persistent dashed tether lines
- Merge: hover tether midpoint → merge button → rename modal → combines clusters
- Drag-to-trash (bottom-right), shake-to-dissolve, drag item outside cluster to release
- Context menus: glob (edit/flag/todo/duplicate/recolor/delete), cluster (rename/collapse/dissolve), empty space (create glob)
- Todo mode with checkboxes, done state (line-through)
- localStorage persistence, 300ms debounced auto-save

## Design philosophy
- Zero friction. Capture fast, organize later (or never).
- "Gentle wife nudge" — patient, not forcing. If globs float too long, gently group them.
- Layers of depth invisible until you want them (connections, merge, todo mode).
- Headlessui.com aesthetic: indigo/violet/cyan gradients, frosted glass, subtle glows.

## Pending work
- Auto-cluster orphan globs (~1 week old) into gentle "lost thoughts" cluster
- Search/filter, keyboard shortcuts, export/import
- Island zone integration (IslandScene.tsx wired for `zone_adhdo`, needs mesh added to island.blend)
