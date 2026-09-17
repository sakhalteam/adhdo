import type { GalaxyState, Glob, Cluster, Connection } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'

const STORAGE_KEY = 'adhdo-galaxy'
const UPDATED_AT_KEY = 'adhdo-updated-at'
const ONBOARDING_SEEN_KEY = 'adhdo-seen-onboarding-v1'
const REMOTE_SEEN_KEY = 'adhdo-remote-seen'
const REMOTE_BASE_KEY = 'adhdo-remote-base'
const RESCUE_KEY = 'adhdo-rescue'
const VERSION_AT_KEY = 'adhdo-version-at'
const DIRTY_KEY = 'adhdo-dirty'

/**
 * 🎨 PALETTE — per-glob / per-cluster colors.
 *
 * These hexes are picked randomly for new globs (glob fill) and new clusters
 * (cluster border + cluster.color). Edit, reorder, or extend freely.
 *
 * Semantic theme colors (accent, success, danger, etc.) live in
 * `src/index.css` under the "🎨 DESIGN KNOBS" header at the top of the file.
 */
export const PALETTE = [
  '#7c3aed', '#a78bfa', '#6366f1', '#818cf8',
  '#06b6d4', '#22d3ee', '#2dd4bf', '#34d399',
  '#8b5cf6', '#c084fc', '#67e8f9', '#a5f3fc',
]

export function randomColor(): string {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)]
}

export function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/** Strip physics/visual noise from state before persisting */
function serializeState(state: GalaxyState) {
  return {
    globs: state.globs.map(({ vx, vy, blobSeed, ...rest }) => rest),
    clusters: state.clusters.map(({ vx, vy, lastInteraction, ...rest }) => rest),
    connections: state.connections,
  }
}

/**
 * Make the two views of cluster membership agree.
 *
 * Membership is stored twice — `cluster.globIds` (which carries order and is
 * what the cluster renders) and `glob.clusterId` — and nothing stops those from
 * disagreeing after a merge, a crash mid-write, or a hand-edited backup. The
 * failure that matters is a glob claiming a clusterId that no cluster lists:
 * the list view renders loose globs as `!clusterId` and cluster contents from
 * `globIds`, so such a glob appears in *neither* place. It's still in the data,
 * but as far as you can tell the thought is gone.
 *
 * `globIds` wins, because it's the ordered one, and every glob then gets a
 * `clusterId` derived from it. That guarantees each glob renders exactly once.
 */
export function repairState(state: GalaxyState): GalaxyState {
  const globIds = new Set(state.globs.map(g => g.id))
  const owner = new Map<string, string>()

  const clusters = state.clusters.map(c => {
    // Drop ids for globs that no longer exist, and any duplicate already claimed
    // by an earlier cluster — a glob can only live in one.
    const kept = c.globIds.filter(id => globIds.has(id) && !owner.has(id))
    for (const id of kept) owner.set(id, c.id)
    return kept.length === c.globIds.length ? c : { ...c, globIds: kept }
  })

  const globs = state.globs.map(g => {
    const belongsTo = owner.get(g.id) ?? null
    return g.clusterId === belongsTo ? g : { ...g, clusterId: belongsTo }
  })

  const liveClusters = new Set(clusters.map(c => c.id))
  const connections = state.connections.filter(
    cn => liveClusters.has(cn.cluster1Id) && liveClusters.has(cn.cluster2Id),
  )

  return { globs, clusters, connections }
}

/** Nothing captured yet — a device that's been opened but never actually used. */
export function isEmptyState(s: GalaxyState): boolean {
  return s.globs.length === 0 && s.clusters.length === 0 && s.connections.length === 0
}

/** Rehydrate physics fields onto saved data */
function hydrateState(saved: { globs?: Partial<Glob>[]; clusters?: Partial<Cluster>[]; connections?: Connection[] }): GalaxyState {
  const W = typeof window !== 'undefined' ? window.innerWidth : 1200
  const H = typeof window !== 'undefined' ? window.innerHeight : 800

  const globs: Glob[] = (saved.globs ?? []).map(g => {
    const angle = Math.random() * Math.PI * 2
    const speed = 0.15 + Math.random() * 0.25
    return {
      x: Math.random() * (W - 120) + 60,
      y: Math.random() * (H - 120) + 60,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: Math.min(28 + (g.text?.length ?? 0) * 1.5, 60),
      blobSeed: Math.random() * 1000,
      ...g,
    } as Glob
  })

  const clusters: Cluster[] = (saved.clusters ?? []).map(c => ({
    x: Math.random() * (W - 200) + 100,
    y: Math.random() * (H - 200) + 100,
    vx: 0,
    vy: 0,
    lastInteraction: Date.now(),
    ...c,
  } as Cluster))

  // Repair on the way in, so a blob that got out of sync in an older build
  // can't render a thought into nowhere.
  return repairState({ globs, clusters, connections: saved.connections ?? [] })
}

