import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GalaxyState, Glob } from './types'
import type { VoiceCapture } from './useVoiceCapture'
import { MicButton, VoiceOverlay } from './AppChrome'

// ── Mobile view ────────────────────────────────────────────────────────────
// A touch-first, list-based replacement for the galaxy. Same state + the same
// App.tsx callbacks — just a UI that works with a thumb.
//
// Two jobs, in priority order:
//   1. CAPTURE. The thought has to land before it's gone, including hands-free
//      and including with no signal. Everything else can wait.
//   2. TRIAGE. Later, on the couch, turn the pile into something — which is what
//      search, filters and multi-select filing are for.

interface Props {
  state: GalaxyState
  onboardingActive: boolean
  /** Owned by App so the mobile and desktop bars can't run two mic sessions. */
  voice: VoiceCapture
  onAdd: (text: string) => void
  onToggleDone: (id: string) => void
  onToggleTodo: (id: string) => void
  onToggleFlag: (id: string) => void
  onUpdateText: (id: string, text: string) => void
  onDelete: (id: string) => void
  onAddToCluster: (globId: string, clusterId: string) => void
  onMoveGlobToCluster: (globId: string, targetClusterId: string) => void
  onConvertToCluster: (globId: string) => void
  onTransferToNewCluster: (ids: string[], name?: string) => void
  onRemoveFromCluster: (globId: string) => void
  onToggleClusterCollapse: (id: string) => void
  onRenameCluster: (id: string, name: string) => void
  onToggleAllTodosInCluster: (id: string) => void
  onDissolveCluster: (id: string) => void
  onDeleteCluster: (id: string) => void
  // Bulk primitives, used by select mode.
  onMoveGlobsToCluster: (ids: string[], clusterId: string) => void
  onToggleFlagGlobs: (ids: string[]) => void
  onToggleAllTodosInGlobs: (ids: string[]) => void
  onDeleteGlobs: (ids: string[]) => void
}

// Which bottom sheet is open, if any.
type Sheet =
  | { kind: 'item'; globId: string }
  | { kind: 'move'; globId: string }
  | { kind: 'cluster'; clusterId: string }
  | { kind: 'bulkMove' }
  | null

type Filter = 'all' | 'todo' | 'flagged' | 'done'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'todo', label: 'To-do' },
  { id: 'flagged', label: 'Flagged' },
  { id: 'done', label: 'Done' },
]

