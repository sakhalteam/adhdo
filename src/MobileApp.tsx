import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Cluster, GalaxyState, Glob, Priority } from './types'
import type { VoiceCapture } from './useVoiceCapture'
import { MicButton, VoiceOverlay } from './AppChrome'
import { PALETTE } from './store'
import {
  addDaysStr, dayKey, formatCaptureDay, formatClock, formatDue, nextWeekdayStr, parseQuickAdd, todayStr,
} from './dates'
import { buildAgenda } from './agenda'

// ── Mobile: a capture pocket ────────────────────────────────────────────────
// The phone has one job: a thought, idea, to-do or memory has to land within
// about five seconds of arriving, or it is gone. Everything here is ordered by
// that. (2026-09-25 — this replaced a week-long Todoist clone that had turned
// the phone into a planner; see CLAUDE.md "Mobile".)
//
//   · The capture bar is ALWAYS on screen, at the bottom, under the thumb. It
//     sends on Enter, keeps focus for rapid fire, and says "caught" so you know
//     it landed even when the thought isn't in view.
//   · Thoughts (the landing page) is a journal of everything you've caught,
//     newest first, grouped by day — never empty just because nothing is due.
//     Anything due today or overdue is pinned above it.
//   · Organizing is invited, never required: a "sort a few?" nudge walks the
//     unsorted pile one thought at a time, and swipe-left files any row.
//   · Clusters and Search are their own pages.
//
// Kept from the Todoist week because they earn their place: due dates (typed
// in plain words — "call mum tomorrow"), swipe-right to finish, the tap-for-
// details sheet. Gone: the Today/Upcoming tabs, the + button and its quick-add
// sheet, priorities (desktop still sets them; the phone only shows the tint).

interface Props {
  state: GalaxyState
  onboardingActive: boolean
  /** Owned by App so the mobile and desktop bars can't run two mic sessions. */
  voice: VoiceCapture
  onAddTask: (text: string, opts?: { clusterId?: string | null; dueDate?: string | null; priority?: Priority }) => void
  onSetDueDate: (id: string, dueDate: string | null) => void
  onAddCluster: (name: string) => void
  onRecolorCluster: (id: string, color: string) => void
  onToggleDone: (id: string) => void
  onToggleTodo: (id: string) => void
  onToggleFlag: (id: string) => void
  onUpdateText: (id: string, text: string) => void
  onDelete: (id: string) => void
  onRemoveFromCluster: (globId: string) => void
  onRenameCluster: (id: string, name: string) => void
  onToggleAllTodosInCluster: (id: string) => void
  onClearCompletedInCluster: (id: string) => void
  onDissolveCluster: (id: string) => void
  onDeleteCluster: (id: string) => void
  // Bulk primitives. Each is ONE undo step, so undoing a mis-filed batch is one tap.
  onMoveGlobsToCluster: (ids: string[], clusterId: string) => void
  onTransferToNewCluster: (ids: string[], name?: string) => void
  onToggleFlagGlobs: (ids: string[]) => void
  onToggleAllTodosInGlobs: (ids: string[]) => void
  onDeleteGlobs: (ids: string[]) => void
  /** Opens the shared backups panel (export / import / version history). */
  onOpenBackups: () => void
  /** Opens the shared diagnostics panel (build stamp + what the device reports). */
  onOpenDiagnostics: () => void
}

type Tab = 'thoughts' | 'clusters' | 'search'

const NAV: { id: Tab; label: string }[] = [
  { id: 'thoughts', label: 'Thoughts' },
  { id: 'clusters', label: 'Clusters' },
  { id: 'search', label: 'Search' },
]

/** Inside the Clusters tab. 'unsorted' is the virtual pile of loose thoughts. */
type ClusterView = 'unsorted' | string

type Sheet =
  | { kind: 'detail'; globId: string }
  | { kind: 'schedule'; globId: string }
  | { kind: 'move'; globIds: string[]; fromDetail?: boolean; bulk?: boolean }
  | { kind: 'newCluster'; globIds: string[]; bulk?: boolean }
  | { kind: 'clusterMenu'; clusterId: string }
  | { kind: 'clusterColor'; clusterId: string }
  | { kind: 'rename'; clusterId: string }
  | { kind: 'sort'; ids: string[] }
  | null

type Filter = 'all' | 'todo' | 'dated' | 'flagged' | 'done'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'todo', label: 'To-do' },
  { id: 'dated', label: 'Dated' },
  { id: 'flagged', label: 'Flagged' },
  { id: 'done', label: 'Done' },
]

/**
 * The "sort a few?" nudge appears once the pile reaches this size. Below it, a
 * nudge after every single capture would be nagging, not nudging — and one or
 * two loose thoughts are a swipe-left each anyway.
 */
const NUDGE_AT = 3

