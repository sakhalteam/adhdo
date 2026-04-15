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
