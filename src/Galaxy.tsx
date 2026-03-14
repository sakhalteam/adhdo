import { useRef, useEffect, useCallback, useState } from 'react'
import type { Glob, Cluster, GalaxyState } from './types'

interface Props {
  state: GalaxyState
  updateGlobs: (fn: (globs: Glob[]) => Glob[]) => void
  updateState: (fn: (s: GalaxyState) => GalaxyState) => void
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
  onDelete, onUpdateText, onToggleFlag, onToggleTodo, onToggleDone,
  onDuplicate, onUpdatePos,
  onCreateCluster, onAddToCluster, onRemoveFromCluster,
  onRenameCluster, onToggleClusterCollapse, onDissolveCluster,
  onUpdateClusterPos, onTouchCluster, onReorderClusterGlobs,
  onRecolor,
}: Props) {
  const { globs, clusters } = state
  const animRef = useRef(0)
  const dragging = useRef<{ id: string; type: 'glob' | 'cluster'; offX: number; offY: number } | null>(null)
  const handleDropRef = useRef<(globId: string, dropX: number, dropY: number) => void>(() => {})
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; globId: string; inCluster: boolean } | null>(null)
  const [dissolveConfirm, setDissolveConfirm] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingClusterId, setEditingClusterId] = useState<string | null>(null)
  const [dragReorder, setDragReorder] = useState<{ clusterId: string; globId: string; overGlobId: string | null } | null>(null)

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
    // Don't drag when interacting with inputs, buttons, or editable elements
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'BUTTON') return

    e.stopPropagation()
    e.preventDefault()
    setContextMenu(null)
    setDissolveConfirm(null)

    if (type === 'cluster') onTouchCluster(id)

    const el = e.currentTarget as HTMLElement
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
      }
    }

    const onUp = (ev: PointerEvent) => {
      if (dragging.current?.type === 'glob') {
        handleDropRef.current(dragging.current.id, ev.clientX, ev.clientY)
      }
      dragging.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [onUpdatePos, onUpdateClusterPos, onTouchCluster])

  // Drop handler ref (always fresh)
  handleDropRef.current = (globId: string, _dropX: number, _dropY: number) => {
    const droppedGlob = globs.find(g => g.id === globId)
    if (!droppedGlob) return

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
    setDissolveConfirm(null)
  }, [])

  useEffect(() => {
    const close = () => { setContextMenu(null); setDissolveConfirm(null) }
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
    <div className="galaxy">
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
            className={`cluster ${c.collapsed ? 'collapsed' : ''} ${isIdle ? 'drifting' : ''}`}
            style={{ left: c.x, top: c.y, borderColor: c.color }}
            onPointerDown={e => onPointerDown(e, c.id, 'cluster')}
            onPointerEnter={() => onTouchCluster(c.id)}
          >
            <div className="cluster-header">
              {editingClusterId === c.id ? (
                <input
                  className="cluster-name-edit"
                  defaultValue={c.name}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                  onBlur={e => { onRenameCluster(c.id, e.currentTarget.value); setEditingClusterId(null) }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { onRenameCluster(c.id, e.currentTarget.value); setEditingClusterId(null) }
                    if (e.key === 'Escape') setEditingClusterId(null)
                  }}
                />
              ) : (
                <span className="cluster-name"
                  onDoubleClick={e => { e.stopPropagation(); setEditingClusterId(c.id) }}
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
                    onDragEnd={() => setDragReorder(null)}
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
                        onClick={e => e.stopPropagation()}
                        onBlur={e => { onUpdateText(g.id, e.currentTarget.value); setEditingId(null) }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { onUpdateText(g.id, e.currentTarget.value); setEditingId(null) }
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                      />
                    ) : (
                      <span
                        className={`cluster-glob-text ${g.done ? 'line-through opacity-50' : ''}`}
                        onDoubleClick={e => { e.stopPropagation(); setEditingId(g.id) }}
                      >
                        {g.flagged && <span className="flag-dot-inline" />}
                        {g.text}
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

      {/* Context menu */}
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
    </div>
  )
}
