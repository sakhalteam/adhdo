import type { GalaxyState, Glob, Cluster, Connection } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'

const STORAGE_KEY = 'adhdo-galaxy'
const UPDATED_AT_KEY = 'adhdo-updated-at'
const ONBOARDING_SEEN_KEY = 'adhdo-seen-onboarding-v1'

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

  return { globs, clusters, connections: saved.connections ?? [] }
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

export function hasSeenOnboarding(): boolean {
  return localStorage.getItem(ONBOARDING_SEEN_KEY) === '1'
}

export function markOnboardingSeen() {
  localStorage.setItem(ONBOARDING_SEEN_KEY, '1')
}

/** Save state to Supabase. Returns true on success. */
export async function saveRemote(supabase: SupabaseClient, state: GalaxyState): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { error } = await supabase
    .from('galaxy_states')
    .upsert({
      user_id: user.id,
      state_json: serializeState(state),
      updated_at: new Date().toISOString(),
    })

  return !error
}

/** Load state from Supabase. Returns null if not logged in or no data. */
export async function loadRemote(supabase: SupabaseClient): Promise<{ state: GalaxyState; updatedAt: string } | null> {
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
