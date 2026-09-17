/**
 * Sync reconciliation check: node scripts/sync-check.mjs
 *
 * No browser, no dev server, no dependencies — Node strips the types off
 * src/store.ts on import. The sync layer had exactly zero assertions on it
 * until a phone that captured five notes while signed out replaced the entire
 * cloud galaxy on sign-in, so this replays that morning end to end, and the
 * neighbouring cases a fix for it can easily break: a cross-device delete that
 * must stay deleted, an offline delete that must survive a merge, and the
 * no-common-ancestor fallback that would rather resurrect than lose.
 *
 * The decision under test is the real one (`planSync` / `reconcileWithRemote`
 * out of src/store.ts). Only App.tsx's few lines of executor are restated here,
 * in `deviceSync` / `devicePush` — keep them in step with the component.
 */

// ── localStorage, one sandbox per simulated device ──────────────────────────
// An installed PWA gets its own storage separate from Safari's, which is how a
// device holding nothing at all ends up signing in to a full cloud galaxy.
const sandboxes = new Map()
let current = null
const useDevice = name => {
  if (!sandboxes.has(name)) sandboxes.set(name, new Map())
  current = sandboxes.get(name)
}
globalThis.localStorage = {
  getItem: k => (current.has(k) ? current.get(k) : null),
  setItem: (k, v) => current.set(k, String(v)),
  removeItem: k => current.delete(k),
}
useDevice('laptop')

const {
  saveLocal, loadLocal, saveRemote, loadRemote, getRemoteSeen, getRemoteBase,
  markRemoteSeen, saveRescue, loadRescue, planSync, reconcileWithRemote, repairState,
  shouldArchive, listVersions, loadVersion, exportPayload, parseImport, mergeStates,
} = await import('../src/store.ts')

// ── a fake galaxy_states table ──────────────────────────────────────────────
// Stamps are Postgres-shaped (`+00:00`, never the `Z` a local toISOString gives)
// because telling those apart is half the history of this file.
let clock = Date.parse('2026-09-17T09:00:00Z')
const pgStamp = () => new Date((clock += 60_000)).toISOString().replace('Z', '+00:00')

const makeCloud = () => ({ row: null, writes: 0, versions: [], archiveTries: 0, noVersionsTable: false })

/** Both tables: galaxy_states (one row, upserted) and galaxy_versions (append + prune). */
const makeClient = cloud => ({
  auth: { getUser: async () => ({ data: { user: { id: 'nic' } } }) },
  from(table) {
    if (table === 'galaxy_versions') {
      const q = {
        _filters: {},
        select() { return q },
        eq(col, val) { q._filters[col] = val; return q },
        order() { return q },
        async insert(row) {
          cloud.archiveTries++
          // A project where supabase/galaxy_versions.sql was never run. Not an
          // error case — it is the default until someone opens the SQL editor.
          if (cloud.noVersionsTable) {
            return { data: null, error: { message: 'relation "galaxy_versions" does not exist' } }
          }
          cloud.versions.unshift({ id: `v${cloud.versions.length + 1}`, created_at: pgStamp(), ...row })
          // The pruning trigger, in miniature.
          cloud.versions = cloud.versions.slice(0, 20)
          return { data: null, error: null }
        },
        async maybeSingle() {
          const hit = cloud.versions.find(v => v.id === q._filters.id)
          return { data: hit ? { ...hit } : null, error: null }
        },
        then(resolve) { return Promise.resolve({ data: cloud.versions.map(v => ({ ...v })), error: null }).then(resolve) },
      }
      return q
    }
    const q = {
      _upsert: null,
      select() { return q },
      eq() { return q },
      upsert(payload) { q._upsert = payload; return q },
      async maybeSingle() { return { data: cloud.row ? { ...cloud.row } : null, error: null } },
      async single() {
        cloud.row = { state_json: q._upsert.state_json, updated_at: pgStamp() }
        cloud.writes++
        return { data: { updated_at: cloud.row.updated_at }, error: null }
      },
    }
    return q
  },
})

