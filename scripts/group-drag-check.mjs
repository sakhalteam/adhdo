/**
 * Drives the (modeless) rubber band → group-drag flow end to end.
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

/**
 * Rubber-band the three globs across the top. There is no tool to pick and no
 * mode to enter any more — dragging from bare galaxy background IS the gesture.
 */
async function selectTopThree(page) {
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
  check('Drag from empty space draws a band, not a ghost',
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

// ── D. carry the selection onto the trash → one confirm deletes them all ──
{
  const { ctx, page, errors } = await open()
  await selectTopThree(page)

  const from = await grabPoint(page)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y + 40, { steps: 4 })
  // The trash zone sits at the bottom-right (see src/trashZone.ts).
  const trash = await page.evaluate(() => ({
    x: window.innerWidth - 24 - 28,
    y: window.innerHeight - 80 - 28,
  }))
  await page.mouse.move(trash.x, trash.y, { steps: 10 })
  await page.waitForTimeout(200)
  check('Trash zone appears during a group drag', await page.locator('.trash-zone.visible').isVisible())
  check('Ghost says it will delete them all',
    (await page.locator('.group-ghost-label').innerText()).includes('delete'))
  await page.screenshot({ path: 'shots/group-drag-trash.png' })

  await page.mouse.up()
  await page.waitForTimeout(300)
  check('One toast for the whole selection',
    (await page.locator('.trash-toast-label').innerText()).includes('3 thoughts'))
  await page.locator('.trash-toast-btn').click()
  await page.waitForTimeout(300)

  const s = await readState(page)
  check('All three selected thoughts are gone',
    ['g1', 'g2', 'g3'].every(id => !s.globs.some(g => g.id === id)),
    `${s.globs.length} left`)
  check('The unselected thought survived', s.globs.some(g => g.id === 'g4'))
  check('No console errors (trash the selection)', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

// ── E. cluster-item extras: grip double-click, clear completed ────────────
{
  const { ctx, page, errors } = await open()
  const item = page.locator('.cluster[data-cluster-id="c1"] [data-glob-id="g5"]')

  // g5 seeds as a to-do; double-clicking its grip should toggle it back off.
  await item.locator('.cluster-glob-grip').dblclick()
  await page.waitForTimeout(200)
  check('Double-clicking the grip toggles to-do off',
    (await item.locator('.todo-check').count()) === 0)
  check('...and does not open the editor',
    (await item.locator('input.glob-edit').count()) === 0)

  await item.locator('.cluster-glob-grip').dblclick()
  await page.waitForTimeout(200)
  check('Double-clicking again makes it a to-do', (await item.locator('.todo-check').count()) === 1)

  // Nothing is ticked off yet, so the sweep must be offered but inert.
  await page.locator('.cluster[data-cluster-id="c1"] .cluster-drag-handle').click({ button: 'right' })
  await page.waitForTimeout(200)
  const sweep = page.locator('.ctx-menu button', { hasText: 'Clear completed' })
  check('Clear completed is offered on a cluster', (await sweep.count()) === 1)
  check('...and is inert with nothing completed', await sweep.isDisabled())
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  await item.locator('.todo-check').click()
  await page.waitForTimeout(200)
  await page.locator('.cluster[data-cluster-id="c1"] .cluster-drag-handle').click({ button: 'right' })
  await page.waitForTimeout(200)
  const armed = page.locator('.ctx-menu button', { hasText: 'Clear completed' })
  check('It counts what it will sweep', (await armed.innerText()).includes('(1)'))
  await armed.click()
  await page.waitForTimeout(300)

  const s = await readState(page)
  check('The done to-do is gone', !s.globs.some(g => g.id === 'g5'))
  check('The cluster no longer lists it',
    !s.clusters.find(c => c.id === 'c1').globIds.includes('g5'))
  check('No console errors (item extras)', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

// ── F. modeless routing: the band must not steal anyone else's drag ───────
{
  const { ctx, page, errors } = await open()
  const selCount = () => page.evaluate(() => document.querySelectorAll('[data-glob-id].selected').length)
  const band = async (x1, y1, x2, y2, mod) => {
    if (mod) await page.keyboard.down(mod)
    await page.mouse.move(x1, y1)
    await page.mouse.down()
    await page.mouse.move(x2, y2, { steps: 8 })
    await page.mouse.up()
    if (mod) await page.keyboard.up(mod)
    await page.waitForTimeout(250)
  }

  // Selection first, while the three globs are still in their seeded row.
  await band(120, 120, 520, 300)
  check('Plain band selects', (await selCount()) === 2, `${await selCount()}`)
  await band(560, 120, 760, 300, 'Shift')
  check('Shift+band adds', (await selCount()) === 3, `${await selCount()}`)
  await band(380, 130, 470, 280, 'Control')
  check('Ctrl+band removes', (await selCount()) === 2, `${await selCount()}`)

  // The bulk menu used to hang off the full-screen overlay; free globs now
  // carry the rule themselves.
  const gb = await page.locator('[data-glob-id="g1"]').boundingBox()
  await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2, { button: 'right' })
  await page.waitForTimeout(200)
  check('Right-click a selected free glob opens the bulk menu',
    (await page.locator('.ctx-menu').innerText()).includes('items selected'))
  check('Opening the bulk menu kept the selection', (await selCount()) === 2)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('Esc clears the selection', (await selCount()) === 0)

  await band(120, 120, 520, 300)
  await page.mouse.click(300, 760)
  await page.waitForTimeout(200)
  check('A plain click on empty space clears', (await selCount()) === 0)

  // Now the drags, which move things out from under the band.
  // Positions live only in the DOM here: stateSignature ignores x/y, so a drag
  // on its own never reaches localStorage.
  await page.mouse.move(220, 200)
  await page.mouse.down()
  await page.mouse.move(300, 380, { steps: 8 })
  await page.mouse.up()
  const moved = await page.locator('[data-glob-id="g1"]').boundingBox()
  check('A lone glob still drags', Math.abs(moved.y + moved.height / 2 - 200) > 100)
  check('No band was drawn under it', (await page.locator('.marquee-rect').count()) === 0)

  const handle = await page.locator('.cluster[data-cluster-id="c1"] .cluster-drag-handle').boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(700, 300, { steps: 8 })
  await page.mouse.up()
  const card = await page.locator('.cluster[data-cluster-id="c1"]').boundingBox()
  check('A cluster still drags', Math.abs(card.x + card.width / 2 - 1000) > 50)

  await page.mouse.click(300, 760, { button: 'right' })
  await page.waitForTimeout(200)
  check('Right-click empty space still offers a new thought',
    await page.locator('.new-glob-input input').isVisible())
  check('No console errors (modeless routing)', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

// ── G. one shared breathing clock, whatever joins the selection ───────────
{
  const { ctx, page, errors } = await open()
  const breath = () => page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('.galaxy')).getPropertyValue('--breath')))

  check('Clock is idle with nothing selected', (await page.locator('.galaxy.breathing').count()) === 0)
  await selectTopThree(page)
  check('Clock is running', (await page.locator('.galaxy.breathing').count()) === 1)

  const samples = []
  for (let i = 0; i < 5; i++) { samples.push(await breath()); await page.waitForTimeout(320) }
  check('--breath animates', new Set(samples.map(v => v.toFixed(3))).size >= 4,
    samples.map(v => v.toFixed(2)).join(' '))
  check('--breath stays in 0..1', samples.every(v => v >= 0 && v <= 1))

  // A bad color-mix calc would silently collapse the glow to `none`.
  const shadow = await page.evaluate(() => getComputedStyle(document.querySelector('.glob.selected')).boxShadow)
  check('The glow actually resolves', shadow !== 'none' && shadow.length > 20)
  await page.waitForTimeout(900)
  check('...and moves with the clock',
    (await page.evaluate(() => getComputedStyle(document.querySelector('.glob.selected')).boxShadow)) !== shadow)

  const before = await breath()
  await page.keyboard.down('Shift')
  await page.mouse.move(180, 560)
  await page.mouse.down()
  await page.mouse.move(400, 720, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await page.waitForTimeout(60)
  check('Shift+band added a fourth', (await page.evaluate(() =>
    document.querySelectorAll('[data-glob-id].selected').length)) === 4)
  check('Adding a sister did not reset the rhythm', Math.abs((await breath()) - before) < 0.25)
  check('Everything selected reads one shared phase', (await page.evaluate(() =>
    new Set([...document.querySelectorAll('[data-glob-id].selected')]
      .map(el => getComputedStyle(el).getPropertyValue('--breath').trim())).size)) === 1)
  check('No console errors (breathing)', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
}

// ── H. the handle gutter: double-click either edge of a row → to-do ───────
{
  const rowSeed = {
    globs: [
      { id: 'r1', text: 'asdf', x: 0, y: 0, vx: 0, vy: 0, radius: 40, color: '#f472b6', flagged: false, isTodo: false, done: false, clusterId: 'k1', createdAt: now },
      { id: 'r2', text: 'a much longer thought that wraps onto two lines in the card', x: 0, y: 0, vx: 0, vy: 0, radius: 40, color: '#f472b6', flagged: false, isTodo: false, done: false, clusterId: 'k1', createdAt: now },
    ],
    clusters: [{ id: 'k1', name: 'gutter', x: 500, y: 400, vx: 0, vy: 0, color: '#8b5cf6', globIds: ['r1', 'r2'], collapsed: false, lastInteraction: now }],
    connections: [],
  }
  const c = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  await c.addInitScript(seed => {
    localStorage.setItem('adhdo-galaxy', JSON.stringify(seed))
    localStorage.setItem('adhdo-seen-onboarding-v1', '1')
  }, rowSeed)
  const page = await c.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(URL)
  await page.waitForTimeout(800)

  const row = id => page.locator(`[data-glob-id="${id}"]`)
  const isTodo = async id => (await row(id).locator('.todo-check').count()) === 1
  const editing = async id => (await row(id).locator('input.glob-edit').count()) === 1
  /** Double-click x px in from the row's left edge; negative counts from the right. */
  const dbl = async (id, dx) => {
    const b = await row(id).boundingBox()
    await page.mouse.dblclick(dx >= 0 ? b.x + dx : b.x + b.width + dx, b.y + b.height / 2)
    await page.waitForTimeout(180)
  }
  /**
   * Assert the FLIP, not the absolute state. Once a row is a to-do the checkbox
   * occupies part of the left gutter, so "double-click the same spot again" is
   * not a valid way to reset between probes — the right square always is.
   */
  const flips = async (id, dx) => {
    const before = await isTodo(id)
    await dbl(id, dx)
    const after = await isTodo(id)
    if (before !== after) await dbl(id, -14)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    return before !== after
  }

  for (const dx of [3, 7, 14, 22, 30]) {
    check(`Left gutter converts at +${dx}px`, await flips('r1', dx))
  }
  for (const dx of [-4, -12, -22]) {
    check(`Right square converts at ${dx}px`, await flips('r1', dx))
  }
  check('Left gutter works on a wrapped row too', await flips('r2', 7))

  // On the words themselves the gesture must stay "edit these words".
  const mid = Math.round((await row('r1').boundingBox()).width / 2)
  const wasTodo = await isTodo('r1')
  await dbl('r1', mid)
  check('Mid-row is not a handle zone', (await isTodo('r1')) === wasTodo)
  check('...it opens the editor instead', await editing('r1'))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)

  const b = await row('r1').boundingBox()
  await page.mouse.click(b.x + 8, b.y + b.height / 2)
  await page.waitForTimeout(200)
  check('A single click in the gutter does not open the editor', !(await editing('r1')))
  await page.mouse.click(b.x + mid, b.y + b.height / 2)
  await page.waitForTimeout(200)
  check('A single click on the text still opens the editor', await editing('r1'))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)

  // The gutter reaches that far in only because `.cluster-edge-hit` was pulled
  // outward — so prove the border it belongs to is still grabbable.
  const k1 = await page.locator('.cluster').boundingBox()
  await page.mouse.move(k1.x - 4, k1.y + k1.height / 2)
  await page.mouse.down()
  await page.mouse.move(k1.x - 164, k1.y + k1.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  const k2 = await page.locator('.cluster').boundingBox()
  check('The cluster still drags by its left border', Math.abs(k2.x - k1.x) > 100,
    `${Math.round(k1.x)} -> ${Math.round(k2.x)}`)
  await page.mouse.move(k2.x + k2.width + 4, k2.y + k2.height / 2)
  await page.mouse.down()
  await page.mouse.move(k2.x + k2.width + 124, k2.y + k2.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  check('...and by its right border',
    Math.abs((await page.locator('.cluster').boundingBox()).x - k2.x) > 80)

  check('No console errors (handle gutter)', errors.length === 0, errors.slice(0, 3).join(' | '))
  await c.close()
}

await browser.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
