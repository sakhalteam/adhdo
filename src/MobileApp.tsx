import { useEffect, useMemo, useRef, useState } from 'react'
import type { GalaxyState, Glob } from './types'

// ── Mobile view ────────────────────────────────────────────────────────────
// A touch-first, list-based replacement for the galaxy. Same state + the same
// App.tsx callbacks — just a UI that works with a thumb. Capture stays the star:
// a big always-ready input at the bottom, newest thought lands at the top.

interface Props {
  state: GalaxyState
  onboardingActive: boolean
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
}

// Which bottom sheet is open, if any.
type Sheet =
  | { kind: 'item'; globId: string }
  | { kind: 'move'; globId: string }
  | { kind: 'cluster'; clusterId: string }
  | null

export default function MobileApp(props: Props) {
  const { state, onboardingActive, onAdd } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  // Inline edit — one glob or one cluster name at a time.
  const [editingGlob, setEditingGlob] = useState<string | null>(null)
  const [editingCluster, setEditingCluster] = useState<string | null>(null)

  const looseGlobs = useMemo(
    () => state.globs.filter(g => !g.clusterId).sort((a, b) => b.createdAt - a.createdAt),
    [state.globs],
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

  return (
    <div className="mobile-app">
      <header className="mobile-head">
        <span className="mobile-title">adhdo</span>
        <span className="mobile-count">
          {state.globs.length} {state.globs.length === 1 ? 'thought' : 'thoughts'}
        </span>
      </header>

      <div className="mobile-list">
        {onboardingActive && (
          <div className="mobile-empty">
            <div className="mobile-empty-emoji">🧠</div>
            <p className="mobile-empty-title">Empty headspace.</p>
            <p className="mobile-empty-sub">Tap below and dump a thought. Hit enter. Repeat.</p>
          </div>
        )}

        {looseGlobs.length > 0 && (
          <section className="mobile-section">
            <div className="mobile-section-head">
              <span className="mobile-section-name">loose thoughts</span>
              <span className="mobile-section-count">{looseGlobs.length}</span>
            </div>
            {looseGlobs.map(g => (
              <MobileItem
                key={g.id}
                glob={g}
                editing={editingGlob === g.id}
                onStartEdit={() => setEditingGlob(g.id)}
                onCommitEdit={text => { props.onUpdateText(g.id, text); setEditingGlob(null) }}
                onCancelEdit={() => setEditingGlob(null)}
                onToggleDone={() => props.onToggleDone(g.id)}
                onMenu={() => setSheet({ kind: 'item', globId: g.id })}
                onDelete={() => props.onDelete(g.id)}
              />
            ))}
          </section>
        )}

        {state.clusters.map(cluster => {
          const items = cluster.globIds
            .map(id => globsById.get(id))
            .filter((g): g is Glob => !!g)
          return (
            <section className="mobile-section" key={cluster.id}>
              <div
                className="mobile-section-head cluster"
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
                    className="mobile-section-name cluster"
                    onClick={e => { e.stopPropagation(); setEditingCluster(cluster.id) }}
                  >
                    {cluster.name}
                  </span>
                )}
                <span className="mobile-section-count">{items.length}</span>
                <button
                  className="mobile-menu-btn"
                  aria-label="Cluster actions"
                  onClick={e => { e.stopPropagation(); setSheet({ kind: 'cluster', clusterId: cluster.id }) }}
                >
                  <DotsIcon />
                </button>
              </div>
              {!cluster.collapsed && items.map(g => (
                <MobileItem
                  key={g.id}
                  glob={g}
                  inCluster
                  editing={editingGlob === g.id}
                  onStartEdit={() => setEditingGlob(g.id)}
                  onCommitEdit={text => { props.onUpdateText(g.id, text); setEditingGlob(null) }}
                  onCancelEdit={() => setEditingGlob(null)}
                  onToggleDone={() => props.onToggleDone(g.id)}
                  onMenu={() => setSheet({ kind: 'item', globId: g.id })}
                  onDelete={() => props.onDelete(g.id)}
                />
              ))}
            </section>
          )
        })}

        {/* spacer so the last item clears the capture bar */}
        <div className="mobile-list-pad" />
      </div>

      <div className="capture-bar mobile">
        <div className="capture-wrap">
          <input
            ref={inputRef}
            type="text"
            className="capture-input"
            placeholder={onboardingActive ? 'type a thought, hit enter…' : 'brain dump here…'}
            enterKeyHint="done"
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

      {sheet && (
        <ActionSheet sheet={sheet} {...props} onClose={() => setSheet(null)} setSheet={setSheet} />
      )}
    </div>
  )
}