// ── the App.tsx executor, restated ──────────────────────────────────────────
async function deviceSync(client, local, { mustPush = false } = {}) {
  const remote = await loadRemote(client)
  if (!remote) return local
  const plan = planSync(local, remote, {
    seen: getRemoteSeen(), base: getRemoteBase(), mustPush,
  })
  if (plan.action === 'hold') return local
  if (plan.dropped.length) saveRescue(local)
  if (plan.action === 'adopt') {
    saveLocal(remote.state)
    markRemoteSeen(remote.updatedAt, remote.state)
    return remote.state
  }
  saveLocal(plan.state)
  await saveRemote(client, plan.state, { force: true })
  return plan.state
}

async function devicePush(client, state) {
  saveLocal(state)
  const result = await saveRemote(client, state)
  if (result === 'stale') return deviceSync(client, state, { mustPush: true })
  return state
}

// ── fixtures ────────────────────────────────────────────────────────────────
const glob = (id, text, opts = {}) => ({
  id, text, x: 400, y: 300, vx: 0, vy: 0, radius: 40, color: '#a78bfa',
  flagged: false, isTodo: false, done: false, clusterId: null,
  createdAt: Date.now(), blobSeed: 1, dueDate: null, priority: 4, ...opts,
})
const cluster = (id, name, globIds) => ({
  id, name, x: 300, y: 200, vx: 0, vy: 0, color: '#22d3ee',
  globIds, collapsed: false, lastInteraction: 0,
})

/** The galaxy that was already in the cloud: two projects and a loose thought. */
const galaxy = () => repairState({
  globs: [
    glob('g1', 'gutter guards', { clusterId: 'c1' }),
    glob('g2', 'order degreaser', { clusterId: 'c1' }),
    glob('g3', 'jojo dinosaur birthday', { clusterId: 'c2' }),
    glob('g4', 'call the arborist'),
  ],
  clusters: [cluster('c1', 'work stuff', ['g1', 'g2']), cluster('c2', 'family', ['g3'])],
  connections: [],
})

/** What Nic typed on the phone before noticing he was signed out. */
const NOTES = [
  'Contact Cathy and KenBonnie', 'Source zinc', 'Message Larry about availability',
  'Think about Patrick’s path', 'Message Hiromi with makeup lesson time',
]
const notesState = () => ({
  globs: NOTES.map((t, i) => glob(`n${i + 1}`, t)), clusters: [], connections: [],
})

const empty = () => ({ globs: [], clusters: [], connections: [] })
const ids = s => [...s.globs.map(g => g.id), ...s.clusters.map(c => c.id)].sort()
const has = (s, id) => ids(s).includes(id)

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── 1. the bookkeeping the compare-and-swap rests on ────────────────────────
console.log('\nremote-seen bookkeeping')
{
  const cloud = makeCloud()
  const client = makeClient(cloud)

  useDevice('laptop')
  check('a first save lands (nothing in the cloud to swap against)',
    await saveRemote(client, galaxy()) === 'saved')
  check('a save records the version it wrote', getRemoteSeen() === cloud.row.updated_at)
  check('...and the ids that version was made of',
    [...getRemoteBase()].sort().join() === ids(galaxy()).join())

  useDevice('phone')
  const read = await loadRemote(client)
  check('loadRemote returns the cloud copy', read.state.globs.length === 4)
  // The bug in one line: a read that stamps "seen" tells the next save it is
  // building on a version this device never took in.
  check('reading does NOT mark the version seen', getRemoteSeen() === null)
  check('so a save of unrelated state is refused as stale',
    await saveRemote(client, notesState()) === 'stale')
  check('...leaving the cloud galaxy untouched', cloud.row.state_json.globs.length === 4)
  check('force overwrites deliberately',
    await saveRemote(client, notesState(), { force: true }) === 'saved')

  useDevice('laptop')
  check('a device whose base version moved on is stale too',
    await saveRemote(client, galaxy()) === 'stale')
}