/**
 * A fingerprint of the *meaningful* state — everything except physics drift
 * (x/y/vx/vy/lastInteraction). Used by the autosave loop to decide whether a
 * write is worthwhile: globs never settle (MIN_SPEED keeps them drifting), so a
 * full-state diff would fire every tick. Positions still persist whenever a real
 * change triggers a save, and on beforeunload.
 */
export function stateSignature(state: GalaxyState): string {
  return JSON.stringify({
    // dueDate/priority must be in here or scheduling a task would never reach
    // localStorage — the autosave loop only writes when the signature moves.
    globs: state.globs.map(g => [g.id, g.text, g.color, g.flagged, g.isTodo, g.done, g.clusterId, g.dueDate ?? null, g.priority ?? 4]),
    clusters: state.clusters.map(c => [c.id, c.name, c.color, c.collapsed, c.role, c.globIds]),
    connections: state.connections.map(cn => [cn.id, cn.cluster1Id, cn.cluster2Id, cn.color]),
  })
}

export function saveLocal(state: GalaxyState) {
  const now = new Date().toISOString()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState(state)))
  localStorage.setItem(UPDATED_AT_KEY, now)
}

export function loadLocal(): GalaxyState {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return { globs: [], clusters: [], connections: [] }
  try {
    return hydrateState(JSON.parse(raw))
  } catch { /* ignore corrupt data */ }
  return { globs: [], clusters: [], connections: [] }
}

/**
 * When this device last changed anything. Informational only since the pull
 * stopped asking: which copy is "newer" turned out to be the wrong question
 * (see `markRemoteSeen`), because capturing while signed out advances this
 * stamp without the cloud hearing a word about it.
 */
export function touchLocal(at: string) {
  localStorage.setItem(UPDATED_AT_KEY, at)
}

/**
 * `updated_at` of the cloud row whose contents this device is known to HOLD —
 * the base version for saveRemote's compare-and-swap.
 *
 * "Holds", not "has read". Reading a copy and then discarding it must never
 * stamp this, or the compare-and-swap waves through the very overwrite it
 * exists to catch. That is exactly how a phone that captured five notes while
 * signed out flattened the cloud galaxy on the next save: the sign-in pull read
 * the cloud row (stamping it seen), declined to adopt it because the local
 * stamp was newer, and the save five seconds later sailed through the guard.
 *
 * Only `markRemoteSeen` writes it, and only from a Postgres-returned
 * `updated_at` — never a locally generated ISO string. Both sides of every
 * comparison are therefore byte-identical echoes of the same column, which is
 * what makes `===` safe here: mixing in a `toISOString()` stamp would
 * reintroduce the old `'Z'`-vs-`'+00:00'` mismatch.
 */
export function getRemoteSeen(): string | null {
  return localStorage.getItem(REMOTE_SEEN_KEY)
}

/**
 * The ids the cloud copy we hold was made of — the common ancestor that lets a
 * later reconcile tell a *new* local record apart from one that was deleted on
 * another device. Without it the two look identical (present here, absent
 * there) and you must either lose captures or resurrect deletions.
 */
export function getRemoteBase(): Set<string> | null {
  const raw = localStorage.getItem(REMOTE_BASE_KEY)
  if (!raw) return null
  try {
    const ids = JSON.parse(raw)
    if (Array.isArray(ids)) return new Set(ids as string[])
  } catch { /* ignore corrupt data */ }
  return null
}

function idsOf(state: GalaxyState): string[] {
  return [
    ...state.globs.map(g => g.id),
    ...state.clusters.map(c => c.id),
    ...state.connections.map(cn => cn.id),
  ]
}

/**
 * Record that this device now holds the cloud version stamped `updatedAt`, and
 * what it was made of. Call it on exactly two occasions: adopting a cloud copy,
 * and a save the cloud accepted. Anything else is a lie the compare-and-swap
 * will believe.
 */
export function markRemoteSeen(updatedAt: string, state: GalaxyState) {
  localStorage.setItem(REMOTE_SEEN_KEY, updatedAt)
  localStorage.setItem(REMOTE_BASE_KEY, JSON.stringify(idsOf(state)))
}

