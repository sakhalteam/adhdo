import { useEffect, useRef } from 'react'
import type { Cluster, Glob } from './types'
import { isOverTrash } from './trashZone'

export type GlobDropHandler = (globId: string, dropX: number, dropY: number) => void

export function useGlobDrop({
  globs,
  clusters,
  onTrash,
  onAddToCluster,
  onCreateCluster,
}: {
  globs: Glob[]
  clusters: Cluster[]
  onTrash: (globId: string) => void
  onAddToCluster: (globId: string, clusterId: string) => void
  onCreateCluster: (id1: string, id2: string, x: number, y: number) => void
}) {
  const handleDropRef = useRef<GlobDropHandler>(() => {})

  useEffect(() => {
    handleDropRef.current = (globId: string, dropX: number, dropY: number) => {
      const droppedGlob = globs.find(glob => glob.id === globId)
      if (!droppedGlob) return

      if (isOverTrash(dropX, dropY)) {
        onTrash(globId)
        return
      }

      for (const cluster of clusters) {
        const dx = droppedGlob.x - cluster.x
        const dy = droppedGlob.y - cluster.y
        if (Math.sqrt(dx * dx + dy * dy) < 120 && !droppedGlob.clusterId) {
          onAddToCluster(globId, cluster.id)
          return
        }
      }

      for (const other of globs) {
        if (other.id === globId || other.clusterId) continue
        const dx = droppedGlob.x - other.x
        const dy = droppedGlob.y - other.y
        if (Math.sqrt(dx * dx + dy * dy) < (droppedGlob.radius + other.radius + 20)) {
          onCreateCluster(globId, other.id, (droppedGlob.x + other.x) / 2, (droppedGlob.y + other.y) / 2)
          return
        }
      }
    }
  }, [clusters, globs, onAddToCluster, onCreateCluster, onTrash])

  return handleDropRef
}
