import type { GalaxyState, Glob, Cluster, Connection } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'

const STORAGE_KEY = 'adhdo-galaxy'
const UPDATED_AT_KEY = 'adhdo-updated-at'

const PALETTE = [
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
    globs: state.globs.map(({ x, y, vx, vy, radius, blobSeed, ...rest }) => rest),
    clusters: state.clusters.map(({ x, y, vx, vy, lastInteraction, ...rest }) => rest),
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

export function saveLocal(state: GalaxyState) {
  const now = new Date().toISOString()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState(state)))
  localStorage.setItem(UPDATED_AT_KEY, now)
}

export function loadLocal(): GalaxyState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = JSON.parse(raw!)
    return hydrateState(parsed)
  } catch { /* ignore corrupt data */ }
  return { globs: [], clusters: [], connections: [] }
}

export function getLocalUpdatedAt(): string | null {
  return localStorage.getItem(UPDATED_AT_KEY)
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

// Keep legacy names as aliases for backward compat in App.tsx autosave
export const save = saveLocal
export const load = loadLocal

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
