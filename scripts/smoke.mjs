/**
 * Functional smoke test against the running dev server: node scripts/smoke.mjs
 * Needs a driver first: npm i --no-save playwright-core
 *
 * Mobile is the capture pocket (persistent capture bar, journal stream,
 * Clusters + Search pages, swipe gestures); desktop is the galaxy plus the
 * due-date/priority reflection and the agenda dock.
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'

// Vite picks the next free port if 5173 is taken; override with PORT=5174.
const URL = `http://localhost:${process.env.PORT ?? 5173}/adhdo/`
const now = Date.now()

// Local calendar dates, same arithmetic as src/dates.ts.
const dstr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const TODAY = dstr(new Date())
const YESTERDAY = dstr(new Date(now - 86_400_000))
const TOMORROW = dstr(new Date(now + 86_400_000))

let n = 0
const glob = (text, opts = {}) => ({
  id: `g${++n}`, text, x: 400, y: 300, color: '#a78bfa',
  flagged: false, isTodo: false, done: false, clusterId: null,
  createdAt: now - n * 60_000, dueDate: null, priority: 4, ...opts,
})

const state = {
  globs: [
    glob('call the arborist about the maple'),
    glob('pressure-wash pricing tiers'),
    glob('jojo dinosaur birthday', { flagged: true }),
    glob('renew the trailer tabs', { isTodo: true, dueDate: YESTERDAY, priority: 1 }),
    glob('water the ficus', { isTodo: true, dueDate: TODAY }),
    glob('gutter guards', { isTodo: true, clusterId: 'c1', dueDate: TODAY, priority: 2 }),
    glob('order degreaser', { isTodo: true, clusterId: 'c1' }),
    // Deliberately corrupt: claims c1, but c1 does not list it. Before
    // repairState this rendered nowhere at all.
    glob('ORPHANED THOUGHT', { clusterId: 'c1' }),
  ],
  clusters: [
    { id: 'c1', name: 'work stuff', x: 300, y: 200, color: '#22d3ee', globIds: ['g6', 'g7'], collapsed: false },
    { id: 'c2', name: 'side projects', x: 700, y: 400, color: '#c084fc', globIds: [], collapsed: false },
  ],
  connections: [],
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// Defaults to installed Edge (Nic's machine); BROWSER_PATH points at any
// Chromium binary instead (e.g. a CI container's bundled build).
const browser = await chromium.launch(
  process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: 'msedge' },
)

async function session(viewport, isMobile) {
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 2, isMobile, hasTouch: isMobile,
  })
  await ctx.addInitScript(s => {
    localStorage.setItem('adhdo-galaxy', JSON.stringify(s))
    localStorage.setItem('adhdo-seen-onboarding-v1', '1')
  }, state)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(URL)
  await page.waitForTimeout(700)
  return { ctx, page, errors }
}

/**
 * adhdo mirrors to localStorage on a 2s interval (keyed off a signature, so
 * physics drift doesn't thrash it). Reading straight after a click gets the
 * previous snapshot — wait for the write before asserting on it.
 */
const readState = async page => {
  await page.waitForTimeout(2400)
  return page.evaluate(() => JSON.parse(localStorage.getItem('adhdo-galaxy')))
}

/** Close whatever bottom sheet is open by tapping the dimmed backdrop. */
const closeSheet = async page => {
  await page.locator('.mobile-sheet-backdrop').click({ position: { x: 20, y: 80 } })
  await page.waitForTimeout(250)
}