// ── A single thought row ─────────────────────────────────────────────────────
function MobileItem({
  glob,
  inCluster,
  editing,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onToggleDone,
  onMenu,
  onDelete,
}: {
  glob: Glob
  inCluster?: boolean
  editing: boolean
  onStartEdit: () => void
  onCommitEdit: (text: string) => void
  onCancelEdit: () => void
  onToggleDone: () => void
  onMenu: () => void
  onDelete: () => void
}) {
  // Swipe-left-to-delete. Track only horizontal drag; small movements fall
  // through to the tap handlers (edit / checkbox).
  const startX = useRef<number | null>(null)
  const [dx, setDx] = useState(0)
  const DELETE_AT = -96

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) return
    startX.current = e.clientX
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (startX.current === null) return
    const delta = e.clientX - startX.current
    setDx(Math.min(0, delta)) // only allow swiping left
  }
  const onPointerUp = () => {
    if (dx <= DELETE_AT) {
      onDelete()
    }
    startX.current = null
    setDx(0)
  }

  return (
    <div className="mobile-item-wrap">
      <div className="mobile-item-delete" aria-hidden="true">
        <TrashIcon />
      </div>
      <div
        className={`mobile-item ${glob.done ? 'done' : ''} ${glob.flagged ? 'flagged' : ''} ${inCluster ? 'in-cluster' : ''}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, ['--glob-color' as string]: glob.color }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button
          className={`mobile-check ${glob.done ? 'done' : ''} ${glob.isTodo ? 'todo' : ''}`}
          aria-label={glob.done ? 'Mark not done' : 'Mark done'}
          onClick={e => { e.stopPropagation(); onToggleDone() }}
        >
          {glob.done && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>

        {editing ? (
          <InlineInput
            initial={glob.text}
            className="mobile-item-input"
            onCommit={text => onCommitEdit(text.trim() || glob.text)}
            onCancel={onCancelEdit}
          />
        ) : (
          <span className="mobile-item-text" onClick={onStartEdit}>
            {glob.flagged && <span className="mobile-flag">★</span>}
            {glob.text}
          </span>
        )}

        <button
          className="mobile-menu-btn"
          aria-label="Thought actions"
          onClick={e => { e.stopPropagation(); onMenu() }}
        >
          <DotsIcon />
        </button>
      </div>
    </div>
  )
}

// ── Bottom action sheet ──────────────────────────────────────────────────────
function ActionSheet({
  sheet,
  state,
  onClose,
  setSheet,
  ...props
}: Props & { sheet: Exclude<Sheet, null>; onClose: () => void; setSheet: (s: Sheet) => void }) {
  const glob = sheet.kind !== 'cluster' ? state.globs.find(g => g.id === sheet.globId) : undefined
  const cluster = sheet.kind === 'cluster' ? state.clusters.find(c => c.id === sheet.clusterId) : undefined

  const close = () => onClose()
  // Run an action then close.
  const act = (fn: () => void) => () => { fn(); close() }

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
        {rows.map((r, i) => (
          <button key={i} className={`mobile-sheet-row ${r.danger ? 'danger' : ''}`} onClick={r.onClick}>
            {r.label}
          </button>
        ))}
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

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}
