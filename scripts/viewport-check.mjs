/**
 * Viewport shortfall check: node scripts/viewport-check.mjs
 *
 * No browser, no dev server, no dependencies — Node strips the types off
 * src/iosViewport.ts on import.
 *
 * This exists because the bug it guards cannot be reproduced in a desktop
 * browser: only an iOS home-screen web app hands out a layout viewport shorter
 * than its own screen, and the two fixes shipped for it before this one were
 * both reasoned out on a laptop and both wrong. The readings below are what the
 * real devices report, so the decision can be tested even though the condition
 * cannot be staged.
 */

const { shortfallPx } = await import('../src/iosViewport.ts')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const eq = (name, got, want) => check(name, got === want, `got ${got}, want ${want}`)

// An iPhone 15 Pro: 393×852 CSS px, 59px status bar, 34px home indicator.
const pro15 = { screenW: 393, screenH: 852, topInset: 59 }

// ── the bug itself ──────────────────────────────────────────────────────────
eq('Installed on iOS, a short layout viewport measures the status bar',
  shortfallPx({ ...pro15, standalone: true, clientHeight: 793, landscape: false }), 59)

eq('A standalone app that already fills the screen needs no correction',
  shortfallPx({ ...pro15, standalone: true, clientHeight: 852, landscape: false }), 0)

// ── the ways this must refuse to act ────────────────────────────────────────
// Safari's viewport is legitimately short: its own URL bar is down there. The
// same arithmetic would draw the app underneath it — this bug in reverse, and
// the reason every branch is gated on `standalone`.
eq('In Safari the browser chrome is not a shortfall to correct',
  shortfallPx({ ...pro15, standalone: false, clientHeight: 750, landscape: false }), 0)

eq('A gap bigger than the status bar is something else, and is left alone',
  shortfallPx({ ...pro15, standalone: true, clientHeight: 600, landscape: false }), 0)

eq('A viewport TALLER than the screen never yields a negative correction',
  shortfallPx({ ...pro15, standalone: true, clientHeight: 900, landscape: false }), 0)

eq('No top inset (no notch, no black-translucent) means no correction',
  shortfallPx({ ...pro15, standalone: true, clientHeight: 793, topInset: 0, landscape: false }), 0)

eq('Unreadable screen metrics are declined rather than guessed at',
  shortfallPx({ ...pro15, standalone: true, screenH: 0, clientHeight: 793, landscape: false }), 0)
eq('A zero-height document is declined too',
  shortfallPx({ ...pro15, standalone: true, clientHeight: 0, landscape: false }), 0)

// ── orientation ─────────────────────────────────────────────────────────────
// iOS does not reliably swap screen.width/height on rotation, so the long/short
// side has to be picked from what the window is doing. Getting this backwards
// would "correct" a landscape app by 459px.
eq('Landscape measures against the short side of the screen',
  shortfallPx({ ...pro15, standalone: true, clientHeight: 334, landscape: true, topInset: 59 }), 59)
eq('Landscape does not mistake the long side for its height',
  shortfallPx({ ...pro15, standalone: true, clientHeight: 393, landscape: true }), 0)
eq('Portrait still works when the screen dims arrive pre-swapped',
  shortfallPx({ screenW: 852, screenH: 393, topInset: 59, standalone: true, clientHeight: 793, landscape: false }), 59)

// ── desktop / Android: the whole file must be inert ─────────────────────────
eq('Desktop (no navigator.standalone) is untouched',
  shortfallPx({ screenW: 2560, screenH: 1440, topInset: 0, standalone: false, clientHeight: 1300, landscape: true }), 0)

// ── the device matrix ───────────────────────────────────────────
// Nothing in shortfallPx is tuned to the phone the bug was found on: the status
// bar it reclaims is whatever THAT device reports as its top inset. These are
// the readings other hardware gives, so "it works on Nic's 15 Pro" is not the
// claim being made.
const device = (name, d, want) => eq(name, shortfallPx(d), want)

device('iPhone 15 Pro — reclaims its 59px Dynamic Island inset',
  { standalone: true, screenW: 393, screenH: 852, clientHeight: 793, landscape: false, topInset: 59 }, 59)
device('iPhone 16 Pro Max — reclaims its larger 62px inset, not a copied 59',
  { standalone: true, screenW: 440, screenH: 956, clientHeight: 894, landscape: false, topInset: 62 }, 62)
device('iPhone SE — no notch, a 20px status bar, and it reclaims exactly that',
  { standalone: true, screenW: 375, screenH: 667, clientHeight: 647, landscape: false, topInset: 20 }, 20)
device('iPad, installed and owning the whole screen',
  { standalone: true, screenW: 1024, screenH: 1366, clientHeight: 1342, landscape: false, topInset: 24 }, 24)
device('iPad in Split View does NOT own the screen, so nothing is reclaimed',
  { standalone: true, screenW: 1024, screenH: 1366, clientHeight: 1024, landscape: false, topInset: 24 }, 0)
device('Android installed PWA (no navigator.standalone) is left alone',
  { standalone: false, screenW: 412, screenH: 915, clientHeight: 915, landscape: false, topInset: 24 }, 0)
device('A friend opening the link in a browser instead of installing it',
  { standalone: false, screenW: 393, screenH: 852, clientHeight: 733, landscape: false, topInset: 59 }, 0)
device('A future iOS that stops doing this needs no correction and gets none',
  { standalone: true, screenW: 393, screenH: 852, clientHeight: 852, landscape: false, topInset: 59 }, 0)

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