// ── 2. the decision table ───────────────────────────────────────────────────
console.log('\nplanSync')
{
  const remote = { state: galaxy(), updatedAt: '2026-09-17T09:00:00+00:00' }
  const plan = (local, opts) => planSync(local, remote, { seen: null, base: null, ...opts })

  check('empty device adopts the cloud copy',
    plan(empty()).action === 'adopt')
  check('a version we already hold is left alone',
    plan(galaxy(), { seen: remote.updatedAt }).action === 'hold')
  check('...unless we are holding an unsaved change',
    plan(galaxy(), { seen: remote.updatedAt, mustPush: true }).action === 'merge')
  check('a device holding only what the cloud has adopts rather than writing',
    plan(galaxy(), { base: new Set(ids(galaxy())) }).action === 'adopt')

  // The headline: signed-out captures meet a cloud galaxy neither side has seen.
  const p = plan(notesState())
  check('signed-out captures + cloud galaxy → merge, not a winner',
    p.action === 'merge')
  check('...keeping every note typed while signed out',
    NOTES.every((_, i) => has(p.state, `n${i + 1}`)))
  check('...and every cluster already in the cloud',
    has(p.state, 'c1') && has(p.state, 'c2') && p.state.globs.length === 9)
}

// ── 3. deletions, both directions ───────────────────────────────────────────
console.log('\nreconcileWithRemote and deletions')
{
  const base = new Set(ids(galaxy()))

  // Another device deleted g4 and pushed. We still hold it, but we know from
  // `base` that we got it from the cloud — so it is a deletion, not a capture.
  const withoutG4 = repairState({ ...galaxy(), globs: galaxy().globs.filter(g => g.id !== 'g4') })
  const a = reconcileWithRemote(galaxy(), withoutG4, base)
  check('a delete from another device stays deleted', !has(a.state, 'g4'))
  check('...and needs no write-back', a.needsPush === false)

  // Same shape, no common ancestor: indistinguishable from a capture, so keep it.
  const b = reconcileWithRemote(galaxy(), withoutG4, null)
  check('with no common ancestor a delete resurrects (documented fallback)',
    has(b.state, 'g4') && b.needsPush === true)

  // We deleted g1 offline; meanwhile another device added g9.
  const localDel = repairState({
    globs: galaxy().globs.filter(g => g.id !== 'g1'),
    clusters: [cluster('c1', 'work stuff', ['g2']), cluster('c2', 'family', ['g3'])],
    connections: [],
  })
  const remoteAdd = repairState({ ...galaxy(), globs: [...galaxy().globs, glob('g9', 'new elsewhere')] })
  const c = reconcileWithRemote(localDel, remoteAdd, base)
  check('our offline delete survives a merge', !has(c.state, 'g1'))
  check('...while the other device’s capture is kept', has(c.state, 'g9'))
  check('...and the result is written back', c.needsPush === true)
  check('...with cluster membership repaired',
    c.state.clusters.find(x => x.id === 'c1').globIds.join() === 'g2')

  // A capture made here since the last sync is never a deletion.
  const localNew = { ...galaxy(), globs: [...galaxy().globs, glob('n1', 'typed just now')] }
  const d = reconcileWithRemote(localNew, galaxy(), base)
  check('a record absent from base is a capture, and is kept',
    has(d.state, 'n1') && d.needsPush === true)
}

// ── 4. Nic's morning, end to end ────────────────────────────────────────────
console.log('\nreplay: captured signed out, then signed in')
{
  const cloud = makeCloud()
  const client = makeClient(cloud)

  useDevice('desktop')
  let desktop = await devicePush(client, galaxy())
  check('the galaxy is in the cloud', cloud.row.state_json.globs.length === 4)

  // A separate storage sandbox that has never synced — an installed PWA.
  useDevice('freshphone')
  let phone = loadLocal()
  check('the phone starts with nothing', phone.globs.length === 0)

  // Signed out: captures are saved locally and the cloud is never told.
  phone = notesState()
  saveLocal(phone)
  check('signed-out captures do not touch the cloud', cloud.writes === 1)

  // Sign in. This is the moment the galaxy used to vanish.
  phone = await deviceSync(client, phone)
  check('after sign-in the phone still holds all five notes',
    NOTES.every((_, i) => has(phone, `n${i + 1}`)))
  check('...and the clusters are back on screen',
    has(phone, 'c1') && has(phone, 'c2'), ids(phone).join(' '))
  check('...and the cloud kept its galaxy',
    cloud.row.state_json.clusters.length === 2 && cloud.row.state_json.globs.length === 9)

  // The next edit on the phone must not undo any of that.
  phone = { ...phone, globs: [...phone.globs, glob('n6', 'one more')] }
  phone = await devicePush(client, phone)
  check('a later edit still leaves the galaxy whole',
    cloud.row.state_json.clusters.length === 2 && cloud.row.state_json.globs.length === 10)

  // And the desktop picks the notes up without losing anything of its own.
  useDevice('desktop')
  desktop = await deviceSync(client, desktop)
  check('the desktop gains the phone’s notes',
    NOTES.every((_, i) => has(desktop, `n${i + 1}`)))
  check('...and keeps its own clusters and globs',
    has(desktop, 'c1') && has(desktop, 'c2') && has(desktop, 'g1') && has(desktop, 'g4'))
  check('a second sync is a no-op',
    (await deviceSync(client, desktop)) === desktop && cloud.writes === 3)
}

