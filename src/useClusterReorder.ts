import { useCallback, useRef, useState } from 'react'
import type { Cluster } from './types'

export type DragReorderState = {
  clusterId: string
  globId: string
  overClusterId: string | null
  overGlobId: string | null
}

export function useClusterReorder({
  clusters,
  onMoveGlobToCluster,
  onReorderClusterGlobs,
}: {
  clusters: Cluster[]
  onMoveGlobToCluster: (globId: string, targetClusterId: string, beforeGlobId?: string | null) => void
  onReorderClusterGlobs: (clusterId: string, globIds: string[]) => void
}) {
  const dragHandledRef = useRef(false)
  const [dragReorder, setDragReorder] = useState<DragReorderState | null>(null)

  const onReorderDragStart = useCallback((clusterId: string, globId: string) => {
    dragHandledRef.current = false
    setDragReorder({ clusterId, globId, overClusterId: clusterId, overGlobId: null })
  }, [])

  const onReorderDragOver = useCallback((clusterId: string, overGlobId: string | null) => {
    setDragReorder(prev => prev ? { ...prev, overClusterId: clusterId, overGlobId } : null)
  }, [])

  const onReorderDrop = useCallback(() => {
    if (!dragReorder || !dragReorder.overClusterId) {
      setDragReorder(null)
      return
    }

    dragHandledRef.current = true

    if (dragReorder.overClusterId !== dragReorder.clusterId) {
      onMoveGlobToCluster(dragReorder.globId, dragReorder.overClusterId, dragReorder.overGlobId)
      setDragReorder(null)
      return
    }

    if (!dragReorder.overGlobId) {
      const cluster = clusters.find(c => c.id === dragReorder.clusterId)
      if (!cluster) {
        setDragReorder(null)
        return
      }
      const ids = cluster.globIds.filter(id => id !== dragReorder.globId)
      ids.push(dragReorder.globId)
      onReorderClusterGlobs(dragReorder.clusterId, ids)
      setDragReorder(null)
      return
    }

    const cluster = clusters.find(c => c.id === dragReorder.clusterId)
    if (!cluster) {
      setDragReorder(null)
      return
    }

    const ids = [...cluster.globIds]
    const fromIdx = ids.indexOf(dragReorder.globId)
    const toIdx = ids.indexOf(dragReorder.overGlobId)
    if (fromIdx === -1 || toIdx === -1) {
      setDragReorder(null)
      return
    }

    ids.splice(fromIdx, 1)
    ids.splice(toIdx, 0, dragReorder.globId)
    onReorderClusterGlobs(dragReorder.clusterId, ids)
    setDragReorder(null)
  }, [clusters, dragReorder, onMoveGlobToCluster, onReorderClusterGlobs])

  return {
    dragHandledRef,
    dragReorder,
    setDragReorder,
    onReorderDragStart,
    onReorderDragOver,
    onReorderDrop,
  }
}