// ── mobile ────────────────────────────────────────────────────────────────
// The capture pocket: a persistent bar at the bottom, a journal-style stream,
// Clusters and Search as their own pages. See src/MobileApp.tsx.
{
  const { ctx, page, errors } = await session({ width: 390, height: 844 }, true)

  /** Bring a row to mid-screen, clear of the header and the capture bar. */
  const centre = async loc => {
    await loc.evaluate(el => el.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(150)
    return loc.boundingBox()
  }
  const swipe = async (loc, dx) => {
    const b = await centre(loc)
    const y = b.y + b.height / 2
    const x0 = dx > 0 ? b.x + 40 : b.x + b.width - 40
    await page.mouse.move(x0, y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + (dx * i) / 10, y)
    await page.mouse.up()
    await page.waitForTimeout(400)
  }
  const longPress = async loc => {
    const b = await centre(loc)
    await page.mouse.move(b.x + 140, b.y + b.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(700)
    await page.mouse.up()
    await page.waitForTimeout(250)
  }
  const row = text => page.locator('.mobile-task', { hasText: text })
  const capture = page.locator('.mobile-capture-input')
  const catchIt = async text => {
    await capture.fill(text)
    await capture.press('Enter')
    await page.waitForTimeout(250)
  }

  // 0. The shell reaches the bottom of the window.
  //    Installed on iOS, `height: 100%` / `100vh` / `100dvh` all resolve against
  //    an initial containing block that is `safe-area-inset-top` SHORT, so the
  //    app box stopped 59px above the screen edge. `position: fixed` measures
  //    the real window instead, so `#root` is fixed — and a transform on
  //    `.app`/`.mobile-root` would make it the containing block for the fixed
  //    chrome and put the capture bar right back in the short box. A desktop
  //    browser cannot reproduce the short ICB, so assert the structural facts
  //    the fix rests on, plus the flush geometry that must hold everywhere.
  const shell = await page.evaluate(() => {
    const cs = el => getComputedStyle(el)
    const bottom = sel => document.querySelector(sel).getBoundingClientRect().bottom
    return {
      rootPosition: cs(document.getElementById('root')).position,
      rootTransform: cs(document.querySelector('.mobile-root')).transform,
      appTransform: cs(document.querySelector('.app')).transform,
      viewportH: window.innerHeight,
      appBottom: bottom('.mobile-app'),
      captureBottom: bottom('.mobile-capture'),
    }
  })
  check('#root is fixed, so the shell measures the window not the short ICB',
    shell.rootPosition === 'fixed', shell.rootPosition)
  check('Nothing transforms .app/.mobile-root into a containing block for the fixed chrome',
    shell.rootTransform === 'none' && shell.appTransform === 'none',
    `${shell.appTransform} / ${shell.rootTransform}`)
  check('The mobile app box reaches the bottom of the window',
    Math.abs(shell.appBottom - shell.viewportH) < 1, `${shell.appBottom} vs ${shell.viewportH}`)
  check('The capture bar sits flush on the bottom edge',
    Math.abs(shell.captureBottom - shell.viewportH) < 1, `${shell.captureBottom} vs ${shell.viewportH}`)

  // src/iosViewport.ts MEASURES the installed-on-iOS shortfall; it must never
  // correct for it — no CSS can paint outside a web view smaller than the
  // screen. So the marker class may land, and landing must move nothing.
  const marker = await page.evaluate(() => {
    const before = {
      cls: document.documentElement.classList.contains('ios-short-viewport'),
      px: getComputedStyle(document.documentElement).getPropertyValue('--ios-shortfall').trim(),
    }
    const r = sel => document.querySelector(sel).getBoundingClientRect().bottom
    const snap = () => ({
      app: r('.mobile-app'),
      bar: r('.mobile-capture'),
      transform: getComputedStyle(document.querySelector('.mobile-root')).transform,
    })
    const off = snap()
    document.documentElement.classList.add('ios-short-viewport')
    const on = snap()
    document.documentElement.classList.remove('ios-short-viewport')
    return { before, off, on, viewportH: window.innerHeight }
  })
  check('No shortfall is measured in a browser that does not have the bug',
    marker.before.cls === false && marker.before.px === '0px',
    `class=${marker.before.cls} var=${marker.before.px}`)
  check('.ios-short-viewport is a diagnostic marker and moves nothing',
    marker.off.app === marker.on.app && marker.off.bar === marker.on.bar && marker.on.transform === 'none',
    `app ${marker.off.app}->${marker.on.app}, bar ${marker.off.bar}->${marker.on.bar}`)

  // Round four of the iOS bug: `overflow: hidden` on the shell propagated to the
  // viewport and CLIPPED the bottom chrome. Nothing in the shell chain may clip.
  const clip = await page.evaluate(() => {
    const ov = el => getComputedStyle(el).overflow
    const labels = [...document.querySelectorAll('.mobile-nav-label')]
    return {
      html: ov(document.documentElement),
      body: ov(document.body),
      root: ov(document.getElementById('root')),
      labels: labels.map(l => l.textContent),
    }
  })
  check('Nothing in the shell chain clips (html / body / #root)',
    ![clip.html, clip.body, clip.root].some(v => v.includes('hidden')),
    `html:${clip.html} body:${clip.body} #root:${clip.root}`)
  check('Three pages: Thoughts · Clusters · Search',
    clip.labels.join('|') === 'Thoughts|Clusters|Search', clip.labels.join('|'))
  check('The Todoist chrome is gone (no tab bar, no + button, no quick-add sheet)',
    (await page.locator('.mobile-tabbar, .mobile-fab, .mobile-qa-input').count()) === 0)

  // 1. The landing page is never empty just because nothing is due.
  check('Lands on Thoughts', await page.locator('.mobile-nav-btn.on', { hasText: 'Thoughts' }).isVisible())
  check('Due today + overdue are pinned at the top',
    await page.locator('.mobile-group-head.is-due').isVisible()
    && await row('renew the trailer tabs').first().isVisible()
    && await row('water the ficus').first().isVisible())
  check('...and a pinned thought is not listed twice',
    (await row('water the ficus').count()) === 1, `${await row('water the ficus').count()} rows`)
  check('Undated thoughts fill the stream under a day header',
    await page.locator('.mobile-day-head', { hasText: 'Today' }).isVisible()
    && await row('pressure-wash pricing tiers').isVisible())
  check('State repair: the orphaned glob is rendered, not lost',
    await row('ORPHANED THOUGHT').isVisible())

  // 2. The capture bar: the whole point of the phone.
  check('The capture bar is on screen, with the mic', await capture.isVisible()
    && await page.locator('.mobile-capture .capture-mic').isVisible())
  await catchIt('brand new thought from the pass')
  // Checked before the state read below: the flash is meant to be brief.
  check('...and says it was caught', await page.locator('.mobile-capture-flash', { hasText: 'caught' }).isVisible())
  let s = await readState(page)
  const fresh = s.globs.find(g => g.text === 'brand new thought from the pass')
  check('Enter catches a plain thought into Unsorted',
    !!fresh && fresh.clusterId === null && fresh.isTodo === false && fresh.dueDate == null)
  check('...clears the bar and keeps focus for the next one',
    (await capture.inputValue()) === ''
    && await page.evaluate(() => document.activeElement?.classList.contains('mobile-capture-input')))
  check('The new thought lands at the top of today',
    (await page.locator('.mobile-day-head', { hasText: 'Today' }).locator('xpath=..').locator('.mobile-task-text').first().innerText())
      .includes('brand new thought'))

  // 3. Dates in plain words, visible before you send, and refusable.
  const barTop = (await capture.boundingBox()).y
  await capture.fill('call mum tomorrow')
  await page.waitForTimeout(150)
  check('"tomorrow" shows as a date chip while typing',
    await page.locator('.mobile-capture-date', { hasText: 'Tomorrow' }).isVisible())
  check('...and the input does not jump when the chip appears',
    Math.abs((await capture.boundingBox()).y - barTop) < 1, `${barTop} -> ${(await capture.boundingBox()).y}`)
  await capture.press('Enter')
  await page.waitForTimeout(200)
  await capture.fill('tomorrow is jojo day')
  await page.waitForTimeout(150)
  await page.locator('.mobile-capture-date').click()
  check('Tapping the chip away drops the date', (await page.locator('.mobile-capture-date').count()) === 0)
  await capture.press('Enter')
  await page.waitForTimeout(200)
  await catchIt('fix the gate p2')
  s = await readState(page)
  const mum = s.globs.find(g => g.text === 'call mum')
  check('A date word becomes a due date, lifted out of the text',
    mum?.dueDate === TOMORROW && mum?.isTodo === true, JSON.stringify(mum && { t: mum.text, d: mum.dueDate }))
  const jojo = s.globs.find(g => g.text.startsWith('tomorrow is jojo'))
  check('...unless refused: then the words stay and no date is set',
    jojo?.text === 'tomorrow is jojo day' && jojo?.dueDate == null)
  const gate = s.globs.find(g => g.text.startsWith('fix the gate'))
  check('Priority tokens are left alone on the phone',
    gate?.text === 'fix the gate p2' && (gate?.priority ?? 4) === 4)

  // 4. The nudge: sort a few, one at a time.
  const nudge = page.locator('.mobile-nudge')
  check('The "sort a few?" nudge shows when the pile is big enough', await nudge.isVisible())
  await nudge.click()
  await page.waitForTimeout(350)
  const first = await page.locator('.mobile-sort-text').innerText()
  check('Sorting starts at the newest thought', first === 'fix the gate p2', first)
  await page.locator('.mobile-sort-chip', { hasText: 'side projects' }).click()
  await page.waitForTimeout(200)
  check('Filing it advances to the next one',
    (await page.locator('.mobile-sort-progress').textContent()).startsWith('2 of'))
  await page.locator('.mobile-sort-act', { hasText: 'Skip' }).click()
  await page.waitForTimeout(200)
  check('Skip moves on without touching it',
    (await page.locator('.mobile-sort-progress').textContent()).startsWith('3 of'))
  await page.locator('.mobile-head-link', { hasText: 'Enough for now' }).click()
  await page.waitForTimeout(250)
  s = await readState(page)
  check('The sorted thought is in its cluster',
    s.globs.find(g => g.text === 'fix the gate p2')?.clusterId === 'c2'
    && s.clusters.find(c => c.id === 'c2').globIds.includes(s.globs.find(g => g.text === 'fix the gate p2').id))

  // 5. Row gestures: right = done, left = file.
  await swipe(row('pressure-wash pricing tiers'), 150)
  s = await readState(page)
  check('Swipe right marks it done', s.globs.find(g => g.id === 'g2')?.done === true)
  check('...and it stays in the stream, struck through',
    ((await row('pressure-wash pricing tiers').getAttribute('class')) ?? '').includes('done'))

  await swipe(row('jojo dinosaur birthday'), -150)
  check('Swipe left opens "file into"',
    await page.locator('.mobile-sheet-title', { hasText: 'into' }).isVisible())
  await page.locator('.mobile-sheet-row', { hasText: 'side projects' }).click()
  await page.waitForTimeout(250)
  s = await readState(page)
  check('...and filing puts it in the cluster', s.globs.find(g => g.id === 'g3')?.clusterId === 'c2')

  const beforeScroll = (await readState(page)).globs.map(g => [g.id, g.done, g.clusterId])
  const t2 = await centre(row('call the arborist'))
  await page.mouse.move(t2.x + t2.width / 2, t2.y + t2.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    // Drift sideways while mostly moving down, like a real thumb.
    await page.mouse.move(t2.x + t2.width / 2 - i * 4, t2.y + t2.height / 2 + i * 18)
  }
  await page.mouse.up()
  await page.waitForTimeout(300)
  check('A drifting vertical scroll changes nothing',
    JSON.stringify((await readState(page)).globs.map(g => [g.id, g.done, g.clusterId])) === JSON.stringify(beforeScroll))

  // 6. The detail sheet: dates yes, priorities no.
  await row('call the arborist').click()
  await page.waitForTimeout(350)
  check('Tapping a row opens its details, with when it was caught',
    await page.locator('.mobile-detail-when', { hasText: 'caught today at' }).isVisible())
  check('...and no priority picker', (await page.locator('.mobile-detail-row', { hasText: 'Priority' }).count()) === 0)
  await page.locator('.mobile-detail-row', { hasText: 'Due date' }).click()
  await page.waitForTimeout(250)
  await page.locator('.mobile-sheet-row', { hasText: 'Tomorrow' }).click()
  await page.waitForTimeout(250)
  check('Picking a date returns to the details, showing it',
    await page.locator('.mobile-detail-row', { hasText: 'Due date' }).locator('.mobile-detail-value', { hasText: 'Tomorrow' }).isVisible())
  await closeSheet(page)
  s = await readState(page)
  check('...and saves it', s.globs.find(g => g.id === 'g1')?.dueDate === TOMORROW)

  // Making an Unsorted thought a to-do keeps it Unsorted. Desktop wraps a free
  // glob in a cluster (it has no checkbox out there); the phone must not.
  const clustersBeforeTodo = s.clusters.length
  await row('ORPHANED THOUGHT').click()
  await page.waitForTimeout(350)
  await page.locator('.mobile-detail-row', { hasText: 'Make a to-do' }).click()
  await page.waitForTimeout(200)
  await closeSheet(page)
  s = await readState(page)
  check('Making an Unsorted thought a to-do keeps it Unsorted',
    s.globs.find(g => g.id === 'g8')?.isTodo === true && s.globs.find(g => g.id === 'g8')?.clusterId === null
    && s.clusters.length === clustersBeforeTodo)

  // 7. Select mode → a brand-new cluster → one undo.
  await longPress(row('brand new thought from the pass'))
  check('Long-press enters select mode', await page.locator('.bulk-bar').isVisible())
  check('...which takes the capture bar\'s place', (await page.locator('.mobile-capture').count()) === 0)
  await row('tomorrow is jojo day').click()
  await page.waitForTimeout(200)
  check('Tapping adds to the selection', (await page.locator('.mobile-select-count').innerText()).startsWith('2'))
  await page.locator('.bulk-btn', { hasText: 'File' }).click()
  await page.waitForTimeout(250)
  await page.locator('.mobile-sheet-row', { hasText: 'New cluster' }).click()
  await page.waitForTimeout(250)
  await page.locator('.mobile-prompt-input').fill('errands')
  await page.locator('.mobile-prompt-btn', { hasText: 'Create' }).click()
  await page.waitForTimeout(300)
  s = await readState(page)
  const errands = s.clusters.find(c => c.name === 'errands')
  check('File → New cluster makes one holding both', errands?.globIds.length === 2)
  check('Select mode exits after the batch', !(await page.locator('.bulk-bar').isVisible()))
  await page.locator('.undo-redo-btn').first().click()
  s = await readState(page)
  check('Undo lives in the capture bar and reverses the batch in one tap',
    !s.clusters.some(c => c.name === 'errands'))

  // 8. Clusters: its own page, and capture follows you into a cluster.
  await page.locator('.mobile-nav-btn', { hasText: 'Clusters' }).click()
  await page.waitForTimeout(300)
  check('Clusters page shows Unsorted and every cluster as a card',
    await page.locator('.mobile-cluster-card.is-unsorted').isVisible()
    && await page.locator('.mobile-cluster-card', { hasText: 'work stuff' }).isVisible()
    && await page.locator('.mobile-cluster-card', { hasText: 'side projects' }).isVisible())
  await page.locator('.mobile-cluster-card', { hasText: 'work stuff' }).click()
  await page.waitForTimeout(300)
  check('A cluster opens with its thoughts',
    await page.locator('.mobile-view-title', { hasText: 'work stuff' }).isVisible()
    && await row('order degreaser').isVisible())
  check('...and the capture bar now adds to it',
    await page.locator('.mobile-capture-target', { hasText: 'work stuff' }).isVisible()
    && (await capture.getAttribute('placeholder')).includes('work stuff'))
  await catchIt('buy a ladder')
  check('...and says where it went', await page.locator('.mobile-capture-flash', { hasText: 'work stuff' }).isVisible())
  s = await readState(page)
  check('A thought caught inside a cluster lands in it',
    s.globs.find(g => g.text === 'buy a ladder')?.clusterId === 'c1')
  await row('order degreaser').locator('.mobile-check').click()
  await page.waitForTimeout(300)
  check('Done thoughts fold away under Done',
    await page.locator('.mobile-completed-toggle', { hasText: 'Done' }).isVisible()
    && !(await row('order degreaser').isVisible()))
  await page.locator('.mobile-back-btn').click()
  await page.waitForTimeout(250)
  await page.locator('.mobile-cluster-card.is-add').click()
  await page.waitForTimeout(250)
  await page.locator('.mobile-prompt-input').fill('reading list')
  await page.locator('.mobile-prompt-btn', { hasText: 'Create' }).click()
  await page.waitForTimeout(300)
  s = await readState(page)
  check('New cluster from the Clusters page creates an empty one',
    s.clusters.some(c => c.name === 'reading list' && c.globIds.length === 0)
    && await page.locator('.mobile-cluster-card', { hasText: 'reading list' }).isVisible())

  // 9. Search: its own page.
  await page.locator('.mobile-nav-btn', { hasText: 'Search' }).click()
  await page.waitForTimeout(300)
  check('Search focuses its own box',
    await page.evaluate(() => document.activeElement?.getAttribute('type') === 'search'))
  await page.locator('.mobile-search input').fill('degreaser')
  await page.waitForTimeout(250)
  check('Search narrows to matches, done ones included', (await page.locator('.mobile-task').count()) === 1)
  await page.locator('.mobile-search input').fill('')
  await page.locator('.mobile-chip', { hasText: 'Dated' }).click()
  await page.waitForTimeout(250)
  check('"Dated" lists what\'s scheduled, soonest first',
    (await page.locator('.mobile-task-text').first().innerText()) === 'renew the trailer tabs')
  await page.locator('.mobile-chip', { hasText: 'Flagged' }).click()
  await page.waitForTimeout(250)
  check('Flagged filter works', (await page.locator('.mobile-task').count()) === 1)
  await page.locator('.mobile-chip', { hasText: 'All' }).click()

  // 10. Backups + diagnostics, tucked at the bottom of Clusters.
  await page.locator('.mobile-nav-btn', { hasText: 'Clusters' }).click()
  await page.waitForTimeout(300)
  await page.locator('.mobile-quiet-row', { hasText: 'Backups' }).click()
  await page.waitForTimeout(300)
  check('Clusters opens the backups panel on mobile', await page.locator('.backups-panel').isVisible())
  check('...which offers the export file when signed out',
    await page.locator('.backups-btn', { hasText: 'export' }).isVisible())
  check('...and says version history needs a sign-in',
    await page.locator('.backups-note', { hasText: 'Sign in' }).isVisible())

  // Import merges: seed a file holding one thought this galaxy has never seen.
  const importPath = `${os.tmpdir()}/adhdo-import-test.json`
  fs.writeFileSync(importPath, JSON.stringify({
    version: 1,
    state: { globs: [glob('imported from a file', { id: 'imp1' })], clusters: [], connections: [] },
  }))
  await page.locator('.backups-panel input[type=file]').setInputFiles(importPath)
  await page.waitForTimeout(400)
  const afterImport = await readState(page)
  check('Import merges the file in rather than replacing the galaxy',
    afterImport.globs.some(g => g.id === 'imp1')
    && afterImport.globs.some(g => g.id === 'g1')
    && afterImport.clusters.some(c => c.id === 'c1'),
    `globs ${afterImport.globs.length}, imp1 ${afterImport.globs.some(g => g.id === 'imp1')}`)
  fs.rmSync(importPath, { force: true })

  // Diagnostics: the panel that tells a stale bundle from a failed fix.
  await page.keyboard.press('Escape')   // the backups panel is still open
  await page.waitForTimeout(250)
  await page.locator('.mobile-quiet-row', { hasText: 'Diagnostics' }).click()
  await page.waitForTimeout(300)
  check('Clusters opens the diagnostics panel on mobile', await page.locator('.diag-panel').isVisible())
  const diag = await page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('.diag-row')].map(r => [
      r.querySelector('.diag-key').textContent,
      r.querySelector('.diag-val').textContent,
    ])))
  check('...and names the build it is running',
    /\S+ · \d{4}-\d{2}-\d{2}T/.test(diag.build ?? ''), diag.build)
  check('...and reports the readings the fix turns on',
    diag.standalone === 'false'
    && diag['measured shortfall'] === '0px'
    && diag['correction applied'] === 'false'
    && (diag['overflow html / body / #root'] ?? '').split('/').every(v => !v.includes('hidden')),
    JSON.stringify({ standalone: diag.standalone, shortfall: diag['measured shortfall'] }))
  check('...and measures the capture bar as the bottom-edge canary',
    /^\d+ of \d+$/.test(diag['capture bar bottom'] ?? ''), diag['capture bar bottom'])
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  check('Esc closes the diagnostics panel', !(await page.locator('.diag-panel').isVisible()))

  check('No console errors (mobile)', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

// ── desktop ───────────────────────────────────────────────────────────────
{
  const { ctx, page, errors } = await session({ width: 1280, height: 860 }, false)
  check('Desktop still renders the galaxy', await page.locator('.glob').first().isVisible())
  check('Desktop clusters render', (await page.locator('.cluster').count()) >= 2)
  check('Desktop capture bar has the mic', await page.locator('.capture-mic').isVisible())
  check('Undo bar hidden with no history', (await page.locator('.undo-redo-bar').count()) === 0)

  // The mobile additions reflect back: due chips on rows and globs.
  check('Cluster item wears its due-chip',
    await page.locator('.cluster-glob-item .due-chip').first().isVisible())
  check('Free glob wears its due-chip',
    await page.locator('.glob .due-chip').first().isVisible())
  check('Priority colors the desktop todo-check',
    await page.locator('.todo-check.p2').first().isVisible())

  // Schedule from the context menu.
  await page.locator('.cluster-glob-item', { hasText: 'order degreaser' }).click({ button: 'right' })
  await page.waitForTimeout(300)
  check('Glob context menu offers Due date + Priority',
    await page.locator('.ctx-menu button', { hasText: 'Due date' }).isVisible()
    && await page.locator('.ctx-menu button', { hasText: 'Priority' }).isVisible())
  await page.locator('.ctx-menu button', { hasText: 'Due date' }).click()
  await page.waitForTimeout(250)
  await page.locator('.schedule-popover button', { hasText: 'Today' }).click()
  const s = await readState(page)
  check('Desktop schedule popover sets the date',
    s.globs.find(g => g.id === 'g7')?.dueDate === TODAY)

  // ── the agenda dock: desktop's answer to the phone's Today tab ──
  // Seed has one overdue + two due today; the popover above just added a third.
  check('Agenda badge counts overdue + today',
    (await page.locator('.agenda-badge').innerText()) === '4',
    await page.locator('.agenda-badge').innerText())

  await page.locator('.agenda-toggle').click()
  await page.waitForTimeout(400)
  check('Agenda panel opens', await page.locator('.agenda-panel').isVisible())
  check('Agenda splits overdue from today',
    await page.locator('.agenda-section-head.is-overdue').isVisible()
    && await page.locator('.agenda-section-head.is-today').isVisible())
  check('A task scheduled from the context menu lands in the agenda',
    await page.locator('.agenda-row-text', { hasText: 'order degreaser' }).isVisible())
  check('Agenda names the cluster a task lives in',
    await page.locator('.agenda-row-cluster', { hasText: 'work stuff' }).first().isVisible())
  check('Undated thoughts stay off the agenda',
    !(await page.locator('.agenda-row-text', { hasText: 'podcast about attention' }).isVisible()))

  // It is a dock, not a menu: working the galaxy must not dismiss it.
  await page.mouse.click(620, 780)
  await page.waitForTimeout(300)
  check('The dock survives a click on the galaxy',
    await page.locator('.agenda-panel').isVisible())

  // Ticking a row off completes the task and drops it from the agenda.
  await page.locator('.agenda-row', { hasText: 'water the ficus' }).locator('.todo-check').click()
  await page.waitForTimeout(400)
  check('Ticking an agenda row completes the task',
    !(await page.locator('.agenda-row-text', { hasText: 'water the ficus' }).isVisible())
    && (await page.locator('.agenda-badge').innerText()) === '3')

  // Clicking a row flies to the glob: its cluster expands and it pulses.
  await page.locator('.agenda-row', { hasText: 'gutter guards' }).click()
  await page.waitForTimeout(500)
  check('Clicking an agenda row highlights the glob in the galaxy',
    await page.locator('.cluster-glob-item.highlight-pulse').first().isVisible())

  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check('Esc closes the dock', (await page.locator('.agenda-panel').count()) === 0)

  // ── right-click on open canvas asks glob-or-cluster first ──
  // Physics keeps things drifting, so find a point that is really bare galaxy.
  const bare = await page.evaluate(() => {
    for (const [x, y] of [[1000, 650], [1120, 180], [160, 650], [620, 120], [1000, 300]]) {
      if (document.elementFromPoint(x, y)?.classList.contains('galaxy')) return { x, y }
    }
    return null
  })
  check('Found bare canvas to right-click', !!bare)
  await page.mouse.click(bare.x, bare.y, { button: 'right' })
  await page.waitForTimeout(250)
  check('Right-click on empty space opens the glob/cluster picker',
    await page.locator('.spawn-menu button', { hasText: 'glob' }).isVisible()
    && await page.locator('.spawn-menu button', { hasText: 'cluster' }).isVisible())
  await page.locator('.spawn-menu button', { hasText: 'cluster' }).click()
  await page.waitForTimeout(300)
  check('"cluster" spawns one straight into rename mode',
    await page.evaluate(() => document.activeElement?.classList.contains('cluster-name-edit')))
  await page.keyboard.type('garage')
  await page.keyboard.press('Enter')
  let d = await readState(page)
  check('...and it is a named, empty cluster',
    d.clusters.some(c => c.name === 'garage' && c.globIds.length === 0))

  // ── a free glob made a to-do gets its own cluster, so the checkbox exists ──
  const clustersBeforeWrap = d.clusters.length
  // Dispatched rather than clicked: the glob drifts under the physics loop and
  // can pass beneath a cluster card, so a coordinate right-click is a coin flip.
  // This still runs the glob's own onContextMenu → openGlobMenu path.
  const pwGlob = page.locator('.glob', { hasText: 'pressure-wash' })
  const pw = await pwGlob.boundingBox()
  await pwGlob.dispatchEvent('contextmenu', {
    button: 2, clientX: pw.x + pw.width / 2, clientY: pw.y + pw.height / 2,
  })
  await page.waitForTimeout(300)
  await page.locator('.ctx-menu button', { hasText: 'Make todo' }).click()
  await page.waitForTimeout(400)
  d = await readState(page)
  const wrapped = d.globs.find(g => g.id === 'g2')
  check('Make todo on a free glob wraps it in a one-member cluster',
    wrapped?.isTodo === true && !!wrapped?.clusterId
    && d.clusters.length === clustersBeforeWrap + 1
    && d.clusters.find(c => c.id === wrapped.clusterId)?.globIds.join() === 'g2')
  check('...where its checkbox is actually visible',
    await page.locator('.cluster-glob-item', { hasText: 'pressure-wash' }).locator('.todo-check').isVisible())

  // ── cluster ✕ offers two actions, no yes/no ──
  // The one-member cluster "Make todo" just built around the pressure-wash glob.
  const wrap = page.locator('.cluster', { hasText: 'pressure-wash' })
  await wrap.locator('.cluster-actions button').last().click()
  await page.waitForTimeout(250)
  check('Cluster ✕ offers release | destroy',
    JSON.stringify(await wrap.locator('.dissolve-confirm button').allInnerTexts()) === '["release","destroy"]')
  await page.waitForTimeout(250) // destroy ignores a double-click's second click
  await wrap.locator('.dissolve-destroy').click()
  d = await readState(page)
  check('Destroy removes the cluster and its globs',
    !d.clusters.some(c => c.globIds.includes('g2')) && !d.globs.some(g => g.id === 'g2'))
  await page.keyboard.press('Control+z')
  d = await readState(page)
  check('...and a single undo brings both back',
    d.globs.some(g => g.id === 'g2' && g.clusterId) && d.clusters.some(c => c.globIds.join() === 'g2'))

  // ── a collapsed cluster opens on a plain click ──
  const work = page.locator('.cluster[data-cluster-id="c1"]')
  await work.locator('.cluster-actions button').first().click()
  await page.waitForTimeout(300)
  check('− collapses a cluster', (await work.getAttribute('class')).includes('collapsed'))
  await work.locator('.cluster-name').click()
  await page.waitForTimeout(300)
  check('Clicking a collapsed cluster expands it',
    !(await work.getAttribute('class')).includes('collapsed')
    && (await page.locator('.cluster-name-edit').count()) === 0)

  // Same panel, reached through the `?` panel's backup section.
  await page.locator('.help-trigger').click()
  await page.waitForTimeout(250)
  await page.locator('.help-action-btn', { hasText: 'version history' }).click()
  await page.waitForTimeout(300)
  check('The desktop help panel opens the same backups panel',
    await page.locator('.backups-panel').isVisible())
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  check('...and Esc closes it',
    await page.locator('.backups-panel').count() === 0)

  check('No console errors (desktop)', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
