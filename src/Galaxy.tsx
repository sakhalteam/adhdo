import { useRef, useEffect, useCallback, useState } from 'react'
import type { Glob, Cluster } from './types'

interface Props {
  globs: Glob[]
  clusters: Cluster[]
  updateGlobs: (fn: (globs: Glob[]) => Glob[]) => void
  onDelete: (id: string) => void
  onUpdateText: (id: string, text: string) => void
  onToggleFlag: (id: string) => void
  onDuplicate: (id: string) => void
  onUpdatePos: (id: string, x: number, y: number) => void
  onCreateCluster: (id1: string, id2: string, x: number, y: number) => void
  onAddToCluster: (globId: string, clusterId: string) => void
  onRemoveFromCluster: (globId: string) => void
  onRenameCluster: (id: string, name: string) => void
  onToggleClusterCollapse: (id: string) => void
  onDeleteCluster: (id: string) => void
  onUpdateClusterPos: (id: string, x: number, y: number) => void
  onRecolor: (id: string) => void
}

const DAMPING = 0.998
const BOUNCE = 0.6
const REPEL_DIST = 90
const REPEL_FORCE = 0.02

export default function Galaxy({
  globs, clusters, updateGlobs,
  onDelete, onUpdateText, onToggleFlag, onDuplicate, onUpdatePos,
  onCreateCluster, onAddToCluster, onRemoveFromCluster,
  onRenameCluster, onToggleClusterCollapse, onDeleteCluster, onUpdateClusterPos,
  onRecolor,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const animRef = useRef(0)
  const dragging = useRef<{ id: string; type: 'glob' | 'cluster'; offX: number; offY: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; globId: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingClusterId, setEditingClusterId] = useState<string | null>(null)

  // Physics loop — only moves free (non-clustered, non-dragged) globs
  useEffect(() => {
    function tick() {
      updateGlobs(prev => {
        const w = window.innerWidth
        const h = window.innerHeight
        const dragId = dragging.current?.id

        return prev.map((g, i) => {
          // Skip clustered or currently-dragged globs
          if (g.clusterId || g.id === dragId) return g

          let { x, y, vx, vy } = g

          // Soft repulsion from other free globs
          for (let j = 0; j < prev.length; j++) {
            if (i === j || prev[j].clusterId) continue
            const dx = x - prev[j].x
            const dy = y - prev[j].y
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < REPEL_DIST && dist > 0) {
              const force = REPEL_FORCE * (1 - dist / REPEL_DIST)
              vx += (dx / dist) * force
              vy += (dy / dist) * force
            }
          }

          // Apply velocity
          vx *= DAMPING
          vy *= DAMPING
          x += vx
          y += vy

          // Bounce off walls (accounting for capture bar at top)
          const r = g.radius
          const topBound = 70
          if (x - r < 0) { x = r; vx = Math.abs(vx) * BOUNCE }
          if (x + r > w) { x = w - r; vx = -Math.abs(vx) * BOUNCE }
          if (y - r < topBound) { y = topBound + r; vy = Math.abs(vy) * BOUNCE }
          if (y + r > h) { y = h - r; vy = -Math.abs(vy) * BOUNCE }

          return { ...g, x, y, vx, vy }
        })
      })

      animRef.current = requestAnimationFrame(tick)
    }

    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [updateGlobs])

  // Drag handlers
  const onPointerDown = useCallback((e: React.PointerEvent, id: string, type: 'glob' | 'cluster') => {
    e.stopPropagation()
    e.preventDefault()
    setContextMenu(null)

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
        handleDrop(dragging.current.id, ev.clientX, ev.clientY)
      }
      dragging.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [onUpdatePos, onUpdateClusterPos])

  // When a glob is dropped, check if it landed on another glob or cluster
  const handleDrop = useCallback((globId: string, dropX: number, dropY: number) => {
    const droppedGlob = globs.find(g => g.id === globId)
    if (!droppedGlob) return

    // Check clusters first — did we drop onto a cluster?
    for (const c of clusters) {
      const dx = dropX - c.x
      const dy = dropY - c.y
      if (Math.sqrt(dx * dx + dy * dy) < 80 && !droppedGlob.clusterId) {
        onAddToCluster(globId, c.id)
        return
      }
    }

    // Check other free globs — did we drop onto another free glob?
    for (const other of globs) {
      if (other.id === globId || other.clusterId) continue
      const dx = dropX - other.x
      const dy = dropY - other.y
      if (Math.sqrt(dx * dx + dy * dy) < 70) {
        onCreateCluster(globId, other.id, (dropX + other.x) / 2, (dropY + other.y) / 2)
        return
      }
    }
  }, [globs, clusters, onAddToCluster, onCreateCluster])

  // Context menu (right-click)
  const onContextMenu = useCallback((e: React.MouseEvent, globId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, globId })
  }, [])

  // Close context menu on click elsewhere
  useEffect(() => {
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  // Get globs belonging to a cluster
  const clusterGlobs = (c: Cluster) => globs.filter(g => g.clusterId === c.id)

  // Free-floating globs (not in any cluster)
  const freeGlobs = globs.filter(g => !g.clusterId)

  return (
    <div ref={containerRef} className="galaxy">
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
          }}
          onPointerDown={e => onPointerDown(e, g.id, 'glob')}
          onContextMenu={e => onContextMenu(e, g.id)}
          onDoubleClick={(e) => {
            e.stopPropagation()
            setEditingId(g.id)
          }}
        >
          {g.flagged && <span className="flag-dot" />}
          {editingId === g.id ? (
            <input
              className="glob-edit"
              defaultValue={g.text}
              autoFocus
              onClick={e => e.stopPropagation()}
              onBlur={e => {
                onUpdateText(g.id, e.currentTarget.value)
                setEditingId(null)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  onUpdateText(g.id, e.currentTarget.value)
                  setEditingId(null)
                }
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
        return (
          <div
            key={c.id}
            className={`cluster ${c.collapsed ? 'collapsed' : ''}`}
            style={{ left: c.x, top: c.y, borderColor: c.color }}
            onPointerDown={e => onPointerDown(e, c.id, 'cluster')}
          >
            <div className="cluster-header">
              {editingClusterId === c.id ? (
                <input
                  className="cluster-name-edit"
                  defaultValue={c.name}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                  onBlur={e => {
                    onRenameCluster(c.id, e.currentTarget.value)
                    setEditingClusterId(null)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      onRenameCluster(c.id, e.currentTarget.value)
                      setEditingClusterId(null)
                    }
                    if (e.key === 'Escape') setEditingClusterId(null)
                  }}
                />
              ) : (
                <span
                  className="cluster-name"
                  onDoubleClick={e => { e.stopPropagation(); setEditingClusterId(c.id) }}
                >
                  {c.name}
                </span>
              )}
              <div className="cluster-actions">
                <button onClick={e => { e.stopPropagation(); onToggleClusterCollapse(c.id) }}>
                  {c.collapsed ? '＋' : '－'}
                </button>
                <button onClick={e => { e.stopPropagation(); onDeleteCluster(c.id) }} title="Dissolve cluster">
                  ✕
                </button>
              </div>
            </div>

            {!c.collapsed && (
              <div className="cluster-globs">
                {cGlobs.map(g => (
                  <div
                    key={g.id}
                    className={`cluster-glob-item ${g.flagged ? 'flagged' : ''}`}
                    style={{ borderLeftColor: g.color }}
                  >
                    {editingId === g.id ? (
                      <input
                        className="glob-edit inline"
                        defaultValue={g.text}
                        autoFocus
                        onClick={e => e.stopPropagation()}
                        onBlur={e => {
                          onUpdateText(g.id, e.currentTarget.value)
                          setEditingId(null)
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            onUpdateText(g.id, e.currentTarget.value)
                            setEditingId(null)
                          }
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                      />
                    ) : (
                      <span
                        className="cluster-glob-text"
                        onDoubleClick={e => { e.stopPropagation(); setEditingId(g.id) }}
                      >
                        {g.flagged && <span className="flag-dot small" />}
                        {g.text}
                      </span>
                    )}
                    <div className="cluster-glob-actions">
                      <button onClick={e => { e.stopPropagation(); onToggleFlag(g.id) }} title="Flag">
                        {g.flagged ? '🚩' : '⚑'}
                      </button>
                      <button onClick={e => { e.stopPropagation(); onRemoveFromCluster(g.id) }} title="Pop out">
                        ↗
                      </button>
                      <button onClick={e => { e.stopPropagation(); onDelete(g.id) }} title="Delete">
                        ✕
                      </button>
                    </div>
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
          <button onClick={() => { onDuplicate(contextMenu.globId); setContextMenu(null) }}>
            📋 Duplicate
          </button>
          <button onClick={() => { onRecolor(contextMenu.globId); setContextMenu(null) }}>
            🎨 Recolor
          </button>
          {globs.find(g => g.id === contextMenu.globId)?.clusterId && (
            <button onClick={() => { onRemoveFromCluster(contextMenu.globId); setContextMenu(null) }}>
              ↗️ Pop out
            </button>
          )}
          <hr />
          <button className="danger" onClick={() => { onDelete(contextMenu.globId); setContextMenu(null) }}>
            🗑️ Delete
          </button>
        </div>
      )}
    </div>
  )
}