export default function MobileApp(props: Props) {
  const { state, onboardingActive, onAdd, voice } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  // Inline edit — one glob or one cluster name at a time.
  const [editingGlob, setEditingGlob] = useState<string | null>(null)
  const [editingCluster, setEditingCluster] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  /** Non-null = select mode. Empty set is a valid (just-entered) state. */
  const [selected, setSelected] = useState<Set<string> | null>(null)

  const selecting = selected !== null
  const selectedIds = useMemo(() => (selected ? [...selected] : []), [selected])

  const matches = useCallback((g: Glob) => {
    if (filter === 'todo' && (!g.isTodo || g.done)) return false
    if (filter === 'flagged' && !g.flagged) return false
    if (filter === 'done' && !g.done) return false
    const q = query.trim().toLowerCase()
    return q ? g.text.toLowerCase().includes(q) : true
  }, [filter, query])

  const filtering = filter !== 'all' || query.trim() !== ''

  const looseGlobs = useMemo(
    () => state.globs
      .filter(g => !g.clusterId && matches(g))
      .sort((a, b) => b.createdAt - a.createdAt),
    [state.globs, matches],
  )

  const globsById = useMemo(() => {
    const m = new Map<string, Glob>()
    for (const g of state.globs) m.set(g.id, g)
    return m
  }, [state.globs])

  const send = () => {
    const input = inputRef.current
    if (!input) return
    onAdd(input.value)
    input.value = ''
    input.focus() // keep focus for rapid-fire capture
  }

  // The "New thought" home-screen shortcut lands here — open with the keyboard
  // already up, so the shortcut actually saves a tap.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('capture')) {
      inputRef.current?.focus()
    }
  }, [])

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

  const totalCount = state.globs.length
  const looseCount = state.globs.filter(g => !g.clusterId).length

  return (
    <div className={`mobile-app ${selecting ? 'selecting' : ''} ${voice.status === 'listening' ? 'listening' : ''}`}>
      {selecting ? (
        <header className="mobile-head select">
          <button className="mobile-head-btn" onClick={endSelect}>Cancel</button>
          <span className="mobile-select-count">
            {selectedIds.length} selected
          </span>
          <button
            className="mobile-head-btn"
            onClick={() => {
              const visible = [
                ...looseGlobs.map(g => g.id),
                ...state.clusters.flatMap(c => c.globIds.filter(id => {
                  const g = globsById.get(id)
                  return g ? matches(g) : false
                })),
              ]
              setSelected(new Set(visible))
            }}
          >
            All
          </button>
        </header>
      ) : (
        <header className="mobile-head">
          <span className="mobile-title">adhdo</span>
          <span className="mobile-count">
            {totalCount} {totalCount === 1 ? 'thought' : 'thoughts'}
            {looseCount > 0 && ` · ${looseCount} unsorted`}
          </span>
        </header>
      )}

      {/* Triage controls. Hidden until there's enough in here for finding things
          to be a problem — an empty app doesn't need a search box. */}
      {totalCount > 6 && !selecting && (
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
      )}

      <div className="mobile-list">
        {onboardingActive && (
          <div className="mobile-empty">
            <div className="mobile-empty-emoji">🧠</div>
            <p className="mobile-empty-title">Empty headspace.</p>
            <p className="mobile-empty-sub">
              Tap below and dump a thought. Or hit the mic and just talk — every sentence
              becomes its own thought.
            </p>
          </div>
        )}

        {(looseGlobs.length > 0 || (!filtering && !onboardingActive && looseCount === 0)) && (
          <section className="mobile-section">
            <div className="mobile-section-head">
              <span className="mobile-section-name">unsorted</span>
              <span className="mobile-section-count">{looseGlobs.length}</span>
            </div>
            {looseGlobs.length === 0 ? (
              <p className="mobile-inbox-clear">Inbox empty. Everything's filed. 🎉</p>
            ) : looseGlobs.map(g => (
              <MobileItem
                key={g.id}
                glob={g}
                selecting={selecting}
                selected={!!selected?.has(g.id)}
                editing={editingGlob === g.id}
                onStartEdit={() => setEditingGlob(g.id)}
                onCommitEdit={text => { props.onUpdateText(g.id, text); setEditingGlob(null) }}
                onCancelEdit={() => setEditingGlob(null)}
                onToggleDone={() => props.onToggleDone(g.id)}
                onMenu={() => setSheet({ kind: 'item', globId: g.id })}
                onDelete={() => props.onDelete(g.id)}
                onLongPress={() => beginSelect(g.id)}
                onToggleSelect={() => toggleSelect(g.id)}
              />
            ))}
          </section>
        )}

        {state.clusters.map(cluster => {
          const all = cluster.globIds
            .map(id => globsById.get(id))
            .filter((g): g is Glob => !!g)
          const items = all.filter(matches)
          // While filtering, a cluster with nothing matching is just noise.
          if (filtering && items.length === 0) return null
          return (
            <section className="mobile-section" key={cluster.id}>
              <div
                className="mobile-section-head is-cluster"
                style={{ ['--cluster-color' as string]: cluster.color }}
                onClick={() => props.onToggleClusterCollapse(cluster.id)}
              >
                <svg
                  className={`mobile-chevron ${cluster.collapsed ? '' : 'open'}`}
                  width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                {editingCluster === cluster.id ? (
                  <InlineInput
                    initial={cluster.name}
                    className="mobile-section-name-input"
                    onCommit={text => { props.onRenameCluster(cluster.id, text || cluster.name); setEditingCluster(null) }}
                    onCancel={() => setEditingCluster(null)}
                  />
                ) : (
                  <span
                    className="mobile-section-name is-cluster"
                    onClick={e => { e.stopPropagation(); setEditingCluster(cluster.id) }}
                  >
                    {cluster.name}
                  </span>
                )}
                <span className="mobile-section-count">
                  {filtering ? `${items.length}/${all.length}` : all.length}
                </span>
                <button
                  className="mobile-menu-btn"
                  aria-label="Cluster actions"
                  onClick={e => { e.stopPropagation(); setSheet({ kind: 'cluster', clusterId: cluster.id }) }}
                >
                  <DotsIcon />
                </button>
              </div>
              {/* A filter is a search: honour it over a collapsed cluster, or the
                  thing you're looking for hides inside a folded section. */}
              {(!cluster.collapsed || filtering) && items.map(g => (
                <MobileItem
                  key={g.id}
                  glob={g}
                  inCluster
                  selecting={selecting}
                  selected={!!selected?.has(g.id)}
                  editing={editingGlob === g.id}
                  onStartEdit={() => setEditingGlob(g.id)}
                  onCommitEdit={text => { props.onUpdateText(g.id, text); setEditingGlob(null) }}
                  onCancelEdit={() => setEditingGlob(null)}
                  onToggleDone={() => props.onToggleDone(g.id)}
                  onMenu={() => setSheet({ kind: 'item', globId: g.id })}
                  onDelete={() => props.onDelete(g.id)}
                  onLongPress={() => beginSelect(g.id)}
                  onToggleSelect={() => toggleSelect(g.id)}
                />
              ))}
            </section>
          )
        })}

        {filtering && looseGlobs.length === 0 && state.clusters.every(c =>
          c.globIds.every(id => { const g = globsById.get(id); return !g || !matches(g) })
        ) && (
          <p className="mobile-no-results">Nothing matches that.</p>
        )}

        {/* spacer so the last item clears the capture bar */}
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
            onClick={() => setSheet({ kind: 'bulkMove' })}
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
        <div className="capture-bar mobile">
          <div className="capture-wrap">
            {voice.supported && <MicButton voice={voice} />}
            <input
              ref={inputRef}
              type="text"
              className="capture-input"
              placeholder={onboardingActive ? 'type a thought, hit enter…' : 'brain dump here…'}
              enterKeyHint="send"
              onKeyDown={e => { if (e.key === 'Enter') send() }}
            />
            <button className="capture-send" onClick={send} aria-label="Add thought">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {sheet && (
        <ActionSheet
          sheet={sheet}
          selectedIds={selectedIds}
          onBulkDone={endSelect}
          {...props}
          onClose={() => setSheet(null)}
          setSheet={setSheet}
        />
      )}
    </div>
  )
}

