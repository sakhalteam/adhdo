import type { GalaxyState, Glob, Cluster } from './types'

const STORAGE_KEY = 'adhdo-galaxy'

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

export function save(state: GalaxyState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function load(): GalaxyState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore corrupt data */ }
  return { globs: [], clusters: [] }
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
