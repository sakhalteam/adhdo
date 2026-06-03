// Trash drop-zone geometry, shared by every drag handler so the hit-test
// can't drift out of sync (it used to be copy-pasted in 3 places).

export const TRASH_SIZE = 56
export const TRASH_MARGIN = 24
const TRASH_BOTTOM_OFFSET = 80 // distance from the bottom edge to the zone center

/** True when (x, y) lands on the bottom-right trash zone. */
export function isOverTrash(x: number, y: number): boolean {
  const cx = window.innerWidth - TRASH_MARGIN - TRASH_SIZE / 2
  const cy = window.innerHeight - TRASH_BOTTOM_OFFSET - TRASH_SIZE / 2
  return Math.hypot(x - cx, y - cy) < TRASH_SIZE
}
