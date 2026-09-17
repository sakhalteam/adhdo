import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Cluster, GalaxyState, Glob, Priority } from './types'
import type { VoiceCapture } from './useVoiceCapture'
import { MicButton, VoiceOverlay } from './AppChrome'
import { PALETTE } from './store'
import { addDaysStr, formatDue, nextWeekdayStr, parseQuickAdd, todayStr } from './dates'
import { buildAgenda } from './agenda'

// ── Mobile view: Todoist-shaped ─────────────────────────────────────────────
// The galaxy is a desktop instrument; on a phone adhdo runs a straight task
// app modeled on Todoist. The vocabulary maps 1:1 onto the shared state:
//
//   project        = cluster        (same records the galaxy renders as cards)
//   Inbox          = unclustered globs
//   task           = glob           (a glob with isTodo, or just a thought)
//   due date       = glob.dueDate   (also visible on desktop as a chip)
//   priority P1-P4 = glob.priority  (colors the checkbox on both layouts)
//
// Navigation is Todoist's: bottom tabs Today / Upcoming / Search / Browse,
// projects drill in from Browse, a floating + opens quick add with
// natural-language dates ("call mum tomorrow p2"). Capture stays king: the
// quick-add sheet stays open for rapid entry and the mic FAB runs the same
// hands-free dictation session as desktop.

interface Props {
  state: GalaxyState
  onboardingActive: boolean
  /** Owned by App so the mobile and desktop bars can't run two mic sessions. */
  voice: VoiceCapture
  onAdd: (text: string) => void
  onAddTask: (text: string, opts?: { clusterId?: string | null; dueDate?: string | null; priority?: Priority }) => void
  onSetDueDate: (id: string, dueDate: string | null) => void
  onSetPriority: (id: string, priority: Priority) => void
  onAddCluster: (name: string) => void
  onRecolorCluster: (id: string, color: string) => void
  onToggleDone: (id: string) => void
  onToggleTodo: (id: string) => void
  onToggleFlag: (id: string) => void
  onUpdateText: (id: string, text: string) => void
  onDelete: (id: string) => void
  onAddToCluster: (globId: string, clusterId: string) => void
  onMoveGlobToCluster: (globId: string, targetClusterId: string) => void
  onRemoveFromCluster: (globId: string) => void
  onRenameCluster: (id: string, name: string) => void
  onToggleAllTodosInCluster: (id: string) => void
  onClearCompletedInCluster: (id: string) => void
  onDissolveCluster: (id: string) => void
  onDeleteCluster: (id: string) => void
  // Bulk primitives, used by select mode. Each is ONE undo step.
  onMoveGlobsToCluster: (ids: string[], clusterId: string) => void
  onToggleFlagGlobs: (ids: string[]) => void
  onToggleAllTodosInGlobs: (ids: string[]) => void
  onDeleteGlobs: (ids: string[]) => void
  /** Opens the shared backups panel (export / import / version history). */
  onOpenBackups: () => void
}

type Tab = 'today' | 'upcoming' | 'search' | 'browse'

/** 'inbox' and 'flagged' are virtual projects; anything else is a cluster id. */
type ProjectId = 'inbox' | 'flagged' | string

type Sheet =
  | { kind: 'quickAdd' }
  | { kind: 'detail'; globId: string }
  | { kind: 'schedule'; globId: string; back?: boolean }
  | { kind: 'move'; globId: string; back?: boolean }
  | { kind: 'projectMenu'; clusterId: string }
  | { kind: 'projectColor'; clusterId: string }
  | { kind: 'rename'; clusterId: string }
  | { kind: 'newProject' }
  | { kind: 'bulkMove' }
  | null

type Filter = 'all' | 'todo' | 'flagged' | 'done'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'todo', label: 'To-do' },
  { id: 'flagged', label: 'Flagged' },
  { id: 'done', label: 'Done' },
]

const PRIORITIES: Priority[] = [1, 2, 3, 4]

