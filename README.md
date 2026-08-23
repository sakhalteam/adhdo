# adhdo

A galaxy-brained brain dump. Catch the thought before it escapes; sort it out later
(or never). Part of the [sakhalteam](https://sakhalteam.github.io/) galaxy.

Thoughts are **globs** — blobby things that drift around a nebula. Drag two together
and they form a **cluster**. Nothing has to be organised, ever. The whole design bet is
that the cost of capturing an idea should be as close to zero as a computer can make it,
and everything else is optional.

## Two front ends, one brain

**On a desktop** you get the galaxy: floating globs, physics, drag-to-cluster, tether
lines between clusters, marquee multi-select, right-click menus, `Cmd+K` search.

**On a phone** you get a list. The galaxy's whole interaction model is hover, right-click
and drag, none of which exist under a thumb — so mobile is a different app over the same
state: an unsorted inbox at the top, collapsible clusters below, and a capture bar pinned
to the bottom. Search, filter chips, and long-press multi-select are there for triage.

Same `GalaxyState`, same App.tsx callbacks. The branch is `useIsMobile`.

## Capture

- **Type it.** The capture bar is always focused and always at the bottom. Enter sends,
  and the field keeps focus so you can rattle off five in a row.
- **Say it.** The 🎤 starts a *dictation session*: every sentence you finish becomes its
  own thought, with a soft blip to confirm, and the mic stays open until you tap Done.
  Built for catching an idea while driving — one tap in, one tap out, no looking. The
  screen is held awake while it listens. Falls back silently where the browser has no
  speech API (use the keyboard's own mic there).

## On a phone

adhdo is an installable PWA — **Share → Add to Home Screen** on iOS, **⋮ → Install app**
on Android. Installed, it launches straight to capture with no browser chrome and
**opens with no signal**, which is the point: the passes are where the ideas happen and
the bars are not.

Anything captured offline syncs itself the moment the network returns. When a phone and
a desktop have both moved on since they last spoke, adhdo **merges** the two rather than
letting the newer one win, so a drive's worth of thoughts can't be traded away for a
cluster rename. The trade-off is that deletions made offline may reappear — see
[Sync](#sync) below.

## Sync

State is one JSON document per user in Supabase (`galaxy_states`), GitHub OAuth,
localStorage-first. Writes are guarded by a compare-and-swap against the row version this
device last read, so a freshly-installed device can never flatten the cloud with its empty
galaxy — which matters, because an installed PWA gets a storage sandbox separate from the
browser's and therefore always starts empty.

When the guard trips, `mergeStates` unions both copies by id: records only one side knows
about are kept, and the cloud wins any id both sides hold. `repairState` then makes the
two views of cluster membership (`glob.clusterId` and `cluster.globIds`) agree, so no
thought can end up belonging to a cluster that doesn't list it — which would render it in
neither place.

Without sign-in everything still works; the data just lives in this browser.

## Stack

Vite + React 19 + TypeScript + Tailwind v4 (via `@tailwindcss/vite`, not PostCSS).
`base: '/adhdo/'`. Deploys to `sakhalteam.github.io/adhdo/` via GitHub Actions.

## Scripts

- `node scripts/make-icons.mjs` — regenerate the app icons in `public/`. They're drawn in
  code (no image dependency), so edit the script rather than the PNGs.
- `node scripts/smoke.mjs` — end-to-end test of capture, select-mode filing, search,
  swipe-delete and state repair against a running `npm run dev`. Needs a browser driver
  first: `npm i --no-save playwright-core` (drives your installed Edge).
