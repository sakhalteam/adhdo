import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import type { Glob, Cluster, GalaxyState } from './types'
import {
  ClusterBrowser,
  ClusterCard,
  ClusterTools,
  ConnectionLayer,
  FreeGlob,
  GalaxyOverlays,
  MarqueeOverlay,
  ModeTools,
  OnboardingLayer,
  type RecolorTarget,
} from './GalaxyChrome'
import { useClusterFocus } from './useClusterFocus'
import { useClusterReorder } from './useClusterReorder'
import { useFreeGlobPhysics } from './useFreeGlobPhysics'
import { useGalaxyHotkeys } from './useGalaxyHotkeys'
import { useGalaxySearch } from './useGalaxySearch'
import { useGlobDrop } from './useGlobDrop'
import { useMarqueeSelection } from './useMarqueeSelection'

interface Props {
  state: GalaxyState
  showOnboarding: boolean
  onDismissOnboarding: () => void
  updateGlobs: (fn: (globs: Glob[]) => Glob[]) => void
  updateState: (fn: (s: GalaxyState) => GalaxyState) => void
  onAddGlobAt: (text: string, x: number, y: number) => void
  onDelete: (id: string) => void
  onUpdateText: (id: string, text: string) => void
  onToggleFlag: (id: string) => void
  onToggleTodo: (id: string) => void
  onToggleAllTodosInCluster: (clusterId: string) => void
  onToggleDone: (id: string) => void
  onDuplicate: (id: string) => void
  onUpdatePos: (id: string, x: number, y: number) => void
  onCreateCluster: (id1: string, id2: string, x: number, y: number) => void
  onConvertToCluster: (globId: string) => void
  onAddToCluster: (globId: string, clusterId: string) => void
  onMoveGlobToCluster: (globId: string, targetClusterId: string, beforeGlobId?: string | null) => void
  onAddGlobToCluster: (text: string, clusterId: string) => void
  onRemoveFromCluster: (globId: string) => void
  onRenameCluster: (id: string, name: string) => void
  onToggleClusterCollapse: (id: string) => void
  onDissolveCluster: (id: string) => void
  onDeleteCluster: (id: string) => void
  onUpdateClusterPos: (id: string, x: number, y: number) => void
  onTouchCluster: (id: string) => void
  onReorderClusterGlobs: (clusterId: string, globIds: string[]) => void
  onRecolor: (id: string, color?: string) => void
  onRecolorCluster: (id: string, color: string) => void
  onRecolorAllInCluster: (clusterId: string, color: string) => void
  onRecolorGlobs: (ids: string[], color: string) => void
  onToggleAllTodosInGlobs: (ids: string[]) => void
  onDeleteGlobs: (ids: string[]) => void
  onTransferToNewCluster: (ids: string[], name?: string) => void
  onConnectClusters: (c1Id: string, c2Id: string) => void
  onDisconnectClusters: (connectionId: string) => void
  onMergeClusters: (c1Id: string, c2Id: string, newName: string) => void
  onGatherFreeGlobs: () => void
  onClearAll: () => void
  onExportJSON: () => void
  onImportJSON: (file: File) => void
}

const MERGE_HOLD_MS = 750 // hold a cluster over another this long → target glows, release opens rename merge modal

