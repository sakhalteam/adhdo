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
  clusterId: string | null
  createdAt: number
}

export interface Cluster {
  id: string
  name: string
  x: number
  y: number
  color: string
  globIds: string[]
  collapsed: boolean
}

export interface GalaxyState {
  globs: Glob[]
  clusters: Cluster[]
}
