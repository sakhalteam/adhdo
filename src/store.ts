import type { GalaxyState, Glob, Cluster, Connection } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'

const STORAGE_KEY = 'adhdo-galaxy'
const UPDATED_AT_KEY = 'adhdo-updated-at'
const ONBOARDING_SEEN_KEY = 'adhdo-seen-onboarding-v1'
const REMOTE_SEEN_KEY = 'adhdo-remote-seen'
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
    globs: state.globs.map(g => [g.id, g.text, g.color, g.flagged, g.isTodo, g.done, g.clusterId]),
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

export function getLocalUpdatedAt(): string | null {
  return localStorage.getItem(UPDATED_AT_KEY)
}

/**
 * Overwrite the "this device last changed the data" stamp. Used after adopting a
 * cloud copy, to inherit its timestamp rather than claiming we just edited —
 * otherwise every pull would leave this device looking like the freshest writer
 * and it would never pull again.
 */
export function touchLocal(at: string) {
  localStorage.setItem(UPDATED_AT_KEY, at)
}

/**
 * Is `a` strictly newer than `b`? Parsed, never string-compared.
 *
 * This used to be a raw `>` on the two strings, which is subtly wrong: local
 * stamps come from `toISOString()` and end in `Z`, while Postgres hands back
 * `+00:00`. Compare those lexically and `'Z'` (0x5A) sorts after `'+'` (0x2B),
 * so a cloud copy written in the same second as a local one always *looks*
 * older and the pull silently never happens.
 */
export function isNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) return false
  const ta = Date.parse(a)
  if (Number.isNaN(ta)) return false
  if (!b) return true
  const tb = Date.parse(b)
  return Number.isNaN(tb) ? true : ta > tb
}

/**
 * `updated_at` of the cloud row this device last read or wrote — the base
 * version for saveRemote's compare-and-swap.
 */
export function getRemoteSeen(): string | null {
  return localStorage.getItem(REMOTE_SEEN_KEY)
}

function setRemoteSeen(updatedAt: string) {
  localStorage.setItem(REMOTE_SEEN_KEY, updatedAt)
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
 * Reconcile this device's galaxy with a cloud copy that moved ahead of it.
 *
 * Runs in exactly one situation: we tried to save, the compare-and-swap said the
 * cloud holds a version we never read, and both copies contain real thoughts.
 * The alternative — take one side wholesale — means a phone that captured six
 * ideas on a drive loses all of them because the laptop renamed one cluster in
 * the meantime.
 *
 * So: union every collection by id. Records only one side knows about are new
 * captures and are always kept; where both know an id, the cloud wins, since it
 * is by definition the newer document. `repairState` then puts membership back
 * in order, because the two sides may disagree about which cluster holds what.
 *
 * The deliberate trade-off is deletions: with no tombstones, something deleted
 * here but still present in the cloud comes back. That's the right way to be
 * wrong — a thought you have to delete twice is mildly annoying, while one that
 * vanishes silently is exactly the failure this app exists to prevent.
 */
export function mergeStates(local: GalaxyState, remote: GalaxyState): GalaxyState {
  return repairState({
    globs: unionById(local.globs, remote.globs),
    clusters: unionById(local.clusters, remote.clusters),
    connections: unionById(local.connections, remote.connections),
  })
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
 * we just merged the cloud's version into.
 */
export async function saveRemote(
  supabase: SupabaseClient,
  state: GalaxyState,
  opts: { force?: boolean } = {},
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
  // Store what the row actually holds now, so the next compare-and-swap matches
  // like for like (Postgres echoes `+00:00`, not the `Z` we sent).
  setRemoteSeen(data.updated_at)
  return 'saved'
}

export interface RemoteState {
  state: GalaxyState
  updatedAt: string
  /** True when this device had never observed the cloud row before this read. */
  firstSight: boolean
}

/** Load state from Supabase. Returns null if not logged in or no data. */
export async function loadRemote(supabase: SupabaseClient): Promise<RemoteState | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('galaxy_states')
    .select('state_json, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !data) return null
  const firstSight = getRemoteSeen() === null
  // We've now observed this version, so a later local save is allowed to build
  // on it — whether or not the caller decides to adopt it.
  setRemoteSeen(data.updated_at)
  return {
    state: hydrateState(data.state_json),
    updatedAt: data.updated_at,
    firstSight,
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
