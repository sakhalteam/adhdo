import { useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { MarqueeRect } from './GalaxyChrome'

type MarqueeMode = 'replace' | 'add' | 'remove'

export function useMarqueeSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [marqueeMode, setMarqueeMode] = useState(false)
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null)
  const marqueeModeRef = useRef<MarqueeMode>('replace')

  const clearSelection = () => setSelectedIds(new Set())

  const setPointerMode = () => {
    setMarqueeMode(false)
    setMarqueeRect(null)
  }

  const setSelectionMode = () => {
    setMarqueeMode(true)
    setMarqueeRect(null)
  }

  const startSelection = (event: PointerEvent<HTMLDivElement>) => {
    marqueeModeRef.current = (event.ctrlKey || event.metaKey) ? 'remove' : event.shiftKey ? 'add' : 'replace'
    const startX = event.clientX
    const startY = event.clientY
    setMarqueeRect({ x1: startX, y1: startY, x2: startX, y2: startY })
  }

  const updateSelection = (x: number, y: number) => {
    setMarqueeRect(rect => rect ? { ...rect, x2: x, y2: y } : null)
  }

  const commitSelection = () => {
    if (!marqueeRect) return
    if (Math.abs(marqueeRect.x2 - marqueeRect.x1) < 3 && Math.abs(marqueeRect.y2 - marqueeRect.y1) < 3) {
      setMarqueeRect(null)
      return
    }

    const left = Math.min(marqueeRect.x1, marqueeRect.x2)
    const right = Math.max(marqueeRect.x1, marqueeRect.x2)
    const top = Math.min(marqueeRect.y1, marqueeRect.y2)
    const bottom = Math.max(marqueeRect.y1, marqueeRect.y2)
    const inRect = new Set<string>()

    document.querySelectorAll<HTMLElement>('[data-glob-id]').forEach(el => {
      const id = el.dataset.globId
      if (!id) return
      const rect = el.getBoundingClientRect()
      if (rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom) {
        inRect.add(id)
      }
    })

    const mode = marqueeModeRef.current
    setSelectedIds(prev => {
      if (mode === 'add') return new Set([...prev, ...inRect])
      if (mode === 'remove') {
        const next = new Set(prev)
        inRect.forEach(id => next.delete(id))
        return next
      }
      return inRect
    })
    setMarqueeRect(null)
  }

  return {
    selectedIds,
    setSelectedIds,
    clearSelection,
    marqueeMode,
    setMarqueeMode,
    marqueeRect,
    setMarqueeRect,
    setPointerMode,
    setSelectionMode,
    startSelection,
    updateSelection,
    commitSelection,
  }
}
