import { useState, useEffect, useRef, useCallback } from 'react'
import { load, save, makeGlob, makeCluster, genId, randomColor } from './store'
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

  // Focus input on load + refocus when clicking empty space
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const refocusInput = useCallback(() => {
    inputRef.current?.focus()
  }, [])

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

  // Delete a glob
  const deleteGlob = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.filter(g => g.id !== id),
      clusters: prev.clusters.map(c => ({
        ...c,
        globIds: c.globIds.filter(gid => gid !== id),
      })),
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

  // Update glob velocity + position (from physics)
  const updateGlobs = useCallback((updater: (globs: Glob[]) => Glob[]) => {
    setState(prev => ({ ...prev, globs: updater(prev.globs) }))
  }, [])

  // Create cluster from two globs dragged together
  const createCluster = useCallback((globId1: string, globId2: string, x: number, y: number) => {
    const name = 'new cluster'
    const cluster = makeCluster(name, x, y, [globId1, globId2])
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
          ? { ...c, globIds: [...c.globIds, globId] }
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
      clusters: prev.clusters.map(c => c.id === id ? { ...c, name } : c),
    }))
  }, [])

  // Toggle cluster collapsed
  const toggleClusterCollapse = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === id ? { ...c, collapsed: !c.collapsed } : c),
    }))
  }, [])

  // Delete cluster (frees all globs)
  const deleteCluster = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, clusterId: null } : g),
      clusters: prev.clusters.filter(c => c.id !== id),
    }))
  }, [])

  // Update cluster position
  const updateClusterPos = useCallback((id: string, x: number, y: number) => {
    setState(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === id ? { ...c, x, y } : c),
    }))
  }, [])

  // Change glob color
  const recolorGlob = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, color: randomColor() } : g),
    }))
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

      <Galaxy
        globs={state.globs}
        clusters={state.clusters}
        updateGlobs={updateGlobs}
        onDelete={deleteGlob}
        onUpdateText={updateGlobText}
        onToggleFlag={toggleFlag}
        onDuplicate={duplicateGlob}
        onUpdatePos={updateGlobPos}
        onCreateCluster={createCluster}
        onAddToCluster={addToCluster}
        onRemoveFromCluster={removeFromCluster}
        onRenameCluster={renameCluster}
        onToggleClusterCollapse={toggleClusterCollapse}
        onDeleteCluster={deleteCluster}
        onUpdateClusterPos={updateClusterPos}
        onRecolor={recolorGlob}
      />
    </div>
  )
}
