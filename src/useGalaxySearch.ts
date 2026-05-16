import { useMemo } from 'react'
import type { Cluster, Glob } from './types'

export type SearchResult = {
  type: 'glob' | 'cluster'
  id: string
  label: string
  sub?: string
}

export function useGalaxySearch({
  query,
  globs,
  clusters,
  focusCluster,
  onToggleClusterCollapse,
  onCloseSearch,
  onHighlight,
}: {
  query: string
  globs: Glob[]
  clusters: Cluster[]
  focusCluster: (clusterId: string, options?: { center?: boolean; pulse?: boolean }) => void
  onToggleClusterCollapse: (clusterId: string) => void
  onCloseSearch: () => void
  onHighlight: (id: string) => void
}) {
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return [] as SearchResult[]

    const nextResults: SearchResult[] = []
    for (const cluster of clusters) {
      if (cluster.name.toLowerCase().includes(q)) {
        nextResults.push({
          type: 'cluster',
          id: cluster.id,
          label: cluster.name,
          sub: `cluster · ${cluster.globIds.length} globs`,
        })
      }
    }

    for (const glob of globs) {
      if (glob.text.toLowerCase().includes(q)) {
        const parent = glob.clusterId ? clusters.find(cluster => cluster.id === glob.clusterId) : null
        nextResults.push({
          type: 'glob',
          id: glob.id,
          label: glob.text,
          sub: parent ? `in ${parent.name}` : 'free glob',
        })
      }
    }

    return nextResults.slice(0, 30)
  }, [clusters, globs, query])

  const jumpToResult = (result: SearchResult) => {
    if (result.type === 'cluster') {
      focusCluster(result.id, { center: true })
      onCloseSearch()
      return
    }

    const glob = globs.find(g => g.id === result.id)
    if (glob?.clusterId) {
      const parent = clusters.find(cluster => cluster.id === glob.clusterId)
      if (parent?.collapsed) onToggleClusterCollapse(parent.id)
      if (parent) focusCluster(parent.id, { center: true, pulse: false })
    }

    onHighlight(result.id)
    onCloseSearch()
  }

  return { results, jumpToResult }
}
