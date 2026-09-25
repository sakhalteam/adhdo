/**
 * The installed-on-iOS bottom gap: measured, reported, and NOT corrected.
 *
 * Five rounds of CSS were spent trying to reclaim a strip of screen that was
 * never this app's to paint. The readings that ended it (Nic's 15 Pro, Browse →
 * Diagnostics, 2026-09-20): `screen` 852pt, but `innerHeight`,
 * `visualViewport.height` and `documentElement.clientHeight` all 793. A
 * `black-translucent` standalone web view is anchored at y=0 — correctly
 * full-bleed under the Dynamic Island — and sized screen MINUS the status bar.
 * The bottom 59pt belongs to the app window, not the document; the flat colour
 * there is the manifest's `background_color`.
 *
 * ⚠️ So the shortfall is not a layout error, and extending the app box by it is
 * actively harmful: the DOM then reports a tab bar at 759→852 while the screen
 * paints nothing past 793, and the labels vanish while measuring as present.
 * The real fix is in index.html — `apple-mobile-web-app-status-bar-style:
 * black`, which makes iOS size the web view to reach the screen bottom.
 *
 * What survives here is the instrument, not the cure. `shortfallPx` detects the
 * condition so `DiagnosticsPanel` can show it and flag the reading that
 * disagrees with the others, and so the day iOS changes this again there is a
 * number to look at rather than a theory to argue. Nothing in index.css acts on
 * what this publishes.
 */

export interface ViewportProbe {
  /** iOS home-screen web app? (`navigator.standalone`) */
  standalone: boolean
  /** `screen.width` / `screen.height` — the device screen in CSS px. */
  screenW: number
  screenH: number
  /** The layout viewport: `document.documentElement.clientHeight`. */
  clientHeight: number
  /** Is the window currently wider than it is tall? */
  landscape: boolean
  /** Computed `env(safe-area-inset-top)`, in px. */
  topInset: number
}

/**
 * How many px the layout viewport is short of the real screen.
 *
 * Pure, so `scripts/viewport-check.mjs` can put the readings from every case
 * through it — including the ones no desktop browser can reproduce.
 */
export function shortfallPx(p: ViewportProbe): number {
  // Only an installed standalone app owns the full screen. Anywhere else the
  // browser's own chrome legitimately makes the viewport shorter, and
  // "correcting" for it would draw the app underneath that chrome.
  if (!p.standalone) return 0
  if (!(p.clientHeight > 0) || !(p.screenW > 0) || !(p.screenH > 0)) return 0

  // iOS does not reliably swap screen.width/height with orientation, so pick
  // the long or short side by what the window is actually doing.
  const screenLong = Math.max(p.screenW, p.screenH)
  const screenShort = Math.min(p.screenW, p.screenH)
  const screenH = p.landscape ? screenShort : screenLong

  const gap = screenH - p.clientHeight
  // The bug is worth exactly one status bar. A larger gap is something else —
  // split view, a resized window, a reading we do not understand — and this is
  // not the code to guess at it.
  if (gap <= 0 || !(p.topInset > 0) || gap > p.topInset + 1) return 0
  return Math.round(gap)
}

/** Read `env(safe-area-inset-top)` in px, via a throwaway element. */
function readTopInset(doc: Document): number {
  const probe = doc.createElement('div')
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;' +
    'height:env(safe-area-inset-top,0px)'
  doc.body.appendChild(probe)
  const px = probe.getBoundingClientRect().height
  probe.remove()
  return px
}

/**
 * Measure once and publish to `--ios-shortfall` + the `.ios-short-viewport`
 * class on `<html>`. Returns the px measured.
 *
 * ⚠️ "Publish", not "apply": no stylesheet rule reads either of them. They are
 * for the diagnostics panel. See the note at the top of this file.
 */
export function applyViewportShortfall(win: Window = window): number {
  const doc = win.document
  const px = shortfallPx({
    // `standalone` is a non-standard iOS-only Navigator field.
    standalone: (win.navigator as Navigator & { standalone?: boolean }).standalone === true,
    screenW: win.screen?.width ?? 0,
    screenH: win.screen?.height ?? 0,
    clientHeight: doc.documentElement.clientHeight,
    landscape: win.innerWidth > win.innerHeight,
    topInset: readTopInset(doc),
  })
  doc.documentElement.style.setProperty('--ios-shortfall', `${px}px`)
  doc.documentElement.classList.toggle('ios-short-viewport', px > 0)
  return px
}