/**
 * Does this device hold changes the cloud hasn't accepted yet?
 *
 * In localStorage rather than a ref because the case that matters is surviving
 * a reload: capture a thought on a pass with no signal, the save fails, the app
 * gets closed. Without a persisted flag nothing would retry until the next
 * unrelated edit, and the cloud would sit stale for days.
 */
export function isDirty(): boolean {
  return localStorage.getItem(DIRTY_KEY) === '1'
}

export function setDirty(dirty: boolean) {
  if (dirty) localStorage.setItem(DIRTY_KEY, '1')
  else localStorage.removeItem(DIRTY_KEY)
}

// ── merge ────────────────────────────────────────────────────────────────────

/** Union two lists of id-bearing records, letting `theirs` decide any overlap. */
function unionById<T extends { id: string }>(mine: T[], theirs: T[]): T[] {
  const out = new Map<string, T>()
  for (const item of mine) out.set(item.id, item)
  for (const item of theirs) out.set(item.id, item)
  return [...out.values()]
}

/**
 * Union of both sides, keeping everything either one knows about.
 *
 * Used when there's no common ancestor to reason from (`getRemoteBase()` is
 * null — a device that has never completed a sync, or one whose storage was
 * evicted). Deliberately errs towards resurrection: with nothing to compare
 * against, a record present here and absent there is indistinguishable from a
 * new capture, and a thought you have to delete twice beats one that vanishes.
 */
export function mergeStates(local: GalaxyState, remote: GalaxyState): GalaxyState {
  return repairState({
    globs: unionById(local.globs, remote.globs),
    clusters: unionById(local.clusters, remote.clusters),
    connections: unionById(local.connections, remote.connections),
  })
}

/**
 * Three-way merge of one collection against the ids the last synced copy held.
 *
 * `base` is what makes "present here, absent there" answerable. Without it the
 * two directions are indistinguishable and you have to pick a way to be wrong
 * for both at once:
 *
 *   in both            → the cloud's version; it is the newer document
 *   here, not there    → in base? deleted on another device, let it go
 *                        not in base? captured here since the last sync, KEEP
 *   there, not here    → in base? deleted here, stays deleted
 *                        not in base? captured elsewhere since the last sync, KEEP
 *
 * Local order is preserved and anything new from the cloud is appended.
 */
function reconcileList<T extends { id: string }>(mine: T[], theirs: T[], base: Set<string>): T[] {
  const theirsById = new Map(theirs.map(t => [t.id, t]))
  const mineIds = new Set(mine.map(m => m.id))
  const out: T[] = []
  for (const item of mine) {
    const match = theirsById.get(item.id)
    if (match) out.push(match)
    else if (!base.has(item.id)) out.push(item)
  }
  for (const item of theirs) {
    if (!mineIds.has(item.id) && !base.has(item.id)) out.push(item)
  }
  return out
}

export interface Reconciliation {
  state: GalaxyState
  /** True when the result holds records the cloud row doesn't — it must be written back. */
  needsPush: boolean
  /** Ids this device held that the merge let go of. Non-empty means take a rescue copy. */
  dropped: string[]
}

/**
 * Fold a cloud copy into what this device holds.
 *
 * Runs whenever the cloud row carries a version we have never taken in —
 * a save that lost the compare-and-swap, or a sign-in that finds thoughts
 * captured while signed out. Taking one side wholesale is not an option in
 * either direction: adopt the cloud and the five notes you just typed are gone;
 * keep local and the entire galaxy on the other device is gone. So merge, using
 * `base` to tell a new capture apart from a remote deletion.
 */
export function reconcileWithRemote(
  local: GalaxyState,
  remote: GalaxyState,
  base: Set<string> | null,
): Reconciliation {
  const state = base === null ? mergeStates(local, remote) : repairState({
    globs: reconcileList(local.globs, remote.globs, base),
    clusters: reconcileList(local.clusters, remote.clusters, base),
    connections: reconcileList(local.connections, remote.connections, base),
  })
  // Compared on ids, not fields: shared records already took the cloud's values,
  // so only membership can differ. Both directions count — we may be holding a
  // capture the cloud lacks, or honouring a deletion it hasn't heard about.
  const remoteIds = new Set(idsOf(remote))
  const mergedIds = idsOf(state)
  const needsPush = mergedIds.length !== remoteIds.size || mergedIds.some(id => !remoteIds.has(id))
  const kept = new Set(mergedIds)
  const dropped = idsOf(local).filter(id => !kept.has(id))
  return { state, needsPush, dropped }
}

