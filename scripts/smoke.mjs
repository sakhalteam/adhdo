/**
 * Functional smoke test against the running dev server: node scripts/smoke.mjs
 * Needs a driver first: npm i --no-save playwright-core
 *
 * Mobile is the Todoist-shaped app (tabs, quick add, swipe gestures); desktop
 * is the galaxy plus the due-date/priority reflection.
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
{
  const { ctx, page, errors } = await session({ width: 390, height: 844 }, true)

  // 1. Today tab: overdue + today sections from due dates.
  check('Today shows the overdue task',
    await page.locator('.mobile-group-head.is-overdue').isVisible()
    && await page.locator('.mobile-task-text', { hasText: 'renew the trailer tabs' }).isVisible())
  check('Today shows tasks due today',
    await page.locator('.mobile-task-text', { hasText: 'water the ficus' }).isVisible()
    && await page.locator('.mobile-task-text', { hasText: 'gutter guards' }).isVisible())
  check('Today tab badge counts overdue + today',
    (await page.locator('.mobile-tab-badge').innerText()) === '3')
  check('Priority colors the checkbox', await page.locator('.mobile-check.p1').isVisible())
  check('Overdue row wears an overdue due-chip',
    await page.locator('.due-chip.overdue', { hasText: 'Yesterday' }).isVisible())
  check('Rows outside a project view show their project',
    await page.locator('.mobile-task-proj', { hasText: 'work stuff' }).isVisible())

  // 2. Checkbox completes a task (it leaves the Today list).
  await page.locator('.mobile-task', { hasText: 'water the ficus' }).locator('.mobile-check').click()
  await page.waitForTimeout(400)
  let s = await readState(page)
  check('Tapping the circle completes the task',
    s.globs.find(g => g.id === 'g5')?.done === true
    && !(await page.locator('.mobile-task-text', { hasText: 'water the ficus' }).isVisible()))

  // 3. Quick add FAB with natural-language date + priority.
  check('Mic rides in the FAB stack', await page.locator('.mobile-fab-stack .capture-mic').isVisible())
  await page.locator('.mobile-fab').click()
  await page.waitForTimeout(350)
  await page.locator('.mobile-qa-input').fill('brand new thought from the pass tomorrow p1')
  check('Quick add parses "tomorrow" into the date chip live',
    await page.locator('.mobile-qa-chip', { hasText: 'Tomorrow' }).isVisible())
  await page.locator('.mobile-qa-input').press('Enter')
  await page.waitForTimeout(300)
  check('Quick add stays open for rapid fire',
    await page.locator('.mobile-qa-input').isVisible()
    && (await page.locator('.mobile-qa-input').inputValue()) === '')
  await closeSheet(page)
  s = await readState(page)
  const added = s.globs.find(g => g.text === 'brand new thought from the pass')
  check('NL tokens lift out: due tomorrow, P1, a to-do',
    added?.dueDate === TOMORROW && added?.priority === 1 && added?.isTodo === true,
    JSON.stringify({ due: added?.dueDate, prio: added?.priority }))

  // 4. Upcoming groups by date.
  await page.locator('.mobile-tab', { hasText: 'Upcoming' }).click()
  await page.waitForTimeout(300)
  check('Upcoming shows the tomorrow group',
    await page.locator('.mobile-group-head', { hasText: 'Tomorrow' }).isVisible()
    && await page.locator('.mobile-task-text', { hasText: 'brand new thought' }).isVisible())

  // 5. Search reaches everything — including the repaired orphan.
  await page.locator('.mobile-tab', { hasText: 'Search' }).click()
  await page.waitForTimeout(300)
  check('State repair: orphaned glob is rendered, not lost',
    await page.locator('.mobile-task-text', { hasText: 'ORPHANED THOUGHT' }).isVisible())
  await page.locator('.mobile-search input').fill('degreaser')
  await page.waitForTimeout(400)
  check('Search narrows to matches', (await page.locator('.mobile-task').count()) === 1,
    `${await page.locator('.mobile-task').count()} rows`)
  await page.locator('.mobile-search input').fill('')
  await page.waitForTimeout(200)
  await page.locator('.mobile-chip', { hasText: 'Flagged' }).click()
  await page.waitForTimeout(300)
  check('Flagged filter works', (await page.locator('.mobile-task').count()) === 1)
  await page.locator('.mobile-chip', { hasText: 'All' }).click()

  // 6. Browse: inbox + projects with drill-in.
  await page.locator('.mobile-tab', { hasText: 'Browse' }).click()
  await page.waitForTimeout(300)
  check('Browse lists Inbox and the projects',
    await page.locator('.mobile-browse-row', { hasText: 'Inbox' }).isVisible()
    && await page.locator('.mobile-browse-row', { hasText: 'work stuff' }).isVisible()
    && await page.locator('.mobile-browse-row', { hasText: 'side projects' }).isVisible())

  await page.locator('.mobile-browse-row', { hasText: 'work stuff' }).click()
  await page.waitForTimeout(300)
  check('Project view opens with its tasks',
    await page.locator('.mobile-proj-title', { hasText: 'work stuff' }).isVisible()
    && await page.locator('.mobile-task-text', { hasText: 'order degreaser' }).isVisible())

  // 7. Task detail sheet: set priority.
  await page.locator('.mobile-task', { hasText: 'order degreaser' }).click()
  await page.waitForTimeout(350)
  check('Tapping a row opens its detail sheet',
    await page.locator('.mobile-detail-text').isVisible())
  await page.locator('.mobile-prio-btn', { hasText: 'P2' }).click()
  await page.waitForTimeout(200)
  await closeSheet(page)
  s = await readState(page)
  check('Detail sheet sets priority', s.globs.find(g => g.id === 'g7')?.priority === 2)

  // 8. Swipe left → schedule sheet; pick tomorrow.
  const gutter = page.locator('.mobile-task', { hasText: 'gutter guards' })
  let box = await gutter.boundingBox()
  await page.mouse.move(box.x + box.width - 60, box.y + box.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box.x + box.width - 60 - i * 14, box.y + box.height / 2)
  }
  await page.mouse.up()
  await page.waitForTimeout(400)
  check('Swipe left opens the schedule sheet',
    await page.locator('.mobile-sheet-row', { hasText: 'Tomorrow' }).isVisible())
  await page.locator('.mobile-sheet-row', { hasText: 'Tomorrow' }).click()
  await page.waitForTimeout(300)
  s = await readState(page)
  check('Schedule sheet sets the due date', s.globs.find(g => g.id === 'g6')?.dueDate === TOMORROW)

  // 9. Swipe right → complete; lands under the Completed toggle.
  box = await gutter.boundingBox()
  await page.mouse.move(box.x + 40, box.y + box.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box.x + 40 + i * 14, box.y + box.height / 2)
  }
  await page.mouse.up()
  await page.waitForTimeout(500)
  s = await readState(page)
  check('Swipe right completes the task', s.globs.find(g => g.id === 'g6')?.done === true)
  check('Completed tasks fold away in the project view',
    await page.locator('.mobile-completed-toggle', { hasText: 'Completed' }).isVisible()
    && !(await page.locator('.mobile-task-text', { hasText: 'gutter guards' }).isVisible()))
  await page.locator('.mobile-completed-toggle').click()
  await page.waitForTimeout(200)
  check('Completed toggle reveals them',
    await page.locator('.mobile-task-text', { hasText: 'gutter guards' }).isVisible())

  // 10. A vertical scroll must not swipe anything.
  const beforeScroll = (await readState(page)).globs
  const t2 = await page.locator('.mobile-task').first().boundingBox()
  await page.mouse.move(t2.x + t2.width / 2, t2.y + t2.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    // Drift sideways while mostly moving down, like a real thumb.
    await page.mouse.move(t2.x + t2.width / 2 - i * 4, t2.y + t2.height / 2 + i * 18)
  }
  await page.mouse.up()
  await page.waitForTimeout(400)
  const afterScroll = (await readState(page)).globs
  check('A drifting vertical scroll changes nothing',
    JSON.stringify(afterScroll.map(g => [g.id, g.done, g.dueDate]))
    === JSON.stringify(beforeScroll.map(g => [g.id, g.done, g.dueDate])))

  // 11. Long-press → select mode → bulk move → single undo.
  const row = page.locator('.mobile-task', { hasText: 'order degreaser' })
  box = await row.boundingBox()
  await page.mouse.move(box.x + 140, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()
  await page.waitForTimeout(250)
  check('Long-press enters select mode', await page.locator('.bulk-bar').isVisible())
  await page.locator('.mobile-task', { hasText: 'gutter guards' }).click()
  await page.waitForTimeout(200)
  check('Tapping adds to the selection',
    (await page.locator('.mobile-select-count').innerText()).startsWith('2'))
  await page.locator('.bulk-btn', { hasText: 'Move…' }).click()
  await page.waitForTimeout(300)
  await page.locator('.mobile-sheet-row', { hasText: 'side projects' }).click()
  await page.waitForTimeout(500)
  s = await readState(page)
  check('Bulk move filed both into the target project',
    s.clusters.find(c => c.id === 'c2')?.globIds.length === 2)
  check('Select mode exits after the batch', !(await page.locator('.bulk-bar').isVisible()))
  await page.locator('.undo-redo-btn').first().click()
  await page.waitForTimeout(600)
  s = await readState(page)
  check('A single undo reverses the whole batch',
    s.clusters.find(c => c.id === 'c2')?.globIds.length === 0)

  // 12. New project from Browse.
  await page.locator('.mobile-tab', { hasText: 'Browse' }).click()
  await page.waitForTimeout(300)
  await page.locator('.mobile-browse-row.is-add').click()
  await page.waitForTimeout(300)
  await page.locator('.mobile-sheet .mobile-qa-input').fill('reading list')
  await page.locator('.mobile-prompt-btn', { hasText: 'Create' }).click()
  await page.waitForTimeout(400)
  s = await readState(page)
  check('Add project creates an empty cluster',
    s.clusters.some(c => c.name === 'reading list')
    && await page.locator('.mobile-browse-row', { hasText: 'reading list' }).isVisible())

  // 13. Making an Inbox thought a to-do keeps it in the Inbox. Desktop wraps a
  // free glob in a cluster (it has no checkbox out there); the phone must not,
  // or every Inbox to-do would get filed into a project called "new cluster".
  const clustersBeforeTodo = s.clusters.length
  await page.locator('.mobile-browse-row', { hasText: 'Inbox' }).click()
  await page.waitForTimeout(300)
  await page.locator('.mobile-task', { hasText: 'call the arborist' }).click()
  await page.waitForTimeout(350)
  await page.locator('.mobile-detail-row', { hasText: 'Make a to-do' }).click()
  await page.waitForTimeout(200)
  await closeSheet(page)
  s = await readState(page)
  const arborist = s.globs.find(g => g.id === 'g1')
  check('Making an Inbox thought a to-do keeps it in the Inbox',
    arborist?.isTodo === true && arborist?.clusterId === null
    && s.clusters.length === clustersBeforeTodo)

  // Backups reachable from the phone — the point of putting the panel in
  // shared chrome is that the device to hand is the one that has it.
  await page.locator('.mobile-tab', { hasText: 'Browse' }).click()
  await page.waitForTimeout(300)
  await page.locator('.mobile-browse-row', { hasText: 'Backups' }).click()
  await page.waitForTimeout(300)
  check('Browse opens the backups panel on mobile',
    await page.locator('.backups-panel').isVisible())
  check('...which offers the export file when signed out',
    await page.locator('.backups-btn', { hasText: 'export' }).isVisible())
  check('...and says version history needs a sign-in',
    (await page.locator('.backups-note').first().textContent() ?? '').length > 0
    && await page.locator('.backups-note', { hasText: 'Sign in' }).isVisible())

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
