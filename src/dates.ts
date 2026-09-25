import type { Priority } from './types'

// ── due dates ────────────────────────────────────────────────────────────────
// A due date is a local calendar date, stored as 'YYYY-MM-DD'. Never a Date
// object and never UTC: "tomorrow" typed at 11pm has to mean the user's
// tomorrow, and an ISO timestamp round-tripped through a timezone doesn't.

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function toStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Parse 'YYYY-MM-DD' as a LOCAL date (new Date('YYYY-MM-DD') would be UTC). */
export function parseDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayStr(): string {
  return toStr(new Date())
}

export function addDaysStr(dateStr: string, days: number): string {
  const d = parseDay(dateStr)
  d.setDate(d.getDate() + days)
  return toStr(d)
}

/** Whole calendar days from today to `dateStr` (negative = past). */
export function daysFromToday(dateStr: string): number {
  const ms = parseDay(dateStr).getTime() - parseDay(todayStr()).getTime()
  return Math.round(ms / 86_400_000)
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The next occurrence of a weekday, always in the future (today → a week out). */
export function nextWeekdayStr(weekday: number): string {
  const now = new Date()
  const ahead = ((weekday - now.getDay()) % 7 + 7) % 7 || 7
  now.setDate(now.getDate() + ahead)
  return toStr(now)
}

export type DueTone = 'overdue' | 'today' | 'tomorrow' | 'soon' | 'later'

/**
 * How a due date reads on a row: "Yesterday", "Today", "Tomorrow", a weekday
 * within the coming week, otherwise "Sep 24" (with the year once it differs).
 */
export function formatDue(dateStr: string): { label: string; tone: DueTone } {
  const diff = daysFromToday(dateStr)
  if (diff < 0) {
    const label = diff === -1 ? 'Yesterday' : `${-diff} days ago`
    return { label, tone: 'overdue' }
  }
  if (diff === 0) return { label: 'Today', tone: 'today' }
  if (diff === 1) return { label: 'Tomorrow', tone: 'tomorrow' }
  const d = parseDay(dateStr)
  if (diff < 7) return { label: WEEKDAYS_SHORT[d.getDay()], tone: 'soon' }
  const year = d.getFullYear() === new Date().getFullYear() ? '' : ` ${d.getFullYear()}`
  return { label: `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}${year}`, tone: 'later' }
}

// ── quick-add parsing ────────────────────────────────────────────────────────
// The Todoist trick: type "call mum tomorrow p2" and the date and priority lift
// out of the text. Deliberately conservative — only unambiguous, word-bounded
// tokens, so "monitor the situation" never schedules anything. Short weekday
// forms (mon, sat, sun...) are skipped for the same reason ("sat down").

export interface QuickAddParse {
  /** The text with any recognized tokens stripped out. */
  text: string
  dueDate: string | null
  priority: Priority | null
}

const DATE_TOKENS: { re: RegExp; resolve: () => string }[] = [
  { re: /\b(?:today|tonight)\b/i, resolve: todayStr },
  { re: /\b(?:tomorrow|tmrw)\b/i, resolve: () => addDaysStr(todayStr(), 1) },
  { re: /\bnext week\b/i, resolve: () => nextWeekdayStr(1) },
  ...WEEKDAYS.map((name, day) => ({
    re: new RegExp(`\\b(?:next\\s+)?${name}\\b`, 'i'),
    resolve: () => nextWeekdayStr(day),
  })),
]

const PRIORITY_TOKEN = /\bp([1-4])\b/i

/**
 * `priority: false` leaves "p1"–"p4" in the text. The phone passes it: it is a
 * capture pocket, not a planner, and a token that silently vanishes from what
 * you typed — into a field the phone never shows — is the opposite of that.
 */
export function parseQuickAdd(raw: string, opts: { priority?: boolean } = {}): QuickAddParse {
  let text = raw
  let dueDate: string | null = null
  let priority: Priority | null = null

  const pm = opts.priority === false ? null : text.match(PRIORITY_TOKEN)
  if (pm) {
    priority = Number(pm[1]) as Priority
    text = text.replace(PRIORITY_TOKEN, ' ')
  }
  for (const token of DATE_TOKENS) {
    if (token.re.test(text)) {
      dueDate = token.resolve()
      text = text.replace(token.re, ' ')
      break
    }
  }
  return { text: text.replace(/\s+/g, ' ').trim(), dueDate, priority }
}

// ── capture days ─────────────────────────────────────────────────────────────
// The phone's stream reads like a journal: thoughts grouped by the day they were
// caught. Backward-looking, unlike formatDue — "Yesterday", a weekday for the
// last week, then a plain date.

const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Local 'YYYY-MM-DD' of a timestamp — the key the stream groups by. */
export function dayKey(ts: number): string {
  return toStr(new Date(ts))
}

export function formatCaptureDay(key: string): string {
  const diff = daysFromToday(key)
  if (diff === 0) return 'Today'
  if (diff === -1) return 'Yesterday'
  const d = parseDay(key)
  if (diff > -7 && diff < 0) return WEEKDAYS_LONG[d.getDay()]
  const year = d.getFullYear() === new Date().getFullYear() ? '' : ` ${d.getFullYear()}`
  return `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${year}`
}

/** "3:42 pm" — for the detail sheet's "caught at" line. */
export function formatClock(ts: number): string {
  const d = new Date(ts)
  const h = d.getHours()
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`
}
