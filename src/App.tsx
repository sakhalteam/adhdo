import { useState, useEffect, useRef, useCallback } from 'react'
import { load, save, makeGlob, makeCluster, makeConnection, genId, randomColor } from './store'
import type { GalaxyState, Glob } from './types'
import Galaxy from './Galaxy'

/* ── HomeBtn ─────────────────────────────────────────── */

function HomeBtn() {
  return (
    <a href="https://sakhalteam.github.io/" className="home-btn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        width="16" height="16">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
        <path d="M9 21V12h6v9" />
      </svg>
      sakhalteam
    </a>
  )
}

/* ── App ─────────────────────────────────────────────── */

export default function App() {
  const [state, setState] = useState<GalaxyState>(load)
  const inputRef = useRef<HTMLInputElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-save on state change (debounced)
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(state), 300)
  }, [state])

  // Focus input on load
  useEffect(() => { inputRef.current?.focus() }, [])

  const refocusInput = useCallback(() => { inputRef.current?.focus() }, [])

  // Add a new glob
  const addGlob = useCallback((text: string) => {
    if (!text.trim()) return
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    setState(prev => ({
      ...prev,
      globs: [...prev.globs, makeGlob(text.trim(), cx, cy)],
    }))
  }, [])

  // Add a new glob at a specific position
  const addGlobAt = useCallback((text: string, x: number, y: number) => {
    if (!text.trim()) return
    setState(prev => ({
      ...prev,
      globs: [...prev.globs, makeGlob(text.trim(), x, y)],
    }))
  }, [])

  // Delete a glob
  const deleteGlob = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.filter(g => g.id !== id),
      clusters: prev.clusters.map(c => ({
        ...c,
        globIds: c.globIds.filter(gid => gid !== id),
      })).filter(c => c.globIds.length > 0),
    }))
  }, [])

  // Update glob text
  const updateGlobText = useCallback((id: string, text: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, text, radius: Math.min(28 + text.length * 1.5, 60) } : g),
    }))
  }, [])

  // Toggle flag
  const toggleFlag = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, flagged: !g.flagged } : g),
    }))
  }, [])

  // Toggle todo
  const toggleTodo = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, isTodo: !g.isTodo, done: false } : g),
    }))
  }, [])

  // Toggle done
  const toggleDone = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, done: !g.done } : g),
    }))
  }, [])

  // Duplicate
  const duplicateGlob = useCallback((id: string) => {
    setState(prev => {
      const orig = prev.globs.find(g => g.id === id)
      if (!orig) return prev
      const dupe: Glob = {
        ...orig,
        id: genId(),
        x: orig.x + 30,
        y: orig.y + 30,
        vx: -orig.vx,
        vy: -orig.vy,
        createdAt: Date.now(),
        blobSeed: Math.random() * 1000,
      }
      return { ...prev, globs: [...prev.globs, dupe] }
    })
  }, [])

  // Update glob position (after drag)
  const updateGlobPos = useCallback((id: string, x: number, y: number) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, x, y, vx: 0, vy: 0 } : g),
    }))
  }, [])

  // Update globs (from physics)
  const updateGlobs = useCallback((updater: (globs: Glob[]) => Glob[]) => {
    setState(prev => ({ ...prev, globs: updater(prev.globs) }))
  }, [])

  // Update clusters (from physics)
  const updateState = useCallback((updater: (s: GalaxyState) => GalaxyState) => {
    setState(updater)
  }, [])

  // Create cluster from two globs dragged together
  const createCluster = useCallback((globId1: string, globId2: string, x: number, y: number) => {
    const cluster = makeCluster('new cluster', x, y, [globId1, globId2])
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g =>
        g.id === globId1 || g.id === globId2
          ? { ...g, clusterId: cluster.id }
          : g
      ),
      clusters: [...prev.clusters, cluster],
    }))
  }, [])

  // Add glob to existing cluster
  const addToCluster = useCallback((globId: string, clusterId: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === globId ? { ...g, clusterId } : g),
      clusters: prev.clusters.map(c =>
        c.id === clusterId
          ? { ...c, globIds: [...c.globIds, globId], lastInteraction: Date.now() }
          : c
      ),
    }))
  }, [])

  // Remove glob from cluster (pop it free)
  const removeFromCluster = useCallback((globId: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === globId ? { ...g, clusterId: null } : g),
      clusters: prev.clusters.map(c => ({
        ...c,
        globIds: c.globIds.filter(id => id !== globId),
      })).filter(c => c.globIds.length > 0),
    }))
  }, [])

  // Rename cluster
  const renameCluster = useCallback((id: string, name: string) => {
    setState(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === id ? { ...c, name, lastInteraction: Date.now() } : c),
    }))
  }, [])

  // Toggle cluster collapsed
  const toggleClusterCollapse = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === id ? { ...c, collapsed: !c.collapsed, lastInteraction: Date.now() } : c),
    }))
  }, [])

  // Dissolve cluster (frees all globs)
  const dissolveCluster = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.clusterId === id ? { ...g, clusterId: null } : g),
      clusters: prev.clusters.filter(c => c.id !== id),
      connections: prev.connections.filter(cn => cn.cluster1Id !== id && cn.cluster2Id !== id),
    }))
  }, [])

  // Update cluster position
  const updateClusterPos = useCallback((id: string, x: number, y: number) => {
    setState(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === id ? { ...c, x, y, vx: 0, vy: 0, lastInteraction: Date.now() } : c),
    }))
  }, [])

  // Touch cluster interaction timer (freeze drift)
  const touchCluster = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === id ? { ...c, lastInteraction: Date.now() } : c),
    }))
  }, [])

  // Reorder globs within a cluster
  const reorderClusterGlobs = useCallback((clusterId: string, globIds: string[]) => {
    setState(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === clusterId ? { ...c, globIds, lastInteraction: Date.now() } : c),
    }))
  }, [])

  // Change glob color
  const recolorGlob = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, color: randomColor() } : g),
    }))
  }, [])

  // Connect two clusters
  const connectClusters = useCallback((c1Id: string, c2Id: string) => {
    setState(prev => {
      // Don't duplicate connections
      const exists = prev.connections.some(
        cn => (cn.cluster1Id === c1Id && cn.cluster2Id === c2Id) ||
              (cn.cluster1Id === c2Id && cn.cluster2Id === c1Id)
      )
      if (exists) return prev
      return { ...prev, connections: [...prev.connections, makeConnection(c1Id, c2Id)] }
    })
  }, [])

  // Disconnect two clusters
  const disconnectClusters = useCallback((connectionId: string) => {
    setState(prev => ({
      ...prev,
      connections: prev.connections.filter(cn => cn.id !== connectionId),
    }))
  }, [])

  // Merge two connected clusters into one
  const mergeClusters = useCallback((c1Id: string, c2Id: string, newName: string) => {
    setState(prev => {
      const c1 = prev.clusters.find(c => c.id === c1Id)
      const c2 = prev.clusters.find(c => c.id === c2Id)
      if (!c1 || !c2) return prev
      const mergedGlobIds = [...c1.globIds, ...c2.globIds]
      const mx = (c1.x + c2.x) / 2
      const my = (c1.y + c2.y) / 2
      const merged = makeCluster(newName, mx, my, mergedGlobIds)
      return {
        ...prev,
        globs: prev.globs.map(g =>
          g.clusterId === c1Id || g.clusterId === c2Id
            ? { ...g, clusterId: merged.id }
            : g
        ),
        clusters: [
          ...prev.clusters.filter(c => c.id !== c1Id && c.id !== c2Id),
          merged,
        ],
        // Remove connections involving either old cluster, keep the rest
        connections: prev.connections.filter(
          cn => cn.cluster1Id !== c1Id && cn.cluster1Id !== c2Id &&
                cn.cluster2Id !== c1Id && cn.cluster2Id !== c2Id
        ),
      }
    })
  }, [])

  // Handle input submit
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      addGlob(e.currentTarget.value)
      e.currentTarget.value = ''
    }
  }

  return (
    <div className="app" onClick={refocusInput}>
      <HomeBtn />

      <Galaxy
        state={state}
        updateGlobs={updateGlobs}
        updateState={updateState}
        onAddGlobAt={addGlobAt}
        onDelete={deleteGlob}
        onUpdateText={updateGlobText}
        onToggleFlag={toggleFlag}
        onToggleTodo={toggleTodo}
        onToggleDone={toggleDone}
        onDuplicate={duplicateGlob}
        onUpdatePos={updateGlobPos}
        onCreateCluster={createCluster}
        onAddToCluster={addToCluster}
        onRemoveFromCluster={removeFromCluster}
        onRenameCluster={renameCluster}
        onToggleClusterCollapse={toggleClusterCollapse}
        onDissolveCluster={dissolveCluster}
        onUpdateClusterPos={updateClusterPos}
        onTouchCluster={touchCluster}
        onReorderClusterGlobs={reorderClusterGlobs}
        onRecolor={recolorGlob}
        onConnectClusters={connectClusters}
        onDisconnectClusters={disconnectClusters}
        onMergeClusters={mergeClusters}
      />

      <div className="capture-bar">
        <input
          ref={inputRef}
          type="text"
          className="capture-input"
          placeholder="brain dump here... hit enter to launch"
          onKeyDown={handleKeyDown}
          onClick={e => e.stopPropagation()}
          autoFocus
        />
      </div>
    </div>
  )
}
