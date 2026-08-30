import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { isOverTrash } from './trashZone'

/*
 * Drag a marquee selection somewhere as one thing.
 *
 * Once you've rubber-banded a handful of thoughts, the obvious next move is to
 * grab them and put them where they belong. The galaxy offers this hook first
 * refusal on every press: if it landed on something already selected, the whole
 * selection travels; otherwise it declines and the press falls through to the
 * normal single-item drag (or, on empty space, to a new rubber band).
 *
 * The globs themselves never move during the drag. Dragging six blobs around
 * the physics sim to find out you dropped them badly is a lot of motion for no
 * information — instead a single ghost follows the cursor, and the drop is what
 * actually mutates anything.
 */

/** Travel before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 5

export interface GroupDragState {
  /** Cursor position, once the press has become a real drag. */
  ghost: { x: number; y: number } | null
  /** Cluster currently under the cursor, to light up as the drop target. */
  hoverClusterId: string | null
  /** Cursor is over the trash zone — the drop will delete the whole selection. */
  overTrash: boolean
}

export function useGroupDrag({
  selectedIds,
  onDropIntoCluster,
  onDropOnEmpty,
  onDropOnTrash,
}: {
  selectedIds: Set<string>
  onDropIntoCluster: (ids: string[], clusterId: string) => void
  /** Drop landed on open space — caller prompts for a new cluster name. */
  onDropOnEmpty: (ids: string[], x: number, y: number) => void
  /** Drop landed on the trash — caller confirms deleting the whole selection. */
  onDropOnTrash: (ids: string[]) => void
}) {
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  const [hoverClusterId, setHoverClusterId] = useState<string | null>(null)
  const [overTrash, setOverTrash] = useState(false)

  // Refs, because the window listeners below are registered once per drag and
  // must not close over stale state.
  const selectedRef = useRef(selectedIds)
  selectedRef.current = selectedIds
  const onDropIntoClusterRef = useRef(onDropIntoCluster)
  onDropIntoClusterRef.current = onDropIntoCluster
  const onDropOnEmptyRef = useRef(onDropOnEmpty)
  onDropOnEmptyRef.current = onDropOnEmpty
  const onDropOnTrashRef = useRef(onDropOnTrash)
  onDropOnTrashRef.current = onDropOnTrash
  const cleanupRef = useRef<(() => void) | null>(null)

  const endDrag = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    setGhost(null)
    setHoverClusterId(null)
    setOverTrash(false)
  }, [])

  useEffect(() => endDrag, [endDrag])

  /**
   * The cluster under a point, ignoring the overlay stacked on top of it.
   * elementsFromPoint (plural) returns the whole stack, so nothing needs its
   * pointer-events toggled off mid-gesture.
   */
  const clusterAt = (x: number, y: number): string | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const cluster = (el as HTMLElement).closest('.cluster[data-cluster-id]') as HTMLElement | null
      if (cluster?.dataset.clusterId) return cluster.dataset.clusterId
    }
    return null
  }

  /** Is this point over an item that's part of the current selection? */
  const selectedItemAt = (x: number, y: number): boolean => {
    for (const el of document.elementsFromPoint(x, y)) {
      const item = (el as HTMLElement).closest('[data-glob-id]') as HTMLElement | null
      const id = item?.dataset.globId
      if (id && selectedRef.current.has(id)) return true
    }
    return false
  }

  /**
   * Offered every pointerdown on the marquee overlay. Returns true when it has
   * taken the gesture, which tells the overlay not to start a rubber band.
   */
  const tryStart = useCallback((event: ReactPointerEvent<HTMLDivElement>): boolean => {
    if (selectedRef.current.size < 2) return false
    // ⌃/⌘/Shift+click still mean what they always meant on an item.
    if (event.ctrlKey || event.metaKey || event.shiftKey) return false
    if (!selectedItemAt(event.clientX, event.clientY)) return false

    const startX = event.clientX
    const startY = event.clientY
    let armed = false

    const onMove = (e: PointerEvent) => {
      if (!armed) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return
        armed = true
      }
      const trashed = isOverTrash(e.clientX, e.clientY)
      setGhost({ x: e.clientX, y: e.clientY })
      setOverTrash(trashed)
      // The trash sits over the galaxy, so a cluster underneath it must not win.
      setHoverClusterId(trashed ? null : clusterAt(e.clientX, e.clientY))
    }

    const onUp = (e: PointerEvent) => {
      const wasDragging = armed
      const trashed = wasDragging && isOverTrash(e.clientX, e.clientY)
      const target = wasDragging && !trashed ? clusterAt(e.clientX, e.clientY) : null
      const ids = [...selectedRef.current]
      endDrag()
      // A press that never moved is just a click; leave the selection alone.
      if (!wasDragging) return
      if (trashed) onDropOnTrashRef.current(ids)
      else if (target) onDropIntoClusterRef.current(ids, target)
      else onDropOnEmptyRef.current(ids, e.clientX, e.clientY)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endDrag()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', endDrag)
    window.addEventListener('keydown', onKey)
    cleanupRef.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', endDrag)
      window.removeEventListener('keydown', onKey)
    }
    return true
  }, [endDrag])

  return { ghost, hoverClusterId, overTrash, dragging: ghost !== null, tryStart }
}
