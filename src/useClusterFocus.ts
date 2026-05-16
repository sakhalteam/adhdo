import { useCallback, useEffect, useState } from 'react'
import type { GalaxyState } from './types'

export function useClusterFocus({
  clusters,
  updateState,
  onTouchCluster,
  onHighlight,
  onCloseClusterBrowser,
}: {
  clusters: GalaxyState['clusters']
  updateState: (fn: (state: GalaxyState) => GalaxyState) => void
  onTouchCluster: (clusterId: string) => void
  onHighlight: (clusterId: string) => void
  onCloseClusterBrowser: () => void
}) {
  const [focusedClusterId, setFocusedClusterId] = useState<string | null>(null)

  useEffect(() => {
    if (focusedClusterId && !clusters.some(cluster => cluster.id === focusedClusterId)) {
      setFocusedClusterId(null)
    }
  }, [clusters, focusedClusterId])

  const getClusterSize = useCallback((clusterId: string) => {
    const el = document.querySelector(`.cluster[data-cluster-id="${clusterId}"]`) as HTMLElement | null
    return {
      width: el?.offsetWidth ?? 240,
      height: el?.offsetHeight ?? 132,
    }
  }, [])

  const centerCluster = useCallback((clusterId: string) => {
    updateState(prev => {
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const spotlightPadding = 26
      const targetSize = getClusterSize(clusterId)

      const clampPosition = (x: number, y: number, width: number, height: number) => ({
        x: Math.min(Math.max(x, width / 2 + 18), Math.max(width / 2 + 18, viewportWidth - width / 2 - 18)),
        y: Math.min(Math.max(y, height / 2 + 18), Math.max(height / 2 + 18, viewportHeight - height / 2 - 92)),
      })

      const spotlightY = Math.min(
        Math.max(viewportHeight * 0.38, 24 + targetSize.height / 2),
        viewportHeight - 110 - targetSize.height / 2,
      )

      const nextClusters = prev.clusters.map(cluster => ({ ...cluster, vx: 0, vy: 0 }))
      const targetIndex = nextClusters.findIndex(cluster => cluster.id === clusterId)
      if (targetIndex === -1) return prev

      const targetPos = clampPosition(viewportWidth / 2, spotlightY, targetSize.width, targetSize.height)
      nextClusters[targetIndex] = {
        ...nextClusters[targetIndex],
        x: targetPos.x,
        y: targetPos.y,
        lastInteraction: Date.now(),
      }

      const protectedIds = new Set<string>([clusterId])

      for (let iteration = 0; iteration < 10; iteration++) {
        let changed = false

        for (let i = 0; i < nextClusters.length; i++) {
          for (let j = i + 1; j < nextClusters.length; j++) {
            const a = nextClusters[i]
            const b = nextClusters[j]
            const aSize = getClusterSize(a.id)
            const bSize = getClusterSize(b.id)
            const dx = b.x - a.x
            const dy = b.y - a.y
            const overlapX = aSize.width / 2 + bSize.width / 2 + spotlightPadding - Math.abs(dx)
            const overlapY = aSize.height / 2 + bSize.height / 2 + spotlightPadding - Math.abs(dy)
            if (overlapX <= 0 || overlapY <= 0) continue

            const moveIndex =
              protectedIds.has(a.id) && !protectedIds.has(b.id) ? j :
              protectedIds.has(b.id) && !protectedIds.has(a.id) ? i :
              j

            const fixed = moveIndex === i ? b : a
            const moving = nextClusters[moveIndex]
            const movingSize = getClusterSize(moving.id)
            let nextX = moving.x
            let nextY = moving.y

            if (overlapX < overlapY) {
              const direction = ((moving.x - fixed.x) || (moveIndex === j ? 1 : -1)) >= 0 ? 1 : -1
              nextX += direction * (overlapX + 12)
            } else {
              const direction = ((moving.y - fixed.y) || 1) >= 0 ? 1 : -1
              nextY += direction * (overlapY + 12)
            }

            const clamped = clampPosition(nextX, nextY, movingSize.width, movingSize.height)
            if (clamped.x !== moving.x || clamped.y !== moving.y) {
              nextClusters[moveIndex] = {
                ...moving,
                x: clamped.x,
                y: clamped.y,
                lastInteraction: Date.now(),
              }
              changed = true
            }
          }
        }

        if (!changed) break
      }

      return { ...prev, clusters: nextClusters }
    })

    onHighlight(clusterId)
  }, [getClusterSize, onHighlight, updateState])

  const focusCluster = useCallback((clusterId: string, options?: { center?: boolean; pulse?: boolean }) => {
    setFocusedClusterId(clusterId)
    onTouchCluster(clusterId)
    if (options?.center) centerCluster(clusterId)
    if (options?.pulse !== false) onHighlight(clusterId)
    onCloseClusterBrowser()
  }, [centerCluster, onCloseClusterBrowser, onHighlight, onTouchCluster])

  const rescueClustersIntoView = useCallback(() => {
    updateState(prev => ({
      ...prev,
      clusters: prev.clusters.map(cluster => {
        const { width, height } = getClusterSize(cluster.id)
        const minX = width / 2 + 18
        const maxX = window.innerWidth - width / 2 - 18
        const minY = height / 2 + 18
        const maxY = window.innerHeight - height / 2 - 92
        const nextX = Math.min(Math.max(cluster.x, minX), Math.max(minX, maxX))
        const nextY = Math.min(Math.max(cluster.y, minY), Math.max(minY, maxY))

        return { ...cluster, x: nextX, y: nextY, vx: 0, vy: 0, lastInteraction: Date.now() }
      }),
    }))
  }, [getClusterSize, updateState])

  const organizeClusters = useCallback(() => {
    updateState(prev => {
      if (prev.clusters.length === 0) return prev

      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const marginX = 40
      const topMargin = 84
      const bottomMargin = 118
      const gapX = 28
      const gapY = 28
      const ordered = [...prev.clusters].sort((a, b) => (a.y - b.y) || (a.x - b.x) || a.name.localeCompare(b.name))
      const sizes = new Map(ordered.map(cluster => [cluster.id, getClusterSize(cluster.id)]))
      const maxWidth = Math.max(...ordered.map(cluster => sizes.get(cluster.id)?.width ?? 240))
      const maxHeight = Math.max(...ordered.map(cluster => sizes.get(cluster.id)?.height ?? 132))
      const availableWidth = Math.max(viewportWidth - marginX * 2, maxWidth)
      const availableHeight = Math.max(viewportHeight - topMargin - bottomMargin, maxHeight)
      const maxColumns = Math.max(1, Math.floor((availableWidth + gapX) / (maxWidth + gapX)))

      let columns = maxColumns
      for (let candidate = 1; candidate <= maxColumns; candidate++) {
        const rows = Math.ceil(ordered.length / candidate)
        const neededHeight = rows * maxHeight + (rows - 1) * gapY
        if (neededHeight <= availableHeight) {
          columns = candidate
          break
        }
      }

      const rows = Math.ceil(ordered.length / columns)
      const gridWidth = columns * maxWidth + (columns - 1) * gapX
      const gridHeight = rows * maxHeight + (rows - 1) * gapY
      const startX = marginX + Math.max((availableWidth - gridWidth) / 2, 0) + maxWidth / 2
      const startY = topMargin + Math.max((availableHeight - gridHeight) / 2, 0) + maxHeight / 2
      const now = Date.now()

      const nextById = new Map(ordered.map((cluster, index) => {
        const row = Math.floor(index / columns)
        const col = index % columns
        const size = sizes.get(cluster.id) ?? { width: 240, height: 132 }
        const minX = size.width / 2 + 18
        const maxX = viewportWidth - size.width / 2 - 18
        const minY = size.height / 2 + 18
        const maxY = viewportHeight - size.height / 2 - 92
        const targetX = startX + col * (maxWidth + gapX)
        const targetY = startY + row * (maxHeight + gapY)

        return [cluster.id, {
          ...cluster,
          x: Math.min(Math.max(targetX, minX), Math.max(minX, maxX)),
          y: Math.min(Math.max(targetY, minY), Math.max(minY, maxY)),
          vx: 0,
          vy: 0,
          lastInteraction: now,
        }]
      }))

      return {
        ...prev,
        clusters: prev.clusters.map(cluster => nextById.get(cluster.id) ?? cluster),
      }
    })

    onCloseClusterBrowser()
  }, [getClusterSize, onCloseClusterBrowser, updateState])

  return {
    focusedClusterId,
    setFocusedClusterId,
    focusCluster,
    rescueClustersIntoView,
    organizeClusters,
  }
}
