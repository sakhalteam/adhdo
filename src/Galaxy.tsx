import { useRef, useEffect, useCallback, useState } from 'react'
import type { Glob, Cluster, GalaxyState } from './types'

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
  onConvertToCluster: (globId: string) => void
  onAddToCluster: (globId: string, clusterId: string) => void
  onRemoveFromCluster: (globId: string) => void
  onRenameCluster: (id: string, name: string) => void
  onToggleClusterCollapse: (id: string) => void
  onDissolveCluster: (id: string) => void
  onDeleteCluster: (id: string) => void
  onUpdateClusterPos: (id: string, x: number, y: number) => void
  onTouchCluster: (id: string) => void
  onReorderClusterGlobs: (clusterId: string, globIds: string[]) => void
  onRecolor: (id: string) => void
  onConnectClusters: (c1Id: string, c2Id: string) => void
  onDisconnectClusters: (connectionId: string) => void
  onMergeClusters: (c1Id: string, c2Id: string, newName: string) => void
  onGatherFreeGlobs: () => void
  onClearAll: () => void
  onExportJSON: () => void
  onImportJSON: (file: File) => void
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
  onCreateCluster, onConvertToCluster, onAddToCluster, onRemoveFromCluster,
  onRenameCluster, onToggleClusterCollapse, onDissolveCluster, onDeleteCluster,
  onUpdateClusterPos, onTouchCluster, onReorderClusterGlobs,
  onRecolor,
  onConnectClusters, onDisconnectClusters, onMergeClusters,
  onGatherFreeGlobs, onClearAll, onExportJSON, onImportJSON,
}: Props) {
  const { globs, clusters, connections } = state
  const animRef = useRef(0)
  const dragging = useRef<{ id: string; type: 'glob' | 'cluster'; offX: number; offY: number } | null>(null)
  const handleDropRef = useRef<(globId: string, dropX: number, dropY: number) => void>(() => {})
  const connectionsRef = useRef(connections)
  connectionsRef.current = connections
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
  const [clusterTrashConfirm, setClusterTrashConfirm] = useState<string | null>(null)
  const shakeHistory = useRef<{ x: number; y: number; t: number }[]>([])
  const [connecting, setConnecting] = useState<{ fromClusterId: string; cursorX: number; cursorY: number } | null>(null)
  const [hoveredConnection, setHoveredConnection] = useState<string | null>(null)
  const [mergePrompt, setMergePrompt] = useState<{ c1Id: string; c2Id: string; connectionId: string } | null>(null)
  const [flashConnection, setFlashConnection] = useState<string | null>(null)
  const [lastGlobPrompt, setLastGlobPrompt] = useState<{ globId: string; clusterId: string; x: number; y: number } | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpPinned, setHelpPinned] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    if (!highlightId) return
    const t = setTimeout(() => setHighlightId(null), 2200)
    return () => clearTimeout(t)
  }, [highlightId])

  const searchResults = (() => {
    const q = searchQ.trim().toLowerCase()
    if (!q) return [] as { type: 'glob' | 'cluster'; id: string; label: string; sub?: string }[]
    const results: { type: 'glob' | 'cluster'; id: string; label: string; sub?: string }[] = []
    for (const c of clusters) {
      if (c.name.toLowerCase().includes(q)) {
        results.push({ type: 'cluster', id: c.id, label: c.name, sub: `cluster · ${c.globIds.length} globs` })
      }
    }
    for (const g of globs) {
      if (g.text.toLowerCase().includes(q)) {
        const parent = g.clusterId ? clusters.find(c => c.id === g.clusterId) : null
        results.push({ type: 'glob', id: g.id, label: g.text, sub: parent ? `in ${parent.name}` : 'free glob' })
      }
    }
    return results.slice(0, 30)
  })()

  const jumpToResult = (r: { type: 'glob' | 'cluster'; id: string }) => {
    if (r.type === 'glob') {
      const g = globs.find(gl => gl.id === r.id)
      if (g?.clusterId) {
        const parent = clusters.find(c => c.id === g.clusterId)
        if (parent?.collapsed) onToggleClusterCollapse(parent.id)
      }
    }
    setHighlightId(r.id)
    setSearchOpen(false)
    setSearchQ('')
  }
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
    // If pointer is on a draggable item, grip handle, or link handle inside a cluster, don't start cluster drag
    if (type === 'cluster' && (target.closest('.cluster-glob-grip') || target.closest('[draggable="true"]') || target.closest('.cluster-link-handle'))) return

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
      if (dragging.current?.type === 'cluster') {
        const cid = dragging.current.id
        // Alt+drag severs all connections
        if (ev.altKey) {
          connectionsRef.current.forEach(cn => {
            if (cn.cluster1Id === cid || cn.cluster2Id === cid) {
              onDisconnectClusters(cn.id)
            }
          })
        }
        // Check if dropped on trash zone (bottom-right corner)
        const w = window.innerWidth
        const h = window.innerHeight
        const trashCx = w - TRASH_MARGIN - TRASH_SIZE / 2
        const trashCy = h - 80 - TRASH_SIZE / 2
        const tdx = ev.clientX - trashCx
        const tdy = ev.clientY - trashCy
        if (Math.sqrt(tdx * tdx + tdy * tdy) < TRASH_SIZE) {
          dragging.current = null
          shakeHistory.current = []
          setDraggingFreeGlob(false)
          setDraggingClusterId(null)
          setClusterTrashConfirm(cid)
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          return
        }
        // Check if dropped on another cluster → merge prompt
        // Hide dragged cluster so elementFromPoint finds the one underneath
        const draggedEl = document.querySelector(`.cluster[data-cluster-id="${cid}"]`) as HTMLElement | null
        if (draggedEl) draggedEl.style.pointerEvents = 'none'
        const el = document.elementFromPoint(ev.clientX, ev.clientY)
        if (draggedEl) draggedEl.style.pointerEvents = ''
        const targetClusterEl = el?.closest('.cluster[data-cluster-id]') as HTMLElement | null
        if (targetClusterEl) {
          const targetId = targetClusterEl.dataset.clusterId
          if (targetId && targetId !== cid) {
            setMergePrompt({ c1Id: cid, c2Id: targetId, connectionId: '' })
          }
        }
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
    const close = () => { setContextMenu(null); setClusterCtx(null); setDissolveConfirm(null); setHelpPinned(false); setHelpOpen(false) }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const active = document.activeElement as HTMLElement | null
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        active.blur()
      }
      close()
      setClearConfirm(false)
      setShakeDissolve(null)
      setLastGlobPrompt(null)
      setMergePrompt(null)
      setTrashConfirm(null)
      setClusterTrashConfirm(null)
      setNewGlobPos(null)
      setSearchOpen(false)
      setSearchQ('')
    }
    const onSearch = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(v => !v)
        setSearchQ('')
      }
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onEsc)
    window.addEventListener('keydown', onSearch)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onEsc)
      window.removeEventListener('keydown', onSearch)
    }
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

      {/* Connection lines between clusters (below clusters) */}
      <svg className="connection-lines" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 15 }}>
        {connections.map(cn => {
          const c1 = clusters.find(c => c.id === cn.cluster1Id)
          const c2 = clusters.find(c => c.id === cn.cluster2Id)
          if (!c1 || !c2) return null

          // Compute edge points so line doesn't bisect clusters
          const dx = c2.x - c1.x
          const dy = c2.y - c1.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          const nx = dist > 0 ? dx / dist : 0
          const ny = dist > 0 ? dy / dist : 0

          // Get cluster element sizes (fall back to reasonable defaults)
          const NODE_RADIUS = 6
          const PADDING = 12 // extra gap between cluster edge and node
          const el1 = document.querySelector(`.cluster[data-cluster-id="${c1.id}"]`) as HTMLElement | null
          const el2 = document.querySelector(`.cluster[data-cluster-id="${c2.id}"]`) as HTMLElement | null
          const hw1 = el1 ? el1.offsetWidth / 2 : 90
          const hh1 = el1 ? el1.offsetHeight / 2 : 50
          const hw2 = el2 ? el2.offsetWidth / 2 : 90
          const hh2 = el2 ? el2.offsetHeight / 2 : 50

          // Ray-box intersection: how far along (nx,ny) to exit the cluster's bounding box
          const edgeDist = (hw: number, hh: number) => {
            if (Math.abs(nx) < 0.001 && Math.abs(ny) < 0.001) return 0
            const tx = Math.abs(nx) > 0.001 ? hw / Math.abs(nx) : Infinity
            const ty = Math.abs(ny) > 0.001 ? hh / Math.abs(ny) : Infinity
            return Math.min(tx, ty) + PADDING
          }

          const d1 = edgeDist(hw1, hh1)
          const d2 = edgeDist(hw2, hh2)

          // Node positions at cluster edges
          const x1 = c1.x + nx * d1
          const y1 = c1.y + ny * d1
          const x2 = c2.x - nx * d2
          const y2 = c2.y - ny * d2

          const mx = (c1.x + c2.x) / 2
          const my = (c1.y + c2.y) / 2
          const isFlashing = flashConnection === (cn.cluster1Id + '-' + cn.cluster2Id) || flashConnection === (cn.cluster2Id + '-' + cn.cluster1Id)
          const isHovered = hoveredConnection === cn.id
          return (
            <g key={cn.id}
              onPointerEnter={() => setHoveredConnection(cn.id)}
              onPointerLeave={() => setHoveredConnection(prev => prev === cn.id ? null : prev)}
              style={{ pointerEvents: 'auto' }}
            >
              {/* Fat invisible line for hover hit area */}
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="transparent" strokeWidth="28"
                style={{ cursor: 'pointer' }}
              />
              {/* Glow line (flash on connect) */}
              {isFlashing && (
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={cn.color} strokeWidth="6" strokeDasharray="6 4"
                  opacity="0.6"
                  className="connection-flash"
                  style={{ pointerEvents: 'none' }}
                />
              )}
              {/* Visible dashed line between edge nodes */}
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={cn.color} strokeWidth="2" strokeDasharray="6 4"
                opacity={isHovered ? 0.7 : isFlashing ? 0.8 : 0.4}
                style={{ transition: 'opacity 0.2s', pointerEvents: 'none' }}
              />
              {/* Endpoint node at cluster 1 edge */}
              <circle cx={x1} cy={y1} r={NODE_RADIUS}
                fill={cn.color} opacity={isHovered ? 0.9 : 0.6}
                style={{ transition: 'opacity 0.2s', pointerEvents: 'none' }}
              />
              <circle cx={x1} cy={y1} r={NODE_RADIUS + 3}
                fill={cn.color} opacity={isHovered ? 0.2 : 0.1}
                style={{ transition: 'opacity 0.2s', pointerEvents: 'none' }}
              />
              {/* Endpoint node at cluster 2 edge */}
              <circle cx={x2} cy={y2} r={NODE_RADIUS}
                fill={cn.color} opacity={isHovered ? 0.9 : 0.6}
                style={{ transition: 'opacity 0.2s', pointerEvents: 'none' }}
              />
              <circle cx={x2} cy={y2} r={NODE_RADIUS + 3}
                fill={cn.color} opacity={isHovered ? 0.2 : 0.1}
                style={{ transition: 'opacity 0.2s', pointerEvents: 'none' }}
              />
              {/* Merge + disconnect buttons at midpoint (on hover) */}
              {isHovered && (
                <foreignObject x={mx - 44} y={my - 20} width="88" height="40">
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%' }}>
                    <div
                      className="connection-merge-btn"
                      title="Merge clusters"
                      onClick={e => {
                        e.stopPropagation()
                        setMergePrompt({ c1Id: cn.cluster1Id, c2Id: cn.cluster2Id, connectionId: cn.id })
                        setHoveredConnection(null)
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                      </svg>
                    </div>
                    <div
                      className="connection-merge-btn disconnect"
                      title="Disconnect"
                      onClick={e => {
                        e.stopPropagation()
                        onDisconnectClusters(cn.id)
                        setHoveredConnection(null)
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </div>
                  </div>
                </foreignObject>
              )}
            </g>
          )
        })}
      </svg>

      {/* Temporary connecting line (above everything) */}
      {connecting && (() => {
        const from = clusters.find(c => c.id === connecting.fromClusterId)
        if (!from) return null
        return (
          <svg style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 100 }}>
            <line
              x1={from.x} y1={from.y}
              x2={connecting.cursorX} y2={connecting.cursorY}
              stroke="#7c3aed" strokeWidth="3" strokeDasharray="8 5"
              opacity="0.8"
            />
            <circle cx={connecting.cursorX} cy={connecting.cursorY} r="8" fill="#7c3aed" opacity="0.4" />
          </svg>
        )
      })()}

      {/* Free-floating globs */}
      {freeGlobs.map(g => (
        <div
          key={g.id}
          className={`glob ${g.flagged ? 'flagged' : ''} ${highlightId === g.id ? 'highlight-pulse' : ''}`}
          style={{
            left: g.x,
            top: g.y,
            width: g.radius * 2,
            height: g.radius * 2,
            ['--glob-color' as string]: g.color,
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
            className={`cluster ${c.collapsed ? 'collapsed' : ''} ${isIdle ? 'drifting' : ''} ${draggingClusterId === c.id ? 'dragging-active' : ''} ${highlightId === c.id ? 'highlight-pulse' : ''}`}
            data-cluster-id={c.id}
            style={{ left: c.x, top: c.y, borderColor: c.color }}
            onPointerEnter={() => onTouchCluster(c.id)}
            onPointerDown={e => {
              // Skip if clicking on link handle or drag handle
              if ((e.target as HTMLElement).closest('.cluster-link-handle') || (e.target as HTMLElement).closest('.cluster-drag-handle')) return
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
                const fromId = c.id
                setConnecting({ fromClusterId: fromId, cursorX: e.clientX, cursorY: e.clientY })

                const onMove = (ev: PointerEvent) => {
                  setConnecting(prev => prev ? { ...prev, cursorX: ev.clientX, cursorY: ev.clientY } : null)
                }
                const onUp = (ev: PointerEvent) => {
                  window.removeEventListener('pointermove', onMove)
                  window.removeEventListener('pointerup', onUp)
                  // Hide source cluster's link handle so elementFromPoint hits the target cluster
                  const sourceEl = document.querySelector(`.cluster[data-cluster-id="${fromId}"]`) as HTMLElement | null
                  if (sourceEl) sourceEl.style.pointerEvents = 'none'
                  const el = document.elementFromPoint(ev.clientX, ev.clientY)
                  if (sourceEl) sourceEl.style.pointerEvents = ''
                  const clusterEl = el?.closest('.cluster[data-cluster-id]') as HTMLElement | null
                  if (clusterEl) {
                    const targetId = clusterEl.dataset.clusterId
                    if (targetId && targetId !== fromId) {
                      onConnectClusters(fromId, targetId)
                      setFlashConnection(fromId + '-' + targetId)
                      setTimeout(() => setFlashConnection(null), 800)
                    }
                  }
                  setConnecting(null)
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

            {!c.collapsed && cGlobs.length === 0 && (
              <div className="cluster-empty">drag globs here</div>
            )}

            {!c.collapsed && cGlobs.length > 0 && (
              <div className="cluster-globs">
                {cGlobs.map(g => (
                  <div
                    key={g.id}
                    className={`cluster-glob-item ${g.flagged ? 'flagged' : ''} ${g.done ? 'done' : ''} ${dragReorder?.overGlobId === g.id ? 'drag-over' : ''} ${highlightId === g.id ? 'highlight-pulse' : ''}`}
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
                          // If this is the last glob, prompt before removing
                          if (c.globIds.length === 1) {
                            setLastGlobPrompt({ globId: g.id, clusterId: c.id, x: mx, y: my })
                          } else {
                            onRemoveFromCluster(g.id)
                            onUpdatePos(g.id, mx, my)
                          }
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
              <span className="cluster-count">{cGlobs.length === 0 ? 'empty' : `${cGlobs.length} items`}</span>
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
          {!contextMenu.inCluster && (
            <button onClick={() => {
              onConvertToCluster(contextMenu.globId)
              setContextMenu(null)
            }}>
              📦 Convert to cluster
            </button>
          )}
          {contextMenu.inCluster && (
            <button onClick={() => {
              const glob = globs.find(g => g.id === contextMenu.globId)
              if (glob?.clusterId) {
                const cluster = clusters.find(c => c.id === glob.clusterId)
                if (cluster && cluster.globIds.length === 1) {
                  setLastGlobPrompt({ globId: glob.id, clusterId: cluster.id, x: glob.x, y: glob.y })
                  setContextMenu(null)
                  return
                }
              }
              onRemoveFromCluster(contextMenu.globId)
              setContextMenu(null)
            }}>
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

      {/* Trash zone (visible when dragging a free glob or a cluster) */}
      <div className={`trash-zone ${draggingFreeGlob || draggingClusterId ? 'visible' : ''}`}>
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

      {/* Cluster trash confirmation toast */}
      {clusterTrashConfirm && (() => {
        const c = clusters.find(cl => cl.id === clusterTrashConfirm)
        if (!c) return null
        const globCount = c.globIds.length
        return (
          <div className="trash-toast" onClick={e => e.stopPropagation()}>
            <span className="trash-toast-label">delete cluster "{c.name}"{globCount > 0 ? ` and ${globCount} glob${globCount > 1 ? 's' : ''}` : ''}?</span>
            <button className="trash-toast-btn" onClick={() => {
              // Delete all globs in the cluster, then the cluster itself
              c.globIds.forEach(gid => onDelete(gid))
              onDeleteCluster(clusterTrashConfirm)
              setClusterTrashConfirm(null)
            }}>
              delete all
            </button>
            {globCount > 0 && (
              <button className="trash-toast-btn" style={{ background: 'rgba(139, 92, 246, 0.15)', borderColor: 'rgba(139, 92, 246, 0.4)', color: '#a78bfa' }} onClick={() => {
                onDissolveCluster(clusterTrashConfirm)
                setClusterTrashConfirm(null)
              }}>
                release globs
              </button>
            )}
            <button className="trash-toast-cancel" onClick={() => setClusterTrashConfirm(null)}>
              cancel
            </button>
          </div>
        )
      })()}

      {/* Shake dissolve modal */}
      {shakeDissolve && (() => {
        const shakeCluster = clusters.find(c => c.id === shakeDissolve)
        const globCount = shakeCluster?.globIds.length ?? 0
        return (
          <div className="shake-modal-overlay" onClick={e => { e.stopPropagation(); setShakeDissolve(null) }}>
            <div className="shake-modal" onClick={e => e.stopPropagation()}>
              <p>release {globCount === 1 ? 'glob' : 'all globs'}?</p>
              <div className="shake-modal-actions">
                <button className="shake-modal-yes" onClick={() => {
                  setShakeDissolve(null)
                  if (shakeCluster && globCount === 1) {
                    // Single glob — chain into the "destroy cluster?" prompt
                    setLastGlobPrompt({
                      globId: shakeCluster.globIds[0],
                      clusterId: shakeDissolve,
                      x: shakeCluster.x,
                      y: shakeCluster.y,
                    })
                  } else {
                    onDissolveCluster(shakeDissolve)
                  }
                }}>
                  yes, release
                </button>
                <button className="shake-modal-no" onClick={() => setShakeDissolve(null)}>
                  no, keep
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Merge prompt modal */}
      {/* Last glob prompt */}
      {lastGlobPrompt && (
        <div className="shake-modal-overlay" onClick={e => { e.stopPropagation(); setLastGlobPrompt(null) }}>
          <div className="shake-modal" onClick={e => e.stopPropagation()}>
            <p>destroy cluster?</p>
            <p className="merge-subtitle">or keep it empty for new globs</p>
            <div className="shake-modal-actions">
              <button className="shake-modal-yes" onClick={() => {
                onRemoveFromCluster(lastGlobPrompt.globId)
                onUpdatePos(lastGlobPrompt.globId, lastGlobPrompt.x, lastGlobPrompt.y)
                onDeleteCluster(lastGlobPrompt.clusterId)
                setLastGlobPrompt(null)
              }}>
                destroy
              </button>
              <button className="shake-modal-no" onClick={() => {
                onRemoveFromCluster(lastGlobPrompt.globId)
                onUpdatePos(lastGlobPrompt.globId, lastGlobPrompt.x, lastGlobPrompt.y)
                setLastGlobPrompt(null)
              }}>
                keep empty
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Help / tips panel */}
      <div
        className={`help-trigger ${helpOpen ? 'open' : ''}`}
        onClick={e => {
          e.stopPropagation()
          if (helpPinned) {
            setHelpPinned(false)
            setHelpOpen(false)
          } else {
            setHelpPinned(true)
            setHelpOpen(true)
          }
        }}
        onMouseEnter={() => { if (!helpPinned) setHelpOpen(true) }}
        onMouseLeave={() => { if (!helpPinned) setHelpOpen(false) }}
      >
        <span className="help-icon">?</span>
        {helpOpen && (
          <div className="help-panel" onClick={e => e.stopPropagation()}>
            <div className="help-title">tips & shortcuts</div>
            <div className="help-items">
              <div className="help-item"><kbd>Enter</kbd> in capture bar to launch a glob</div>
              <div className="help-item"><span className="help-action">Right-click</span> empty space to create a glob</div>
              <div className="help-item"><span className="help-action">Drag</span> a glob onto another to create a cluster</div>
              <div className="help-item"><span className="help-action">Drag</span> a glob onto a cluster to add it</div>
              <div className="help-item"><span className="help-action">Double-click</span> a glob to edit its text</div>
              <div className="help-item"><span className="help-action">Right-click</span> a glob for more options</div>
              <div className="help-item"><span className="help-action">Click</span> a cluster title to rename it</div>
              <div className="help-item"><span className="help-action">Drag</span> the <span className="help-mono">&#x2807;</span> handle to move a cluster</div>
              <div className="help-item"><span className="help-action">Drag</span> the chain icon to connect clusters</div>
              <div className="help-item"><span className="help-action">Hover</span> a connection line to merge or disconnect</div>
              <div className="help-item"><kbd>Alt</kbd>+drag a cluster to sever all connections</div>
              <div className="help-item"><span className="help-action">Shake</span> a cluster to dissolve it</div>
              <div className="help-item"><span className="help-action">Drag</span> a glob or cluster to the trash (bottom-right)</div>
              <div className="help-item"><span className="help-action">Drag</span> a cluster onto another to merge them</div>
              <div className="help-item"><kbd>Ctrl</kbd>+<kbd>Z</kbd> to undo, <kbd>Ctrl</kbd>+<kbd>Y</kbd> to redo</div>
              <div className="help-item"><kbd>Ctrl</kbd>+<kbd>K</kbd> to search, <kbd>Esc</kbd> to close menus</div>
            </div>

            <div className="help-divider" />
            <div className="help-title">backup</div>
            <div className="help-actions">
              <button
                className="help-action-btn"
                onClick={() => { onExportJSON(); setHelpOpen(false); setHelpPinned(false) }}
                title="Download your galaxy as JSON"
              >
                export JSON
              </button>
              <label className="help-action-btn" title="Restore from a previously exported JSON">
                import JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  style={{ display: 'none' }}
                  onClick={e => e.stopPropagation()}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) onImportJSON(f)
                    e.target.value = ''
                    setHelpOpen(false)
                    setHelpPinned(false)
                  }}
                />
              </label>
            </div>

            <div className="help-divider" />
            <div className="help-title help-title--danger">recovery</div>
            <div className="help-actions">
              <button
                className="help-action-btn"
                onClick={() => { onGatherFreeGlobs(); setHelpOpen(false); setHelpPinned(false) }}
                title="Scoop every free-floating glob into an orphans cluster"
              >
                gather free globs
              </button>
              <button
                className="help-action-btn help-action-btn--danger"
                onClick={() => setClearConfirm(true)}
                title="Delete everything — globs, clusters, connections"
              >
                clear everything
              </button>
            </div>
          </div>
        )}
      </div>

      {searchOpen && (
        <div className="search-overlay" onClick={e => { e.stopPropagation(); setSearchOpen(false); setSearchQ('') }}>
          <div className="search-modal" onClick={e => e.stopPropagation()}>
            <input
              ref={searchInputRef}
              className="search-input"
              placeholder="search globs and clusters..."
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && searchResults[0]) {
                  jumpToResult(searchResults[0])
                }
              }}
            />
            {searchQ.trim() && (
              <div className="search-results">
                {searchResults.length === 0 ? (
                  <div className="search-empty">no matches</div>
                ) : (
                  searchResults.map(r => (
                    <button
                      key={`${r.type}-${r.id}`}
                      className="search-result"
                      onClick={() => jumpToResult(r)}
                    >
                      <span className={`search-result-kind ${r.type}`}>{r.type}</span>
                      <span className="search-result-label">{r.label}</span>
                      {r.sub && <span className="search-result-sub">{r.sub}</span>}
                    </button>
                  ))
                )}
              </div>
            )}
            <div className="search-hint">
              <kbd>↵</kbd> jump to first · <kbd>Esc</kbd> close
            </div>
          </div>
        </div>
      )}

      {clearConfirm && (
        <div className="shake-modal-overlay" onClick={e => { e.stopPropagation(); setClearConfirm(false) }}>
          <div className="shake-modal" onClick={e => e.stopPropagation()}>
            <p>clear everything?</p>
            <p className="merge-subtitle">deletes all globs, clusters, and connections. undo with Ctrl+Z.</p>
            <div className="shake-modal-actions">
              <button className="shake-modal-yes" onClick={() => {
                onClearAll()
                setClearConfirm(false)
                setHelpOpen(false)
                setHelpPinned(false)
              }}>
                yes, nuke it
              </button>
              <button className="shake-modal-no" onClick={() => setClearConfirm(false)}>
                cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