// ── 5. nothing a device held is ever unrecoverable ──────────────────────────
console.log('\nrescue slot')
{
  const cloud = makeCloud()
  const client = makeClient(cloud)

  useDevice('rescue-desktop')
  let desktop = await devicePush(client, galaxy())

  // An old build on another device overwrites the row with only its own notes.
  // Indistinguishable, from in here, from Nic deleting everything on his phone.
  useDevice('bad-phone')
  await loadRemote(client)
  await saveRemote(client, notesState(), { force: true })
  check('the cloud row has been truncated', cloud.row.state_json.globs.length === 5)

  useDevice('rescue-desktop')
  const before = desktop
  desktop = await deviceSync(client, desktop)
  check('the desktop honours it (a merge cannot tell it from a bulk delete)',
    !has(desktop, 'c1') && !has(desktop, 'g1'))
  const rescue = loadRescue()
  check('...but the fuller copy is kept in the rescue slot',
    rescue !== null && ids(rescue.state).join() === ids(before).join())

  // A second lossy merge must not bury the good copy.
  saveRescue(notesState())
  check('the rescue slot keeps whichever copy holds more',
    ids(loadRescue().state).join() === ids(before).join())

  // Restoring the state alone is a trap: the stored base still describes the
  // truncated row, so the merge would read the cloud's own records as things
  // this device deleted and take those away instead.
  // (Planned, not performed — performing it would truncate the row a second
  // time and there'd be nothing left for the real restore to prove.)
  saveLocal(rescue.state)
  const trap = planSync(rescue.state, await loadRemote(client), {
    seen: getRemoteSeen(), base: getRemoteBase(), mustPush: true,
  })
  check('restoring state but keeping the base trades one loss for another',
    trap.action === 'merge' && has(trap.state, 'c1') && !has(trap.state, 'n1'))

  // The documented restore clears seen + base too, dropping the merge onto its
  // union fallback — which is what keeps both sides.
  saveLocal(rescue.state)
  localStorage.removeItem('adhdo-remote-seen')
  localStorage.removeItem('adhdo-remote-base')
  desktop = await deviceSync(client, loadLocal(), { mustPush: true })
  check('the documented restore brings the galaxy back',
    has(desktop, 'c1') && has(desktop, 'c2') && has(desktop, 'g1'))
  check('...without dropping the notes the other device had written',
    NOTES.every((_, i) => has(desktop, `n${i + 1}`)))
  check('...and the cloud holds all of it',
    cloud.row.state_json.clusters.length === 2 && cloud.row.state_json.globs.length === 9)
}

