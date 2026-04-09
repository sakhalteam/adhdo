import { useState, useEffect, useRef, useCallback } from 'react'
import { load, save, makeGlob, makeCluster, makeConnection, genId, randomColor } from './store'
import type { GalaxyState, Glob } from './types'
import Galaxy from './Galaxy'

const MAX_UNDO = 40

/* ── HomeBtn ─────────────────────────────────────────── */

function HomeBtn() {
  return (
    <a href="https://sakhalteam.github.io/" className="home-btn" title="Back to island">
      <svg width="20" height="12" viewBox="0 0 32 18" fill="currentColor" aria-hidden="true">
        <path d="M 4,10 C 5,4 9,2 14,3 C 18,4 20,2 24,4 C 28,6 29,11 26,15 C 22,18 12,18 6,15 C 2,13 2,11 4,10 Z" />
      </svg>
      sakhalteam
    </a>
  )
}

/* ── App ─────────────────────────────────────────────── */

export default function App() {
  const [state, setStateRaw] = useState<GalaxyState>(load)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastSavedRef = useRef<string>('')
  const [showSaved, setShowSaved] = useState(false)

  // Undo/redo stacks
  const undoStack = useRef<GalaxyState[]>([])
  const redoStack = useRef<GalaxyState[]>([])
  const [undoLen, setUndoLen] = useState(0)
  const [redoLen, setRedoLen] = useState(0)

  // Tracked setState — snapshots before applying (for user actions)
  const setState = useCallback((updater: GalaxyState | ((prev: GalaxyState) => GalaxyState)) => {
    setStateRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (next === prev) return prev
      undoStack.current.push(prev)
      if (undoStack.current.length > MAX_UNDO) undoStack.current.shift()
      redoStack.current = []
      setUndoLen(undoStack.current.length)
      setRedoLen(0)
      return next
    })
  }, [])

  const undo = useCallback(() => {
    setStateRaw(prev => {
      const snapshot = undoStack.current.pop()
      if (!snapshot) return prev
      redoStack.current.push(prev)
      setUndoLen(undoStack.current.length)
      setRedoLen(redoStack.current.length)
      return snapshot
    })
  }, [])

  const redo = useCallback(() => {
    setStateRaw(prev => {
      const snapshot = redoStack.current.pop()
      if (!snapshot) return prev
      undoStack.current.push(prev)
      setUndoLen(undoStack.current.length)
      setRedoLen(redoStack.current.length)
      return snapshot
    })
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // Auto-save: check every 2s if state has actually changed from last save
  useEffect(() => {
    const interval = setInterval(() => {
      const json = JSON.stringify(state)
      if (json !== lastSavedRef.current) {
        save(state)
        lastSavedRef.current = json
        setShowSaved(true)
        setTimeout(() => setShowSaved(false), 1200)
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [state])

  // Also save on beforeunload
  useEffect(() => {
    const onUnload = () => save(state)
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [state])

  // Focus input on load
  useEffect(() => { inputRef.current?.focus() }, [])

  const refocusInput = useCallback(() => { inputRef.current?.focus() }, [])

  // ── Tracked actions (create undo snapshots) ──────────

  const addGlob = useCallback((text: string) => {
    if (!text.trim()) return
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    setState(prev => ({
      ...prev,
      globs: [...prev.globs, makeGlob(text.trim(), cx, cy)],
    }))
  }, [setState])

  const addGlobAt = useCallback((text: string, x: number, y: number) => {
    if (!text.trim()) return
    setState(prev => ({
      ...prev,
      globs: [...prev.globs, makeGlob(text.trim(), x, y)],
    }))
  }, [setState])

  const deleteGlob = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.filter(g => g.id !== id),
      clusters: prev.clusters.map(c => ({
        ...c,
        globIds: c.globIds.filter(gid => gid !== id),
      })).filter(c => c.globIds.length > 0),
    }))
  }, [setState])

  const updateGlobText = useCallback((id: string, text: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, text, radius: Math.min(28 + text.length * 1.5, 60) } : g),
    }))
  }, [setState])

  const toggleFlag = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, flagged: !g.flagged } : g),
    }))
  }, [setState])

  const toggleTodo = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, isTodo: !g.isTodo, done: false } : g),
    }))
  }, [setState])

  const toggleDone = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, done: !g.done } : g),
    }))
  }, [setState])

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
  }, [setState])

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
  }, [setState])

  const convertToCluster = useCallback((globId: string) => {
    setState(prev => {
      const g = prev.globs.find(g => g.id === globId)
      if (!g) return prev
      const cluster = makeCluster('new cluster', g.x, g.y, [globId])
      return {
        ...prev,
        globs: prev.globs.map(gl => gl.id === globId ? { ...gl, clusterId: cluster.id } : gl),
        clusters: [...prev.clusters, cluster],
      }
    })
  }, [setState])

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
  }, [setState])

  const removeFromCluster = useCallback((globId: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === globId ? { ...g, clusterId: null } : g),
      clusters: prev.clusters.map(c => ({
        ...c,
        globIds: c.globIds.filter(id => id !== globId),
      })),
    }))
  }, [setState])

  const deleteCluster = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.clusterId === id ? { ...g, clusterId: null } : g),
      clusters: prev.clusters.filter(c => c.id !== id),
      connections: prev.connections.filter(cn => cn.cluster1Id !== id && cn.cluster2Id !== id),
    }))
  }, [setState])

  const renameCluster = useCallback((id: string, name: string) => {
    setState(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === id ? { ...c, name, lastInteraction: Date.now() } : c),
    }))
  }, [setState])

  const toggleClusterCollapse = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === id ? { ...c, collapsed: !c.collapsed, lastInteraction: Date.now() } : c),
    }))
  }, [setState])

  const dissolveCluster = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.clusterId === id ? { ...g, clusterId: null } : g),
      clusters: prev.clusters.filter(c => c.id !== id),
      connections: prev.connections.filter(cn => cn.cluster1Id !== id && cn.cluster2Id !== id),
    }))
  }, [setState])

  const reorderClusterGlobs = useCallback((clusterId: string, globIds: string[]) => {
    setState(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === clusterId ? { ...c, globIds, lastInteraction: Date.now() } : c),
    }))
  }, [setState])

  const recolorGlob = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, color: randomColor() } : g),
    }))
  }, [setState])

  const connectClusters = useCallback((c1Id: string, c2Id: string) => {
    setState(prev => {
      const exists = prev.connections.some(
        cn => (cn.cluster1Id === c1Id && cn.cluster2Id === c2Id) ||
              (cn.cluster1Id === c2Id && cn.cluster2Id === c1Id)
      )
      if (exists) return prev
      return { ...prev, connections: [...prev.connections, makeConnection(c1Id, c2Id)] }
    })
  }, [setState])

  const disconnectClusters = useCallback((connectionId: string) => {
    setState(prev => ({
      ...prev,
      connections: prev.connections.filter(cn => cn.id !== connectionId),
    }))
  }, [setState])

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
        connections: prev.connections.filter(
          cn => cn.cluster1Id !== c1Id && cn.cluster1Id !== c2Id &&
                cn.cluster2Id !== c1Id && cn.cluster2Id !== c2Id
        ),
      }
    })
  }, [setState])

  // ── Untracked updates (physics, drag position, touch) ──

  const updateGlobPos = useCallback((id: string, x: number, y: number) => {
    setStateRaw(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, x, y, vx: 0, vy: 0 } : g),
    }))
  }, [])

  const updateGlobs = useCallback((updater: (globs: Glob[]) => Glob[]) => {
    setStateRaw(prev => ({ ...prev, globs: updater(prev.globs) }))
  }, [])

  const updateState = useCallback((updater: (s: GalaxyState) => GalaxyState) => {
    setStateRaw(updater)
  }, [])

  const updateClusterPos = useCallback((id: string, x: number, y: number) => {
    setStateRaw(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === id ? { ...c, x, y, vx: 0, vy: 0, lastInteraction: Date.now() } : c),
    }))
  }, [])

  const touchCluster = useCallback((id: string) => {
    setStateRaw(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === id ? { ...c, lastInteraction: Date.now() } : c),
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

      {/* Undo / Redo buttons */}
      <div className="undo-redo-bar">
        <button
          className="undo-redo-btn"
          onClick={e => { e.stopPropagation(); undo() }}
          disabled={undoLen === 0}
          title="Undo (Ctrl+Z)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </button>
        <button
          className="undo-redo-btn"
          onClick={e => { e.stopPropagation(); redo() }}
          disabled={redoLen === 0}
          title="Redo (Ctrl+Y)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
          </svg>
        </button>
      </div>

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
        onConvertToCluster={convertToCluster}
        onAddToCluster={addToCluster}
        onRemoveFromCluster={removeFromCluster}
        onRenameCluster={renameCluster}
        onToggleClusterCollapse={toggleClusterCollapse}
        onDissolveCluster={dissolveCluster}
        onDeleteCluster={deleteCluster}
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

      {/* Save indicator */}
      <div className={`save-indicator ${showSaved ? 'visible' : ''}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        saved
      </div>
    </div>
  )
}
