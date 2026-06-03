import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { Connection, Glob } from './types'
import { isOverTrash } from './trashZone'
import type { GlobDropHandler } from './useGlobDrop'

const MERGE_HOLD_MS = 750 // hold a cluster over another this long → target glows, release opens rename merge modal

type DragKind = 'glob' | 'cluster'
type DragState = { id: string; type: DragKind; offX: number; offY: number }
type MergePrompt = { c1Id: string; c2Id: string; connectionId: string }

/**
 * Owns the pointer-drag lifecycle for globs and clusters: position updates,
 * shake-to-dissolve detection, hold-to-merge glow, alt-drag to sever links,
 * click-to-add, and trash-drop. Returns the drag refs/flags the rest of the
 * Galaxy needs to render (trash zone, merge-target glow, dragging classes).
 */
export function useClusterDrag({
  globs,
  connectionsRef,
  handleDropRef,
  onTouchCluster,
  onUpdatePos,
  onUpdateClusterPos,
  onToggleAllTodosInCluster,
  onDisconnectClusters,
  onCloseMenus,
  onShakeDissolve,
  onClusterTrashConfirm,
  onMergePrompt,
  onAddingToCluster,
}: {
  globs: Glob[]
  connectionsRef: RefObject<Connection[]>
  handleDropRef: RefObject<GlobDropHandler>
  onTouchCluster: (id: string) => void
  onUpdatePos: (id: string, x: number, y: number) => void
  onUpdateClusterPos: (id: string, x: number, y: number) => void
  onToggleAllTodosInCluster: (id: string) => void
  onDisconnectClusters: (id: string) => void
  /** Clears transient menus/popovers when a drag begins. */
  onCloseMenus: () => void
  onShakeDissolve: (id: string) => void
  onClusterTrashConfirm: (id: string) => void
  onMergePrompt: (value: MergePrompt) => void
  onAddingToCluster: (id: string) => void
}) {
  const dragging = useRef<DragState | null>(null)
  const [draggingFreeGlob, setDraggingFreeGlob] = useState(false)
  const [draggingClusterId, setDraggingClusterId] = useState<string | null>(null)

  // Hold-to-merge: while dragging a cluster over another, after MERGE_HOLD_MS we glow the target;
  // release while glowing triggers absorb.
  const [mergeHoverTargetId, setMergeHoverTargetId] = useState<string | null>(null)
  const mergeHoverIdRef = useRef<string | null>(null)
  const mergeHoverTimerRef = useRef<number | null>(null)
  const mergeHoverTargetIdRef = useRef<string | null>(null)
  mergeHoverTargetIdRef.current = mergeHoverTargetId

  const shakeHistory = useRef<{ x: number; y: number; t: number }[]>([])
  const clusterClickStart = useRef<{ x: number; y: number } | null>(null)

  const onPointerDown = useCallback((e: ReactPointerEvent, id: string, type: DragKind) => {
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
    onCloseMenus()

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
          const hoverId = clusterEl.dataset.clusterId
          if (hoverId && hoverId !== cid) { newHoverId = hoverId; break }
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
            onShakeDissolve(id)
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
            onAddingToCluster(cid)
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            return
          }
        }
        // Check if dropped on trash zone (bottom-right corner)
        if (isOverTrash(ev.clientX, ev.clientY)) {
          dragging.current = null
          shakeHistory.current = []
          setDraggingFreeGlob(false)
          setDraggingClusterId(null)
          onClusterTrashConfirm(cid)
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          return
        }
        // Hold-to-merge: if we were glowing a target, open the rename merge modal (same UX as the tether merge button).
        if (heldMergeTargetId && heldMergeTargetId !== cid) {
          onMergePrompt({ c1Id: cid, c2Id: heldMergeTargetId, connectionId: '' })
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
  }, [
    globs,
    connectionsRef,
    handleDropRef,
    onTouchCluster,
    onUpdatePos,
    onUpdateClusterPos,
    onToggleAllTodosInCluster,
    onDisconnectClusters,
    onCloseMenus,
    onShakeDissolve,
    onClusterTrashConfirm,
    onMergePrompt,
    onAddingToCluster,
  ])

  return {
    dragging,
    draggingFreeGlob,
    setDraggingFreeGlob,
    draggingClusterId,
    mergeHoverTargetId,
    onPointerDown,
  }
}