/**
 * Keep a copy of the fullest galaxy this device ever held before a merge let
 * anything go.
 *
 * Honouring a deletion and honouring a truncated cloud row are the same
 * operation from in here — the merge cannot tell a bulk delete apart from
 * another client having overwritten the row with less than it held. That is
 * survivable as long as nothing is ever *unrecoverable*, so before a lossy
 * merge the pre-merge state goes in a one-slot backup. Restore from a console:
 *
 *   localStorage.setItem('adhdo-galaxy', JSON.stringify(
 *     JSON.parse(localStorage.getItem('adhdo-rescue')).state))
 *   localStorage.removeItem('adhdo-remote-seen')
 *   localStorage.removeItem('adhdo-remote-base')
 *
 * then reload. Clearing the base matters as much as restoring the state: with a
 * common ancestor in hand the next reconcile would read the cloud's own records
 * as things this device had deleted and take *those* away instead. Dropping it
 * puts the merge back on the union fallback, which keeps both sides — the right
 * way to be wrong when you already know one copy was wrongly emptied.
 *
 * Whichever copy holds more records wins the slot, so a second bad merge can't
 * bury the good one.
 */
export function saveRescue(state: GalaxyState) {
  const size = idsOf(state).length
  const existing = loadRescue()
  if (existing && idsOf(existing.state).length >= size) return
  localStorage.setItem(RESCUE_KEY, JSON.stringify({
    at: new Date().toISOString(),
    state: serializeState(state),
  }))
}

export function loadRescue(): { at: string; state: GalaxyState } | null {
  const raw = localStorage.getItem(RESCUE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return { at: parsed.at, state: hydrateState(parsed.state) }
  } catch { /* ignore corrupt data */ }
  return null
}

export function hasSeenOnboarding(): boolean {
  return localStorage.getItem(ONBOARDING_SEEN_KEY) === '1'
}

export function markOnboardingSeen() {
  localStorage.setItem(ONBOARDING_SEEN_KEY, '1')
}

export type SaveResult = 'saved' | 'stale' | 'error'

/**
 * Save the galaxy to Supabase (one row per user).
 *
 * Guarded by a compare-and-swap: we refuse to overwrite a cloud row this device
 * has never seen. Without that guard, a freshly-installed device holding an
 * empty galaxy replaces the entire brain dump the moment you touch anything —
 * and adding the app to an iOS home screen creates exactly such a device, since
 * an installed PWA gets its own storage sandbox separate from Safari's.
 *
 * `force` is for the case where overwriting IS the intent: writing back a copy
 * we just merged the cloud's version into. `archive` says to snapshot the row
 * being replaced whatever the usual policy thinks — see the call site in
 * `restoreVersion`, which is what makes a restore undoable.
 */
export async function saveRemote(
  supabase: SupabaseClient,
  state: GalaxyState,
  opts: { force?: boolean; archive?: boolean } = {},
): Promise<SaveResult> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'error'

  if (!opts.force) {
    const { data: head, error } = await supabase
      .from('galaxy_states')
      .select('updated_at')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) return 'error'
    if (head?.updated_at && head.updated_at !== getRemoteSeen()) return 'stale'
  }

  // Archive the row we're about to replace, so the previous save survives this
  // one. Before the upsert and never after: afterwards there is nothing left to
  // copy. Best-effort — a backup that fails must not cost you the save.
  // `archive` is the caller saying it knows this write is a deliberate
  // replacement — a restore, above all, which typically *grows* the galaxy and
  // so trips none of the heuristics below, yet is precisely the write you are
  // most likely to want to take back.
  if (opts.archive || shouldArchive(state, getRemoteBase(), getArchivedAt())) {
    await archiveRemote(supabase, user.id)
  }

  const { data, error } = await supabase
    .from('galaxy_states')
    .upsert({
      user_id: user.id,
      state_json: serializeState(state),
      updated_at: new Date().toISOString(),
    })
    .select('updated_at')
    .single()
  if (error || !data) return 'error'
  // The row now holds exactly `state`, so record both the stamp and what it was
  // made of. The stamp is the one Postgres echoed (`+00:00`), not the `Z` we
  // sent, so the next compare-and-swap matches like for like.
  markRemoteSeen(data.updated_at, state)
  return 'saved'
}