/**
 * Install the measurement and keep it current, so the diagnostics panel is
 * never showing a stale reading after a rotation.
 *
 * ⚠️ Plain `addEventListener` with no React in sight, on purpose. See the
 * autosave / BackupsPanel notes in CLAUDE.md: an effect that registers a window
 * listener on this app's desktop path re-runs every animation frame if anything
 * in its dep array churns, and the galaxy's physics loop churns everything.
 * This listener is registered once at boot and never torn down.
 */
export function watchViewportShortfall(win: Window = window): void {
  const measure = () => applyViewportShortfall(win)
  measure()
  win.addEventListener('resize', measure)
  win.addEventListener('orientationchange', measure)
  // The insets are not always final on the first frame of a cold standalone
  // launch, and a rotation reports its new size a beat after the event.
  win.setTimeout(measure, 300)
}

/** One labelled reading for the diagnostics panel. */
export interface ViewportReading {
  label: string
  value: string
  /** true when this reading is the one that does not agree with the others. */
  flag?: boolean
}

/**
 * Everything needed to tell a stale bundle from a failed fix, read live.
 *
 * This exists because four rounds of the installed-on-iOS viewport bug were
 * argued from screenshots: a laptop cannot reproduce the short viewport, and an
 * installed PWA that resumes rather than cold-launches can sit on old CSS
 * indefinitely, which looks exactly like a fix that did not work. One
 * screenshot of this panel settles both questions at once.
 */
export function viewportReadings(win: Window = window): ViewportReading[] {
  const doc = win.document
  const css = (el: Element | null, prop: string) =>
    el ? win.getComputedStyle(el).getPropertyValue(prop).trim() : '—'
  const rect = (sel: string) => {
    const el = doc.querySelector(sel)
    if (!el) return '—'
    const r = el.getBoundingClientRect()
    return `${Math.round(r.top)} → ${Math.round(r.bottom)}`
  }
  const root = doc.documentElement
  const standalone =
    (win.navigator as Navigator & { standalone?: boolean }).standalone === true
  const clientH = root.clientHeight
  const screenH = Math.max(win.screen?.width ?? 0, win.screen?.height ?? 0)
  const shortfall = css(root, '--ios-shortfall') || '0px'
  const applied = root.classList.contains('ios-short-viewport')

  return [
    { label: 'build', value: __BUILD_ID__ },
    { label: 'standalone', value: String(standalone) },
    { label: 'screen', value: `${win.screen?.width ?? 0} × ${win.screen?.height ?? 0}` },
    { label: 'documentElement.clientHeight', value: String(clientH), flag: standalone && clientH < screenH },
    { label: 'window.innerHeight', value: String(win.innerHeight) },
    { label: 'visualViewport.height', value: String(Math.round(win.visualViewport?.height ?? 0)) },
    { label: 'safe-area top / bottom', value: `${readTopInset(doc)} / ${readBottomInset(doc)}` },
    { label: 'measured shortfall', value: shortfall },
    { label: 'correction applied', value: String(applied) },
    { label: 'overflow html / body / #root', value:
        `${css(root, 'overflow')} / ${css(doc.body, 'overflow')} / ${css(doc.getElementById('root'), 'overflow')}` },
    { label: '#root rect', value: rect('#root') },
    { label: '.mobile-app rect', value: rect('.mobile-app') },
    // The capture bar is the phone's bottom-most chrome (the tab bar it replaced
    // on 2026-09-25 was what first showed the clipping), so it is the canary: if
    // its bottom isn't the window's bottom, the shell is short again.
    { label: '.mobile-capture rect', value: rect('.mobile-capture') },
    { label: 'capture bar bottom', value: (() => {
      const bar = doc.querySelector('.mobile-capture')
      if (!bar) return 'none rendered'
      return `${Math.round(bar.getBoundingClientRect().bottom)} of ${win.innerHeight}`
    })() },
  ]
}

/** Companion to readTopInset, for the report only. */
function readBottomInset(doc: Document): number {
  const probe = doc.createElement('div')
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;' +
    'height:env(safe-area-inset-bottom,0px)'
  doc.body.appendChild(probe)
  const px = probe.getBoundingClientRect().height
  probe.remove()
  return px
}
