import { useEffect, useState } from 'react'

// Phones (and coarse-pointer small tablets) get the list view instead of the galaxy.
// The galaxy's hover / right-click / drag / physics model is unusable with touch, so
// we branch on this in App.tsx and never mount Galaxy on mobile.
const QUERY = '(max-width: 640px), (pointer: coarse) and (max-width: 920px)'

function evaluate(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(QUERY).matches
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(evaluate)

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const onChange = () => setIsMobile(mq.matches)
    mq.addEventListener('change', onChange)
    // Orientation changes can flip the (max-width) clause without firing 'change' on
    // some browsers — re-evaluate on resize too.
    window.addEventListener('resize', onChange)
    return () => {
      mq.removeEventListener('change', onChange)
      window.removeEventListener('resize', onChange)
    }
  }, [])

  return isMobile
}