export interface RemoteState {
  state: GalaxyState
  updatedAt: string
}

/**
 * What to do about a cloud row, given what this device holds.
 *
 * The whole sync decision, in one pure function and out of the component, for
 * two reasons: it is the part that broke and it is the part that had no test.
 * It used to be split between a timestamp comparison in the pull and a
 * compare-and-swap in the save — which is how the two came to disagree. A phone
 * that captured a few notes while signed out satisfied both into overwriting
 * the galaxy: newest clock, and a stamp the read had already marked seen.
 *
 *   hold  — `seen` says our copy already contains this version; nothing to do
 *   adopt — take the cloud copy as-is (we hold nothing, or nothing it lacks)
 *   merge — fold the two together and write the result back
 *
 * `mustPush` is the save path saying it knows it holds unsaved work, so the
 * result must be written back even if the merge added nothing new.
 */
export type SyncPlan =
  | { action: 'hold' }
  | { action: 'adopt'; dropped: string[] }
  | { action: 'merge'; state: GalaxyState; dropped: string[] }

export function planSync(
  local: GalaxyState,
  remote: RemoteState,
  opts: { seen: string | null; base: Set<string> | null; mustPush?: boolean },
): SyncPlan {
  if (!opts.mustPush && opts.seen === remote.updatedAt) return { action: 'hold' }
  // An untouched device has nothing worth merging; just take the cloud copy.
  if (isEmptyState(local)) return { action: 'adopt', dropped: [] }
  const { state, needsPush, dropped } = reconcileWithRemote(local, remote.state, opts.base)
  // `adopt` can shed records too: taking the cloud copy wholesale is how a
  // deletion made elsewhere reaches this device, so it carries `dropped` as well.
  if (!needsPush && !opts.mustPush) return { action: 'adopt', dropped }
  return { action: 'merge', state, dropped }
}

/**
 * Load state from Supabase. Returns null if not logged in or no data.
 *
 * ⚠️ Reading does NOT mark the version seen. Only the caller knows whether it
 * actually took the copy in, and `markRemoteSeen` is a promise that this device
 * holds those thoughts — see `getRemoteSeen` for what it cost to learn that.
 */
export async function loadRemote(supabase: SupabaseClient): Promise<RemoteState | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('galaxy_states')
    .select('state_json, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !data) return null
  return {
    state: hydrateState(data.state_json),
    updatedAt: data.updated_at,
  }
}

// ── version history ──────────────────────────────────────────────────────────
// `galaxy_states` is one row per user and every save is an UPSERT, so the
// previous document dies the moment the next lands — which is why a single bad
// write had nothing to roll back to. `galaxy_versions` keeps the last 20, and
// what goes in it is the row we are ABOUT TO REPLACE, so a version really is
// "the previous save" rather than a copy of whatever we happened to be holding.
// Schema + RLS + the pruning trigger: supabase/galaxy_versions.sql.

/** Routine cadence. A snapshot before every save would bury the useful ones. */
const VERSION_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface GalaxyVersion {
  id: string
  createdAt: string
  /** `updated_at` of the galaxy_states row this was taken from. */
  savedAt: string | null
  globCount: number
  clusterCount: number
}

/**
 * Is this save worth archiving the current cloud row for?
 *
 * Two triggers, and the first is the one that matters: a write that **shrinks**
 * the galaxy is exactly the shape of every way this app has lost data, so the
 * copy it is about to replace is worth keeping whatever else is true. `base` is
 * what the cloud held last time we agreed with it — comparing against our own
 * previous state would miss a device that arrived holding less than the cloud.
 *
 * The second is a plain cadence, so an ordinary week still leaves you something
 * to go back to. Pure, so `scripts/sync-check.mjs` can pin the policy down.
 */
export function shouldArchive(
  outgoing: GalaxyState,
  base: Set<string> | null,
  lastArchivedAt: string | null,
  now: number = Date.now(),
): boolean {
  if (base !== null && idsOf(outgoing).length < base.size) return true
  if (!lastArchivedAt) return true
  const last = Date.parse(lastArchivedAt)
  return Number.isNaN(last) || now - last >= VERSION_INTERVAL_MS
}

/** When this device last wrote a snapshot — a stamp, so we needn't ask the server. */
function getArchivedAt(): string | null {
  return localStorage.getItem(VERSION_AT_KEY)
}

/**
 * Copy the user's current cloud row into the version history.
 *
 * Best-effort by design: it runs on the way to a save, and failing to keep a
 * backup is never a reason to refuse to save the thought you just typed.
 */