// ── 6. version history: the previous save actually survives ─────────────────
console.log('\nversion history')
{
  const HOUR = 3_600_000
  const base = new Set(ids(galaxy()))
  const smaller = { globs: galaxy().globs.slice(0, 2), clusters: [], connections: [] }

  check('a write that shrinks the galaxy always archives first',
    shouldArchive(smaller, base, new Date().toISOString()) === true)
  check('an ordinary write soon after the last snapshot does not',
    shouldArchive(galaxy(), base, new Date().toISOString()) === false)
  check('...but one six hours later does',
    shouldArchive(galaxy(), base, new Date(Date.now() - 7 * HOUR).toISOString()) === true)
  check('a device that has never archived does so on its first save',
    shouldArchive(galaxy(), base, null) === true)
  check('growth alone is not a reason to snapshot',
    shouldArchive({ ...galaxy(), globs: [...galaxy().globs, glob('gX', 'one more')] },
      base, new Date().toISOString()) === false)

  // End to end: the overwrite that started all this, with history switched on.
  const cloud = makeCloud()
  const client = makeClient(cloud)

  useDevice('hist-desktop')
  await devicePush(client, galaxy())

  useDevice('hist-phone')
  await deviceSync(client, empty())            // adopt, so base = the full galaxy
  await saveRemote(client, notesState(), { force: true })
  check('the galaxy row has been replaced by the five notes',
    cloud.row.state_json.globs.length === 5)

  const history = await listVersions(client)
  check('...and the previous save is in the history',
    history.length === 1 && history[0].globCount === 4 && history[0].clusterCount === 2)
  const recovered = await loadVersion(client, history[0].id)
  check('...and loads back as the galaxy it was',
    has(recovered, 'c1') && has(recovered, 'c2') && has(recovered, 'g1'))

  // A restore usually GROWS the galaxy, so it trips none of the heuristics —
  // which is why the restore path asks for the snapshot explicitly.
  check('a restore would not trip the shrink or cadence rules on its own',
    shouldArchive(recovered, getRemoteBase(), new Date().toISOString()) === false)
  await saveRemote(client, recovered, { force: true, archive: true })
  const after = await listVersions(client)
  check('restoring archives what it replaced, so it can be undone',
    after.length === 2 && after[0].globCount === 5)
  check('...and the cloud holds the galaxy again',
    cloud.row.state_json.clusters.length === 2)
}

// ── 6b. the table nobody has created yet ────────────────────────────────────
// Running the SQL is a manual step, so "no galaxy_versions" is the DEFAULT
// state, not a fault. It must cost nothing and must heal itself.
console.log('\nversion history, before the SQL is run')
{
  const cloud = makeCloud()
  cloud.noVersionsTable = true
  const client = makeClient(cloud)

  useDevice('no-table')
  await devicePush(client, galaxy())
  const triesAfterFirst = cloud.archiveTries

  // Ordinary saves, one after another. Without the attempt stamp these each
  // fetched the whole document and posted a doomed insert, for ever.
  await saveRemote(client, galaxy(), { force: true })
  await saveRemote(client, galaxy(), { force: true })
  check('a missing versions table does not retry on every save',
    cloud.archiveTries === triesAfterFirst, `tries: ${cloud.archiveTries}`)
  check('...and saving still works regardless',
    cloud.row.state_json.globs.length === 4)
  check('...and the history list is empty rather than broken',
    (await listVersions(client)).length === 0)

  // The snapshot that matters is never the one skipped.
  const shrunk = { globs: galaxy().globs.slice(0, 1), clusters: [], connections: [] }
  await saveRemote(client, shrunk, { force: true })
  check('a shrinking write still tries, stamp or no stamp',
    cloud.archiveTries === triesAfterFirst + 1)

  // Run the SQL: the next attempt just works, with nothing to clear.
  cloud.noVersionsTable = false
  await saveRemote(client, galaxy(), { force: true, archive: true })
  check('creating the table later heals it with no flag to clear',
    (await listVersions(client)).length === 1)
}

// ── 7. export / import ──────────────────────────────────────────────────────
console.log('\nexport and import')
{
  const file = exportPayload(galaxy())
  const back = parseImport(file)
  check('an exported galaxy parses back whole',
    back !== null && ids(back).join() === ids(galaxy()).join())
  check('a bare galaxy blob (copied out of a console) parses too',
    ids(parseImport(JSON.stringify(galaxy()))).join() === ids(galaxy()).join())
  check('a file missing connections still parses',
    parseImport(JSON.stringify({ globs: [], clusters: [] })) !== null)
  check('junk is rejected rather than half-applied',
    parseImport('not json') === null && parseImport('{"nope":1}') === null)

  // Import merges. It used to replace, which made the recovery tool one more
  // way to lose the thoughts you captured since the file was written.
  const merged = mergeStates(notesState(), parseImport(file))
  check('importing adds the file without removing what you have',
    has(merged, 'c1') && has(merged, 'g1') && NOTES.every((_, i) => has(merged, `n${i + 1}`)))
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