export default function MobileApp(props: Props) {
  const { state, onboardingActive, voice, onOpenBackups } = props
  const [tab, setTabRaw] = useState<Tab>('today')
  const [openProject, setOpenProject] = useState<ProjectId | null>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  /** Non-null = select mode. Empty set is a valid (just-entered) state. */
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)

  const selecting = selected !== null
  const selectedIds = useMemo(() => (selected ? [...selected] : []), [selected])

  const setTab = useCallback((t: Tab) => {
    setTabRaw(t)
    setOpenProject(null)
    setShowCompleted(false)
  }, [])

  const today = todayStr()

  const globsById = useMemo(() => {
    const m = new Map<string, Glob>()
    for (const g of state.globs) m.set(g.id, g)
    return m
  }, [state.globs])

  const clustersById = useMemo(() => {
    const m = new Map<string, Cluster>()
    for (const c of state.clusters) m.set(c.id, c)
    return m
  }, [state.clusters])

  const inboxGlobs = useMemo(
    () => state.globs.filter(g => !g.clusterId).sort((a, b) => b.createdAt - a.createdAt),
    [state.globs],
  )

  // Buckets come from the shared agenda so the desktop panel and these tabs
  // can never disagree about what "due today" means.
  const {
    overdue,
    today: dueToday,
    upcoming: upcomingGroups,
    todayCount,
  } = useMemo(() => buildAgenda(state.globs, today), [state.globs, today])

  const matches = useCallback((g: Glob) => {
    if (filter === 'todo' && (!g.isTodo || g.done)) return false
    if (filter === 'flagged' && !g.flagged) return false
    if (filter === 'done' && !g.done) return false
    const q = query.trim().toLowerCase()
    return q ? g.text.toLowerCase().includes(q) : true
  }, [filter, query])

  const searchResults = useMemo(
    () => state.globs.filter(matches).sort((a, b) => b.createdAt - a.createdAt),
    [state.globs, matches],
  )

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
  // A bulk action consumes the selection; leaving select mode on is just a trap
  // for the next tap.
  const bulk = (fn: () => void) => () => { fn(); endSelect(); setSheet(null) }

  // The "New thought" home-screen shortcut: straight into quick add.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('capture')) {
      setSheet({ kind: 'quickAdd' })
    }
  }, [])

  // Quick add pre-targets the project being looked at.
  const quickAddProject = openProject && openProject !== 'inbox' && openProject !== 'flagged'
    ? openProject
    : null

  const detailGlob = sheet?.kind === 'detail' ? globsById.get(sheet.globId) : undefined
  // Sheets and the open project point at live records; a delete, undo, or sync
  // underneath them must close the view rather than render a ghost.
  useEffect(() => {
    if (!sheet) return
    const globGone = (sheet.kind === 'detail' || sheet.kind === 'schedule' || sheet.kind === 'move')
      && !globsById.has(sheet.globId)
    const clusterGone = (sheet.kind === 'projectMenu' || sheet.kind === 'projectColor' || sheet.kind === 'rename')
      && !clustersById.has(sheet.clusterId)
    if (globGone || clusterGone) setSheet(null)
  }, [sheet, globsById, clustersById])
  useEffect(() => {
    if (openProject && openProject !== 'inbox' && openProject !== 'flagged' && !clustersById.has(openProject)) {
      setOpenProject(null)
    }
  }, [openProject, clustersById])

  const rowProps = (showProject: boolean) => ({
    selecting,
    selectedSet: selected,
    showProject,
    clustersById,
    onToggleDone: props.onToggleDone,
    onOpen: (id: string) => setSheet({ kind: 'detail', globId: id }),
    onSchedule: (id: string) => setSheet({ kind: 'schedule', globId: id }),
    onLongPress: beginSelect,
    onToggleSelect: toggleSelect,
  })

  // ── the four tabs ──────────────────────────────────────────────────────────

  const renderToday = () => {
    const now = new Date()
    const sub = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()]} ${now.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][now.getMonth()]}`
    return (
      <>
        <ViewHead title="Today" sub={sub} />
        {onboardingActive && (
          <div className="mobile-empty">
            <div className="mobile-empty-emoji">🧠</div>
            <p className="mobile-empty-title">Empty headspace.</p>
            <p className="mobile-empty-sub">
              Tap <b>+</b> and dump a thought — type “tomorrow” or “p1” and it schedules
              itself. Or hit the mic and just talk.
            </p>
          </div>
        )}
        {overdue.length > 0 && (
          <section className="mobile-group">
            <div className="mobile-group-head is-overdue">Overdue<span className="mobile-group-count">{overdue.length}</span></div>
            {overdue.map(g => <TaskRow key={g.id} glob={g} {...rowProps(true)} />)}
          </section>
        )}
        <section className="mobile-group">
          {overdue.length > 0 && (
            <div className="mobile-group-head">Today<span className="mobile-group-count">{dueToday.length}</span></div>
          )}
          {dueToday.map(g => <TaskRow key={g.id} glob={g} {...rowProps(true)} />)}
          {todayCount === 0 && !onboardingActive && (
            <div className="mobile-clear-state">
              <div className="mobile-empty-emoji">🌌</div>
              <p className="mobile-empty-title">Nothing due today.</p>
              <p className="mobile-empty-sub">Schedule a task and it shows up here.</p>
            </div>
          )}
        </section>
      </>
    )
  }

  const renderUpcoming = () => (
    <>
      <ViewHead title="Upcoming" />
      {upcomingGroups.length === 0 ? (
        <div className="mobile-clear-state">
          <div className="mobile-empty-emoji">🗓️</div>
          <p className="mobile-empty-title">Nothing scheduled ahead.</p>
          <p className="mobile-empty-sub">Give a task a date — swipe one left, or type “friday” in quick add.</p>
        </div>
      ) : upcomingGroups.map(group => {
        const due = formatDue(group.date)
        const d = group.date.split('-')
        return (
          <section className="mobile-group" key={group.date}>
            <div className="mobile-group-head">
              {due.label}
              <span className="mobile-group-date">{`${Number(d[2])}/${Number(d[1])}`}</span>
              <span className="mobile-group-count">{group.items.length}</span>
            </div>
            {group.items.map(g => <TaskRow key={g.id} glob={g} {...rowProps(true)} />)}
          </section>
        )
      })}
    </>
  )

  const renderSearch = () => (
    <>
      <ViewHead title="Search" />
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
        {searchResults.length === 0 ? (
          <p className="mobile-no-results">Nothing matches that.</p>
        ) : searchResults.map(g => <TaskRow key={g.id} glob={g} {...rowProps(true)} />)}
      </section>
    </>
  )

  const renderBrowse = () => (
    <>
      <ViewHead title="Browse" />
      <section className="mobile-group">
        <button className="mobile-browse-row" onClick={() => setOpenProject('inbox')}>
          <span className="mobile-browse-ico">📥</span>
          <span className="mobile-browse-name">Inbox</span>
          <span className="mobile-browse-count">{inboxGlobs.length}</span>
          <ChevronIcon />
        </button>
        <button className="mobile-browse-row" onClick={() => setOpenProject('flagged')}>
          <span className="mobile-browse-ico">🚩</span>
          <span className="mobile-browse-name">Flagged</span>
          <span className="mobile-browse-count">{state.globs.filter(g => g.flagged).length}</span>
          <ChevronIcon />
        </button>
      </section>
      <section className="mobile-group">
        <div className="mobile-group-head">My Projects<span className="mobile-group-count">{state.clusters.length}</span></div>
        {state.clusters.map(c => (
          <button className="mobile-browse-row" key={c.id} onClick={() => setOpenProject(c.id)}>
            <span className="mobile-proj-dot" style={{ background: c.color }} />
            <span className="mobile-browse-name">{c.name}</span>
            <span className="mobile-browse-count">{c.globIds.length}</span>
            <ChevronIcon />
          </button>
        ))}
        <button className="mobile-browse-row is-add" onClick={() => setSheet({ kind: 'newProject' })}>
          <span className="mobile-browse-ico">＋</span>
          <span className="mobile-browse-name">Add project</span>
        </button>
      </section>
      <section className="mobile-group">
        <button className="mobile-browse-row" onClick={onOpenBackups}>
          <span className="mobile-browse-ico">🛟</span>
          <span className="mobile-browse-name">Backups &amp; history</span>
          <ChevronIcon />
        </button>
      </section>
    </>
  )

  const renderProject = (pid: ProjectId) => {
    const cluster = pid !== 'inbox' && pid !== 'flagged' ? clustersById.get(pid) : undefined
    // Deleted out from under us (undo, sync) — the effect above pops the view.
    if (pid !== 'inbox' && pid !== 'flagged' && !cluster) return null
    const all: Glob[] = pid === 'inbox'
      ? inboxGlobs
      : pid === 'flagged'
        ? state.globs.filter(g => g.flagged).sort((a, b) => b.createdAt - a.createdAt)
        : cluster!.globIds.map(id => globsById.get(id)).filter((g): g is Glob => !!g)
    const active = all.filter(g => !g.done)
    const completed = all.filter(g => g.done)
    const title = pid === 'inbox' ? 'Inbox' : pid === 'flagged' ? 'Flagged' : cluster!.name

    return (
      <>
        <div className="mobile-proj-head">
          <button className="mobile-back-btn" onClick={() => setOpenProject(null)} aria-label="Back">
            <BackIcon />
          </button>
          {cluster && <span className="mobile-proj-dot big" style={{ background: cluster.color }} />}
          <span className="mobile-proj-title">{title}</span>
          {cluster && (
            <button
              className="mobile-menu-btn"
              aria-label="Project actions"
              onClick={() => setSheet({ kind: 'projectMenu', clusterId: cluster.id })}
            >
              <DotsIcon />
            </button>
          )}
        </div>
        <section className="mobile-group">
          {active.map(g => <TaskRow key={g.id} glob={g} {...rowProps(pid === 'flagged')} />)}
          {all.length === 0 && (
            <p className="mobile-no-results">
              {pid === 'inbox' ? 'Inbox zero. Everything’s filed. 🎉' : 'Nothing in here yet.'}
            </p>
          )}
          {pid !== 'flagged' && (
            <button className="mobile-addtask-row" onClick={() => setSheet({ kind: 'quickAdd' })}>
              <span className="mobile-addtask-plus">＋</span> Add task
            </button>
          )}
        </section>
        {completed.length > 0 && (
          <section className="mobile-group">
            <button className="mobile-completed-toggle" onClick={() => setShowCompleted(v => !v)}>
              <ChevronIcon open={showCompleted} /> Completed <span className="mobile-group-count">{completed.length}</span>
            </button>
            {showCompleted && completed.map(g => <TaskRow key={g.id} glob={g} {...rowProps(pid === 'flagged')} />)}
          </section>
        )}
      </>
    )
  }

  return (
    <div className={`mobile-app ${selecting ? 'selecting' : ''} ${voice.status === 'listening' ? 'listening' : ''}`}>
      {selecting && (
        <header className="mobile-head select">
          <button className="mobile-head-btn" onClick={endSelect}>Cancel</button>
          <span className="mobile-select-count">{selectedIds.length} selected</span>
          <button
            className="mobile-head-btn"
            onClick={() => setSelected(new Set(state.globs.map(g => g.id)))}
          >
            All
          </button>
        </header>
      )}

      <div className="mobile-list">
        {openProject
          ? renderProject(openProject)
          : tab === 'today' ? renderToday()
          : tab === 'upcoming' ? renderUpcoming()
          : tab === 'search' ? renderSearch()
          : renderBrowse()}
        {/* spacer so the last row clears the tab bar + FAB */}
        <div className="mobile-list-pad" />
      </div>

      <VoiceOverlay voice={voice} />

      {!selecting && (
        <div className="mobile-fab-stack">
          {voice.supported && <MicButton voice={voice} />}
          <button
            className="mobile-fab"
            aria-label="Add task"
            onClick={() => setSheet({ kind: 'quickAdd' })}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      )}

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
            onClick={() => setSheet({ kind: 'bulkMove' })}
          >
            Move…
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
        <nav className="mobile-tabbar">
          <TabButton id="today" label="Today" active={tab === 'today' && !openProject} badge={todayCount} onPress={setTab}>
            <TodayIcon />
          </TabButton>
          <TabButton id="upcoming" label="Upcoming" active={tab === 'upcoming' && !openProject} onPress={setTab}>
            <CalendarIcon />
          </TabButton>
          <TabButton id="search" label="Search" active={tab === 'search' && !openProject} onPress={setTab}>
            <SearchIcon size={20} />
          </TabButton>
          <TabButton id="browse" label="Browse" active={tab === 'browse' || !!openProject} onPress={setTab}>
            <BrowseIcon />
          </TabButton>
        </nav>
      )}

      {sheet?.kind === 'quickAdd' && (
        <QuickAddSheet
          clusters={state.clusters}
          defaultClusterId={quickAddProject}
          onSubmit={(text, opts) => props.onAddTask(text, opts)}
          onClose={() => setSheet(null)}
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
          onSetPriority={props.onSetPriority}
          onOpenSchedule={() => setSheet({ kind: 'schedule', globId: detailGlob.id, back: true })}
          onOpenMove={() => setSheet({ kind: 'move', globId: detailGlob.id, back: true })}
          onDelete={() => { props.onDelete(detailGlob.id); setSheet(null) }}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === 'schedule' && (() => {
        const g = globsById.get(sheet.globId)
        if (!g) return null
        const done = () => setSheet(sheet.back ? { kind: 'detail', globId: g.id } : null)
        return (
          <ScheduleSheet
            glob={g}
            onPick={date => { props.onSetDueDate(g.id, date); done() }}
            onClose={done}
          />
        )
      })()}

      {sheet?.kind === 'move' && (() => {
        const g = globsById.get(sheet.globId)
        if (!g) return null
        const done = () => setSheet(sheet.back ? { kind: 'detail', globId: g.id } : null)
        return (
          <ActionSheet title="Move to…" onClose={done} rows={[
            ...(g.clusterId ? [{ label: '📥 Inbox', onClick: () => { props.onRemoveFromCluster(g.id); done() } }] : []),
            ...state.clusters.filter(c => c.id !== g.clusterId).map(c => ({
              label: c.name,
              dot: c.color,
              onClick: () => {
                if (g.clusterId) props.onMoveGlobToCluster(g.id, c.id)
                else props.onAddToCluster(g.id, c.id)
                done()
              },
            })),
          ]} />
        )
      })()}

      {sheet?.kind === 'bulkMove' && (
        <ActionSheet
          title={`Move ${selectedIds.length} thought${selectedIds.length === 1 ? '' : 's'} to…`}
          onClose={() => setSheet(null)}
          rows={state.clusters.map(c => ({
            label: c.name,
            dot: c.color,
            onClick: bulk(() => props.onMoveGlobsToCluster(selectedIds, c.id)),
          }))}
        />
      )}

      {sheet?.kind === 'projectMenu' && (() => {
        const c = clustersById.get(sheet.clusterId)
        if (!c) return null
        const items = c.globIds.map(id => globsById.get(id)).filter((g): g is Glob => !!g)
        const completedCount = items.filter(g => g.isTodo && g.done).length
        const allAreTodos = items.length > 0 && items.every(g => g.isTodo)
        return (
          <ActionSheet title={c.name} onClose={() => setSheet(null)} rows={[
            { label: '✏️ Rename', onClick: () => setSheet({ kind: 'rename', clusterId: c.id }) },
            { label: '🎨 Color', onClick: () => setSheet({ kind: 'projectColor', clusterId: c.id }) },
            {
              label: allAreTodos ? '☑️ Remove all to-dos' : '☐ Convert all to to-dos',
              disabled: items.length === 0,
              onClick: () => { props.onToggleAllTodosInCluster(c.id); setSheet(null) },
            },
            {
              label: `🧹 Clear completed${completedCount ? ` (${completedCount})` : ''}`,
              disabled: completedCount === 0,
              onClick: () => { props.onClearCompletedInCluster(c.id); setSheet(null) },
            },
            {
              label: '💨 Delete project, keep thoughts',
              onClick: () => { props.onDissolveCluster(c.id); setSheet(null); setOpenProject(null) },
            },
            {
              label: '🗑️ Delete project + thoughts',
              danger: true,
              onClick: () => {
                c.globIds.forEach(id => props.onDelete(id))
                props.onDeleteCluster(c.id)
                setSheet(null)
                setOpenProject(null)
              },
            },
          ]} />
        )
      })()}

      {sheet?.kind === 'projectColor' && (() => {
        const c = clustersById.get(sheet.clusterId)
        if (!c) return null
        return (
          <SheetShell onClose={() => setSheet(null)}>
            <div className="mobile-sheet-title">Project color</div>
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
            title="Rename project"
            initial={c.name}
            submitLabel="Rename"
            onSubmit={name => { props.onRenameCluster(c.id, name || c.name); setSheet(null) }}
            onClose={() => setSheet(null)}
          />
        )
      })()}

      {sheet?.kind === 'newProject' && (
        <TextPromptSheet
          title="New project"
          initial=""
          placeholder="project name…"
          submitLabel="Create"
          onSubmit={name => { if (name) props.onAddCluster(name); setSheet(null) }}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}

// ── view chrome ──────────────────────────────────────────────────────────────

function ViewHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mobile-view-head">
      <h1 className="mobile-big-title">{title}</h1>
      {sub && <span className="mobile-view-sub">{sub}</span>}
    </div>
  )
}

function TabButton({
  id,
  label,
  active,
  badge,
  onPress,
  children,
}: {
  id: Tab
  label: string
  active: boolean
  badge?: number
  onPress: (t: Tab) => void
  children: React.ReactNode
}) {
  return (
    <button className={`mobile-tab ${active ? 'on' : ''}`} onClick={() => onPress(id)}>
      <span className="mobile-tab-ico">
        {children}
        {badge ? <span className="mobile-tab-badge">{badge > 99 ? '99+' : badge}</span> : null}
      </span>
      <span className="mobile-tab-label">{label}</span>
    </button>
  )
}

// ── a single task row ────────────────────────────────────────────────────────

/** Horizontal travel before a swipe commits. */
const SWIPE_AT = 88
/** Hold this long without moving to enter select mode. */
const LONG_PRESS_MS = 450

function TaskRow({
  glob,
  selecting,
  selectedSet,
  showProject,
  clustersById,
  onToggleDone,
  onOpen,
  onSchedule,
  onLongPress,
  onToggleSelect,
}: {
  glob: Glob
  selecting: boolean
  selectedSet: Set<string> | null
  showProject: boolean
  clustersById: Map<string, Cluster>
  onToggleDone: (id: string) => void
  onOpen: (id: string) => void
  onSchedule: (id: string) => void
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

  const selected = !!selectedSet?.has(glob.id)
  const prio = glob.priority ?? 4
  const due = glob.dueDate ? formatDue(glob.dueDate) : null
  const cluster = showProject && glob.clusterId ? clustersById.get(glob.clusterId) : undefined

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
    if (axis.current === 'swipe') {
      // Todoist's grammar: right = done, left = pick a date.
      if (dx >= SWIPE_AT) onToggleDone(glob.id)
      else if (dx <= -SWIPE_AT) onSchedule(glob.id)
    }
    start.current = null
    axis.current = 'undecided'
    setDx(0)
  }

  useEffect(() => clearTimer, [])

  const activate = () => {
    if (selecting) onToggleSelect(glob.id)
    else onOpen(glob.id)
  }

  return (
    <div className={`mobile-task-wrap ${dx !== 0 ? 'swiping' : ''}`}>
      <div className={`mobile-task-under complete ${dx >= SWIPE_AT ? 'armed' : ''}`} aria-hidden="true">
        <CheckIcon /> Done
      </div>
      <div className={`mobile-task-under schedule ${dx <= -SWIPE_AT ? 'armed' : ''}`} aria-hidden="true">
        <CalendarIcon size={16} /> Schedule
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
        onClick={activate}
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
            className={`mobile-check p${prio} ${glob.done ? 'done' : ''} ${glob.isTodo ? 'todo' : ''}`}
            aria-label={glob.done ? 'Mark not done' : 'Mark done'}
            onClick={e => { e.stopPropagation(); onToggleDone(glob.id) }}
          >
            {glob.done && <CheckIcon />}
          </button>
        )}
        <div className="mobile-task-body">
          <span className="mobile-task-text">{glob.text}</span>
          {(due || cluster || glob.flagged) && (
            <span className="mobile-task-meta">
              {due && <span className={`due-chip ${due.tone}`}><CalendarIcon size={11} />{due.label}</span>}
              {glob.flagged && <span className="mobile-task-flag">🚩</span>}
              {cluster && (
                <span className="mobile-task-proj">
                  {cluster.name}
                  <span className="mobile-proj-dot" style={{ background: cluster.color }} />
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── quick add ────────────────────────────────────────────────────────────────

function QuickAddSheet({
  clusters,
  defaultClusterId,
  onSubmit,
  onClose,
}: {
  clusters: Cluster[]
  defaultClusterId: string | null
  onSubmit: (text: string, opts: { clusterId: string | null; dueDate: string | null; priority: Priority }) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  // Explicit chip choices override anything parsed out of the text.
  const [dueDate, setDueDate] = useState<string | null>(null)
  const [priority, setPriority] = useState<Priority | null>(null)
  const [clusterId, setClusterId] = useState<string | null>(defaultClusterId)
  const [picker, setPicker] = useState<'date' | 'priority' | 'project' | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const parsed = useMemo(() => parseQuickAdd(text), [text])
  const effDue = dueDate ?? parsed.dueDate
  const effPrio: Priority = priority ?? parsed.priority ?? 4
  const cluster = clusterId ? clusters.find(c => c.id === clusterId) : undefined
  const dueLabel = effDue ? formatDue(effDue).label : 'Date'

  const submit = () => {
    if (!parsed.text) return
    onSubmit(parsed.text, { clusterId, dueDate: effDue, priority: effPrio })
    // Stay open, keep the target project: rapid-fire capture is the point.
    setText('')
    setDueDate(null)
    setPriority(null)
    inputRef.current?.focus()
  }

  return (
    <SheetShell onClose={onClose} className="mobile-qa">
      <input
        ref={inputRef}
        className="mobile-qa-input"
        placeholder="e.g. water the ficus tomorrow p2"
        value={text}
        enterKeyHint="send"
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit() }}
      />
      {picker === 'date' && (
        <div className="mobile-qa-picker">
          <button className="mobile-qa-opt" onClick={() => { setDueDate(todayStr()); setPicker(null) }}>Today</button>
          <button className="mobile-qa-opt" onClick={() => { setDueDate(addDaysStr(todayStr(), 1)); setPicker(null) }}>Tomorrow</button>
          <button className="mobile-qa-opt" onClick={() => { setDueDate(nextWeekdayStr(6)); setPicker(null) }}>Weekend</button>
          <button className="mobile-qa-opt" onClick={() => { setDueDate(nextWeekdayStr(1)); setPicker(null) }}>Next week</button>
          <label className="mobile-qa-opt">
            Pick…
            <input
              type="date"
              className="mobile-date-input"
              onChange={e => { if (e.target.value) { setDueDate(e.target.value); setPicker(null) } }}
            />
          </label>
          <button className="mobile-qa-opt" onClick={() => { setDueDate(null); setPicker(null) }}>Clear</button>
        </div>
      )}
      {picker === 'priority' && (
        <div className="mobile-qa-picker">
          {PRIORITIES.map(p => (
            <button
              key={p}
              className={`mobile-qa-opt prio p${p} ${effPrio === p ? 'on' : ''}`}
              onClick={() => { setPriority(p); setPicker(null) }}
            >
              <FlagIcon /> {p === 4 ? 'None' : `P${p}`}
            </button>
          ))}
        </div>
      )}
      {picker === 'project' && (
        <div className="mobile-qa-picker">
          <button className={`mobile-qa-opt ${!clusterId ? 'on' : ''}`} onClick={() => { setClusterId(null); setPicker(null) }}>
            📥 Inbox
          </button>
          {clusters.map(c => (
            <button
              key={c.id}
              className={`mobile-qa-opt ${clusterId === c.id ? 'on' : ''}`}
              onClick={() => { setClusterId(c.id); setPicker(null) }}
            >
              <span className="mobile-proj-dot" style={{ background: c.color }} /> {c.name}
            </button>
          ))}
        </div>
      )}
      <div className="mobile-qa-chips">
        <button
          className={`mobile-qa-chip ${effDue ? 'set' : ''}`}
          onClick={() => setPicker(p => p === 'date' ? null : 'date')}
        >
          <CalendarIcon size={13} /> {dueLabel}
        </button>
        <button
          className={`mobile-qa-chip prio p${effPrio} ${effPrio < 4 ? 'set' : ''}`}
          onClick={() => setPicker(p => p === 'priority' ? null : 'priority')}
        >
          <FlagIcon /> {effPrio < 4 ? `P${effPrio}` : 'Priority'}
        </button>
        <button
          className={`mobile-qa-chip ${clusterId ? 'set' : ''}`}
          onClick={() => setPicker(p => p === 'project' ? null : 'project')}
        >
          {cluster
            ? <><span className="mobile-proj-dot" style={{ background: cluster.color }} />{cluster.name}</>
            : <>📥 Inbox</>}
        </button>
        <button className="mobile-qa-send" onClick={submit} disabled={!parsed.text} aria-label="Add task">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>
    </SheetShell>
  )
}

// ── task detail ──────────────────────────────────────────────────────────────

function DetailSheet({
  glob,
  cluster,
  onUpdateText,
  onToggleDone,
  onToggleTodo,
  onToggleFlag,
  onSetPriority,
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
  onSetPriority: (id: string, p: Priority) => void
  onOpenSchedule: () => void
  onOpenMove: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const due = glob.dueDate ? formatDue(glob.dueDate) : null
  const prio = glob.priority ?? 4
  return (
    <SheetShell onClose={onClose} className="mobile-detail">
      <div className="mobile-detail-top">
        <button
          className={`mobile-check p${prio} ${glob.done ? 'done' : ''} ${glob.isTodo ? 'todo' : ''}`}
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
      <div className="mobile-detail-rows">
        <button className="mobile-detail-row" onClick={onOpenMove}>
          <span className="mobile-detail-ico">{cluster ? <span className="mobile-proj-dot" style={{ background: cluster.color }} /> : '📥'}</span>
          <span className="mobile-detail-label">Project</span>
          <span className="mobile-detail-value">{cluster ? cluster.name : 'Inbox'}</span>
          <ChevronIcon />
        </button>
        <button className="mobile-detail-row" onClick={onOpenSchedule}>
          <span className="mobile-detail-ico"><CalendarIcon size={16} /></span>
          <span className="mobile-detail-label">Due date</span>
          <span className={`mobile-detail-value ${due ? `due-${due.tone}` : ''}`}>{due ? due.label : 'None'}</span>
          <ChevronIcon />
        </button>
        <div className="mobile-detail-row static">
          <span className="mobile-detail-ico"><FlagIcon /></span>
          <span className="mobile-detail-label">Priority</span>
          <span className="mobile-prio-picker">
            {PRIORITIES.map(p => (
              <button
                key={p}
                className={`mobile-prio-btn p${p} ${prio === p ? 'on' : ''}`}
                aria-label={p === 4 ? 'No priority' : `Priority ${p}`}
                onClick={() => onSetPriority(glob.id, p)}
              >
                {p === 4 ? '–' : `P${p}`}
              </button>
            ))}
          </span>
        </div>
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
            {r.dot && <span className="mobile-proj-dot" style={{ background: r.dot }} />}
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
        className="mobile-qa-input"
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function SearchIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
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

function TodayIcon() {
  const day = new Date().getDate()
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <line x1="3" y1="9.5" x2="21" y2="9.5" />
      <text x="12" y="18.5" textAnchor="middle" fontSize="8.5" fill="currentColor" stroke="none" fontWeight="700">{day}</text>
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

function BrowseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="14" y2="17" />
    </svg>
  )
}

function FlagIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  )
}