async function archiveRemote(supabase: SupabaseClient, userId: string): Promise<boolean> {
  // Stamp the ATTEMPT, not the success, and do it first.
  //
  // `galaxy_versions` is created by a SQL file run by hand, so "the table does
  // not exist" is an ordinary state, not an error case. A stamp that only moved
  // on success would leave `shouldArchive` seeing `null` forever and returning
  // true on every single save — a full document fetch plus a doomed insert,
  // every time, on mobile data. Stamping here backs a missing table (or a flaky
  // network) off to the ordinary cadence instead of retrying in a loop.
  //
  // It still self-heals: nothing to clear once the table exists, the next
  // cadence tick picks it up, and a write that SHRINKS the galaxy ignores the
  // stamp entirely — so the snapshot that matters most is never the one skipped.
  localStorage.setItem(VERSION_AT_KEY, new Date().toISOString())
  try {
    const { data, error } = await supabase
      .from('galaxy_states')
      .select('state_json, updated_at')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data?.state_json) return false

    const doc = data.state_json as { globs?: unknown[]; clusters?: unknown[] }
    const { error: insertError } = await supabase.from('galaxy_versions').insert({
      user_id: userId,
      state_json: data.state_json,
      glob_count: doc.globs?.length ?? 0,
      cluster_count: doc.clusters?.length ?? 0,
      saved_at: data.updated_at,
    })
    if (insertError) return false
    return true
  } catch {
    return false
  }
}

/** The history list — counts only, so opening the panel doesn't pull 20 documents. */
export async function listVersions(supabase: SupabaseClient): Promise<GalaxyVersion[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('galaxy_versions')
    .select('id, created_at, saved_at, glob_count, cluster_count')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
  if (error || !data) return []
  return data.map(r => ({
    id: r.id,
    createdAt: r.created_at,
    savedAt: r.saved_at,
    globCount: r.glob_count ?? 0,
    clusterCount: r.cluster_count ?? 0,
  }))
}

/** Pull one version's full document, hydrated and repaired like any other load. */
export async function loadVersion(supabase: SupabaseClient, id: string): Promise<GalaxyState | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('galaxy_versions')
    .select('state_json')
    .eq('user_id', user.id)
    .eq('id', id)
    .maybeSingle()
  if (error || !data?.state_json) return null
  return hydrateState(data.state_json)
}

// ── export / import ──────────────────────────────────────────────────────────

/** The off-site backup: a file you hold, that no sync can reach. */
export function exportPayload(state: GalaxyState): string {
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    state: serializeState(state),
  }, null, 2)
}

/**
 * Parse an exported file back into a state, or null if it isn't one.
 *
 * Accepts both the wrapped payload and a bare galaxy, because the thing you
 * reach for in a panic may well be a `adhdo-galaxy` blob copied out of a
 * console rather than a file this app wrote.
 */
export function parseImport(text: string): GalaxyState | null {
  try {
    const parsed = JSON.parse(text)
    const raw = parsed?.state ?? parsed
    if (!raw || typeof raw !== 'object') return null
    if (!Array.isArray(raw.globs) || !Array.isArray(raw.clusters)) return null
    return hydrateState({
      globs: raw.globs,
      clusters: raw.clusters,
      connections: Array.isArray(raw.connections) ? raw.connections : [],
    })
  } catch {
    return null
  }
}

export function makeGlob(text: string, cx: number, cy: number): Glob {
  const angle = Math.random() * Math.PI * 2
  const speed = 0.15 + Math.random() * 0.25
  return {
    id: genId(),
    text,
    x: cx + (Math.random() - 0.5) * 200,
    y: cy + (Math.random() - 0.5) * 200,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: Math.min(28 + text.length * 1.5, 60),
    color: randomColor(),
    flagged: false,
    isTodo: false,
    done: false,
    clusterId: null,
    createdAt: Date.now(),
    blobSeed: Math.random() * 1000,
    dueDate: null,
    priority: 4,
  }
}

export function makeConnection(cluster1Id: string, cluster2Id: string): Connection {
  return {
    id: genId(),
    cluster1Id,
    cluster2Id,
    color: randomColor(),
  }
}

export function makeCluster(name: string, x: number, y: number, globIds: string[]): Cluster {
  return {
    id: genId(),
    name,
    x,
    y,
    vx: 0,
    vy: 0,
    color: randomColor(),
    globIds,
    collapsed: false,
    lastInteraction: Date.now(),
  }
}
