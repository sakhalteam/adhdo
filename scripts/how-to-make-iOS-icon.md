# How to make an iOS home-screen icon

Covers **adhdo**, **traction** and **bird-bingo** — three separate repos that
deliberately share one icon pipeline, so the instructions below are the same in
each unless a step says otherwise.

This file lives next to `make-icons.mjs` because that is the file you edit when
you want different art. The PNGs in `public/` are its output, not its source.

---

## The two paths

**You want your own art** → [Path A](#path-a-use-your-own-image). Drop in a PNG.

**You want to change the generated art** → [Path B](#path-b-change-the-generated-art).
Edit the script, re-run it, never touch the PNGs.

Both end at the same two caches that will lie to you. Read
[Why your new icon isn't showing up](#why-your-new-icon-isnt-showing-up) before
concluding anything is broken, because it almost certainly isn't.

---

## Path A: use your own image

1. Export a **180×180 PNG**. Read [Rules for the art](#rules-for-the-art) first —
   two of them are non-obvious and both look like "the icon is broken".
2. Save it as `public/apple-touch-icon-custom.png`.
   **Not** `public/apple-touch-icon.png` — that is the filename `make-icons.mjs`
   writes, so the next person to run the script silently overwrites your art.
   A name the script does not know about cannot be clobbered.
3. Point the tag at it, in `index.html`:
   ```html
   <link rel="apple-touch-icon" href="./apple-touch-icon-custom.png" />
   ```
4. Commit and push to `main`. `.github/workflows/deploy.yaml` builds and ships to
   Pages on every push to `main` — there is no separate deploy step. Vite copies
   `public/` into `dist/` verbatim, so the file lands at the site root.
5. Do the [cache dance](#why-your-new-icon-isnt-showing-up). You will need it.

Android and the browser tab still use the generated art (`icon-192.png`,
`icon-512.png`, `favicon-32.png`) unless you replace those too — see
[Which file is used where](#which-file-is-used-where).

## Path B: change the generated art

`make-icons.mjs` is a dependency-free renderer: a hand-rolled PNG encoder (zlib
plus a CRC table) and a `sample(u, v)` function that returns the colour at a
point in `0..1` space. There is no canvas and no image library, so it runs
anywhere Node runs, with nothing installed.

Edit `sample()` and the geometry constants above it, then:

```bash
node scripts/make-icons.mjs
```

That rewrites all four PNGs. Commit them alongside the script — they are checked
in, because the deploy workflow runs `npm run build` and nothing else.

**bird-bingo's script also self-checks.** It sweeps a polar grid to measure how
far the art actually reaches from centre, with separate limits for the solid
shapes and the outer glow, and throws rather than shipping a mark that Android's
circular crop would clip. If you move a constant and it starts refusing to run,
it is telling you the truth — pull the geometry in.

---

## Rules for the art

These four are where home-screen icons go wrong.

**No transparency.** Alpha is composited onto black, so a "transparent"
background becomes a black one — usually not what you drew.

**Do not round the corners.** iOS applies its own squircle mask. Corners already
rounded in the file get masked a second time, leaving dark slivers at the edges.
Ship a full-bleed square and let iOS cut the shape.

**Keep the meaning away from the edge.** iOS crops a few pixels to the squircle.
Android may crop a `maskable` icon to a circle of 80% diameter — everything
inside a circle of radius `0.40` (centre `0.5, 0.5`, in `0..1` units) survives
that. The generated marks sit well inside it on purpose.

**180×180 is the size that matters.** That is 60pt at @3x, what a modern iPhone
uses. iOS scales anything else, badly. iPads want 152 and 167; nobody here has
bothered, and they degrade fine.

---

## Which file is used where

| File | Used by | Size |
|---|---|---|
| `apple-touch-icon.png` | iOS home screen — **this is the iPhone one** | 180 |
| `icon-192.png`, `icon-512.png` | manifest → Android, Chrome install | 192 / 512 |
| `favicon-32.png` | browser tab | 32 |

**iOS picks in this order**, first match wins:

1. `<link rel="apple-touch-icon">` in `index.html`.
2. Failing that, the manifest's `icons`.
3. Failing both, a grey letter tile. (That is what bird-bingo showed for months.)

So the `<link>` always beats the manifest on iOS. Change the link, not the
manifest, when only the iPhone tile is wrong.

---

## Why your new icon isn't showing up

Two caches sit between your PNG and the tile on your phone, and they fail
differently. You usually need **both** fixes.

### 1. The service worker (adhdo and traction only)

`public/sw.js` serves icons **cache-first**:

```js
function isStaticExtra(url) {
  return url.origin === self.location.origin
    && /\.(png|svg|ico|webmanifest)$/.test(url.pathname)
}
```

Same URL, same bytes, forever. A deployed icon change is invisible to an already
installed device no matter how many times you reopen it.

**Fix:** bump the cache name in `public/sw.js`.

```js
const CACHE = 'adhdo-v1'   // → 'adhdo-v2'
```

The `activate` handler deletes every cache whose key isn't the current one, so
bumping it throws the old icons away. Do this in the same commit as the icon —
if you forget, the art is live on the web and stale on every phone.

**bird-bingo has no service worker**, so this step does not apply there.

### 2. The iOS tile snapshot

iOS copies the icon **at the moment you add to the Home Screen** and never looks
again. There is no refresh, no long-press option, nothing. Changing the file
cannot update a tile that already exists.

**Fix:** delete the tile and add it again from Safari.

### The order that actually works

1. Push to `main`, wait for the Actions run to finish (a minute or two).
2. Delete the Home Screen tile.
3. Open the site in **Safari** and hard-reload it.
4. Share → Add to Home Screen.

Skipping step 3 is the usual reason the old icon comes back: Safari hands the
install its cached copy.

---

## Per-repo reference

|  | adhdo | traction | bird-bingo |
|---|---|---|---|
| Base path | `/adhdo/` | `/traction/` | `/bird-bingo/` |
| Generator | `scripts/make-icons.mjs` | same | same, plus a safe-zone check |
| Service worker | yes, `adhdo-v1` | yes, `traction-v1` | none |
| Full-bleed under the status bar | yes | yes | no, deliberately |

All three deploy from `.github/workflows/deploy.yaml` on push to `main`, and all
three serve `public/` at the site root.

---

## Checklist

- [ ] 180×180, no alpha, square corners
- [ ] Saved under a filename `make-icons.mjs` does not write
- [ ] `<link rel="apple-touch-icon">` points at it
- [ ] `CACHE` bumped in `public/sw.js` (adhdo and traction)
- [ ] Pushed to `main`, Actions run green
- [ ] Tile deleted, Safari hard-reloaded, re-added
