/**
 * Drives the marquee → group-drag flow end to end.
 * node scripts/group-drag-check.mjs   (needs: npm i --no-save playwright-core)
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

// Vite picks the next free port if 5173 is taken; override with PORT=5174.
const URL = `http://localhost:${process.env.PORT ?? 5173}/adhdo/`
mkdirSync('shots', { recursive: true })
const now = Date.now()

// Free globs are laid out in a row up top so a marquee can sweep them; the
// cluster sits well clear of them, lower right.
const globs = [
  { id: 'g1', text: 'call the arborist', x: 220, y: 200 },
  { id: 'g2', text: 'trailer tabs', x: 420, y: 200 },
  { id: 'g3', text: 'dinosaur party place', x: 620, y: 200 },
  { id: 'g4', text: 'unrelated thought', x: 260, y: 640 },
].map(g => ({
  ...g, vx: 0, vy: 0, radius: 40, color: '#a78bfa',
  flagged: false, isTodo: false, done: false, clusterId: null, createdAt: now,
}))

const state = {
  globs: [
    ...globs,
    { id: 'g5', text: 'gutter guards', x: 0, y: 0, vx: 0, vy: 0, radius: 40, color: '#22d3ee', flagged: false, isTodo: true, done: false, clusterId: 'c1', createdAt: now },
  ],
  clusters: [{ id: 'c1', name: 'work stuff', x: 1000, y: 560, vx: 0, vy: 0, color: '#22d3ee', globIds: ['g5'], collapsed: false, lastInteraction: now }],
  connections: [],
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge' })

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 })
  await ctx.addInitScript(s => {
    localStorage.setItem('adhdo-galaxy', JSON.stringify(s))
    localStorage.setItem('adhdo-seen-onboarding-v1', '1')
  }, state)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(URL)
  await page.waitForTimeout(800)
  return { ctx, page, errors }
}

const readState = async page => {
  await page.waitForTimeout(2400)
  return page.evaluate(() => JSON.parse(localStorage.getItem('adhdo-galaxy')))
}

/** Enter marquee mode and rubber-band the three globs across the top. */
async function selectTopThree(page) {
  // Click the tool, don't press 'm' — the capture bar autofocuses, so the
  // keystroke would just type into it.
  await page.locator('[aria-label="Marquee select tool"]').click()
  await page.waitForTimeout(200)
  await page.mouse.move(120, 120)
  await page.mouse.down()
  await page.mouse.move(400, 200, { steps: 5 })
  await page.mouse.move(760, 300, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

/** Centre of a selected glob, to start the carry from. */
const grabPoint = async page => {
  const box = await page.locator('.glob.selected, .glob-selected, [data-glob-id].selected').first().boundingBox()
    .catch(() => null)
  if (box) return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const el = await page.locator('[data-glob-id="g2"]').first().boundingBox()
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 }
}

// ── A. drop on empty space → naming modal → new cluster ───────────────────
{
  const { ctx, page, errors } = await open()
  await selectTopThree(page)
  const selected = await page.evaluate(() => document.querySelectorAll('.glob.selected').length)
  check('Marquee selected the three globs', selected === 3, `${selected} selected`)

  const from = await grabPoint(page)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y + 60, { steps: 4 })
  await page.mouse.move(500, 480, { steps: 8 })
  await page.waitForTimeout(150)
  check('Ghost follows the cursor', await page.locator('.group-ghost').isVisible())
  check('Ghost shows the count', (await page.locator('.group-ghost-count').innerText()) === '3')
  await page.screenshot({ path: 'shots/group-drag-empty.png' })

  await page.mouse.up()
  await page.waitForTimeout(300)
  check('Dropping on empty space asks for a name', await page.locator('.shake-modal').isVisible())
  await page.screenshot({ path: 'shots/group-drag-prompt.png' })

  await page.locator('.merge-name-input').fill('spring jobs')
  await page.locator('.shake-modal-yes').click()
  await page.waitForTimeout(400)

  const s = await readState(page)
  const made = s.clusters.find(c => c.name === 'spring jobs')
  check('New cluster created with the given name', !!made)
  check('It holds all three thoughts', made?.globIds.length === 3, `${made?.globIds.length}`)
  check('Those globs now point at it', ['g1', 'g2', 'g3'].every(id =>
    s.globs.find(g => g.id === id)?.clusterId === made?.id))
  check('The unselected glob was left alone',
    s.globs.find(g => g.id === 'g4')?.clusterId === null)
  check('Cluster landed near the drop point',
    made && Math.hypot(made.x - 500, made.y - 480) < 60, made ? `${made.x},${made.y}` : 'n/a')
  await page.screenshot({ path: 'shots/group-drag-result.png' })
  check('No console errors (drop on empty)', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

// ── B. drop onto an existing cluster → items filed, no prompt ─────────────
{
  const { ctx, page, errors } = await open()
  await selectTopThree(page)

  const target = await page.locator('.cluster[data-cluster-id="c1"]').boundingBox()
  const drop = { x: target.x + target.width / 2, y: target.y + target.height / 2 }

  const from = await grabPoint(page)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y + 40, { steps: 4 })
  await page.mouse.move(drop.x, drop.y, { steps: 10 })
  await page.waitForTimeout(200)
  check('Target cluster lights up', (await page.locator('.cluster.group-target').count()) === 1)
  check('Ghost says it will file there',
    (await page.locator('.group-ghost-label').innerText()).includes('file here'))
  await page.screenshot({ path: 'shots/group-drag-over-cluster.png' })

  await page.mouse.up()
  await page.waitForTimeout(400)
  check('No naming prompt when dropping on a cluster',
    (await page.locator('.shake-modal').count()) === 0)

  const s = await readState(page)
  const c1 = s.clusters.find(c => c.id === 'c1')
  check('All three were filed into the cluster', c1.globIds.length === 4, `${c1.globIds.length} items`)
  check('Filed globs point at the cluster', ['g1', 'g2', 'g3'].every(id =>
    s.globs.find(g => g.id === id)?.clusterId === 'c1'))
  check('Original member kept', c1.globIds.includes('g5'))
  check('Selection cleared after the drop',
    (await page.evaluate(() => document.querySelectorAll('.glob.selected').length)) === 0)
  await page.screenshot({ path: 'shots/group-drag-filed.png' })
  check('No console errors (drop on cluster)', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

// ── C. a plain marquee still works (no regression) ────────────────────────
{
  const { ctx, page, errors } = await open()
  await selectTopThree(page)
  check('Rubber band still selects', (await page.evaluate(() => document.querySelectorAll('.glob.selected').length)) === 3)
  // Dragging from empty space must draw a new box, not carry the selection.
  await page.mouse.move(200, 730)
  await page.mouse.down()
  await page.mouse.move(340, 800, { steps: 5 })
  check('Drag from empty space draws a marquee, not a ghost',
    (await page.locator('.group-ghost').count()) === 0)
  check('A rubber band is drawn instead', (await page.locator('.marquee-rect').count()) === 1)
  await page.mouse.up()
  await page.waitForTimeout(300)
  // Replace semantics: the new (empty) box drops the previous selection. The
  // point is that it re-selected rather than carrying the old selection away.
  check('The new box replaced the old selection',
    (await page.evaluate(() => document.querySelectorAll('.glob.selected').length)) !== 3)
  check('No console errors (marquee regression)', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