export default function Galaxy({
  showOnboarding,
  onDismissOnboarding,
  state, updateGlobs, updateState,
  onAddGlobAt, onDelete, onUpdateText, onToggleFlag, onToggleTodo, onToggleAllTodosInCluster, onToggleDone,
  onDuplicate, onUpdatePos,
  onCreateCluster, onConvertToCluster, onAddToCluster, onMoveGlobToCluster, onAddGlobToCluster, onRemoveFromCluster,
  onRenameCluster, onToggleClusterCollapse, onDissolveCluster, onDeleteCluster,
  onUpdateClusterPos, onTouchCluster, onReorderClusterGlobs,
  onRecolor, onRecolorCluster, onRecolorAllInCluster, onRecolorGlobs, onToggleAllTodosInGlobs, onDeleteGlobs, onTransferToNewCluster,
  onConnectClusters, onDisconnectClusters, onMergeClusters,
  onGatherFreeGlobs, onClearAll, onExportJSON, onImportJSON,
}: Props) {
  const { globs, clusters, connections } = state
  // Rank each cluster by lastInteraction. Most-recent → highest rank → highest z-index → paints on top.
  // Means touching any cluster (drag, click, rename, etc.) brings it forward, like clicking a window in Windows.
  const clusterZRank = useMemo(() => {
    const sorted = [...clusters].sort((a, b) => a.lastInteraction - b.lastInteraction)
    const m = new Map<string, number>()
    sorted.forEach((c, i) => m.set(c.id, i))
    return m
  }, [clusters])
  const dragging = useRef<{ id: string; type: 'glob' | 'cluster'; offX: number; offY: number } | null>(null)
  const connectionsRef = useRef(connections)
  connectionsRef.current = connections
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; globId: string; inCluster: boolean } | null>(null)
  const [clusterCtx, setClusterCtx] = useState<{ x: number; y: number; clusterId: string } | null>(null)
  const [recolorPopover, setRecolorPopover] = useState<{ x: number; y: number; target: RecolorTarget } | null>(null)
  const {
    selectedIds,
    setSelectedIds,
    clearSelection,
    marqueeMode,
    marqueeRect,
    setPointerMode,
    setSelectionMode,
    startSelection,
    updateSelection,
    commitSelection,
  } = useMarqueeSelection()
  const [bulkCtx, setBulkCtx] = useState<{ x: number; y: number } | null>(null)
  const [dissolveConfirm, setDissolveConfirm] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingClusterId, setEditingClusterId] = useState<string | null>(null)
  const {
    dragHandledRef,
    dragReorder,
    setDragReorder,
    onReorderDragStart,
    onReorderDragOver,
    onReorderDrop,
  } = useClusterReorder({ clusters, onMoveGlobToCluster, onReorderClusterGlobs })
  const [newGlobPos, setNewGlobPos] = useState<{ x: number; y: number } | null>(null)
  const [draggingFreeGlob, setDraggingFreeGlob] = useState(false)
  const [trashConfirm, setTrashConfirm] = useState<string | null>(null)
  const [shakeDissolve, setShakeDissolve] = useState<string | null>(null)
  const [draggingClusterId, setDraggingClusterId] = useState<string | null>(null)
  const [clusterTrashConfirm, setClusterTrashConfirm] = useState<string | null>(null)
  // Hold-to-merge: while dragging a cluster over another, after MERGE_HOLD_MS we glow the target; release while glowing triggers absorb.
  const [mergeHoverTargetId, setMergeHoverTargetId] = useState<string | null>(null)
  const mergeHoverIdRef = useRef<string | null>(null)
  const mergeHoverTimerRef = useRef<number | null>(null)
  const mergeHoverTargetIdRef = useRef<string | null>(null)
  mergeHoverTargetIdRef.current = mergeHoverTargetId
  const shakeHistory = useRef<{ x: number; y: number; t: number }[]>([])
  const [connecting, setConnecting] = useState<{ fromClusterId: string; cursorX: number; cursorY: number } | null>(null)
  const [hoveredConnection, setHoveredConnection] = useState<string | null>(null)
  const [mergePrompt, setMergePrompt] = useState<{ c1Id: string; c2Id: string; connectionId: string } | null>(null)
  const [flashConnection, setFlashConnection] = useState<string | null>(null)
  const [lastGlobPrompt, setLastGlobPrompt] = useState<{ globId: string; clusterId: string; x: number; y: number } | null>(null)
  const [addingToClusterId, setAddingToClusterId] = useState<string | null>(null)
  const clusterClickStart = useRef<{ x: number; y: number } | null>(null)
  const [clusterBrowserOpen, setClusterBrowserOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpPinned, setHelpPinned] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const disconnectConnectionFromAltClick = useCallback((e: React.MouseEvent<SVGGElement>, connectionId: string) => {
    if (!e.altKey) return
    e.preventDefault()
    e.stopPropagation()
    onDisconnectClusters(connectionId)
    setHoveredConnection(prev => (prev === connectionId ? null : prev))
  }, [onDisconnectClusters])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    if (!highlightId) return
    const t = setTimeout(() => setHighlightId(null), 2200)
    return () => clearTimeout(t)
  }, [highlightId])

  const closeTransientUi = useCallback(() => {
    setContextMenu(null)
    setClusterCtx(null)
    setDissolveConfirm(null)
    setHelpPinned(false)
    setHelpOpen(false)
    setClusterBrowserOpen(false)
    setRecolorPopover(null)
    setBulkCtx(null)
    clearSelection()
  }, [clearSelection])

  const {
    focusedClusterId,
    setFocusedClusterId,
    focusCluster,
    rescueClustersIntoView,
    organizeClusters,
  } = useClusterFocus({
    clusters,
    updateState,
    onTouchCluster,
    onHighlight: setHighlightId,
    onCloseClusterBrowser: () => setClusterBrowserOpen(false),
  })
 
  useGalaxyHotkeys({
    onClose: closeTransientUi,
    onClearConfirm: setClearConfirm,
    onShakeDissolve: setShakeDissolve,
    onLastGlobPrompt: setLastGlobPrompt,
    onMergePrompt: setMergePrompt,
    onTrashConfirm: setTrashConfirm,
    onClusterTrashConfirm: setClusterTrashConfirm,
    onNewGlobPos: setNewGlobPos,
    onToggleSearch: () => {
      setSearchOpen(value => !value)
      setSearchQ('')
    },
    onCloseSearch: () => {
      setSearchOpen(false)
      setSearchQ('')
    },
    onClearFocusedCluster: () => setFocusedClusterId(null),
    onPointerMode: setPointerMode,
    onSelectionMode: setSelectionMode,
  })

  const { results: searchResults, jumpToResult } = useGalaxySearch({
    query: searchQ,
    globs,
    clusters,
    focusCluster,
    onToggleClusterCollapse,
    onCloseSearch: () => { setSearchOpen(false); setSearchQ('') },
    onHighlight: setHighlightId,
  })
  const TRASH_SIZE = 56
  const TRASH_MARGIN = 24
  const handleDropRef = useGlobDrop({
    globs,
    clusters,
    trashSize: TRASH_SIZE,
    trashMargin: TRASH_MARGIN,
    onTrash: setTrashConfirm,
    onAddToCluster,
    onCreateCluster,
  })

  useFreeGlobPhysics({ dragging, updateGlobs })

  // Drag handlers
  const onPointerDown = useCallback((e: React.PointerEvent, id: string, type: 'glob' | 'cluster') => {
    // Don't drag when interacting with inputs, buttons, or draggable reorder items
    const target = e.target as HTMLElement
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'BUTTON') return
    // If pointer is on a draggable item, grip handle, or link handle inside a cluster, don't start cluster drag
    if (type === 'cluster' && (target.closest('.cluster-glob-grip') || target.closest('[draggable="true"]') || target.closest('.cluster-link-handle') || target.closest('.cluster-add-handle'))) return

    // Ctrl/Cmd+click on a cluster (anywhere on its body) → toggle all items as todos. Suppress drag.
    if (type === 'cluster' && (e.ctrlKey || e.metaKey)) {
      e.stopPropagation(); e.preventDefault()
      onToggleAllTodosInCluster(id)
      return
    }

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
      clusterClickStart.current = { x: e.clientX, y: e.clientY }
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

        // Hold-to-merge: the cluster whose bounds contain the CURSOR is the merge candidate.
        // (Cursor-position is the source of truth: wherever the user is pointing IS the target.)
        // Use elementsFromPoint (plural) and walk past the dragged cluster — disabling pointer-events on
        // the dragged cluster alone doesn't help because its `.cluster-edge-hit` children have
        // `pointer-events: auto` and still register as targets.
        const cid = dragging.current.id
        let newHoverId: string | null = null
        for (const el of document.elementsFromPoint(ev.clientX, ev.clientY)) {
          const clusterEl = (el as HTMLElement).closest('.cluster[data-cluster-id]') as HTMLElement | null
          if (!clusterEl) continue
          const id = clusterEl.dataset.clusterId
          if (id && id !== cid) { newHoverId = id; break }
        }

        if (newHoverId !== mergeHoverIdRef.current) {
          // Hover target changed — reset glow + restart timer.
          if (mergeHoverTimerRef.current !== null) {
            window.clearTimeout(mergeHoverTimerRef.current)
            mergeHoverTimerRef.current = null
          }
          if (mergeHoverTargetIdRef.current !== null) setMergeHoverTargetId(null)
          mergeHoverIdRef.current = newHoverId
          if (newHoverId) {
            mergeHoverTimerRef.current = window.setTimeout(() => {
              setMergeHoverTargetId(newHoverId)
              mergeHoverTimerRef.current = null
            }, MERGE_HOLD_MS)
          }
        }

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
            // Clear any pending merge-hover state from this drag.
            if (mergeHoverTimerRef.current !== null) {
              window.clearTimeout(mergeHoverTimerRef.current)
              mergeHoverTimerRef.current = null
            }
            mergeHoverIdRef.current = null
            setMergeHoverTargetId(null)
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            return
          }
        }
      }
    }

    const onUp = (ev: PointerEvent) => {
      // Snapshot + immediately clear hold-to-merge state (timer/refs) so any branch is safe.
      const heldMergeTargetId = mergeHoverTargetIdRef.current
      if (mergeHoverTimerRef.current !== null) {
        window.clearTimeout(mergeHoverTimerRef.current)
        mergeHoverTimerRef.current = null
      }
      mergeHoverIdRef.current = null
      if (heldMergeTargetId !== null) setMergeHoverTargetId(null)

      if (dragging.current?.type === 'glob') {
        handleDropRef.current(dragging.current.id, ev.clientX, ev.clientY)
      }
      if (dragging.current?.type === 'cluster') {
        const cid = dragging.current.id
        const start = clusterClickStart.current
        const moved = start ? Math.hypot(ev.clientX - start.x, ev.clientY - start.y) : 0

        // Alt+drag severs all connections from the dragged cluster.
        if (ev.altKey && moved >= 5) {
          connectionsRef.current.forEach(cn => {
            if (cn.cluster1Id === cid || cn.cluster2Id === cid) {
              onDisconnectClusters(cn.id)
            }
          })
          dragging.current = null
          shakeHistory.current = []
          clusterClickStart.current = null
          setDraggingFreeGlob(false)
          setDraggingClusterId(null)
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          return
        }
        // Click (no drag) → open add-input
        if (start && !ev.altKey) {
          if (moved < 5) {
            dragging.current = null
            shakeHistory.current = []
            clusterClickStart.current = null
            setDraggingFreeGlob(false)
            setDraggingClusterId(null)
            setAddingToClusterId(cid)
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            return
          }
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
        // Hold-to-merge: if we were glowing a target, open the rename merge modal (same UX as the tether merge button).
        if (heldMergeTargetId && heldMergeTargetId !== cid) {
          setMergePrompt({ c1Id: cid, c2Id: heldMergeTargetId, connectionId: '' })
        }
      }
      dragging.current = null
      shakeHistory.current = []
      clusterClickStart.current = null
      setDraggingFreeGlob(false)
      setDraggingClusterId(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [onDisconnectClusters, onUpdatePos, onUpdateClusterPos, onTouchCluster, globs])

  // Context menu
  const onCtx = useCallback((e: React.MouseEvent, globId: string, inCluster: boolean) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, globId, inCluster })
    setClusterCtx(null)
    setDissolveConfirm(null)
  }, [])

  useEffect(() => {
    window.addEventListener('click', closeTransientUi)
    return () => window.removeEventListener('click', closeTransientUi)
  }, [closeTransientUi])
  const freeGlobs = globs.filter(g => !g.clusterId)
  const clusterList = [...clusters].sort((a, b) => {
    const interactionDiff = b.lastInteraction - a.lastInteraction
    if (interactionDiff !== 0) return interactionDiff
    return a.name.localeCompare(b.name)
  })
  const clusterGlobs = (c: Cluster) => {
    const map = new Map(globs.map(g => [g.id, g]))
    return c.globIds.map(id => map.get(id)).filter(Boolean) as Glob[]
  }
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1200
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800
  const onboardingGlobX = Math.min(Math.max(viewportW * 0.34, 180), viewportW - 260)
  const onboardingGlobY = Math.min(Math.max(viewportH * 0.36, 180), viewportH - 220)
  const onboardingClusterX = Math.min(Math.max(viewportW * 0.7, 320), viewportW - 180)
  const onboardingClusterY = Math.min(Math.max(viewportH * 0.38, 180), viewportH - 220)

  return (
    <div className="galaxy" onClick={e => {
      if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('galaxy')) return
      setFocusedClusterId(null)
      setClusterBrowserOpen(false)
    }} onContextMenu={e => {
      // Only trigger on the galaxy background itself
      if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('galaxy')) {
        e.preventDefault()
        setFocusedClusterId(null)
        setClusterBrowserOpen(false)
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

      <ConnectionLayer
        clusters={clusters}
        connections={connections}
        connecting={connecting}
        hoveredConnection={hoveredConnection}
        flashConnection={flashConnection}
        onHoverConnection={setHoveredConnection}
        onDisconnectClick={disconnectConnectionFromAltClick}
        onRequestMerge={(c1Id, c2Id, connectionId) => setMergePrompt({ c1Id, c2Id, connectionId })}
        onDisconnect={onDisconnectClusters}
      />

      {marqueeMode && (
        <MarqueeOverlay
          rect={marqueeRect}
          selectedIds={selectedIds}
          onOpenBulkMenu={(x, y) => setBulkCtx({ x, y })}
          onStartSelection={startSelection}
          onUpdateSelection={updateSelection}
          onCommitSelection={commitSelection}
        />
      )}
      <ModeTools
        marqueeMode={marqueeMode}
        onSetPointerMode={setPointerMode}
        onSetMarqueeMode={setSelectionMode}
      />

      <ClusterTools
        clusterCount={clusters.length}
        browserOpen={clusterBrowserOpen}
        onOrganize={organizeClusters}
        onToggleBrowser={() => setClusterBrowserOpen(v => !v)}
      />

      {clusterBrowserOpen && (
        <ClusterBrowser
          clusters={clusterList}
          focusedClusterId={focusedClusterId}
          onFocusCluster={clusterId => focusCluster(clusterId, { center: true })}
        />
      )}

      {showOnboarding && (
        <OnboardingLayer
          globX={onboardingGlobX}
          globY={onboardingGlobY}
          clusterX={onboardingClusterX}
          clusterY={onboardingClusterY}
          onDismiss={onDismissOnboarding}
        />
      )}

      {freeGlobs.map(g => (
        <FreeGlob
          key={g.id}
          glob={g}
          editing={editingId === g.id}
          highlighted={highlightId === g.id}
          onPointerDown={(e, globId) => onPointerDown(e, globId, 'glob')}
          onConvertToClusterTodo={globId => {
            onConvertToCluster(globId)
            onToggleTodo(globId)
          }}
          onOpenMenu={(e, globId) => onCtx(e, globId, false)}
          onStartEditing={() => setEditingId(g.id)}
          onUpdateText={text => onUpdateText(g.id, text)}
          onCancelEditing={() => setEditingId(null)}
        />
      ))}
      {clusters.map(c => {
        const cGlobs = clusterGlobs(c)
        const isFocused = focusedClusterId === c.id
        const isMergeTarget = mergeHoverTargetId === c.id
        const zRank = 20 + clusterZRank.get(c.id)!
        return (
          <ClusterCard
            key={c.id}
            cluster={c}
            globs={cGlobs}
            className={`cluster ${c.collapsed ? 'collapsed' : ''} ${isFocused ? 'focused' : ''} ${draggingClusterId === c.id ? 'dragging-active' : ''} ${highlightId === c.id ? 'highlight-pulse' : ''} ${isMergeTarget ? 'merge-target' : ''} ${addingToClusterId === c.id ? 'adding-active' : ''}`}
            zIndex={zRank}
            editingCluster={editingClusterId === c.id}
            dissolvePending={dissolveConfirm === c.id}
            addingActive={addingToClusterId === c.id}
            editingGlobId={editingId}
            selectedIds={selectedIds}
            highlightedId={highlightId}
            dragOverGlobId={dragReorder?.overGlobId ?? null}
            onClusterDragOver={e => {
              if (!dragReorder) return
              e.preventDefault()
              e.stopPropagation()
              onReorderDragOver(c.id, null)
            }}
            onClusterDrop={e => {
              if (!dragReorder) return
              e.preventDefault()
              e.stopPropagation()
              onReorderDrop()
            }}
            onOpenClusterMenu={e => {
              const t = e.target as HTMLElement
              if (t.closest('.cluster-glob-item') || t.tagName === 'INPUT' || t.tagName === 'BUTTON') return
              e.preventDefault(); e.stopPropagation()
              setFocusedClusterId(c.id)
              setClusterCtx({ x: e.clientX, y: e.clientY, clusterId: c.id })
              setContextMenu(null)
            }}
            onClusterPointerDown={e => {
              const t = e.target as HTMLElement
              if (t.closest('.cluster-link-handle') || t.closest('.cluster-drag-handle') || t.closest('.cluster-add-handle') || t.closest('.cluster-glob-item')) return
              if (e.ctrlKey || e.metaKey) {
                e.stopPropagation(); e.preventDefault()
                onToggleAllTodosInCluster(c.id)
                return
              }
              const rect = e.currentTarget.getBoundingClientRect()
              const mx = e.clientX, my = e.clientY
              const inset = 8
              const nearEdge = mx < rect.left + inset || mx > rect.right - inset
                || my < rect.top + inset || my > rect.bottom - inset
              if (nearEdge) {
                focusCluster(c.id, { pulse: false })
                onPointerDown(e, c.id, 'cluster')
              }
            }}
            onClusterEdgeDragStart={e => {
              focusCluster(c.id, { pulse: false })
              onPointerDown(e, c.id, 'cluster')
            }}
            onConnectStart={e => {
              e.stopPropagation()
              e.preventDefault()
              focusCluster(c.id, { pulse: false })
              const fromId = c.id
              setConnecting({ fromClusterId: fromId, cursorX: e.clientX, cursorY: e.clientY })

              const onMove = (ev: PointerEvent) => {
                setConnecting(prev => prev ? { ...prev, cursorX: ev.clientX, cursorY: ev.clientY } : null)
              }
              const onUp = (ev: PointerEvent) => {
                window.removeEventListener('pointermove', onMove)
                window.removeEventListener('pointerup', onUp)
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
            onStartClusterEditing={() => setEditingClusterId(c.id)}
            onRenameCluster={name => { onRenameCluster(c.id, name); setEditingClusterId(null) }}
            onCancelClusterEditing={() => setEditingClusterId(null)}
            onToggleCollapse={() => onToggleClusterCollapse(c.id)}
            onRequestDissolve={() => setDissolveConfirm(c.id)}
            onConfirmDissolve={() => { onDissolveCluster(c.id); setDissolveConfirm(null) }}
            onCancelDissolve={() => setDissolveConfirm(null)}
            onToggleGlobTodo={onToggleTodo}
            onToggleGlobDone={onToggleDone}
            onStartGlobEditing={setEditingId}
            onUpdateGlobText={(globId, text) => { onUpdateText(globId, text); setEditingId(null) }}
            onCancelGlobEditing={() => setEditingId(null)}
            onGlobDragStart={(e, globId) => {
              e.stopPropagation()
              onReorderDragStart(c.id, globId)
              setDraggingFreeGlob(true)
            }}
            onGlobDragOver={(e, globId) => {
              e.preventDefault()
              e.stopPropagation()
              onReorderDragOver(c.id, globId)
            }}
            onGlobDrop={e => {
              e.preventDefault()
              e.stopPropagation()
              onReorderDrop()
            }}
            onGlobDragEnd={(e, glob) => {
              setDraggingFreeGlob(false)
              if (dragHandledRef.current) {
                dragHandledRef.current = false
                setDragReorder(null)
                return
              }
              const { clientX: mx, clientY: my } = e
              const w = window.innerWidth, h = window.innerHeight
              const trashCx = w - TRASH_MARGIN - TRASH_SIZE / 2
              const trashCy = h - 80 - TRASH_SIZE / 2
              const tdx = mx - trashCx, tdy = my - trashCy
              if (Math.sqrt(tdx * tdx + tdy * tdy) < TRASH_SIZE) {
                setTrashConfirm(glob.id)
                setDragReorder(null)
                return
              }
              const targetGlob = globs.find(other =>
                !other.clusterId &&
                Math.hypot(mx - other.x, my - other.y) < other.radius + 20
              )
              if (targetGlob) {
                const willOrphanSource = c.globIds.length === 1
                onRemoveFromCluster(glob.id)
                onCreateCluster(glob.id, targetGlob.id, (mx + targetGlob.x) / 2, (my + targetGlob.y) / 2)
                if (willOrphanSource) onDeleteCluster(c.id)
                setDragReorder(null)
                return
              }

              const clusterEl = (e.target as HTMLElement).closest('.cluster')
              if (clusterEl) {
                const rect = clusterEl.getBoundingClientRect()
                const margin = 60
                if (mx < rect.left - margin || mx > rect.right + margin || my < rect.top - margin || my > rect.bottom + margin) {
                  if (c.globIds.length === 1) {
                    setLastGlobPrompt({ globId: glob.id, clusterId: c.id, x: mx, y: my })
                  } else {
                    onRemoveFromCluster(glob.id)
                    onUpdatePos(glob.id, mx, my)
                  }
                  setDragReorder(null)
                  return
                }
              }
              setDragReorder(null)
            }}
            onOpenGlobContextMenu={(e, glob) => {
              if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopPropagation(); return }
              if (selectedIds.size > 1 && selectedIds.has(glob.id)) {
                e.preventDefault(); e.stopPropagation()
                setBulkCtx({ x: e.clientX, y: e.clientY })
                setContextMenu(null); setClusterCtx(null); setRecolorPopover(null)
                return
              }
              onCtx(e, glob.id, true)
            }}
            onActivateAdd={() => { setFocusedClusterId(c.id); setAddingToClusterId(c.id) }}
            onAddGlob={text => onAddGlobToCluster(text, c.id)}
            onCancelAdd={() => setAddingToClusterId(null)}
          />
        )
      })}

      <GalaxyOverlays
        globs={globs}
        clusters={clusters}
        contextMenu={contextMenu}
        clusterCtx={clusterCtx}
        bulkCtx={bulkCtx}
        selectedIds={selectedIds}
        recolorPopover={recolorPopover}
        newGlobPos={newGlobPos}
        draggingFreeGlob={draggingFreeGlob}
        draggingClusterId={draggingClusterId}
        trashConfirm={trashConfirm}
        clusterTrashConfirm={clusterTrashConfirm}
        shakeDissolve={shakeDissolve}
        lastGlobPrompt={lastGlobPrompt}
        mergePrompt={mergePrompt}
        helpOpen={helpOpen}
        helpPinned={helpPinned}
        searchOpen={searchOpen}
        searchQ={searchQ}
        searchResults={searchResults}
        searchInputRef={searchInputRef}
        clearConfirm={clearConfirm}
        onSetContextMenu={setContextMenu}
        onSetClusterCtx={setClusterCtx}
        onSetBulkCtx={setBulkCtx}
        onSetRecolorPopover={setRecolorPopover}
        onSetNewGlobPos={setNewGlobPos}
        onSetTrashConfirm={setTrashConfirm}
        onSetClusterTrashConfirm={setClusterTrashConfirm}
        onSetShakeDissolve={setShakeDissolve}
        onSetLastGlobPrompt={setLastGlobPrompt}
        onSetMergePrompt={setMergePrompt}
        onSetHelpOpen={setHelpOpen}
        onSetHelpPinned={setHelpPinned}
        onSetSearchOpen={setSearchOpen}
        onSetSearchQ={setSearchQ}
        onSetClearConfirm={setClearConfirm}
        onSetEditingId={setEditingId}
        onSetEditingClusterId={setEditingClusterId}
        onSetSelectedIds={setSelectedIds}
        onToggleFlag={onToggleFlag}
        onToggleTodo={onToggleTodo}
        onToggleAllTodosInCluster={onToggleAllTodosInCluster}
        onToggleAllTodosInGlobs={onToggleAllTodosInGlobs}
        onToggleClusterCollapse={onToggleClusterCollapse}
        onDuplicate={onDuplicate}
        onRecolor={onRecolor}
        onRecolorCluster={onRecolorCluster}
        onRecolorAllInCluster={onRecolorAllInCluster}
        onRecolorGlobs={onRecolorGlobs}
        onConvertToCluster={onConvertToCluster}
        onRemoveFromCluster={onRemoveFromCluster}
        onUpdatePos={onUpdatePos}
        onDelete={onDelete}
        onDeleteGlobs={onDeleteGlobs}
        onDeleteCluster={onDeleteCluster}
        onDissolveCluster={onDissolveCluster}
        onTransferToNewCluster={onTransferToNewCluster}
        onAddGlobAt={onAddGlobAt}
        onMergeClusters={onMergeClusters}
        onClearAll={onClearAll}
        onExportJSON={onExportJSON}
        onImportJSON={onImportJSON}
        onRescueClusters={rescueClustersIntoView}
        onGatherFreeGlobs={onGatherFreeGlobs}
        onJumpToSearchResult={jumpToResult}
      />
    </div>
  )
}
