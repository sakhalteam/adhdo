import { useCallback, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { MarqueeRect } from './GalaxyChrome'

/** How a freshly swept band combines with whatever is already selected. */
type CombineMode = 'replace' | 'add' | 'remove'

/** Under this much travel the press was really a click, not a band. */
const MIN_BAND = 3

/*
 * Rubber-band selection. There is no longer a *mode* to be in: the galaxy hands
 * every press on its own background here, so drag-from-empty-space selects and
 * drag-from-anything-else keeps doing what it always did. The old V/M tool
 * column existed only because a full-screen overlay had to swallow pointer
 * events to make the band work, and an overlay you have to opt into is a mode.
 */
export function useMarqueeSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null)
  // Mirrored into a ref so move/commit can read the live band without waiting
  // for a render to land.
  const rectRef = useRef<MarqueeRect | null>(null)
  const combineRef = useRef<CombineMode>('replace')

  const setRect = (next: MarqueeRect | null) => {
    rectRef.current = next
    setMarqueeRect(next)
  }

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const startSelection = (event: PointerEvent<HTMLElement>) => {
    combineRef.current = (event.ctrlKey || event.metaKey) ? 'remove' : event.shiftKey ? 'add' : 'replace'
    setRect({ x1: event.clientX, y1: event.clientY, x2: event.clientX, y2: event.clientY })
  }

  const updateSelection = (x: number, y: number) => {
    const rect = rectRef.current
    if (!rect) return
    setRect({ ...rect, x2: x, y2: y })
  }

  /** Returns true when a real band was swept, so the caller can tell it apart from a click. */
  const commitSelection = (): boolean => {
    const rect = rectRef.current
    if (!rect) return false
    setRect(null)
    if (Math.abs(rect.x2 - rect.x1) < MIN_BAND && Math.abs(rect.y2 - rect.y1) < MIN_BAND) return false

    const left = Math.min(rect.x1, rect.x2)
    const right = Math.max(rect.x1, rect.x2)
    const top = Math.min(rect.y1, rect.y2)
    const bottom = Math.max(rect.y1, rect.y2)
    const inRect = new Set<string>()

    document.querySelectorAll<HTMLElement>('[data-glob-id]').forEach(el => {
      const id = el.dataset.globId
      if (!id) return
      const box = el.getBoundingClientRect()
      if (box.right >= left && box.left <= right && box.bottom >= top && box.top <= bottom) {
        inRect.add(id)
      }
    })

    const mode = combineRef.current
    setSelectedIds(prev => {
      if (mode === 'add') return new Set([...prev, ...inRect])
      if (mode === 'remove') {
        const next = new Set(prev)
        inRect.forEach(id => next.delete(id))
        return next
      }
      return inRect
    })
    return true
  }

  const cancelSelection = () => setRect(null)

  return {
    selectedIds,
    setSelectedIds,
    clearSelection,
    marqueeRect,
    /** True while a band is actively being swept. */
    banding: marqueeRect !== null,
    startSelection,
    updateSelection,
    commitSelection,
    cancelSelection,
  }
}