// ── A single thought row ─────────────────────────────────────────────────────

/** Horizontal travel before a drag counts as a delete swipe. */
const DELETE_AT = -96
/** Hold this long without moving to enter select mode. */
const LONG_PRESS_MS = 450

function MobileItem({
  glob,
  inCluster,
  selecting,
  selected,
  editing,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onToggleDone,
  onMenu,
  onDelete,
  onLongPress,
  onToggleSelect,
}: {
  glob: Glob
  inCluster?: boolean
  selecting: boolean
  selected: boolean
  editing: boolean
  onStartEdit: () => void
  onCommitEdit: (text: string) => void
  onCancelEdit: () => void
  onToggleDone: () => void
  onMenu: () => void
  onDelete: () => void
  onLongPress: () => void
  onToggleSelect: () => void
}) {
  const [dx, setDx] = useState(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  // Which gesture this pointer turned out to be. Decided once, then locked, so a
  // vertical scroll that drifts sideways can't start dragging the row with it.
  const axis = useRef<'undecided' | 'swipe' | 'scroll'>('undecided')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Set when a gesture happened, so the trailing click doesn't also fire. */
  const consumed = useRef(false)

  const clearTimer = () => { clearTimeout(timer.current); timer.current = undefined }

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) return
    start.current = { x: e.clientX, y: e.clientY }
    axis.current = 'undecided'
    consumed.current = false
    if (!selecting) {
      timer.current = setTimeout(() => {
        if (axis.current !== 'undecided') return
        consumed.current = true
        onLongPress()
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
      if (ddx < -12 && Math.abs(ddx) > Math.abs(ddy) * 1.5) {
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
      setDx(Math.min(0, ddx))
    }
  }

  const onPointerUp = () => {
    clearTimer()
    if (axis.current === 'swipe' && dx <= DELETE_AT) onDelete()
    start.current = null
    axis.current = 'undecided'
    setDx(0)
  }

  useEffect(() => clearTimer, [])

  const activate = () => {
    if (selecting) onToggleSelect()
    else onStartEdit()
  }

  return (
    <div className={`mobile-item-wrap ${dx < 0 ? 'swiping' : ''}`}>
      <div className="mobile-item-delete" aria-hidden="true">
        <TrashIcon />
      </div>
      <div
        className={`mobile-item ${glob.done ? 'done' : ''} ${glob.flagged ? 'flagged' : ''} ${inCluster ? 'in-cluster' : ''} ${selected ? 'selected' : ''}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, ['--glob-color' as string]: glob.color }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // Capture phase: swallow the click a swipe or long-press already handled,
        // before it reaches the text span and opens the editor.
        onClickCapture={e => {
          if (consumed.current) {
            e.preventDefault()
            e.stopPropagation()
            consumed.current = false
          }
        }}
      >
        {selecting ? (
          <button
            className={`mobile-check select ${selected ? 'on' : ''}`}
            aria-label={selected ? 'Deselect' : 'Select'}
            onClick={e => { e.stopPropagation(); onToggleSelect() }}
          >
            {selected && <CheckIcon />}
          </button>
        ) : (
          <button
            className={`mobile-check ${glob.done ? 'done' : ''} ${glob.isTodo ? 'todo' : ''}`}
            aria-label={glob.done ? 'Mark not done' : 'Mark done'}
            onClick={e => { e.stopPropagation(); onToggleDone() }}
          >
            {glob.done && <CheckIcon />}
          </button>
        )}

        {editing ? (
          <InlineInput
            initial={glob.text}
            className="mobile-item-input"
            onCommit={text => onCommitEdit(text.trim() || glob.text)}
            onCancel={onCancelEdit}
          />
        ) : (
          <span className="mobile-item-text" onClick={activate}>
            {glob.flagged && <span className="mobile-flag">★</span>}
            {glob.text}
          </span>
        )}

        {!selecting && (
          <button
            className="mobile-menu-btn"
            aria-label="Thought actions"
            onClick={e => { e.stopPropagation(); onMenu() }}
          >
            <DotsIcon />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Bottom action sheet ──────────────────────────────────────────────────────
function ActionSheet({
  sheet,
  state,
  selectedIds,
  onBulkDone,
  onClose,
  setSheet,
  ...props
}: Props & {
  sheet: Exclude<Sheet, null>
  selectedIds: string[]
  onBulkDone: () => void
  onClose: () => void
  setSheet: (s: Sheet) => void
}) {
  const glob = sheet.kind === 'item' || sheet.kind === 'move'
    ? state.globs.find(g => g.id === sheet.globId)
    : undefined
  const cluster = sheet.kind === 'cluster' ? state.clusters.find(c => c.id === sheet.clusterId) : undefined

  const close = () => onClose()
  // Run an action then close.
  const act = (fn: () => void) => () => { fn(); close() }
  const actBulk = (fn: () => void) => () => { fn(); onBulkDone(); close() }

  let title = ''
  let rows: { label: string; danger?: boolean; onClick: () => void }[] = []

  if (sheet.kind === 'item' && glob) {
    title = glob.text
    rows = [
      { label: glob.isTodo ? 'Make a plain note' : 'Make a todo', onClick: act(() => props.onToggleTodo(glob.id)) },
      { label: glob.flagged ? 'Remove flag' : 'Flag it', onClick: act(() => props.onToggleFlag(glob.id)) },
      { label: 'Move to cluster…', onClick: () => setSheet({ kind: 'move', globId: glob.id }) },
      { label: 'Delete', danger: true, onClick: act(() => props.onDelete(glob.id)) },
    ]
  } else if (sheet.kind === 'move' && glob) {
    title = 'Move to…'
    const targets = state.clusters.filter(c => c.id !== glob.clusterId)
    rows = [
      ...targets.map(c => ({
        label: c.name,
        onClick: act(() => {
          if (glob.clusterId) props.onMoveGlobToCluster(glob.id, c.id)
          else props.onAddToCluster(glob.id, c.id)
        }),
      })),
      {
        label: '+ New cluster',
        onClick: act(() => {
          if (glob.clusterId) props.onTransferToNewCluster([glob.id])
          else props.onConvertToCluster(glob.id)
        }),
      },
      ...(glob.clusterId
        ? [{ label: 'Remove from cluster', onClick: act(() => props.onRemoveFromCluster(glob.id)) }]
        : []),
    ]
  } else if (sheet.kind === 'bulkMove') {
    title = `File ${selectedIds.length} thought${selectedIds.length === 1 ? '' : 's'} into…`
    rows = [
      ...state.clusters.map(c => ({
        label: c.name,
        onClick: actBulk(() => props.onMoveGlobsToCluster(selectedIds, c.id)),
      })),
      { label: '+ New cluster', onClick: actBulk(() => props.onTransferToNewCluster(selectedIds)) },
    ]
  } else if (sheet.kind === 'cluster' && cluster) {
    title = cluster.name
    rows = [
      { label: 'Convert all to todos', onClick: act(() => props.onToggleAllTodosInCluster(cluster.id)) },
      { label: 'Ungroup (keep thoughts)', onClick: act(() => props.onDissolveCluster(cluster.id)) },
      { label: 'Delete cluster + thoughts', danger: true, onClick: act(() => props.onDeleteCluster(cluster.id)) },
    ]
  }

  return (
    <div className="mobile-sheet-backdrop" onClick={close}>
      <div className="mobile-sheet" onClick={e => e.stopPropagation()}>
        <div className="mobile-sheet-grip" />
        {title && <div className="mobile-sheet-title">{title}</div>}
        <div className="mobile-sheet-rows">
          {rows.map((r, i) => (
            <button key={i} className={`mobile-sheet-row ${r.danger ? 'danger' : ''}`} onClick={r.onClick}>
              {r.label}
            </button>
          ))}
        </div>
        <button className="mobile-sheet-row cancel" onClick={close}>Cancel</button>
      </div>
    </div>
  )
}

// ── Inline edit input (auto-focus + select-all, commit on enter/blur) ─────────
function InlineInput({
  initial,
  className,
  onCommit,
  onCancel,
}: {
  initial: string
  className?: string
  onCommit: (text: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) { el.focus(); el.select() }
  }, [])
  return (
    <input
      ref={ref}
      className={className}
      defaultValue={initial}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Enter') onCommit(e.currentTarget.value)
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={e => onCommit(e.currentTarget.value)}
    />
  )
}

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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
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

