import { useRef, useEffect, useCallback, useState } from 'react'
import type { Glob, Cluster, GalaxyState, Connection } from './types'

interface Props {
  state: GalaxyState
  updateGlobs: (fn: (globs: Glob[]) => Glob[]) => void
  updateState: (fn: (s: GalaxyState) => GalaxyState) => void
  onAddGlobAt: (text: string, x: number, y: number) => void
  onDelete: (id: string) => void
  onUpdateText: (id: string, text: string) => void
  onToggleFlag: (id: string) => void
  onToggleTodo: (id: string) => void
  onToggleDone: (id: string) => void
  onDuplicate: (id: string) => void
  onUpdatePos: (id: string, x: number, y: number) => void
  onCreateCluster: (id1: string, id2: string, x: number, y: number) => void
  onAddToCluster: (globId: string, clusterId: string) => void
  onRemoveFromCluster: (globId: string) => void
  onRenameCluster: (id: string, name: string) => void
  onToggleClusterCollapse: (id: string) => void
  onDissolveCluster: (id: string) => void
  onUpdateClusterPos: (id: string, x: number, y: number) => void
  onTouchCluster: (id: string) => void
  onReorderClusterGlobs: (clusterId: string, globIds: string[]) => void
  onRecolor: (id: string) => void
  onConnectClusters: (c1Id: string, c2Id: string) => void
  onDisconnectClusters: (connectionId: string) => void
  onMergeClusters: (c1Id: string, c2Id: string, newName: string) => void
}

const DAMPING = 0.9995
const BOUNCE = 0.6
const REPEL_DIST = 90
const REPEL_FORCE = 0.02
const MIN_SPEED = 0.12
const CLUSTER_IDLE_MS = 5000 // drift starts after 5s idle
const CLUSTER_SPEED = 0.04   // much slower than globs
const CLUSTER_DAMPING = 0.999

