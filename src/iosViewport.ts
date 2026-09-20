/**
 * The installed-on-iOS bottom gap, measured instead of guessed.
 *
 * Twice now this app has shipped a fix for the same symptom — the home-screen
 * web app stopping `safe-area-inset-top` (59px on a 15 Pro) above the screen
 * bottom, with body's `--bg` showing under the tab bar — and twice the fix
 * rested on a belief about which box WebKit hands out, with no way to check it
 * from a laptop. `100dvh` was going to be the honest height (it is not; it
 * measures the same short initial containing block). `position: fixed` was
 * going to reach the real window (sibling repo traction says it does, which is
 * why removing `user-scalable=no` — their one head-tag difference — is the
 * primary fix beside this file).
 *
 * This is the part that does not need either belief to be right. It measures
 * the shortfall on the actual device and publishes it as a CSS variable, and
 * index.css corrects the shell by exactly that much. When there is nothing to
 * correct it publishes zero and changes nothing, so it is inert everywhere the
 * bug is absent: desktop, Android, iOS Safari, and an iOS home-screen app on
 * whatever future WebKit stops doing this.
 *
 * ⚠️ Deliberately narrow. `screen.height` is only trustworthy as "the height
 * the app really has" in an installed standalone app, which by definition owns
 * the whole screen. In Safari the same arithmetic would push the app under the
 * URL bar — the bug in reverse — so `navigator.standalone` gates everything,
 * and the result is clamped to the top inset so a wrong reading can never move
 * the app by more than the one offset this bug is made of.
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
 * Measure once and write the result to `--ios-shortfall` + the
 * `.ios-short-viewport` class on `<html>`. Returns the px applied.
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
 * Install the measurement and keep it current.
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
    { label: '.mobile-tabbar rect', value: rect('.mobile-tabbar') },
    { label: 'lowest tab label', value: (() => {
      const labels = [...doc.querySelectorAll('.mobile-tab-label')]
      if (!labels.length) return 'none rendered'
      return `${Math.round(Math.max(...labels.map(l => l.getBoundingClientRect().bottom)))} of ${win.innerHeight}`
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