export default function MobileApp(props: Props) {
  const { state, onboardingActive, voice, onOpenBackups, onOpenDiagnostics } = props
  const [tab, setTabRaw] = useState<Tab>('thoughts')
  const [clusterView, setClusterView] = useState<ClusterView | null>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  /** Non-null = select mode. Empty set is a valid (just-entered) state. */
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const captureRef = useRef<HTMLInputElement>(null)

  const selecting = selected !== null
  const selectedIds = useMemo(() => (selected ? [...selected] : []), [selected])

  const setTab = useCallback((t: Tab) => {
    // Tapping the page you're already on means "take me to the top".
    if (t === tab && !clusterView) listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    setTabRaw(t)
    setClusterView(null)
    setShowCompleted(false)
  }, [tab, clusterView])

  // A new page starts at its top, not wherever the last one was scrolled to.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [tab, clusterView])

  // Capture is the whole job, so the cursor starts in the bar. iOS ignores a
  // focus() no tap asked for — there this is a no-op and the bar is one tap
  // away at the bottom. Elsewhere the keyboard is up before the thought escapes.
  useEffect(() => { captureRef.current?.focus() }, [])

  const today = todayStr()

  const globsById = useMemo(() => new Map(state.globs.map(g => [g.id, g])), [state.globs])
  const clustersById = useMemo(() => new Map(state.clusters.map(c => [c.id, c])), [state.clusters])
  const orphans = useMemo(() => state.clusters.find(c => c.role === 'orphans'), [state.clusters])

  const looseGlobs = useMemo(
    () => state.globs.filter(g => !g.clusterId).sort((a, b) => b.createdAt - a.createdAt),
    [state.globs],
  )

  // Pinned above the stream: what's due today or already late. The same
  // buckets the desktop agenda uses, so the two can't disagree.
  const agenda = useMemo(() => buildAgenda(state.globs, today), [state.globs, today])
  const due = useMemo(() => [...agenda.overdue, ...agenda.today], [agenda])

  // The stream: every thought, newest first, grouped by the day it was caught.
  // Done ones stay, struck through — this is a record of you, not a queue.
  // Anything pinned in Due is left out while it's pinned: the same row twice on
  // one screen reads as a glitch. Tick it off and it drops back into its day.
  const stream = useMemo(() => {
    const pinned = new Set(due.map(g => g.id))
    const days: { key: string; items: Glob[] }[] = []
    for (const g of [...state.globs].sort((a, b) => b.createdAt - a.createdAt)) {
      if (pinned.has(g.id)) continue
      const key = dayKey(g.createdAt)
      const last = days[days.length - 1]
      if (last && last.key === key) last.items.push(g)
      else days.push({ key, items: [g] })
    }
    return days
  }, [state.globs, due])

  // What "sort a few?" walks through: loose thoughts newest first (freshest in
  // your head, so easiest to decide), then whatever the weekly sweep filed into
  // orphans — which is just "unsorted" that got old. The sweep and the nudge
  // work together: nothing escapes the pile by ageing out of it.
  const sortQueue = useMemo(() => {
    const loose = looseGlobs.filter(g => !g.done)
    const swept = orphans
      ? orphans.globIds.map(id => globsById.get(id)).filter((g): g is Glob => !!g && !g.done)
      : []
    return [...loose, ...swept].map(g => g.id)
  }, [looseGlobs, orphans, globsById])

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hits = state.globs.filter(g => {
      if (filter === 'todo' && (!g.isTodo || g.done)) return false
      if (filter === 'dated' && (!g.dueDate || g.done)) return false
      if (filter === 'flagged' && !g.flagged) return false
      if (filter === 'done' && !g.done) return false
      return q ? g.text.toLowerCase().includes(q) : true
    })
    // "Dated" is what the Upcoming tab used to be: soonest first.
    if (filter === 'dated') {
      return hits.sort((a, b) => (a.dueDate as string).localeCompare(b.dueDate as string))
    }
    return hits.sort((a, b) => b.createdAt - a.createdAt)
  }, [state.globs, query, filter])

  // ── select mode ────────────────────────────────────────────────────────────
  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev ?? [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const beginSelect = useCallback((id: string) => {
    setSelected(prev => (prev ? prev : new Set([id])))
  }, [])
  const endSelect = useCallback(() => setSelected(null), [])
  // A bulk action consumes the selection; leaving select mode on is a trap.
  const bulk = (fn: () => void) => () => { fn(); endSelect(); setSheet(null) }

  // Sheets and the open cluster point at live records; a delete, undo or sync
  // underneath them must close the view rather than render a ghost.
  useEffect(() => {
    if (!sheet) return
    const globGone = (sheet.kind === 'detail' || sheet.kind === 'schedule') && !globsById.has(sheet.globId)
    const clusterGone = (sheet.kind === 'clusterMenu' || sheet.kind === 'clusterColor' || sheet.kind === 'rename')
      && !clustersById.has(sheet.clusterId)
    if (globGone || clusterGone) setSheet(null)
  }, [sheet, globsById, clustersById])
  useEffect(() => {
    if (clusterView && clusterView !== 'unsorted' && !clustersById.has(clusterView)) setClusterView(null)
  }, [clusterView, clustersById])

  // Inside a cluster, the bar captures INTO it — that's the cluster page's "add".
  const captureTarget = tab === 'clusters' && clusterView && clusterView !== 'unsorted'
    ? clustersById.get(clusterView)
    : undefined

  const row = (g: Glob, showCluster = true) => (
    <ThoughtRow
      key={g.id}
      glob={g}
      selecting={selecting}
      selected={!!selected?.has(g.id)}
      cluster={showCluster && g.clusterId ? clustersById.get(g.clusterId) : undefined}
      onToggleDone={props.onToggleDone}
      onOpen={id => setSheet({ kind: 'detail', globId: id })}
      onFile={id => setSheet({ kind: 'move', globIds: [id] })}
      onLongPress={beginSelect}
      onToggleSelect={toggleSelect}
    />
  )

  // ── pages ──────────────────────────────────────────────────────────────────

  const renderThoughts = () => (
    <>
      {state.globs.length === 0 && (
        <div className="mobile-empty">
          <div className="mobile-empty-emoji">🧠</div>
          <p className="mobile-empty-title">Empty headspace.</p>
          <p className="mobile-empty-sub">
            Type below and hit send — or tap the mic and just talk. Every thought
            lands here. Say “tomorrow” or “friday” and it gets a date.
          </p>
        </div>
      )}

      {due.length > 0 && (
        <section className="mobile-group">
          <div className="mobile-group-head is-due">
            Due<span className="mobile-group-count">{due.length}</span>
          </div>
          {due.map(g => row(g))}
        </section>
      )}

      {sortQueue.length >= NUDGE_AT && (
        <button className="mobile-nudge" onClick={() => setSheet({ kind: 'sort', ids: sortQueue })}>
          <span className="mobile-nudge-ico" aria-hidden="true">🌀</span>
          <span className="mobile-nudge-text"><b>{sortQueue.length} unsorted</b> — sort a few?</span>
          <ChevronIcon />
        </button>
      )}

      {stream.map(day => (
        <section className="mobile-group" key={day.key}>
          <div className="mobile-day-head">{formatCaptureDay(day.key)}</div>
          {day.items.map(g => row(g))}
        </section>
      ))}
    </>
  )

  const renderClusterGrid = () => {
    const unsortedOpen = looseGlobs.filter(g => !g.done)
    return (
      <>
        <div className="mobile-cluster-grid">
          <button className="mobile-cluster-card is-unsorted" onClick={() => setClusterView('unsorted')}>
            <span className="mobile-cluster-card-name">📥 Unsorted</span>
            <span className="mobile-cluster-card-meta">
              {unsortedOpen.length === 0 ? 'all filed ✨' : `${unsortedOpen.length} waiting for a home`}
            </span>
            {unsortedOpen[0] && <span className="mobile-cluster-card-peek">{unsortedOpen[0].text}</span>}
          </button>

          {state.clusters.map(c => {
            const items = c.globIds.map(id => globsById.get(id)).filter((g): g is Glob => !!g)
            const open = items.filter(g => !g.done)
            const done = items.length - open.length
            const latest = [...open].sort((a, b) => b.createdAt - a.createdAt)[0]
            return (
              <button
                key={c.id}
                className="mobile-cluster-card"
                style={{ ['--cluster-color' as string]: c.color }}
                onClick={() => setClusterView(c.id)}
              >
                <span className="mobile-cluster-card-name">{c.name}</span>
                <span className="mobile-cluster-card-meta">
                  {open.length === 0 && done === 0 ? 'empty' : `${open.length} open${done ? ` · ${done} done` : ''}`}
                </span>
                {latest && <span className="mobile-cluster-card-peek">{latest.text}</span>}
              </button>
            )
          })}

          <button className="mobile-cluster-card is-add" onClick={() => setSheet({ kind: 'newCluster', globIds: [] })}>
            <span className="mobile-cluster-card-name">＋ New cluster</span>
          </button>
        </div>

        <section className="mobile-group is-quiet">
          <button className="mobile-quiet-row" onClick={onOpenBackups}>
            <span aria-hidden="true">🛟</span> Backups &amp; history <ChevronIcon />
          </button>
          <button className="mobile-quiet-row" onClick={onOpenDiagnostics}>
            <span aria-hidden="true">📐</span> Diagnostics <ChevronIcon />
          </button>
        </section>
      </>
    )
  }

  const renderClusterView = (id: ClusterView) => {
    const cluster = id === 'unsorted' ? undefined : clustersById.get(id)
    // Deleted out from under us (undo, sync) — the effect above pops the view.
    if (id !== 'unsorted' && !cluster) return null
    const all = cluster
      ? cluster.globIds.map(gid => globsById.get(gid)).filter((g): g is Glob => !!g)
      : looseGlobs
    const active = all.filter(g => !g.done)
    const completed = all.filter(g => g.done)

    return (
      <>
        <div className="mobile-view-head">
          <button className="mobile-back-btn" onClick={() => setClusterView(null)} aria-label="Back to clusters">
            <BackIcon />
          </button>
          {cluster
            ? <span className="mobile-cluster-dot big" style={{ background: cluster.color }} />
            : <span aria-hidden="true">📥</span>}
          <span className="mobile-view-title">{cluster ? cluster.name : 'Unsorted'}</span>
          {cluster ? (
            <button
              className="mobile-menu-btn"
              aria-label="Cluster actions"
              onClick={() => setSheet({ kind: 'clusterMenu', clusterId: cluster.id })}
            >
              <DotsIcon />
            </button>
          ) : sortQueue.length > 0 && (
            <button className="mobile-head-link" onClick={() => setSheet({ kind: 'sort', ids: sortQueue })}>
              Sort
            </button>
          )}
        </div>
        <section className="mobile-group">
          {active.map(g => row(g, false))}
          {active.length === 0 && (
            <p className="mobile-no-results">
              {cluster ? 'Nothing open in here — type below to add to it.' : 'Nothing unsorted. Everything has a home. ✨'}
            </p>
          )}
        </section>
        {completed.length > 0 && (
          <section className="mobile-group">
            <button className="mobile-completed-toggle" onClick={() => setShowCompleted(v => !v)}>
              <ChevronIcon open={showCompleted} /> Done <span className="mobile-group-count">{completed.length}</span>
            </button>
            {showCompleted && completed.map(g => row(g, false))}
          </section>
        )}
      </>
    )
  }

  const renderSearch = () => (
    <>
      <div className="mobile-tools">
        <div className="mobile-search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="search thoughts…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            // You tapped Search to type, and that tap is what lets iOS raise
            // the keyboard for it.
            autoFocus
          />
          {query && (
            <button className="mobile-search-clear" onClick={() => setQuery('')} aria-label="Clear search">×</button>
          )}
        </div>
        <div className="mobile-chips">
          {FILTERS.map(f => (
            <button
              key={f.id}
              className={`mobile-chip ${filter === f.id ? 'on' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <section className="mobile-group">
        {searchResults.length === 0
          ? <p className="mobile-no-results">Nothing matches that.</p>
          : searchResults.map(g => row(g))}
      </section>
    </>
  )

  const detailGlob = sheet?.kind === 'detail' ? globsById.get(sheet.globId) : undefined

  return (
    <div className={`mobile-app ${selecting ? 'selecting' : ''} ${voice.status === 'listening' ? 'listening' : ''}`}>
      {selecting ? (
        <header className="mobile-head select">
          <button className="mobile-head-btn" onClick={endSelect}>Cancel</button>
          <span className="mobile-select-count">{selectedIds.length} selected</span>
          <button className="mobile-head-btn" onClick={() => setSelected(new Set(state.globs.map(g => g.id)))}>
            All
          </button>
        </header>
      ) : (
        <header className="mobile-head">
          <nav className="mobile-nav" aria-label="Pages">
            {NAV.map(n => (
              <button
                key={n.id}
                className={`mobile-nav-btn ${tab === n.id ? 'on' : ''}`}
                aria-current={tab === n.id ? 'page' : undefined}
                onClick={() => setTab(n.id)}
              >
                <span className="mobile-nav-label">{n.label}</span>
              </button>
            ))}
          </nav>
        </header>
      )}

      <div className="mobile-list" ref={listRef}>
        {tab === 'thoughts' && renderThoughts()}
        {tab === 'clusters' && (clusterView ? renderClusterView(clusterView) : renderClusterGrid())}
        {tab === 'search' && renderSearch()}
        {/* spacer so the last row clears the capture bar */}
        <div className="mobile-list-pad" />
      </div>

      <VoiceOverlay voice={voice} />

      {selecting ? (
        <div className="bulk-bar">
          <button
            className="bulk-btn"
            disabled={selectedIds.length === 0}
            onClick={bulk(() => props.onToggleAllTodosInGlobs(selectedIds))}
          >
            To-do
          </button>
          <button
            className="bulk-btn"
            disabled={selectedIds.length === 0}
            onClick={bulk(() => props.onToggleFlagGlobs(selectedIds))}
          >
            Flag
          </button>
          <button
            className="bulk-btn primary"
            disabled={selectedIds.length === 0}
            onClick={() => setSheet({ kind: 'move', globIds: selectedIds, bulk: true })}
          >
            File…
          </button>
          <button
            className="bulk-btn danger"
            disabled={selectedIds.length === 0}
            onClick={bulk(() => props.onDeleteGlobs(selectedIds))}
          >
            Delete
          </button>
        </div>
      ) : (
        <CaptureDock
          inputRef={captureRef}
          voice={voice}
          target={captureTarget}
          placeholder={
            captureTarget ? `add to ${captureTarget.name}…`
              : onboardingActive ? 'type a thought, hit send…'
              : 'brain dump here…'
          }
          onSubmit={(text, dueDate) => {
            props.onAddTask(text, { clusterId: captureTarget?.id ?? null, dueDate })
            // On the stream the new thought appears at the top — go and meet it.
            if (tab === 'thoughts') listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        />
      )}

      {sheet?.kind === 'detail' && detailGlob && (
        <DetailSheet
          glob={detailGlob}
          cluster={detailGlob.clusterId ? clustersById.get(detailGlob.clusterId) : undefined}
          onUpdateText={props.onUpdateText}
          onToggleDone={props.onToggleDone}
          onToggleTodo={props.onToggleTodo}
          onToggleFlag={props.onToggleFlag}
          onOpenSchedule={() => setSheet({ kind: 'schedule', globId: detailGlob.id })}
          onOpenMove={() => setSheet({ kind: 'move', globIds: [detailGlob.id], fromDetail: true })}
          onDelete={() => { props.onDelete(detailGlob.id); setSheet(null) }}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === 'schedule' && (() => {
        const g = globsById.get(sheet.globId)
        if (!g) return null
        const back = () => setSheet({ kind: 'detail', globId: g.id })
        return <ScheduleSheet glob={g} onPick={date => { props.onSetDueDate(g.id, date); back() }} onClose={back} />
      })()}

      {sheet?.kind === 'move' && (() => {
        const globs = sheet.globIds.map(id => globsById.get(id)).filter((g): g is Glob => !!g)
        if (globs.length === 0) return null
        const leave = () => setSheet(sheet.fromDetail ? { kind: 'detail', globId: sheet.globIds[0] } : null)
        const finish = () => { if (sheet.bulk) endSelect(); leave() }
        const single = globs.length === 1 ? globs[0] : undefined
        return (
          <ActionSheet
            title={single ? `File “${single.text}” into…` : `File ${globs.length} thoughts into…`}
            onClose={leave}
            rows={[
              ...(globs.some(g => g.clusterId)
                ? [{
                    label: '📥 Unsorted',
                    onClick: () => { globs.forEach(g => { if (g.clusterId) props.onRemoveFromCluster(g.id) }); finish() },
                  }]
                : []),
              ...state.clusters
                .filter(c => !single || c.id !== single.clusterId)
                .map(c => ({
                  label: c.name,
                  dot: c.color,
                  onClick: () => { props.onMoveGlobsToCluster(sheet.globIds, c.id); finish() },
                })),
              {
                label: '＋ New cluster…',
                onClick: () => setSheet({ kind: 'newCluster', globIds: sheet.globIds, bulk: sheet.bulk }),
              },
            ]}
          />
        )
      })()}

      {sheet?.kind === 'newCluster' && (
        <TextPromptSheet
          title={sheet.globIds.length
            ? `New cluster for ${sheet.globIds.length === 1 ? 'this thought' : `${sheet.globIds.length} thoughts`}`
            : 'New cluster'}
          initial=""
          placeholder="name it…"
          submitLabel="Create"
          onSubmit={name => {
            if (sheet.globIds.length) props.onTransferToNewCluster(sheet.globIds, name || 'new cluster')
            else if (name) props.onAddCluster(name)
            if (sheet.bulk) endSelect()
            setSheet(null)
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === 'clusterMenu' && (() => {
        const c = clustersById.get(sheet.clusterId)
        if (!c) return null
        const items = c.globIds.map(id => globsById.get(id)).filter((g): g is Glob => !!g)
        const doneCount = items.filter(g => g.isTodo && g.done).length
        const allAreTodos = items.length > 0 && items.every(g => g.isTodo)
        return (
          <ActionSheet title={c.name} onClose={() => setSheet(null)} rows={[
            { label: '✏️ Rename', onClick: () => setSheet({ kind: 'rename', clusterId: c.id }) },
            { label: '🎨 Color', onClick: () => setSheet({ kind: 'clusterColor', clusterId: c.id }) },
            {
              label: allAreTodos ? '💭 Make them all plain thoughts' : '☑️ Make them all to-dos',
              disabled: items.length === 0,
              onClick: () => { props.onToggleAllTodosInCluster(c.id); setSheet(null) },
            },
            {
              label: `🧹 Clear done${doneCount ? ` (${doneCount})` : ''}`,
              disabled: doneCount === 0,
              onClick: () => { props.onClearCompletedInCluster(c.id); setSheet(null) },
            },
            {
              label: '💨 Ungroup — keep the thoughts',
              onClick: () => { props.onDissolveCluster(c.id); setSheet(null); setClusterView(null) },
            },
            {
              label: '🗑️ Delete cluster + thoughts',
              danger: true,
              onClick: () => {
                if (c.globIds.length) props.onDeleteGlobs(c.globIds)
                props.onDeleteCluster(c.id)
                setSheet(null)
                setClusterView(null)
              },
            },
          ]} />
        )
      })()}

      {sheet?.kind === 'clusterColor' && (() => {
        const c = clustersById.get(sheet.clusterId)
        if (!c) return null
        return (
          <SheetShell onClose={() => setSheet(null)}>
            <div className="mobile-sheet-title">Cluster color</div>
            <div className="mobile-swatch-grid">
              {PALETTE.map(color => (
                <button
                  key={color}
                  className={`mobile-swatch ${c.color === color ? 'on' : ''}`}
                  style={{ background: color }}
                  aria-label={color}
                  onClick={() => { props.onRecolorCluster(c.id, color); setSheet(null) }}
                />
              ))}
            </div>
          </SheetShell>
        )
      })()}

      {sheet?.kind === 'rename' && (() => {
        const c = clustersById.get(sheet.clusterId)
        if (!c) return null
        return (
          <TextPromptSheet
            title="Rename cluster"
            initial={c.name}
            submitLabel="Rename"
            onSubmit={name => { props.onRenameCluster(c.id, name || c.name); setSheet(null) }}
            onClose={() => setSheet(null)}
          />
        )
      })()}

      {sheet?.kind === 'sort' && (
        <SortSheet
          ids={sheet.ids}
          globsById={globsById}
          clusters={state.clusters.filter(c => c.role !== 'orphans')}
          onFile={(id, clusterId) => props.onMoveGlobsToCluster([id], clusterId)}
          onNewCluster={(id, name) => props.onTransferToNewCluster([id], name)}
          onDone={id => props.onToggleDone(id)}
          onDelete={id => props.onDelete(id)}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}

// ── the capture bar ──────────────────────────────────────────────────────────

function CaptureDock({
  inputRef,
  voice,
  target,
  placeholder,
  onSubmit,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  voice: VoiceCapture
  /** Set inside a cluster page: captures land there instead of Unsorted. */
  target: Cluster | undefined
  placeholder: string
  onSubmit: (text: string, dueDate: string | null) => void
}) {
  const [text, setText] = useState('')
  /** The user tapped the date chip away: keep "tomorrow" as words, no date. */
  const [keepDateWord, setKeepDateWord] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(flashTimer.current), [])

  // Dates only. "p2" stays in the text: the phone never shows priority, and a
  // word that silently vanishes from what you typed is a small betrayal.
  const parsed = useMemo(() => parseQuickAdd(text, { priority: false }), [text])
  const dueDate = keepDateWord ? null : parsed.dueDate

  const submit = () => {
    const body = keepDateWord ? text.trim() : parsed.text
    if (!body) return
    onSubmit(body, dueDate)
    setText('')
    setKeepDateWord(false)
    // Say it landed. From Search, or scrolled down, the new thought isn't in
    // view — and not knowing whether it saved is its own kind of lost.
    setFlash(target ? `caught → ${target.name}` : 'caught')
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 1400)
    inputRef.current?.focus()
  }

  // Tapping a button would blur the input and drop the keyboard mid-flurry.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault()

  return (
    <div className="mobile-capture">
      {/* Always rendered: a chip appearing mid-sentence must not shove the input
          up under your thumb. Undo docks at its right end (see index.css). */}
      <div className="mobile-capture-chips">
          {flash ? (
            <span className="mobile-capture-flash">✓ {flash}</span>
          ) : (
            <>
              {target && (
                <span className="mobile-capture-target">
                  <span className="mobile-cluster-dot" style={{ background: target.color }} />
                  {target.name}
                </span>
              )}
              {dueDate && (
                <button
                  className="mobile-capture-date"
                  aria-label="Don't schedule it — keep the words"
                  onMouseDown={keepFocus}
                  onClick={() => setKeepDateWord(true)}
                >
                  <CalendarIcon size={12} /> {formatDue(dueDate).label} <span aria-hidden="true">✕</span>
                </button>
              )}
            </>
          )}
      </div>
      <div className="mobile-capture-row">
        {voice.supported && <MicButton voice={voice} />}
        <input
          ref={inputRef}
          type="text"
          className="mobile-capture-input"
          placeholder={placeholder}
          value={text}
          enterKeyHint="send"
          autoComplete="off"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
        />
        <button
          className="mobile-capture-send"
          aria-label="Catch it"
          disabled={!text.trim()}
          onMouseDown={keepFocus}
          onClick={submit}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ── a single thought row ─────────────────────────────────────────────────────

/** Horizontal travel before a swipe commits. */
const SWIPE_AT = 88
/** Hold this long without moving to enter select mode. */
const LONG_PRESS_MS = 450

function ThoughtRow({
  glob,
  selecting,
  selected,
  cluster,
  onToggleDone,
  onOpen,
  onFile,
  onLongPress,
  onToggleSelect,
}: {
  glob: Glob
  selecting: boolean
  selected: boolean
  /** Passed only where the row isn't already inside its cluster's page. */
  cluster: Cluster | undefined
  onToggleDone: (id: string) => void
  onOpen: (id: string) => void
  onFile: (id: string) => void
  onLongPress: (id: string) => void
  onToggleSelect: (id: string) => void
}) {
  const [dx, setDx] = useState(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  // Which gesture this pointer turned out to be. Decided once, then locked, so a
  // vertical scroll that drifts sideways can't start dragging the row with it.
  const axis = useRef<'undecided' | 'swipe' | 'scroll'>('undecided')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Set when a gesture happened, so the trailing click doesn't also fire. */
  const consumed = useRef(false)

  const due = glob.dueDate ? formatDue(glob.dueDate) : null

  const clearTimer = () => { clearTimeout(timer.current); timer.current = undefined }

  const onPointerDown = (e: React.PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY }
    axis.current = 'undecided'
    consumed.current = false
    if (!selecting) {
      timer.current = setTimeout(() => {
        if (axis.current !== 'undecided') return
        consumed.current = true
        onLongPress(glob.id)
      }, LONG_PRESS_MS)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current
    if (!s) return
    const ddx = e.clientX - s.x
    const ddy = e.clientY - s.y

    if (axis.current === 'undecided') {
      // Require a decisive sideways move; anything else is the list scrolling.
      if (Math.abs(ddx) > 12 && Math.abs(ddx) > Math.abs(ddy) * 1.5) {
        axis.current = 'swipe'
        clearTimer()
        // Capture so we still get pointerup if the finger leaves the row.
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not critical */ }
      } else if (Math.abs(ddy) > 8) {
        axis.current = 'scroll'
        clearTimer()
      }
      return
    }
    if (axis.current === 'swipe') {
      consumed.current = true
      setDx(ddx)
    }
  }

  const onPointerUp = () => {
    clearTimer()
    if (axis.current === 'swipe' && !selecting) {
      // Right = done. Left = file it somewhere — the gentle nudge, one flick.
      if (dx >= SWIPE_AT) onToggleDone(glob.id)
      else if (dx <= -SWIPE_AT) onFile(glob.id)
    }
    start.current = null
    axis.current = 'undecided'
    setDx(0)
  }

  useEffect(() => clearTimer, [])

  return (
    <div className={`mobile-task-wrap ${dx !== 0 ? 'swiping' : ''}`}>
      <div className={`mobile-task-under complete ${dx >= SWIPE_AT ? 'armed' : ''}`} aria-hidden="true">
        <CheckIcon /> {glob.done ? 'Undo' : 'Done'}
      </div>
      <div className={`mobile-task-under file ${dx <= -SWIPE_AT ? 'armed' : ''}`} aria-hidden="true">
        File <FolderIcon />
      </div>
      <div
        className={`mobile-task ${glob.done ? 'done' : ''} ${selected ? 'selected' : ''}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // Capture phase: swallow the click a swipe or long-press already handled,
        // before it opens the detail sheet.
        onClickCapture={e => {
          if (consumed.current) {
            e.preventDefault()
            e.stopPropagation()
            consumed.current = false
          }
        }}
        onClick={() => (selecting ? onToggleSelect(glob.id) : onOpen(glob.id))}
      >
        {selecting ? (
          <button
            className={`mobile-check select ${selected ? 'on' : ''}`}
            aria-label={selected ? 'Deselect' : 'Select'}
            onClick={e => { e.stopPropagation(); onToggleSelect(glob.id) }}
          >
            {selected && <CheckIcon />}
          </button>
        ) : (
          <button
            // The priority tint comes from the desktop; the phone shows it, never sets it.
            className={`mobile-check p${glob.priority ?? 4} ${glob.done ? 'done' : ''} ${glob.isTodo ? 'todo' : ''}`}
            aria-label={glob.done ? 'Mark not done' : 'Mark done'}
            onClick={e => { e.stopPropagation(); onToggleDone(glob.id) }}
          >
            {glob.done && <CheckIcon />}
          </button>
        )}
        <div className="mobile-task-body">
          <span className="mobile-task-text">{glob.text}</span>
          {((due && !glob.done) || cluster || glob.flagged) && (
            <span className="mobile-task-meta">
              {due && !glob.done && (
                <span className={`due-chip ${due.tone}`}><CalendarIcon size={10} />{due.label}</span>
              )}
              {glob.flagged && <span className="mobile-task-flag">🚩</span>}
              {cluster && (
                <span className="mobile-task-proj">
                  <span className="mobile-cluster-dot" style={{ background: cluster.color }} />
                  {cluster.name}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── sort a few: the nudge, one thought at a time ─────────────────────────────

function SortSheet({
  ids,
  globsById,
  clusters,
  onFile,
  onNewCluster,
  onDone,
  onDelete,
  onClose,
}: {
  /** Snapshotted when the sheet opened, so filing one doesn't reshuffle the rest. */
  ids: string[]
  globsById: Map<string, Glob>
  clusters: Cluster[]
  onFile: (id: string, clusterId: string) => void
  onNewCluster: (id: string, name: string) => void
  onDone: (id: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const [i, setI] = useState(0)
  const [naming, setNaming] = useState(false)

  // Skip anything that vanished under us (deleted elsewhere, undo, sync).
  let idx = i
  while (idx < ids.length && !globsById.has(ids[idx])) idx++
  const g = idx < ids.length ? globsById.get(ids[idx]) : undefined
  const next = () => { setNaming(false); setI(idx + 1) }

  return (
    <SheetShell onClose={onClose} className="mobile-sort">
      {g ? (
        <>
          <div className="mobile-sort-top">
            <span className="mobile-sort-progress">{idx + 1} of {ids.length}</span>
            <button className="mobile-head-link" onClick={onClose}>Enough for now</button>
          </div>
          <p className="mobile-sort-text">{g.text}</p>
          <div className="mobile-sort-when">
            caught {formatCaptureDay(dayKey(g.createdAt)).toLowerCase()}
            {g.clusterId ? ' · swept into orphans' : ''}
          </div>

          <div className="mobile-sort-label">file into</div>
          <div className="mobile-sort-chips">
            {clusters.map(c => (
              <button
                key={c.id}
                className="mobile-sort-chip"
                style={{ ['--cluster-color' as string]: c.color }}
                onClick={() => { onFile(g.id, c.id); next() }}
              >
                <span className="mobile-cluster-dot" style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
            {naming ? (
              <input
                className="mobile-sort-new"
                autoFocus
                placeholder="new cluster name…"
                enterKeyHint="done"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    onNewCluster(g.id, e.currentTarget.value.trim() || 'new cluster')
                    next()
                  }
                  if (e.key === 'Escape') setNaming(false)
                }}
              />
            ) : (
              <button className="mobile-sort-chip is-new" onClick={() => setNaming(true)}>＋ new</button>
            )}
          </div>

          <div className="mobile-sort-actions">
            <button className="mobile-sort-act is-danger" onClick={() => { onDelete(g.id); next() }}>
              <TrashIcon /> Delete
            </button>
            <button className="mobile-sort-act" onClick={() => { onDone(g.id); next() }}>
              <CheckIcon /> Done
            </button>
            <button className="mobile-sort-act is-skip" onClick={next}>Skip →</button>
          </div>
        </>
      ) : (
        <div className="mobile-sort-finished">
          <div className="mobile-empty-emoji">✨</div>
          <p className="mobile-empty-title">That's the pile.</p>
          <p className="mobile-empty-sub">Everything you looked at has a home. Go do something fun.</p>
          <button className="mobile-prompt-btn primary" onClick={onClose}>Close</button>
        </div>
      )}
    </SheetShell>
  )
}

// ── thought detail ───────────────────────────────────────────────────────────

function DetailSheet({
  glob,
  cluster,
  onUpdateText,
  onToggleDone,
  onToggleTodo,
  onToggleFlag,
  onOpenSchedule,
  onOpenMove,
  onDelete,
  onClose,
}: {
  glob: Glob
  cluster: Cluster | undefined
  onUpdateText: (id: string, text: string) => void
  onToggleDone: (id: string) => void
  onToggleTodo: (id: string) => void
  onToggleFlag: (id: string) => void
  onOpenSchedule: () => void
  onOpenMove: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const due = glob.dueDate ? formatDue(glob.dueDate) : null
  return (
    <SheetShell onClose={onClose} className="mobile-detail">
      <div className="mobile-detail-top">
        <button
          className={`mobile-check p${glob.priority ?? 4} ${glob.done ? 'done' : ''} ${glob.isTodo ? 'todo' : ''}`}
          aria-label={glob.done ? 'Mark not done' : 'Mark done'}
          onClick={() => onToggleDone(glob.id)}
        >
          {glob.done && <CheckIcon />}
        </button>
        <TextArea
          initial={glob.text}
          className={`mobile-detail-text ${glob.done ? 'done' : ''}`}
          onCommit={t => { const v = t.trim(); if (v && v !== glob.text) onUpdateText(glob.id, v) }}
        />
      </div>
      <div className="mobile-detail-when">
        caught {formatCaptureDay(dayKey(glob.createdAt)).toLowerCase()} at {formatClock(glob.createdAt)}
      </div>
      <div className="mobile-detail-rows">
        <button className="mobile-detail-row" onClick={onOpenMove}>
          <span className="mobile-detail-ico">
            {cluster ? <span className="mobile-cluster-dot" style={{ background: cluster.color }} /> : '📥'}
          </span>
          <span className="mobile-detail-label">Cluster</span>
          <span className="mobile-detail-value">{cluster ? cluster.name : 'Unsorted'}</span>
          <ChevronIcon />
        </button>
        <button className="mobile-detail-row" onClick={onOpenSchedule}>
          <span className="mobile-detail-ico"><CalendarIcon size={16} /></span>
          <span className="mobile-detail-label">Due date</span>
          <span className={`mobile-detail-value ${due ? `due-${due.tone}` : ''}`}>{due ? due.label : 'None'}</span>
          <ChevronIcon />
        </button>
        <button className="mobile-detail-row" onClick={() => onToggleFlag(glob.id)}>
          <span className="mobile-detail-ico">🚩</span>
          <span className="mobile-detail-label">Flag</span>
          <span className="mobile-detail-value">{glob.flagged ? 'On' : 'Off'}</span>
        </button>
        <button className="mobile-detail-row" onClick={() => onToggleTodo(glob.id)}>
          <span className="mobile-detail-ico">{glob.isTodo ? '💭' : '☑️'}</span>
          <span className="mobile-detail-label">{glob.isTodo ? 'Make a plain thought' : 'Make a to-do'}</span>
        </button>
        <button className="mobile-detail-row danger" onClick={onDelete}>
          <span className="mobile-detail-ico"><TrashIcon /></span>
          <span className="mobile-detail-label">Delete</span>
        </button>
      </div>
    </SheetShell>
  )
}

function ScheduleSheet({
  glob,
  onPick,
  onClose,
}: {
  glob: Glob
  onPick: (date: string | null) => void
  onClose: () => void
}) {
  return (
    <SheetShell onClose={onClose}>
      <div className="mobile-sheet-title">{glob.text}</div>
      <div className="mobile-sheet-rows">
        <button className="mobile-sheet-row" onClick={() => onPick(todayStr())}>📅 Today</button>
        <button className="mobile-sheet-row" onClick={() => onPick(addDaysStr(todayStr(), 1))}>🌅 Tomorrow</button>
        <button className="mobile-sheet-row" onClick={() => onPick(nextWeekdayStr(6))}>🛋️ This weekend</button>
        <button className="mobile-sheet-row" onClick={() => onPick(nextWeekdayStr(1))}>⏭️ Next week</button>
        <label className="mobile-sheet-row">
          🗓️ Pick a date…
          <input
            type="date"
            className="mobile-date-input"
            defaultValue={glob.dueDate ?? ''}
            onChange={e => { if (e.target.value) onPick(e.target.value) }}
          />
        </label>
        {glob.dueDate && (
          <button className="mobile-sheet-row danger" onClick={() => onPick(null)}>✕ No date</button>
        )}
      </div>
      <button className="mobile-sheet-row cancel" onClick={onClose}>Cancel</button>
    </SheetShell>
  )
}

// ── generic sheet plumbing ───────────────────────────────────────────────────

function SheetShell({
  children,
  className = '',
  onClose,
}: {
  children: React.ReactNode
  className?: string
  onClose: () => void
}) {
  return (
    <div className="mobile-sheet-backdrop" onClick={onClose}>
      <div className={`mobile-sheet ${className}`} onClick={e => e.stopPropagation()}>
        <div className="mobile-sheet-grip" />
        {children}
      </div>
    </div>
  )
}

function ActionSheet({
  title,
  rows,
  onClose,
}: {
  title: string
  rows: { label: string; dot?: string; danger?: boolean; disabled?: boolean; onClick: () => void }[]
  onClose: () => void
}) {
  return (
    <SheetShell onClose={onClose}>
      <div className="mobile-sheet-title">{title}</div>
      <div className="mobile-sheet-rows">
        {rows.map((r, i) => (
          <button
            key={i}
            className={`mobile-sheet-row ${r.danger ? 'danger' : ''}`}
            disabled={r.disabled}
            onClick={r.onClick}
          >
            {r.dot && <span className="mobile-cluster-dot" style={{ background: r.dot }} />}
            {r.label}
          </button>
        ))}
      </div>
      <button className="mobile-sheet-row cancel" onClick={onClose}>Cancel</button>
    </SheetShell>
  )
}

function TextPromptSheet({
  title,
  initial,
  placeholder,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string
  initial: string
  placeholder?: string
  submitLabel: string
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) { el.focus(); el.select() }
  }, [])
  const submit = () => onSubmit(ref.current?.value.trim() ?? '')
  return (
    <SheetShell onClose={onClose}>
      <div className="mobile-sheet-title">{title}</div>
      <input
        ref={ref}
        className="mobile-prompt-input"
        defaultValue={initial}
        placeholder={placeholder}
        enterKeyHint="done"
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onClose()
        }}
      />
      <div className="mobile-prompt-actions">
        <button className="mobile-prompt-btn" onClick={onClose}>Cancel</button>
        <button className="mobile-prompt-btn primary" onClick={submit}>{submitLabel}</button>
      </div>
    </SheetShell>
  )
}

/** Auto-sizing multiline editor for the detail sheet — commits on blur. */
function TextArea({
  initial,
  className,
  onCommit,
}: {
  initial: string
  className?: string
  onCommit: (text: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useEffect(fit, [])
  return (
    <textarea
      ref={ref}
      className={className}
      defaultValue={initial}
      rows={1}
      onInput={fit}
      onBlur={e => onCommit(e.currentTarget.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
      }}
    />
  )
}

// ── icons ────────────────────────────────────────────────────────────────────

function DotsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  )
}

function ChevronIcon({ open }: { open?: boolean }) {
  return (
    <svg
      className={`mobile-chevron ${open ? 'open' : ''}`}
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function CalendarIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <line x1="3" y1="9.5" x2="21" y2="9.5" />
      <line x1="8" y1="2.5" x2="8" y2="6.5" />
      <line x1="16" y1="2.5" x2="16" y2="6.5" />
    </svg>
  )
}