export default function Galaxy({
  state, updateGlobs, updateState,
  onAddGlobAt, onDelete, onUpdateText, onToggleFlag, onToggleTodo, onToggleDone,
  onDuplicate, onUpdatePos,
  onCreateCluster, onAddToCluster, onRemoveFromCluster,
  onRenameCluster, onToggleClusterCollapse, onDissolveCluster,
  onUpdateClusterPos, onTouchCluster, onReorderClusterGlobs,
  onRecolor,
  onConnectClusters, onDisconnectClusters, onMergeClusters,
}: Props) {
  const { globs, clusters, connections } = state
  const animRef = useRef(0)
  const dragging = useRef<{ id: string; type: 'glob' | 'cluster'; offX: number; offY: number } | null>(null)
  const handleDropRef = useRef<(globId: string, dropX: number, dropY: number) => void>(() => {})
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; globId: string; inCluster: boolean } | null>(null)
  const [clusterCtx, setClusterCtx] = useState<{ x: number; y: number; clusterId: string } | null>(null)
  const [dissolveConfirm, setDissolveConfirm] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingClusterId, setEditingClusterId] = useState<string | null>(null)
  const [dragReorder, setDragReorder] = useState<{ clusterId: string; globId: string; overGlobId: string | null } | null>(null)
  const [newGlobPos, setNewGlobPos] = useState<{ x: number; y: number } | null>(null)
  const [draggingFreeGlob, setDraggingFreeGlob] = useState(false)
  const [trashConfirm, setTrashConfirm] = useState<string | null>(null)
  const [shakeDissolve, setShakeDissolve] = useState<string | null>(null)
  const [draggingClusterId, setDraggingClusterId] = useState<string | null>(null)
  const shakeHistory = useRef<{ x: number; y: number; t: number }[]>([])
  const [connecting, setConnecting] = useState<{ fromClusterId: string; cursorX: number; cursorY: number } | null>(null)
  const [hoveredConnection, setHoveredConnection] = useState<string | null>(null)
  const [mergePrompt, setMergePrompt] = useState<{ c1Id: string; c2Id: string; connectionId: string } | null>(null)
  const TRASH_SIZE = 56
  const TRASH_MARGIN = 24

  // Physics loop for free globs + idle cluster drift
  useEffect(() => {
    function tick() {
      const now = Date.now()

      // Update free globs
      updateGlobs(prev => {
        const w = window.innerWidth
        const h = window.innerHeight
        const dragId = dragging.current?.id

        return prev.map((g, i) => {
          if (g.clusterId || g.id === dragId) return g

          let { x, y, vx, vy } = g

          for (let j = 0; j < prev.length; j++) {
            if (i === j || prev[j].clusterId || prev[j].id === dragId) continue
            const dx = x - prev[j].x
            const dy = y - prev[j].y
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < REPEL_DIST && dist > 0) {
              const force = REPEL_FORCE * (1 - dist / REPEL_DIST)
              vx += (dx / dist) * force
              vy += (dy / dist) * force
            }
          }

          vx *= DAMPING
          vy *= DAMPING

          const speed = Math.sqrt(vx * vx + vy * vy)
          if (speed < MIN_SPEED) {
            const angle = Math.atan2(vy, vx) + (Math.random() - 0.5) * 1.5
            vx = Math.cos(angle) * MIN_SPEED
            vy = Math.sin(angle) * MIN_SPEED
          }

          x += vx
          y += vy

          const r = g.radius
          const bottomBound = 70
          if (x - r < 0) { x = r; vx = Math.abs(vx) * BOUNCE }
          if (x + r > w) { x = w - r; vx = -Math.abs(vx) * BOUNCE }
          if (y - r < 10) { y = 10 + r; vy = Math.abs(vy) * BOUNCE }
          if (y + r > h - bottomBound) { y = h - bottomBound - r; vy = -Math.abs(vy) * BOUNCE }

          return { ...g, x, y, vx, vy }
        })
      })

      // Update cluster drift
      updateState(prev => {
        const w = window.innerWidth
        const h = window.innerHeight
        const dragId = dragging.current?.id

        const newClusters = prev.clusters.map(c => {
          if (c.id === dragId) return c
          const idle = now - c.lastInteraction
          if (idle < CLUSTER_IDLE_MS) return c

          let { x, y, vx, vy } = c
          const speed = Math.sqrt(vx * vx + vy * vy)
          if (speed < CLUSTER_SPEED) {
            const angle = Math.random() * Math.PI * 2
            vx = Math.cos(angle) * CLUSTER_SPEED
            vy = Math.sin(angle) * CLUSTER_SPEED
          }

          vx *= CLUSTER_DAMPING
          vy *= CLUSTER_DAMPING
          x += vx
          y += vy

          // Bounce clusters off walls
          if (x < 100) { x = 100; vx = Math.abs(vx) }
          if (x > w - 100) { x = w - 100; vx = -Math.abs(vx) }
          if (y < 60) { y = 60; vy = Math.abs(vy) }
          if (y > h - 120) { y = h - 120; vy = -Math.abs(vy) }

          return { ...c, x, y, vx, vy }
        })

        if (newClusters === prev.clusters) return prev
        return { ...prev, clusters: newClusters }
      })

      animRef.current = requestAnimationFrame(tick)
    }

    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [updateGlobs, updateState])

  // Drag handlers
  const onPointerDown = useCallback((e: React.PointerEvent, id: string, type: 'glob' | 'cluster') => {
    // Don't drag when interacting with inputs, buttons, or draggable reorder items
    const target = e.target as HTMLElement
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'BUTTON') return
    // If pointer is on a draggable item or grip handle inside a cluster, let HTML5 drag handle it
    if (type === 'cluster' && (target.closest('.cluster-glob-grip') || target.closest('[draggable="true"]'))) return

    e.stopPropagation()
    e.preventDefault()
    setContextMenu(null)
    setClusterCtx(null)
    setDissolveConfirm(null)
    setNewGlobPos(null)

    if (type === 'cluster') {
      onTouchCluster(id)
      setDraggingClusterId(id)
      shakeHistory.current = [{ x: e.clientX, y: e.clientY, t: Date.now() }]
    }
    if (type === 'glob') {
      const g = globs.find(g => g.id === id)
      if (g && !g.clusterId) setDraggingFreeGlob(true)
    }

    // For clusters, compute offset from the cluster element's center (not the handle)
    const el = type === 'cluster'
      ? (e.currentTarget as HTMLElement).closest('.cluster') as HTMLElement
      : e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    dragging.current = {
      id,
      type,
      offX: e.clientX - rect.left - rect.width / 2,
      offY: e.clientY - rect.top - rect.height / 2,
    }

    const onMove = (ev: PointerEvent) => {
      if (!dragging.current) return
      const nx = ev.clientX - dragging.current.offX
      const ny = ev.clientY - dragging.current.offY
      if (dragging.current.type === 'glob') {
        onUpdatePos(dragging.current.id, nx, ny)
      } else {
        onUpdateClusterPos(dragging.current.id, nx, ny)

        // Track shake history
        const now = Date.now()
        const hist = shakeHistory.current
        hist.push({ x: ev.clientX, y: ev.clientY, t: now })
        // Keep last 1.5s of history
        while (hist.length > 0 && now - hist[0].t > 1500) hist.shift()

        // Detect shake: count direction reversals in X axis
        if (hist.length >= 6) {
          let reversals = 0
          for (let i = 2; i < hist.length; i++) {
            const dx1 = hist[i - 1].x - hist[i - 2].x
            const dx2 = hist[i].x - hist[i - 1].x
            if (dx1 * dx2 < 0 && Math.abs(dx2) > 3) reversals++
          }
          if (reversals >= 5) {
            // Shake detected — stop drag, show modal
            dragging.current = null
            shakeHistory.current = []
            setDraggingFreeGlob(false)
            setDraggingClusterId(null)
            setShakeDissolve(id)
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            return
          }
        }
      }
    }

    const onUp = (ev: PointerEvent) => {
      if (dragging.current?.type === 'glob') {
        handleDropRef.current(dragging.current.id, ev.clientX, ev.clientY)
      }
      dragging.current = null
      shakeHistory.current = []
      setDraggingFreeGlob(false)
      setDraggingClusterId(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [onUpdatePos, onUpdateClusterPos, onTouchCluster, globs])

  // Drop handler ref (always fresh)
  handleDropRef.current = (globId: string, dropX: number, dropY: number) => {
    const droppedGlob = globs.find(g => g.id === globId)
    if (!droppedGlob) return

    // Check if dropped on trash zone (bottom-right corner)
    const w = window.innerWidth
    const h = window.innerHeight
    const trashCx = w - TRASH_MARGIN - TRASH_SIZE / 2
    const trashCy = h - 80 - TRASH_SIZE / 2
    const dx0 = dropX - trashCx
    const dy0 = dropY - trashCy
    if (Math.sqrt(dx0 * dx0 + dy0 * dy0) < TRASH_SIZE) {
      setTrashConfirm(globId)
      return
    }

    for (const c of clusters) {
      const dx = droppedGlob.x - c.x
      const dy = droppedGlob.y - c.y
      if (Math.sqrt(dx * dx + dy * dy) < 120 && !droppedGlob.clusterId) {
        onAddToCluster(globId, c.id)
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

  // Context menu
  const onCtx = useCallback((e: React.MouseEvent, globId: string, inCluster: boolean) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, globId, inCluster })
    setClusterCtx(null)
    setDissolveConfirm(null)
  }, [])

  useEffect(() => {
    const close = () => { setContextMenu(null); setClusterCtx(null); setDissolveConfirm(null) }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  // Drag reorder within clusters
  const onReorderDragStart = useCallback((clusterId: string, globId: string) => {
    setDragReorder({ clusterId, globId, overGlobId: null })
  }, [])

  const onReorderDragOver = useCallback((globId: string) => {
    setDragReorder(prev => prev ? { ...prev, overGlobId: globId } : null)
  }, [])

  const onReorderDrop = useCallback(() => {
    if (!dragReorder || !dragReorder.overGlobId) { setDragReorder(null); return }
    const cluster = clusters.find(c => c.id === dragReorder.clusterId)
    if (!cluster) { setDragReorder(null); return }

    const ids = [...cluster.globIds]
    const fromIdx = ids.indexOf(dragReorder.globId)
    const toIdx = ids.indexOf(dragReorder.overGlobId)
    if (fromIdx === -1 || toIdx === -1) { setDragReorder(null); return }

    ids.splice(fromIdx, 1)
    ids.splice(toIdx, 0, dragReorder.globId)
    onReorderClusterGlobs(dragReorder.clusterId, ids)
    setDragReorder(null)
  }, [dragReorder, clusters, onReorderClusterGlobs])

  const freeGlobs = globs.filter(g => !g.clusterId)
  const clusterGlobs = (c: Cluster) => {
    const map = new Map(globs.map(g => [g.id, g]))
    return c.globIds.map(id => map.get(id)).filter(Boolean) as Glob[]
  }

  return (
    <div className="galaxy" onContextMenu={e => {
      // Only trigger on the galaxy background itself
      if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('galaxy')) {
        e.preventDefault()
        setContextMenu(null)
        setClusterCtx(null)
        setNewGlobPos({ x: e.clientX, y: e.clientY })
      }
    }}>
      {/* SVG filter for blobby shapes */}
      <svg className="absolute w-0 h-0" aria-hidden="true">
        <defs>
          <filter id="goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feColorMatrix in="blur" type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      {/* Connection lines between clusters */}
      <svg className="connection-lines" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 15 }}>
        {connections.map(cn => {
          const c1 = clusters.find(c => c.id === cn.cluster1Id)
          const c2 = clusters.find(c => c.id === cn.cluster2Id)
          if (!c1 || !c2) return null
          const mx = (c1.x + c2.x) / 2
          const my = (c1.y + c2.y) / 2
          return (
            <g key={cn.id}>
              {/* Fat invisible line for hover hit area */}
              <line
                x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y}
                stroke="transparent" strokeWidth="20"
                style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                onPointerEnter={() => setHoveredConnection(cn.id)}
                onPointerLeave={() => setHoveredConnection(prev => prev === cn.id ? null : prev)}
              />
              {/* Visible line */}
              <line
                x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y}
                stroke={cn.color} strokeWidth="2" strokeDasharray="6 4"
                opacity={hoveredConnection === cn.id ? 0.7 : 0.4}
                style={{ transition: 'opacity 0.2s' }}
              />
              {/* Merge button at midpoint (on hover) */}
              {hoveredConnection === cn.id && (
                <foreignObject x={mx - 16} y={my - 16} width="32" height="32" style={{ pointerEvents: 'auto' }}>
                  <div
                    className="connection-merge-btn"
                    title="Merge"
                    onClick={e => {
                      e.stopPropagation()
                      setMergePrompt({ c1Id: cn.cluster1Id, c2Id: cn.cluster2Id, connectionId: cn.id })
                      setHoveredConnection(null)
                    }}
                    onContextMenu={e => {
                      e.preventDefault(); e.stopPropagation()
                      onDisconnectClusters(cn.id)
                      setHoveredConnection(null)
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                    </svg>
                  </div>
                </foreignObject>
              )}
            </g>
          )
        })}
        {/* Temporary line while connecting */}
        {connecting && (() => {
          const from = clusters.find(c => c.id === connecting.fromClusterId)
          if (!from) return null
          return (
            <line
              x1={from.x} y1={from.y}
              x2={connecting.cursorX} y2={connecting.cursorY}
              stroke="#7c3aed" strokeWidth="2" strokeDasharray="6 4"
              opacity="0.6"
            />
          )
        })()}
      </svg>

      {/* Free-floating globs */}
      {freeGlobs.map(g => (
        <div
          key={g.id}
          className={`glob ${g.flagged ? 'flagged' : ''}`}
          style={{
            left: g.x,
            top: g.y,
            width: g.radius * 2,
            height: g.radius * 2,
            background: g.color,
            animationDelay: `${-(g.blobSeed % 10)}s`,
          }}
          onPointerDown={e => onPointerDown(e, g.id, 'glob')}
          onContextMenu={e => onCtx(e, g.id, false)}
          onDoubleClick={(e) => { e.stopPropagation(); setEditingId(g.id) }}
        >
          {g.flagged && <span className="flag-dot" />}
          {editingId === g.id ? (
            <input
              className="glob-edit"
              defaultValue={g.text}
              autoFocus
              onClick={e => e.stopPropagation()}
              onBlur={e => { onUpdateText(g.id, e.currentTarget.value); setEditingId(null) }}
              onKeyDown={e => {
                if (e.key === 'Enter') { onUpdateText(g.id, e.currentTarget.value); setEditingId(null) }
                if (e.key === 'Escape') setEditingId(null)
              }}
            />
          ) : (
            <span className="glob-text">{g.text}</span>
          )}
        </div>
      ))}

      {/* Clusters */}
      {clusters.map(c => {
        const cGlobs = clusterGlobs(c)
        const isIdle = Date.now() - c.lastInteraction > CLUSTER_IDLE_MS
        return (
          <div
            key={c.id}
            className={`cluster ${c.collapsed ? 'collapsed' : ''} ${isIdle ? 'drifting' : ''} ${draggingClusterId === c.id ? 'dragging-active' : ''}`}
            data-cluster-id={c.id}
            style={{ left: c.x, top: c.y, borderColor: c.color }}
            onPointerEnter={() => onTouchCluster(c.id)}
            onPointerDown={e => {
              // Drag when clicking the cluster border area (within 8px of edge)
              const rect = e.currentTarget.getBoundingClientRect()
              const mx = e.clientX, my = e.clientY
              const inset = 8
              const nearEdge = mx < rect.left + inset || mx > rect.right - inset
                || my < rect.top + inset || my > rect.bottom - inset
              if (nearEdge) onPointerDown(e, c.id, 'cluster')
            }}
          >
            <div className="cluster-drag-handle"
              onPointerDown={e => onPointerDown(e, c.id, 'cluster')}
              onContextMenu={e => {
                e.preventDefault(); e.stopPropagation()
                setClusterCtx({ x: e.clientX, y: e.clientY, clusterId: c.id })
                setContextMenu(null)
              }}
            >⠿</div>
            <div className="cluster-link-handle" title="Drag to connect"
              onPointerDown={e => {
                e.stopPropagation()
                e.preventDefault()
                setConnecting({ fromClusterId: c.id, cursorX: e.clientX, cursorY: e.clientY })

                const onMove = (ev: PointerEvent) => {
                  setConnecting(prev => prev ? { ...prev, cursorX: ev.clientX, cursorY: ev.clientY } : null)
                }
                const onUp = (ev: PointerEvent) => {
                  // Check if cursor is over another cluster
                  const el = document.elementFromPoint(ev.clientX, ev.clientY)
                  const clusterEl = el?.closest('.cluster') as HTMLElement | null
                  if (clusterEl) {
                    const targetId = clusterEl.dataset.clusterId
                    if (targetId && targetId !== c.id) {
                      onConnectClusters(c.id, targetId)
                    }
                  }
                  setConnecting(null)
                  window.removeEventListener('pointermove', onMove)
                  window.removeEventListener('pointerup', onUp)
                }
                window.addEventListener('pointermove', onMove)
                window.addEventListener('pointerup', onUp)
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <div className="cluster-header" onContextMenu={e => {
              e.preventDefault(); e.stopPropagation()
              setClusterCtx({ x: e.clientX, y: e.clientY, clusterId: c.id })
              setContextMenu(null)
            }}>
              {editingClusterId === c.id ? (
                <input
                  className="cluster-name-edit"
                  defaultValue={c.name}
                  autoFocus
                  onFocus={e => e.currentTarget.select()}
                  onClick={e => e.stopPropagation()}
                  onBlur={e => { onRenameCluster(c.id, e.currentTarget.value); setEditingClusterId(null) }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { onRenameCluster(c.id, e.currentTarget.value); setEditingClusterId(null) }
                    if (e.key === 'Escape') setEditingClusterId(null)
                  }}
                />
              ) : (
                <span className="cluster-name"
                  onClick={e => { e.stopPropagation(); setEditingClusterId(c.id) }}
                >
                  {c.name}
                </span>
              )}
              <div className="cluster-actions">
                <button onClick={e => { e.stopPropagation(); onToggleClusterCollapse(c.id) }}>
                  {c.collapsed ? '＋' : '－'}
                </button>
                {dissolveConfirm === c.id ? (
                  <div className="dissolve-confirm" onClick={e => e.stopPropagation()}>
                    <span>release globs?</span>
                    <button className="dissolve-yes" onClick={() => { onDissolveCluster(c.id); setDissolveConfirm(null) }}>yes</button>
                    <button className="dissolve-no" onClick={() => setDissolveConfirm(null)}>no</button>
                  </div>
                ) : (
                  <button onClick={e => { e.stopPropagation(); setDissolveConfirm(c.id) }} title="Release globs">
                    ✕
                  </button>
                )}
              </div>
            </div>

            {!c.collapsed && (
              <div className="cluster-globs">
                {cGlobs.map(g => (
                  <div
                    key={g.id}
                    className={`cluster-glob-item ${g.flagged ? 'flagged' : ''} ${g.done ? 'done' : ''} ${dragReorder?.overGlobId === g.id ? 'drag-over' : ''}`}
                    style={{ borderLeftColor: g.color }}
                    draggable
                    onDragStart={e => { e.stopPropagation(); onReorderDragStart(c.id, g.id) }}
                    onDragOver={e => { e.preventDefault(); e.stopPropagation(); onReorderDragOver(g.id) }}
                    onDrop={e => { e.preventDefault(); e.stopPropagation(); onReorderDrop() }}
                    onDragEnd={e => {
                      const clusterEl = (e.target as HTMLElement).closest('.cluster')
                      if (clusterEl) {
                        const rect = clusterEl.getBoundingClientRect()
                        const margin = 60
                        const { clientX: mx, clientY: my } = e
                        if (mx < rect.left - margin || mx > rect.right + margin || my < rect.top - margin || my > rect.bottom + margin) {
                          onRemoveFromCluster(g.id)
                          onUpdatePos(g.id, mx, my)
                          setDragReorder(null)
                          return
                        }
                      }
                      setDragReorder(null)
                    }}
                    onContextMenu={e => onCtx(e, g.id, true)}
                  >
                    {g.isTodo && (
                      <button
                        className={`todo-check ${g.done ? 'checked' : ''}`}
                        onClick={e => { e.stopPropagation(); onToggleDone(g.id) }}
                      >
                        {g.done ? '✓' : ''}
                      </button>
                    )}
                    <div className="cluster-glob-grip" title="Drag to reorder">⠿</div>
                    {editingId === g.id ? (
                      <input
                        className="glob-edit inline"
                        defaultValue={g.text}
                        autoFocus
                        onFocus={e => e.currentTarget.select()}
                        onClick={e => e.stopPropagation()}
                        onBlur={e => { onUpdateText(g.id, e.currentTarget.value); setEditingId(null) }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { onUpdateText(g.id, e.currentTarget.value); setEditingId(null) }
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                      />
                    ) : (
                      <span className={`cluster-glob-text ${g.done ? 'line-through opacity-50' : ''}`}>
                        <span
                          className="cluster-glob-text-inner"
                          onClick={e => { e.stopPropagation(); setEditingId(g.id) }}
                        >
                          {g.flagged && <span className="flag-dot-inline" />}
                          {g.text}
                        </span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {c.collapsed && (
              <span className="cluster-count">{cGlobs.length} items</span>
            )}
          </div>
        )
      })}

      {/* Cluster context menu */}
      {clusterCtx && (() => {
        const c = clusters.find(cl => cl.id === clusterCtx.clusterId)
        if (!c) return null
        return (
          <div
            className="ctx-menu"
            style={{ left: clusterCtx.x, top: clusterCtx.y }}
            onClick={e => e.stopPropagation()}
          >
            <button onClick={() => { setEditingClusterId(c.id); setClusterCtx(null) }}>
              ✏️ Rename
            </button>
            <button onClick={() => { onToggleClusterCollapse(c.id); setClusterCtx(null) }}>
              {c.collapsed ? '＋ Expand' : '－ Collapse'}
            </button>
            <hr />
            <button className="ctx-danger" onClick={() => { onDissolveCluster(c.id); setClusterCtx(null) }}>
              💨 Dissolve
            </button>
          </div>
        )
      })()}

      {/* Glob context menu */}
      {contextMenu && (
        <div
          className="ctx-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <button onClick={() => { setEditingId(contextMenu.globId); setContextMenu(null) }}>
            ✏️ Edit
          </button>
          <button onClick={() => { onToggleFlag(contextMenu.globId); setContextMenu(null) }}>
            🚩 Flag
          </button>
          <button onClick={() => {
            onToggleTodo(contextMenu.globId)
            setContextMenu(null)
          }}>
            {globs.find(g => g.id === contextMenu.globId)?.isTodo ? '☑️ Remove todo' : '☐ Make todo'}
          </button>
          <button onClick={() => { onDuplicate(contextMenu.globId); setContextMenu(null) }}>
            📋 Duplicate
          </button>
          <button onClick={() => { onRecolor(contextMenu.globId); setContextMenu(null) }}>
            🎨 Recolor
          </button>
          {contextMenu.inCluster && (
            <button onClick={() => { onRemoveFromCluster(contextMenu.globId); setContextMenu(null) }}>
              ↗️ Pop out
            </button>
          )}
          <hr />
          <button className="ctx-danger" onClick={() => { onDelete(contextMenu.globId); setContextMenu(null) }}>
            🗑️ Delete
          </button>
        </div>
      )}

      {/* Right-click create glob */}
      {newGlobPos && (
        <div className="new-glob-input" style={{ left: newGlobPos.x, top: newGlobPos.y }}
          onClick={e => e.stopPropagation()}>
          <input
            autoFocus
            placeholder="new thought..."
            onBlur={e => {
              if (e.currentTarget.value.trim()) onAddGlobAt(e.currentTarget.value, newGlobPos.x, newGlobPos.y)
              setNewGlobPos(null)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                if (e.currentTarget.value.trim()) onAddGlobAt(e.currentTarget.value, newGlobPos.x, newGlobPos.y)
                setNewGlobPos(null)
              }
              if (e.key === 'Escape') setNewGlobPos(null)
            }}
          />
        </div>
      )}

      {/* Trash zone (visible when dragging a free glob) */}
      <div className={`trash-zone ${draggingFreeGlob ? 'visible' : ''}`}>
        <span className="trash-icon">🗑️</span>
      </div>

      {/* Trash confirmation toast */}
      {trashConfirm && (
        <div className="trash-toast" onClick={e => e.stopPropagation()}>
          <span className="trash-toast-label">delete?</span>
          <button className="trash-toast-btn" onClick={() => { onDelete(trashConfirm); setTrashConfirm(null) }}>
            delete
          </button>
          <button className="trash-toast-cancel" onClick={() => setTrashConfirm(null)}>
            cancel
          </button>
        </div>
      )}

      {/* Shake dissolve modal */}
      {shakeDissolve && (
        <div className="shake-modal-overlay" onClick={e => { e.stopPropagation(); setShakeDissolve(null) }}>
          <div className="shake-modal" onClick={e => e.stopPropagation()}>
            <p>release all globs?</p>
            <div className="shake-modal-actions">
              <button className="shake-modal-yes" onClick={() => { onDissolveCluster(shakeDissolve); setShakeDissolve(null) }}>
                yes, release
              </button>
              <button className="shake-modal-no" onClick={() => setShakeDissolve(null)}>
                no, keep
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge prompt modal */}
      {mergePrompt && (() => {
        const c1 = clusters.find(c => c.id === mergePrompt.c1Id)
        const c2 = clusters.find(c => c.id === mergePrompt.c2Id)
        if (!c1 || !c2) return null
        return (
          <div className="shake-modal-overlay" onClick={e => { e.stopPropagation(); setMergePrompt(null) }}>
            <div className="shake-modal" onClick={e => e.stopPropagation()}>
              <p>merge "{c1.name}" + "{c2.name}"</p>
              <p className="merge-subtitle">name the merged cluster:</p>
              <input
                className="merge-name-input"
                autoFocus
                defaultValue={`${c1.name} + ${c2.name}`}
                onFocus={e => e.currentTarget.select()}
                onKeyDown={e => {
                  if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                    onMergeClusters(mergePrompt.c1Id, mergePrompt.c2Id, e.currentTarget.value.trim())
                    setMergePrompt(null)
                  }
                  if (e.key === 'Escape') setMergePrompt(null)
                }}
              />
              <div className="shake-modal-actions" style={{ marginTop: 12 }}>
                <button className="shake-modal-yes" style={{ background: 'rgba(108,92,231,0.15)', borderColor: 'rgba(108,92,231,0.3)', color: '#a78bfa' }}
                  onClick={() => {
                    const input = document.querySelector('.merge-name-input') as HTMLInputElement
                    const name = input?.value.trim()
                    if (name) {
                      onMergeClusters(mergePrompt.c1Id, mergePrompt.c2Id, name)
                      setMergePrompt(null)
                    }
                  }}>
                  merge
                </button>
                <button className="shake-modal-no" onClick={() => setMergePrompt(null)}>
                  cancel
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
