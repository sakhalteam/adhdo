import type { Glob } from './types'
import { todayStr } from './dates'

// ── The agenda: what's due, grouped ─────────────────────────────────────────
// One definition of "overdue", "today" and "upcoming", shared by the phone's
// Today/Upcoming tabs and the desktop agenda panel. Kept out of both layouts
// deliberately: the moment each computes its own buckets they drift, and a
// task that shows up on the phone but not the laptop is worse than no panel.

/** Overdue first, then by date, then P1 before P4, then oldest capture first. */
export function byUrgency(a: Glob, b: Glob): number {
  const da = a.dueDate ?? '9999-99-99'
  const db = b.dueDate ?? '9999-99-99'
  if (da !== db) return da < db ? -1 : 1
  const pa = a.priority ?? 4
  const pb = b.priority ?? 4
  if (pa !== pb) return pa - pb
  return a.createdAt - b.createdAt
}

export interface DayGroup {
  date: string
  items: Glob[]
}

export interface Agenda {
  overdue: Glob[]
  today: Glob[]
  /** Everything dated past today, one group per calendar day, soonest first. */
  upcoming: DayGroup[]
  /** What the Today view holds, and what the tab badge counts. */
  todayCount: number
  /** Overdue + today + upcoming, for "is there anything at all" checks. */
  total: number
}

/**
 * Only open to-dos land on an agenda: a done task is history, and a plain
 * undated thought was never an obligation in the first place.
 */
export function buildAgenda(globs: Glob[], today: string = todayStr()): Agenda {
  const open = globs.filter(g => g.isTodo && !g.done && g.dueDate)

  const overdue: Glob[] = []
  const todayItems: Glob[] = []
  const groups = new Map<string, Glob[]>()

  for (const g of open) {
    const due = g.dueDate as string
    if (due < today) overdue.push(g)
    else if (due === today) todayItems.push(g)
    else {
      const list = groups.get(due) ?? []
      list.push(g)
      groups.set(due, list)
    }
  }

  overdue.sort(byUrgency)
  todayItems.sort(byUrgency)
  const upcoming = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, items]) => ({ date, items: items.sort(byUrgency) }))

  const todayCount = overdue.length + todayItems.length
  return {
    overdue,
    today: todayItems,
    upcoming,
    todayCount,
    total: todayCount + upcoming.reduce((n, g) => n + g.items.length, 0),
  }
}
