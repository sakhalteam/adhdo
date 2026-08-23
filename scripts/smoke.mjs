/**
 * Functional smoke test against the running dev server: node scripts/smoke.mjs
 * Needs a driver first: npm i --no-save playwright-core
 */
import { chromium } from 'playwright-core'

const URL = 'http://localhost:5174/adhdo/'
const now = Date.now()

let n = 0
const glob = (text, opts = {}) => ({
  id: `g${++n}`, text, x: 400, y: 300, color: '#a78bfa',
  flagged: false, isTodo: false, done: false, clusterId: null,
  createdAt: now - n * 60_000, ...opts,
})

const state = {
  globs: [
    glob('call the arborist about the maple'),
    glob('pressure-wash pricing tiers'),
    glob('jojo dinosaur birthday'),
    glob('renew the trailer tabs'),
    glob('podcast about attention', { flagged: true }),
    glob('gutter guards', { isTodo: true, clusterId: 'c1' }),
    glob('order degreaser', { isTodo: true, clusterId: 'c1' }),
    // Deliberately corrupt: claims c1, but c1 does not list it. Before
    // repairState this rendered in neither the unsorted list nor the cluster.
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

const browser = await chromium.launch({ channel: 'msedge' })

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

// ── mobile ────────────────────────────────────────────────────────────────
{
  const { ctx, page, errors } = await session({ width: 390, height: 844 }, true)

  // 1. State repair — the orphan must be visible somewhere.
  const orphanVisible = await page.locator('.mobile-item-text', { hasText: 'ORPHANED THOUGHT' }).isVisible()
  check('Orphaned glob is rendered, not lost', orphanVisible)

  // 2. Capture.
  await page.locator('.capture-input').fill('brand new thought from the pass')
  await page.locator('.capture-input').press('Enter')
  await page.waitForTimeout(400)
  check('Typed capture lands at the top of unsorted',
    (await page.locator('.mobile-item-text').first().innerText()).includes('brand new thought'))

  // 3. Mic button is offered (Chromium exposes webkitSpeechRecognition).
  check('Voice capture button is present', await page.locator('.capture-mic').isVisible())

  // 4. Long-press → select mode, then bulk file.
  const row = page.locator('.mobile-item').first()
  const box = await row.boundingBox()
  await page.mouse.move(box.x + 140, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()
  await page.waitForTimeout(250)
  check('Long-press enters select mode', await page.locator('.bulk-bar').isVisible())

  await page.locator('.mobile-item').nth(1).click()
  await page.waitForTimeout(200)
  check('Tapping adds to the selection',
    (await page.locator('.mobile-select-count').innerText()).startsWith('2'))

  await page.locator('.bulk-btn', { hasText: 'File…' }).click()
  await page.waitForTimeout(300)
  await page.locator('.mobile-sheet-row', { hasText: 'side projects' }).click()
  await page.waitForTimeout(500)

  let s = await readState(page)
  const c2 = s.clusters.find(c => c.id === 'c2')
  check('Bulk file moved both thoughts', c2.globIds.length === 2, `got ${c2.globIds.length}`)
  check('Filed globs point at the target cluster',
    c2.globIds.every(id => s.globs.find(g => g.id === id)?.clusterId === 'c2'))
  check('Select mode exits after filing', !(await page.locator('.bulk-bar').isVisible()))

  // 5. One undo reverses the whole batch.
  await page.locator('.undo-redo-btn').first().click()
  await page.waitForTimeout(600)
  s = await readState(page)
  check('A single undo reverses the whole batch',
    s.clusters.find(c => c.id === 'c2').globIds.length === 0)

  // 6. Search filters the list.
  await page.locator('.mobile-search input').fill('degreaser')
  await page.waitForTimeout(400)
  check('Search narrows to matches', (await page.locator('.mobile-item').count()) === 1,
    `${await page.locator('.mobile-item').count()} rows`)
  check('Search reaches inside clusters',
    (await page.locator('.mobile-item-text').first().innerText()).includes('degreaser'))
  await page.locator('.mobile-search input').fill('')
  await page.waitForTimeout(300)

  // 7. Filter chips.
  await page.locator('.mobile-chip', { hasText: 'Flagged' }).click()
  await page.waitForTimeout(400)
  check('Flagged filter works', (await page.locator('.mobile-item').count()) === 1)
  await page.locator('.mobile-chip', { hasText: 'All' }).click()
  await page.waitForTimeout(300)

  // 8. Swipe to delete.
  const before = (await readState(page)).globs.length
  const target = page.locator('.mobile-item').first()
  const tb = await target.boundingBox()
  await page.mouse.move(tb.x + tb.width - 40, tb.y + tb.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(tb.x + tb.width - 40 - i * 20, tb.y + tb.height / 2)
  }
  await page.mouse.up()
  await page.waitForTimeout(600)
  const after = (await readState(page)).globs.length
  check('Swipe-left deletes one row', after === before - 1, `${before} → ${after}`)

  // 9. A vertical scroll must not delete anything.
  const beforeScroll = (await readState(page)).globs.length
  const t2 = await page.locator('.mobile-item').first().boundingBox()
  await page.mouse.move(t2.x + t2.width / 2, t2.y + t2.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    // Drift sideways while mostly moving down, like a real thumb.
    await page.mouse.move(t2.x + t2.width / 2 - i * 4, t2.y + t2.height / 2 + i * 18)
  }
  await page.mouse.up()
  await page.waitForTimeout(400)
  check('A drifting vertical scroll deletes nothing',
    (await readState(page)).globs.length === beforeScroll)

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
  check('No console errors (desktop)', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
