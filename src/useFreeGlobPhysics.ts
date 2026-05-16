import { useEffect, useRef } from 'react'
import type { Glob } from './types'

const DAMPING = 0.9995
const BOUNCE = 0.6
const REPEL_DIST = 90
const REPEL_FORCE = 0.02
const MIN_SPEED = 0.12

export function useFreeGlobPhysics({
  dragging,
  updateGlobs,
}: {
  dragging: React.RefObject<{ id: string; type: 'glob' | 'cluster'; offX: number; offY: number } | null>
  updateGlobs: (fn: (globs: Glob[]) => Glob[]) => void
}) {
  const animRef = useRef(0)

  useEffect(() => {
    function tick() {
      updateGlobs(prev => {
        const w = window.innerWidth
        const h = window.innerHeight
        const dragId = dragging.current?.id

        return prev.map((glob, i) => {
          if (glob.clusterId || glob.id === dragId) return glob

          let { x, y, vx, vy } = glob

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

          const r = glob.radius
          const bottomBound = 70
          if (x - r < 0) { x = r; vx = Math.abs(vx) * BOUNCE }
          if (x + r > w) { x = w - r; vx = -Math.abs(vx) * BOUNCE }
          if (y - r < 60) { y = 60 + r; vy = Math.abs(vy) * BOUNCE }
          if (y + r > h - bottomBound) { y = h - bottomBound - r; vy = -Math.abs(vy) * BOUNCE }

          return { ...glob, x, y, vx, vy }
        })
      })

      animRef.current = requestAnimationFrame(tick)
    }

    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [dragging, updateGlobs])
}
