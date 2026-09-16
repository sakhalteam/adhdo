/** Todoist-style priority: 1 is highest (red), 4 is "no priority" (the default). */
export type Priority = 1 | 2 | 3 | 4

export interface Glob {
  id: string
  text: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  color: string
  flagged: boolean
  isTodo: boolean
  done: boolean
  clusterId: string | null
  createdAt: number
  /** Random seed for blob shape morphing */
  blobSeed: number
  /** Local calendar date 'YYYY-MM-DD', or null/absent for undated. */
  dueDate?: string | null
  /** Absent on pre-2026-09 records — treat as 4. */
  priority?: Priority
}

export interface Cluster {
  id: string
  name: string
  x: number
  y: number
  vx: number
  vy: number
  color: string
  globIds: string[]
  collapsed: boolean
  /** Timestamp of last user interaction — drift starts after idle */
  lastInteraction: number
  /** Reserved role — 'orphans' is the auto/manual gather bucket, survives rename */
  role?: 'orphans'
}

export interface Connection {
  id: string
  cluster1Id: string
  cluster2Id: string
  color: string
}

export interface GalaxyState {
  globs: Glob[]
  clusters: Cluster[]
  connections: Connection[]
}
