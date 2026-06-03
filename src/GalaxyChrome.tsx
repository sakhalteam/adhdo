import { useRef } from 'react'
import type { DragEvent, KeyboardEvent, MouseEvent, PointerEvent, RefObject } from 'react'
import type { Cluster, Connection, Glob } from './types'
import type { SearchResult } from './useGalaxySearch'
import { PALETTE } from './store'

export type RecolorTarget =
  | { kind: 'glob'; id: string }
  | { kind: 'cluster-border'; id: string }
  | { kind: 'cluster-items'; id: string }
  | { kind: 'bulk'; ids: string[] }

function clampMenuToViewport(el: HTMLDivElement | null) {
  if (!el) return
  const margin = 8
  const r = el.getBoundingClientRect()
  const maxLeft = window.innerWidth - r.width - margin
  const maxTop = window.innerHeight - r.height - margin
  if (r.left > maxLeft) el.style.left = `${Math.max(margin, maxLeft)}px`
  if (r.top > maxTop) el.style.top = `${Math.max(margin, maxTop)}px`
}

/** Six-dot drag grip, inline so it can't be mangled by file-encoding round-trips. */
function GripIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.7" />
      <circle cx="15" cy="6" r="1.7" />
      <circle cx="9" cy="12" r="1.7" />
      <circle cx="15" cy="12" r="1.7" />
      <circle cx="9" cy="18" r="1.7" />
      <circle cx="15" cy="18" r="1.7" />
    </svg>
  )
}

export type MarqueeRect = {
  x1: number
  y1: number
  x2: number
  y2: number
}

export function MarqueeOverlay({
  rect,
  selectedIds,
  onOpenBulkMenu,
  onStartSelection,
  onUpdateSelection,
  onCommitSelection,
}: {
  rect: MarqueeRect | null
  selectedIds: Set<string>
  onOpenBulkMenu: (x: number, y: number) => void
  onStartSelection: (event: PointerEvent<HTMLDivElement>) => void
  onUpdateSelection: (x: number, y: number) => void
  onCommitSelection: (event: PointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      className="marquee-overlay"
      onClick={e => e.stopPropagation()}
      onContextMenu={e => {
        e.preventDefault()
        e.stopPropagation()
        if (selectedIds.size < 2) return
        for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
          const item = (el as HTMLElement).closest('[data-glob-id]') as HTMLElement | null
          if (!item) continue
          const id = item.dataset.globId
          if (id && selectedIds.has(id)) {
            onOpenBulkMenu(e.clientX, e.clientY)
            return
          }
        }
      }}
      onPointerDown={e => {
        e.preventDefault()
        e.stopPropagation()
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        onStartSelection(e)
      }}
      onPointerMove={e => {
        if (!rect) return
        onUpdateSelection(e.clientX, e.clientY)
      }}
      onPointerUp={e => {
        if (!rect) return
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
        onCommitSelection(e)
      }}
    >
      {rect && (
        <div
          className="marquee-rect"
          style={{
            left: Math.min(rect.x1, rect.x2),
            top: Math.min(rect.y1, rect.y2),
            width: Math.abs(rect.x2 - rect.x1),
            height: Math.abs(rect.y2 - rect.y1),
          }}
        />
      )}
    </div>
  )
}

export function NewGlobInput({
  x,
  y,
  onAdd,
  onCancel,
}: {
  x: number
  y: number
  onAdd: (text: string) => void
  onCancel: () => void
}) {
  const submit = (value: string) => {
    const text = value.trim()
    if (text) onAdd(text)
    onCancel()
  }

  return (
    <div className="new-glob-input" style={{ left: x, top: y }} onClick={e => e.stopPropagation()}>
      <input
        autoFocus
        placeholder="new thought..."
        onBlur={e => submit(e.currentTarget.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit(e.currentTarget.value)
          if (e.key === 'Escape') onCancel()
        }}
      />
    </div>
  )
}

export function FreeGlob({
  glob,
  editing,
  highlighted,
  onPointerDown,
  onConvertToClusterTodo,
  onOpenMenu,
  onStartEditing,
  onUpdateText,
  onCancelEditing,
}: {
  glob: Glob
  editing: boolean
  highlighted: boolean
  onPointerDown: (e: PointerEvent<HTMLDivElement>, globId: string) => void
  onConvertToClusterTodo: (globId: string) => void
  onOpenMenu: (e: MouseEvent<HTMLDivElement>, globId: string) => void
  onStartEditing: () => void
  onUpdateText: (text: string) => void
  onCancelEditing: () => void
}) {
  return (
    <div
      className={`glob ${glob.flagged ? 'flagged' : ''} ${highlighted ? 'highlight-pulse' : ''}`}
      style={{
        left: glob.x,
        top: glob.y,
        width: glob.radius * 2,
        height: glob.radius * 2,
        ['--glob-color' as string]: glob.color,
        animationDelay: `${-(glob.blobSeed % 10)}s`,
      }}
      onPointerDown={e => {
        if (e.ctrlKey || e.metaKey) {
          e.stopPropagation()
          e.preventDefault()
          onConvertToClusterTodo(glob.id)
          return
        }
        onPointerDown(e, glob.id)
      }}
      onContextMenu={e => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          return
        }
        onOpenMenu(e, glob.id)
      }}
      onDoubleClick={e => {
        e.stopPropagation()
        onStartEditing()
      }}
    >
      {glob.flagged && <span className="flag-dot" />}
      {editing ? (
        <input
          className="glob-edit"
          defaultValue={glob.text}
          autoFocus
          onClick={e => e.stopPropagation()}
          onBlur={e => {
            onUpdateText(e.currentTarget.value)
            onCancelEditing()
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              onUpdateText(e.currentTarget.value)
              onCancelEditing()
            }
            if (e.key === 'Escape') onCancelEditing()
          }}
        />
      ) : (
        <span className="glob-text">{glob.text}</span>
      )}
    </div>
  )
}

export function ConnectionLayer({
  clusters,
  connections,
  connecting,
  hoveredConnection,
  flashConnection,
  onHoverConnection,
  onDisconnectClick,
  onRequestMerge,
  onDisconnect,
}: {
  clusters: Cluster[]
  connections: Connection[]
  connecting: { fromClusterId: string; cursorX: number; cursorY: number } | null
  hoveredConnection: string | null
  flashConnection: string | null
  onHoverConnection: (connectionId: string | null) => void
  onDisconnectClick: (e: MouseEvent<SVGGElement>, connectionId: string) => void
  onRequestMerge: (firstClusterId: string, secondClusterId: string, connectionId: string) => void
  onDisconnect: (connectionId: string) => void
}) {
  return (
    <>
      <svg className="connection-lines" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 15 }}>
        {connections.map(cn => {
          const c1 = clusters.find(c => c.id === cn.cluster1Id)
          const c2 = clusters.find(c => c.id === cn.cluster2Id)
          if (!c1 || !c2) return null

          const dx = c2.x - c1.x
          const dy = c2.y - c1.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          const nx = dist > 0 ? dx / dist : 0
          const ny = dist > 0 ? dy / dist : 0

          const NODE_RADIUS = 6
          const PADDING = 12
          const el1 = document.querySelector(`.cluster[data-cluster-id="${c1.id}"]`) as HTMLElement | null
          const el2 = document.querySelector(`.cluster[data-cluster-id="${c2.id}"]`) as HTMLElement | null
          const hw1 = el1 ? el1.offsetWidth / 2 : 90
          const hh1 = el1 ? el1.offsetHeight / 2 : 50
          const hw2 = el2 ? el2.offsetWidth / 2 : 90
          const hh2 = el2 ? el2.offsetHeight / 2 : 50

          const edgeDist = (hw: number, hh: number) => {
            if (Math.abs(nx) < 0.001 && Math.abs(ny) < 0.001) return 0
            const tx = Math.abs(nx) > 0.001 ? hw / Math.abs(nx) : Infinity
            const ty = Math.abs(ny) > 0.001 ? hh / Math.abs(ny) : Infinity
            return Math.min(tx, ty) + PADDING
          }

          const d1 = edgeDist(hw1, hh1)
          const d2 = edgeDist(hw2, hh2)
          const x1 = c1.x + nx * d1
          const y1 = c1.y + ny * d1
          const x2 = c2.x - nx * d2
          const y2 = c2.y - ny * d2
          const mx = (c1.x + c2.x) / 2
          const my = (c1.y + c2.y) / 2
          const isFlashing = flashConnection === `${cn.cluster1Id}-${cn.cluster2Id}` || flashConnection === `${cn.cluster2Id}-${cn.cluster1Id}`
          const isHovered = hoveredConnection === cn.id

          return (
            <g
              key={cn.id}
              onPointerEnter={() => onHoverConnection(cn.id)}
              onPointerLeave={() => { if (isHovered) onHoverConnection(null) }}
              onClick={e => onDisconnectClick(e, cn.id)}
              style={{ pointerEvents: 'auto' }}
            >
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="transparent" strokeWidth="28"
                style={{ cursor: 'pointer' }}
              />
              {isFlashing && (
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={cn.color} strokeWidth="6" strokeDasharray="6 4"
                  opacity="0.6"
                  className="connection-flash"
                  style={{ pointerEvents: 'none' }}
                />
              )}
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={cn.color} strokeWidth="2" strokeDasharray="6 4"
                opacity={isHovered ? 0.7 : isFlashing ? 0.8 : 0.4}
                style={{ transition: 'opacity 0.2s', pointerEvents: 'none' }}
              />
              <circle cx={x1} cy={y1} r={NODE_RADIUS}
                fill={cn.color} opacity={isHovered ? 0.9 : 0.6}
                style={{ transition: 'opacity 0.2s', pointerEvents: 'none' }}
              />
              <circle cx={x1} cy={y1} r={NODE_RADIUS + 3}
                fill={cn.color} opacity={isHovered ? 0.2 : 0.1}
                style={{ transition: 'opacity 0.2s', pointerEvents: 'none' }}
              />
              <circle cx={x2} cy={y2} r={NODE_RADIUS}
                fill={cn.color} opacity={isHovered ? 0.9 : 0.6}
                style={{ transition: 'opacity 0.2s', pointerEvents: 'none' }}
              />
              <circle cx={x2} cy={y2} r={NODE_RADIUS + 3}
                fill={cn.color} opacity={isHovered ? 0.2 : 0.1}
                style={{ transition: 'opacity 0.2s', pointerEvents: 'none' }}
              />
              {isHovered && (
                <foreignObject x={mx - 44} y={my - 20} width="88" height="40">
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%' }}>
                    <div
                      className="connection-merge-btn"
                      title="Merge clusters"
                      onClick={e => {
                        e.stopPropagation()
                        onRequestMerge(cn.cluster1Id, cn.cluster2Id, cn.id)
                        onHoverConnection(null)
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                      </svg>
                    </div>
                    <div
                      className="connection-merge-btn disconnect"
                      title="Disconnect"
                      onClick={e => {
                        e.stopPropagation()
                        onDisconnect(cn.id)
                        onHoverConnection(null)
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </div>
                  </div>
                </foreignObject>
              )}
            </g>
          )
        })}
      </svg>

      {connecting && (() => {
        const from = clusters.find(c => c.id === connecting.fromClusterId)
        if (!from) return null
        return (
          <svg style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 100 }}>
            <line
              x1={from.x} y1={from.y}
              x2={connecting.cursorX} y2={connecting.cursorY}
              stroke="#7c3aed" strokeWidth="3" strokeDasharray="8 5"
              opacity="0.8"
            />
            <circle cx={connecting.cursorX} cy={connecting.cursorY} r="8" fill="#7c3aed" opacity="0.4" />
          </svg>
        )
      })()}
    </>
  )
}

export function ModeTools({
  marqueeMode,
  onSetPointerMode,
  onSetMarqueeMode,
}: {
  marqueeMode: boolean
  onSetPointerMode: () => void
  onSetMarqueeMode: () => void
}) {
  return (
    <div className="mode-tools" onClick={e => e.stopPropagation()}>
      <button
        className={`cluster-tool-btn ${!marqueeMode ? 'active' : ''}`}
        onClick={onSetPointerMode}
        title="Pointer mode (V)"
        aria-label="Pointer mode"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 3l6 16 2-7 7-2z" />
        </svg>
      </button>
      <button
        className={`cluster-tool-btn ${marqueeMode ? 'active' : ''}`}
        onClick={onSetMarqueeMode}
        title="Marquee select (M) — click and drag to select; Shift+drag adds, Ctrl+drag removes"
        aria-label="Marquee select tool"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray="3 3" />
        </svg>
      </button>
    </div>
  )
}

export function ClusterTools({
  clusterCount,
  browserOpen,
  onOrganize,
  onToggleBrowser,
}: {
  clusterCount: number
  browserOpen: boolean
  onOrganize: () => void
  onToggleBrowser: () => void
}) {
  return (
    <div className="cluster-tools" onClick={e => e.stopPropagation()}>
      <button
        className="cluster-tool-btn"
        onClick={onOrganize}
        disabled={clusterCount === 0}
        title="Organize clusters into a neat grid"
        aria-label="Organize clusters into a neat grid"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="4" width="6" height="6" rx="1.2" />
          <rect x="14" y="4" width="6" height="6" rx="1.2" />
          <rect x="4" y="14" width="6" height="6" rx="1.2" />
          <rect x="14" y="14" width="6" height="6" rx="1.2" />
        </svg>
      </button>
      <button
        className={`cluster-tool-btn ${browserOpen ? 'active' : ''}`}
        onClick={onToggleBrowser}
        disabled={clusterCount === 0}
        title="Open cluster map"
        aria-label="Open cluster map"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
          <line x1="9" y1="3" x2="9" y2="18" />
          <line x1="15" y1="6" x2="15" y2="21" />
        </svg>
      </button>
    </div>
  )
}

export function ClusterBrowser({
  clusters,
  focusedClusterId,
  onFocusCluster,
}: {
  clusters: Cluster[]
  focusedClusterId: string | null
  onFocusCluster: (clusterId: string) => void
}) {
  return (
    <div className="cluster-browser" onClick={e => e.stopPropagation()}>
      <div className="cluster-browser-title">cluster map</div>
      {clusters.length === 0 ? (
        <div className="cluster-browser-empty">no clusters yet</div>
      ) : (
        <div className="cluster-browser-list">
          {clusters.map(cluster => (
            <button
              key={cluster.id}
              className={`cluster-browser-item ${focusedClusterId === cluster.id ? 'active' : ''}`}
              onClick={() => onFocusCluster(cluster.id)}
            >
              <span className="cluster-browser-name">{cluster.name}</span>
              <span className="cluster-browser-meta">{cluster.globIds.length} items</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function OnboardingLayer({
  globX,
  globY,
  clusterX,
  clusterY,
  onDismiss,
}: {
  globX: number
  globY: number
  clusterX: number
  clusterY: number
  onDismiss: () => void
}) {
  return (
    <>
      <div className="onboarding-panel" onClick={e => e.stopPropagation()}>
        <div className="onboarding-eyebrow">fresh galaxy</div>
        <div className="onboarding-title">Start with one thought.</div>
        <p className="onboarding-copy">
          Type in the capture bar and hit Enter. These guide-stars are just examples, and they disappear
          forever after your first real note.
        </p>
        <button className="onboarding-dismiss" onClick={onDismiss}>
          dismiss intro
        </button>
      </div>

      <div
        className="glob glob-ghost onboarding-ghost"
        style={{
          left: globX,
          top: globY,
          width: 120,
          height: 120,
          ['--glob-color' as string]: '#a78bfa',
        }}
        aria-hidden="true"
      >
        <span className="glob-text">dump a quick idea</span>
      </div>

      <div
        className="onboarding-hint onboarding-hint-glob"
        style={{ left: globX - 86, top: globY - 120 }}
        aria-hidden="true"
      >
        Thoughts start as globs.
      </div>

      <div
        className="cluster cluster-ghost onboarding-ghost"
        style={{ left: clusterX, top: clusterY, borderColor: '#67e8f9' }}
        aria-hidden="true"
      >
        <div className="cluster-header">
          <span className="cluster-name">related pile</span>
        </div>
        <div className="cluster-globs">
          <div className="cluster-glob-item" style={{ borderLeftColor: '#67e8f9' }}>
            <span className="cluster-glob-text">
              <span className="cluster-glob-text-inner">drag a glob into me</span>
            </span>
          </div>
        </div>
      </div>

      <div
        className="onboarding-hint onboarding-hint-cluster"
        style={{ left: clusterX - 98, top: clusterY - 112 }}
        aria-hidden="true"
      >
        Clusters hold related notes.
      </div>

      <div className="onboarding-hint onboarding-hint-capture" aria-hidden="true">
        Start here: type, then hit Enter.
      </div>

      <div className="onboarding-hint onboarding-hint-context" aria-hidden="true">
        Bonus: right-click empty space to place a thought exactly where you want it.
      </div>
    </>
  )
}

export function SearchModal({
  inputRef,
  query,
  results,
  onQueryChange,
  onJump,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  results: SearchResult[]
  onQueryChange: (query: string) => void
  onJump: (result: SearchResult) => void
  onClose: () => void
}) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && results[0]) onJump(results[0])
  }

  return (
    <div className="search-overlay" onClick={e => { e.stopPropagation(); onClose() }}>
      <div className="search-modal" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="search-input"
          placeholder="search globs and clusters..."
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {query.trim() && (
          <div className="search-results">
            {results.length === 0 ? (
              <div className="search-empty">no matches</div>
            ) : (
              results.map(result => (
                <button
                  key={`${result.type}-${result.id}`}
                  className="search-result"
                  onClick={() => onJump(result)}
                >
                  <span className={`search-result-kind ${result.type}`}>{result.type}</span>
                  <span className="search-result-label">{result.label}</span>
                  {result.sub && <span className="search-result-sub">{result.sub}</span>}
                </button>
              ))
            )}
          </div>
        )}
        <div className="search-hint">
          <kbd>↵</kbd> jump to first · <kbd>Esc</kbd> close
        </div>
      </div>
    </div>
  )
}

export function ClusterHeader({
  cluster,
  itemCount,
  editing,
  dissolvePending,
  onOpenMenu,
  onStartEditing,
  onRename,
  onCancelEditing,
  onToggleCollapse,
  onRequestDissolve,
  onConfirmDissolve,
  onCancelDissolve,
}: {
  cluster: Cluster
  itemCount: number
  editing: boolean
  dissolvePending: boolean
  onOpenMenu: (event: MouseEvent<HTMLDivElement>) => void
  onStartEditing: () => void
  onRename: (name: string) => void
  onCancelEditing: () => void
  onToggleCollapse: () => void
  onRequestDissolve: () => void
  onConfirmDissolve: () => void
  onCancelDissolve: () => void
}) {
  return (
    <div className="cluster-header" onContextMenu={onOpenMenu}>
      {editing ? (
        <input
          className="cluster-name-edit"
          defaultValue={cluster.name}
          autoFocus
          onFocus={e => e.currentTarget.select()}
          onClick={e => e.stopPropagation()}
          onBlur={e => onRename(e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onRename(e.currentTarget.value)
            if (e.key === 'Escape') onCancelEditing()
          }}
        />
      ) : (
        <span className="cluster-name" onClick={e => { e.stopPropagation(); onStartEditing() }}>
          {cluster.name}
        </span>
      )}
      <div className="cluster-actions">
        <button onClick={e => { e.stopPropagation(); onToggleCollapse() }}>
          {cluster.collapsed ? '＋' : '－'}
        </button>
        {dissolvePending ? (
          <div className="dissolve-confirm" onClick={e => e.stopPropagation()}>
            <span>{itemCount === 0 ? 'delete cluster?' : 'release globs?'}</span>
            <button className="dissolve-yes" onClick={onConfirmDissolve}>yes</button>
            <button className="dissolve-no" onClick={onCancelDissolve}>no</button>
          </div>
        ) : (
          <button onClick={e => { e.stopPropagation(); onRequestDissolve() }} title={itemCount === 0 ? 'Delete cluster' : 'Release globs'}>
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

export function ClusterAddControl({
  active,
  onActivate,
  onAdd,
  onCancel,
}: {
  active: boolean
  onActivate: () => void
  onAdd: (text: string) => void
  onCancel: () => void
}) {
  if (!active) {
    return (
      <button
        className="cluster-add-handle"
        title="Add a note"
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onActivate() }}
      >＋</button>
    )
  }

  return (
    <div className="cluster-add-input-wrap">
      <input
        className="cluster-add-input"
        placeholder="add a note..."
        autoFocus
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
        onBlur={e => {
          const text = e.currentTarget.value.trim()
          if (text) onAdd(text)
          onCancel()
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            const text = e.currentTarget.value.trim()
            if (text) {
              onAdd(text)
              e.currentTarget.value = ''
            } else {
              onCancel()
            }
          }
          if (e.key === 'Escape') onCancel()
        }}
      />
    </div>
  )
}

export function ClusterItemRow({
  glob,
  editing,
  dragOver,
  highlighted,
  selected,
  draggable,
  onToggleTodo,
  onToggleDone,
  onStartEditing,
  onUpdateText,
  onCancelEditing,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onOpenContextMenu,
}: {
  glob: Glob
  editing: boolean
  dragOver: boolean
  highlighted: boolean
  selected: boolean
  draggable: boolean
  onToggleTodo: () => void
  onToggleDone: () => void
  onStartEditing: () => void
  onUpdateText: (text: string) => void
  onCancelEditing: () => void
  onDragStart: (event: DragEvent<HTMLDivElement>) => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
  onDragEnd: (event: DragEvent<HTMLDivElement>) => void
  onOpenContextMenu: (event: MouseEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      className={`cluster-glob-item ${glob.flagged ? 'flagged' : ''} ${glob.done ? 'done' : ''} ${dragOver ? 'drag-over' : ''} ${highlighted ? 'highlight-pulse' : ''} ${selected ? 'selected' : ''}`}
      style={{ borderLeftColor: glob.color }}
      data-glob-id={glob.id}
      draggable={draggable}
      onClick={e => {
        const target = e.target as HTMLElement
        if (target.closest('.todo-check') || target.closest('.cluster-glob-grip')) return
        if (e.ctrlKey || e.metaKey) {
          e.stopPropagation()
          e.preventDefault()
          onToggleTodo()
          return
        }
        if (!editing) {
          e.stopPropagation()
          onStartEditing()
        }
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onContextMenu={onOpenContextMenu}
    >
      {glob.isTodo && (
        <button
          className={`todo-check ${glob.done ? 'checked' : ''}`}
          onClick={e => { e.stopPropagation(); onToggleDone() }}
        >
          {glob.done ? '✓' : ''}
        </button>
      )}
      <div className="cluster-glob-grip" title="Drag to reorder"><GripIcon size={12} /></div>
      {editing ? (
        <input
          className="glob-edit inline"
          defaultValue={glob.text}
          autoFocus
          onFocus={e => e.currentTarget.select()}
          onClick={e => e.stopPropagation()}
          onBlur={e => onUpdateText(e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onUpdateText(e.currentTarget.value)
            if (e.key === 'Escape') onCancelEditing()
          }}
        />
      ) : (
        <span className={`cluster-glob-text ${glob.done ? 'line-through opacity-50' : ''}`}>
          <span className="cluster-glob-text-inner">
            {glob.flagged && <span className="flag-dot-inline" />}
            {glob.text}
          </span>
        </span>
      )}
    </div>
  )
}

export function ClusterCard({
  cluster,
  globs,
  className,
  zIndex,
  editingCluster,
  dissolvePending,
  addingActive,
  editingGlobId,
  selectedIds,
  highlightedId,
  dragOverGlobId,
  onClusterDrop,
  onClusterDragOver,
  onOpenClusterMenu,
  onClusterPointerDown,
  onClusterEdgeDragStart,
  onConnectStart,
  onStartClusterEditing,
  onRenameCluster,
  onCancelClusterEditing,
  onToggleCollapse,
  onRequestDissolve,
  onConfirmDissolve,
  onCancelDissolve,
  onToggleGlobTodo,
  onToggleGlobDone,
  onStartGlobEditing,
  onUpdateGlobText,
  onCancelGlobEditing,
  onGlobDragStart,
  onGlobDragOver,
  onGlobDrop,
  onGlobDragEnd,
  onOpenGlobContextMenu,
  onActivateAdd,
  onAddGlob,
  onCancelAdd,
}: {
  cluster: Cluster
  globs: Glob[]
  className: string
  zIndex: number
  editingCluster: boolean
  dissolvePending: boolean
  addingActive: boolean
  editingGlobId: string | null
  selectedIds: Set<string>
  highlightedId: string | null
  dragOverGlobId: string | null
  onClusterDrop: (event: DragEvent<HTMLDivElement>) => void
  onClusterDragOver: (event: DragEvent<HTMLDivElement>) => void
  onOpenClusterMenu: (event: MouseEvent<HTMLDivElement>) => void
  onClusterPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onClusterEdgeDragStart: (event: PointerEvent<HTMLDivElement>) => void
  onConnectStart: (event: PointerEvent<HTMLDivElement>) => void
  onStartClusterEditing: () => void
  onRenameCluster: (name: string) => void
  onCancelClusterEditing: () => void
  onToggleCollapse: () => void
  onRequestDissolve: () => void
  onConfirmDissolve: () => void
  onCancelDissolve: () => void
  onToggleGlobTodo: (globId: string) => void
  onToggleGlobDone: (globId: string) => void
  onStartGlobEditing: (globId: string) => void
  onUpdateGlobText: (globId: string, text: string) => void
  onCancelGlobEditing: () => void
  onGlobDragStart: (event: DragEvent<HTMLDivElement>, globId: string) => void
  onGlobDragOver: (event: DragEvent<HTMLDivElement>, globId: string) => void
  onGlobDrop: (event: DragEvent<HTMLDivElement>) => void
  onGlobDragEnd: (event: DragEvent<HTMLDivElement>, glob: Glob) => void
  onOpenGlobContextMenu: (event: MouseEvent<HTMLDivElement>, glob: Glob) => void
  onActivateAdd: () => void
  onAddGlob: (text: string) => void
  onCancelAdd: () => void
}) {
  return (
    <div
      className={className}
      data-cluster-id={cluster.id}
      style={{ left: cluster.x, top: cluster.y, borderColor: cluster.color, ['--cluster-color' as string]: cluster.color, zIndex }}
      onDragOver={onClusterDragOver}
      onDrop={onClusterDrop}
      onContextMenu={onOpenClusterMenu}
      onPointerDown={onClusterPointerDown}
    >
      <div className="cluster-edge-hit top" onPointerDown={onClusterEdgeDragStart} />
      <div className="cluster-edge-hit right" onPointerDown={onClusterEdgeDragStart} />
      <div className="cluster-edge-hit bottom" onPointerDown={onClusterEdgeDragStart} />
      <div className="cluster-edge-hit left" onPointerDown={onClusterEdgeDragStart} />
      <div
        className="cluster-drag-handle"
        onPointerDown={onClusterEdgeDragStart}
        onContextMenu={onOpenClusterMenu}
        title="Drag to move"
      >
        <GripIcon />
      </div>
      <div className="cluster-link-handle" title="Drag to connect" onPointerDown={onConnectStart}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </div>
      <ClusterHeader
        cluster={cluster}
        itemCount={globs.length}
        editing={editingCluster}
        dissolvePending={dissolvePending}
        onOpenMenu={onOpenClusterMenu}
        onStartEditing={onStartClusterEditing}
        onRename={onRenameCluster}
        onCancelEditing={onCancelClusterEditing}
        onToggleCollapse={onToggleCollapse}
        onRequestDissolve={onRequestDissolve}
        onConfirmDissolve={onConfirmDissolve}
        onCancelDissolve={onCancelDissolve}
      />

      {!cluster.collapsed && globs.length === 0 && (
        <div className="cluster-empty">drag globs here</div>
      )}

      {!cluster.collapsed && globs.length > 0 && (
        <div className="cluster-globs">
          {globs.map(glob => (
            <ClusterItemRow
              key={glob.id}
              glob={glob}
              editing={editingGlobId === glob.id}
              dragOver={dragOverGlobId === glob.id}
              highlighted={highlightedId === glob.id}
              selected={selectedIds.has(glob.id)}
              draggable={editingGlobId !== glob.id}
              onToggleTodo={() => onToggleGlobTodo(glob.id)}
              onToggleDone={() => onToggleGlobDone(glob.id)}
              onStartEditing={() => onStartGlobEditing(glob.id)}
              onUpdateText={text => onUpdateGlobText(glob.id, text)}
              onCancelEditing={onCancelGlobEditing}
              onDragStart={event => onGlobDragStart(event, glob.id)}
              onDragOver={event => onGlobDragOver(event, glob.id)}
              onDrop={onGlobDrop}
              onDragEnd={event => onGlobDragEnd(event, glob)}
              onOpenContextMenu={event => onOpenGlobContextMenu(event, glob)}
            />
          ))}
        </div>
      )}

      {cluster.collapsed && (
        <span className="cluster-count">{globs.length === 0 ? 'empty' : `${globs.length} items`}</span>
      )}
      <ClusterAddControl
        active={addingActive}
        onActivate={onActivateAdd}
        onAdd={onAddGlob}
        onCancel={onCancelAdd}
      />
    </div>
  )
}

export function RecolorPopover({
  x,
  y,
  target,
  menuRef,
  onPickColor,
}: {
  x: number
  y: number
  target: RecolorTarget
  menuRef: (element: HTMLDivElement | null) => void
  onPickColor: (color: string, target: RecolorTarget) => void
}) {
  const label =
    target.kind === 'glob' ? 'glob color'
      : target.kind === 'cluster-border' ? 'cluster border'
      : target.kind === 'cluster-items' ? 'all items'
      : `selection (${target.ids.length})`

  return (
    <div
      ref={menuRef}
      className="recolor-popover"
      style={{ left: x, top: y }}
      onClick={e => e.stopPropagation()}
    >
      <div className="recolor-label">{label}</div>
      <div className="recolor-grid">
        {PALETTE.map(color => (
          <button
            key={color}
            className="recolor-swatch"
            style={{ background: color }}
            aria-label={color}
            onClick={() => onPickColor(color, target)}
          />
        ))}
      </div>
    </div>
  )
}

export function ClusterContextMenu({
  x,
  y,
  cluster,
  itemCount,
  allAreTodos,
  menuRef,
  onRename,
  onToggleCollapse,
  onToggleAllTodos,
  onRecolorBorder,
  onRecolorItems,
  onDissolve,
  onDelete,
}: {
  x: number
  y: number
  cluster: Cluster
  itemCount: number
  allAreTodos: boolean
  menuRef: (element: HTMLDivElement | null) => void
  onRename: () => void
  onToggleCollapse: () => void
  onToggleAllTodos: () => void
  onRecolorBorder: () => void
  onRecolorItems: () => void
  onDissolve: () => void
  onDelete: () => void
}) {
  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: x, top: y }}
      onClick={e => e.stopPropagation()}
    >
      <button onClick={onRename}>✏️ Rename</button>
      <button onClick={onToggleCollapse}>{cluster.collapsed ? '＋ Expand' : '－ Collapse'}</button>
      <button disabled={itemCount === 0} onClick={onToggleAllTodos}>
        {allAreTodos ? '☑️ Remove all todos' : '☐ Convert all to todos'}
        <span className="ctx-shortcut">⌃/⌘+Click</span>
      </button>
      <button onClick={onRecolorBorder}>🎨 Recolor border</button>
      <button disabled={itemCount === 0} onClick={onRecolorItems}>🎨 Recolor all items</button>
      <hr />
      <button onClick={onDissolve}>💨 Dissolve (release globs)</button>
      <button className="ctx-danger" onClick={onDelete}>🗑️ Delete</button>
    </div>
  )
}

export function BulkContextMenu({
  x,
  y,
  count,
  allAreTodos,
  menuRef,
  onToggleTodos,
  onRecolor,
  onTransferToNewCluster,
  onDelete,
}: {
  x: number
  y: number
  count: number
  allAreTodos: boolean
  menuRef: (element: HTMLDivElement | null) => void
  onToggleTodos: () => void
  onRecolor: () => void
  onTransferToNewCluster: () => void
  onDelete: () => void
}) {
  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: x, top: y }}
      onClick={e => e.stopPropagation()}
    >
      <div className="ctx-shortcut" style={{ margin: '4px 8px 6px', opacity: 0.6 }}>
        {count} items selected
      </div>
      <hr />
      <button onClick={onToggleTodos}>
        {allAreTodos ? '☑️ Remove all todos' : '☐ Convert all to todos'}
      </button>
      <button onClick={onRecolor}>🎨 Recolor all</button>
      <button onClick={onTransferToNewCluster}>📦 Transfer to new cluster</button>
      <hr />
      <button className="ctx-danger" onClick={onDelete}>🗑️ Delete all</button>
    </div>
  )
}

export function GlobContextMenu({
  x,
  y,
  inCluster,
  isTodo,
  menuRef,
  onEdit,
  onToggleFlag,
  onToggleTodo,
  onDuplicate,
  onRecolor,
  onConvertToCluster,
  onPopOut,
  onDelete,
}: {
  x: number
  y: number
  inCluster: boolean
  isTodo: boolean
  menuRef: (element: HTMLDivElement | null) => void
  onEdit: () => void
  onToggleFlag: () => void
  onToggleTodo: () => void
  onDuplicate: () => void
  onRecolor: () => void
  onConvertToCluster: () => void
  onPopOut: () => void
  onDelete: () => void
}) {
  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: x, top: y }}
      onClick={e => e.stopPropagation()}
    >
      <button onClick={onEdit}>✏️ Edit</button>
      <button onClick={onToggleFlag}>🚩 Flag</button>
      <button onClick={onToggleTodo}>
        {isTodo ? '☑️ Remove todo' : '☐ Make todo'}
        <span className="ctx-shortcut">⌃/⌘+Click</span>
      </button>
      <button onClick={onDuplicate}>📋 Duplicate</button>
      <button onClick={onRecolor}>🎨 Recolor</button>
      {!inCluster && <button onClick={onConvertToCluster}>📦 Convert to cluster</button>}
      {inCluster && <button onClick={onPopOut}>↗️ Pop out</button>}
      <hr />
      <button className="ctx-danger" onClick={onDelete}>🗑️ Delete</button>
    </div>
  )
}

export function TrashZone({ visible }: { visible: boolean }) {
  return (
    <div className={`trash-zone ${visible ? 'visible' : ''}`}>
      <span className="trash-icon">🗑️</span>
    </div>
  )
}

export function TrashConfirmToast({
  label,
  confirmLabel,
  onConfirm,
  onCancel,
  secondary,
}: {
  label: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  secondary?: {
    label: string
    onClick: () => void
  }
}) {
  return (
    <div className="trash-toast" onClick={e => e.stopPropagation()}>
      <span className="trash-toast-label">{label}</span>
      <button className="trash-toast-btn" onClick={onConfirm}>{confirmLabel}</button>
      {secondary && (
        <button
          className="trash-toast-btn"
          style={{ background: 'rgba(139, 92, 246, 0.15)', borderColor: 'rgba(139, 92, 246, 0.4)', color: '#a78bfa' }}
          onClick={secondary.onClick}
        >
          {secondary.label}
        </button>
      )}
      <button className="trash-toast-cancel" onClick={onCancel}>cancel</button>
    </div>
  )
}

export function ShakeDissolveModal({
  globCount,
  onConfirm,
  onCancel,
}: {
  globCount: number
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="shake-modal-overlay" onClick={e => { e.stopPropagation(); onCancel() }}>
      <div className="shake-modal" onClick={e => e.stopPropagation()}>
        <p>release {globCount === 1 ? 'glob' : 'all globs'}?</p>
        <div className="shake-modal-actions">
          <button className="shake-modal-yes" onClick={onConfirm}>yes, release</button>
          <button className="shake-modal-no" onClick={onCancel}>no, keep</button>
        </div>
      </div>
    </div>
  )
}

export function LastGlobPromptModal({
  onDestroy,
  onKeepEmpty,
  onCancel,
}: {
  onDestroy: () => void
  onKeepEmpty: () => void
  onCancel: () => void
}) {
  return (
    <div className="shake-modal-overlay" onClick={e => { e.stopPropagation(); onCancel() }}>
      <div className="shake-modal" onClick={e => e.stopPropagation()}>
        <p>destroy cluster?</p>
        <p className="merge-subtitle">or keep it empty for new globs</p>
        <div className="shake-modal-actions">
          <button className="shake-modal-yes" onClick={onDestroy}>destroy</button>
          <button className="shake-modal-no" onClick={onKeepEmpty}>keep empty</button>
        </div>
      </div>
    </div>
  )
}

export function MergePromptModal({
  firstName,
  secondName,
  onMerge,
  onCancel,
}: {
  firstName: string
  secondName: string
  onMerge: (name: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const defaultName = `${firstName} + ${secondName}`
  const submit = () => {
    const name = inputRef.current?.value.trim()
    if (name) onMerge(name)
  }

  return (
    <div className="shake-modal-overlay" onClick={e => { e.stopPropagation(); onCancel() }}>
      <div className="shake-modal" onClick={e => e.stopPropagation()}>
        <p>merge "{firstName}" + "{secondName}"</p>
        <p className="merge-subtitle">name the merged cluster:</p>
        <input
          ref={inputRef}
          className="merge-name-input"
          autoFocus
          defaultValue={defaultName}
          onFocus={e => e.currentTarget.select()}
          onKeyDown={e => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onCancel()
          }}
        />
        <div className="shake-modal-actions" style={{ marginTop: 12 }}>
          <button
            className="shake-modal-yes"
            style={{ background: 'rgba(108,92,231,0.15)', borderColor: 'rgba(108,92,231,0.3)', color: '#a78bfa' }}
            onClick={submit}
          >
            merge
          </button>
          <button className="shake-modal-no" onClick={onCancel}>cancel</button>
        </div>
      </div>
    </div>
  )
}

export function ClearConfirmModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="shake-modal-overlay" onClick={e => { e.stopPropagation(); onCancel() }}>
      <div className="shake-modal" onClick={e => e.stopPropagation()}>
        <p>clear everything?</p>
        <p className="merge-subtitle">deletes all globs, clusters, and connections. undo with Ctrl+Z.</p>
        <div className="shake-modal-actions">
          <button className="shake-modal-yes" onClick={onConfirm}>yes, nuke it</button>
          <button className="shake-modal-no" onClick={onCancel}>cancel</button>
        </div>
      </div>
    </div>
  )
}

export function HelpPanel({
  open,
  onToggle,
  onClose,
  onExportJSON,
  onImportJSON,
  onRescueClusters,
  onGatherFreeGlobs,
  onRequestClear,
}: {
  open: boolean
  onToggle: () => void
  onClose: () => void
  onExportJSON: () => void
  onImportJSON: (file: File) => void
  onRescueClusters: () => void
  onGatherFreeGlobs: () => void
  onRequestClear: () => void
}) {
  return (
    <div
      className={`help-trigger ${open ? 'open' : ''}`}
      onClick={e => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <span className="help-icon">?</span>
      {open && (
        <div className="help-panel" onClick={e => e.stopPropagation()}>
          <div className="help-title">tips & shortcuts</div>
          <div className="help-items">
            <div className="help-item"><kbd>Enter</kbd> in capture bar to launch a glob</div>
            <div className="help-item"><span className="help-action">Right-click</span> empty space to create a glob</div>
            <div className="help-item"><span className="help-action">Drag</span> a glob onto another to create a cluster</div>
            <div className="help-item"><span className="help-action">Drag</span> a glob onto a cluster to add it</div>
            <div className="help-item"><span className="help-action">Double-click</span> a glob to edit its text</div>
            <div className="help-item"><span className="help-action">Right-click</span> a glob for more options</div>
            <div className="help-item"><span className="help-action">Click</span> a cluster title to rename it</div>
            <div className="help-item"><span className="help-action">Drag</span> a cluster border, or the <span className="help-mono">&#x2807;</span> handle, to move it</div>
            <div className="help-item"><span className="help-action">Click</span> the grid icon to organize clusters</div>
            <div className="help-item"><span className="help-action">Drag</span> the chain icon to connect clusters</div>
            <div className="help-item"><span className="help-action">Hover</span> a connection line to merge or disconnect</div>
            <div className="help-item"><kbd>Alt</kbd>+drag a cluster to sever all connections</div>
            <div className="help-item"><span className="help-action">Shake</span> a cluster to dissolve it</div>
            <div className="help-item"><span className="help-action">Drag</span> a glob or cluster to the trash (bottom-right)</div>
            <div className="help-item"><span className="help-action">Hold</span> a cluster over another (~0.75s) until it glows, then release to merge (you'll be asked for a new name)</div>
            <div className="help-item"><kbd>Ctrl</kbd>+<kbd>Z</kbd> to undo, <kbd>Ctrl</kbd>+<kbd>Y</kbd> to redo</div>
            <div className="help-item"><kbd>Ctrl</kbd>+<kbd>K</kbd> to search, <kbd>Esc</kbd> to close menus</div>
          </div>

          <div className="help-divider" />
          <div className="help-title">backup</div>
          <div className="help-actions">
            <button
              className="help-action-btn"
              onClick={() => { onExportJSON(); onClose() }}
              title="Download your galaxy as JSON"
            >
              export JSON
            </button>
            <label className="help-action-btn" title="Restore from a previously exported JSON">
              import JSON
              <input
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onClick={e => e.stopPropagation()}
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) onImportJSON(f)
                  e.target.value = ''
                  onClose()
                }}
              />
            </label>
          </div>

          <div className="help-divider" />
          <div className="help-title help-title--danger">recovery</div>
          <div className="help-actions">
            <button
              className="help-action-btn"
              onClick={() => {
                onRescueClusters()
                onClose()
              }}
              title="Pull every cluster fully back onto the screen"
            >
              <svg className="help-action-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 3H5a2 2 0 0 0-2 2v4" />
                <path d="M15 3h4a2 2 0 0 1 2 2v4" />
                <path d="M21 15v4a2 2 0 0 1-2 2h-4" />
                <path d="M3 15v4a2 2 0 0 0 2 2h4" />
                <circle cx="12" cy="12" r="2.5" />
              </svg>
              rescue clusters
            </button>
            <button
              className="help-action-btn"
              onClick={() => { onGatherFreeGlobs(); onClose() }}
              title="Scoop every free-floating glob into an orphans cluster"
            >
              gather free globs
            </button>
            <button
              className="help-action-btn help-action-btn--danger"
              onClick={onRequestClear}
              title="Delete everything â€” globs, clusters, connections"
            >
              clear everything
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function GalaxyOverlays({
  globs,
  clusters,
  contextMenu,
  clusterCtx,
  bulkCtx,
  selectedIds,
  recolorPopover,
  newGlobPos,
  draggingFreeGlob,
  draggingClusterId,
  trashConfirm,
  clusterTrashConfirm,
  shakeDissolve,
  lastGlobPrompt,
  mergePrompt,
  helpOpen,
  helpPinned,
  searchOpen,
  searchQ,
  searchResults,
  searchInputRef,
  clearConfirm,
  onSetContextMenu,
  onSetClusterCtx,
  onSetBulkCtx,
  onSetRecolorPopover,
  onSetNewGlobPos,
  onSetTrashConfirm,
  onSetClusterTrashConfirm,
  onSetShakeDissolve,
  onSetLastGlobPrompt,
  onSetMergePrompt,
  onSetHelpOpen,
  onSetHelpPinned,
  onSetSearchOpen,
  onSetSearchQ,
  onSetClearConfirm,
  onSetEditingId,
  onSetEditingClusterId,
  onSetSelectedIds,
  onToggleFlag,
  onToggleTodo,
  onToggleAllTodosInCluster,
  onToggleAllTodosInGlobs,
  onToggleClusterCollapse,
  onDuplicate,
  onRecolor,
  onRecolorCluster,
  onRecolorAllInCluster,
  onRecolorGlobs,
  onConvertToCluster,
  onRemoveFromCluster,
  onUpdatePos,
  onDelete,
  onDeleteGlobs,
  onDeleteCluster,
  onDissolveCluster,
  onTransferToNewCluster,
  onAddGlobAt,
  onMergeClusters,
  onClearAll,
  onExportJSON,
  onImportJSON,
  onRescueClusters,
  onGatherFreeGlobs,
  onJumpToSearchResult,
}: {
  globs: Glob[]
  clusters: Cluster[]
  contextMenu: { x: number; y: number; globId: string; inCluster: boolean } | null
  clusterCtx: { x: number; y: number; clusterId: string } | null
  bulkCtx: { x: number; y: number } | null
  selectedIds: Set<string>
  recolorPopover: { x: number; y: number; target: RecolorTarget } | null
  newGlobPos: { x: number; y: number } | null
  draggingFreeGlob: boolean
  draggingClusterId: string | null
  trashConfirm: string | null
  clusterTrashConfirm: string | null
  shakeDissolve: string | null
  lastGlobPrompt: { globId: string; clusterId: string; x: number; y: number } | null
  mergePrompt: { c1Id: string; c2Id: string; connectionId: string } | null
  helpOpen: boolean
  helpPinned: boolean
  searchOpen: boolean
  searchQ: string
  searchResults: SearchResult[]
  searchInputRef: RefObject<HTMLInputElement | null>
  clearConfirm: boolean
  onSetContextMenu: (value: { x: number; y: number; globId: string; inCluster: boolean } | null) => void
  onSetClusterCtx: (value: { x: number; y: number; clusterId: string } | null) => void
  onSetBulkCtx: (value: { x: number; y: number } | null) => void
  onSetRecolorPopover: (value: { x: number; y: number; target: RecolorTarget } | null) => void
  onSetNewGlobPos: (value: { x: number; y: number } | null) => void
  onSetTrashConfirm: (value: string | null) => void
  onSetClusterTrashConfirm: (value: string | null) => void
  onSetShakeDissolve: (value: string | null) => void
  onSetLastGlobPrompt: (value: { globId: string; clusterId: string; x: number; y: number } | null) => void
  onSetMergePrompt: (value: { c1Id: string; c2Id: string; connectionId: string } | null) => void
  onSetHelpOpen: (value: boolean) => void
  onSetHelpPinned: (value: boolean) => void
  onSetSearchOpen: (value: boolean) => void
  onSetSearchQ: (value: string) => void
  onSetClearConfirm: (value: boolean) => void
  onSetEditingId: (value: string | null) => void
  onSetEditingClusterId: (value: string | null) => void
  onSetSelectedIds: (value: Set<string>) => void
  onToggleFlag: (id: string) => void
  onToggleTodo: (id: string) => void
  onToggleAllTodosInCluster: (clusterId: string) => void
  onToggleAllTodosInGlobs: (ids: string[]) => void
  onToggleClusterCollapse: (clusterId: string) => void
  onDuplicate: (id: string) => void
  onRecolor: (id: string, color?: string) => void
  onRecolorCluster: (id: string, color: string) => void
  onRecolorAllInCluster: (clusterId: string, color: string) => void
  onRecolorGlobs: (ids: string[], color: string) => void
  onConvertToCluster: (id: string) => void
  onRemoveFromCluster: (id: string) => void
  onUpdatePos: (id: string, x: number, y: number) => void
  onDelete: (id: string) => void
  onDeleteGlobs: (ids: string[]) => void
  onDeleteCluster: (id: string) => void
  onDissolveCluster: (id: string) => void
  onTransferToNewCluster: (ids: string[], name?: string) => void
  onAddGlobAt: (text: string, x: number, y: number) => void
  onMergeClusters: (c1Id: string, c2Id: string, newName: string) => void
  onClearAll: () => void
  onExportJSON: () => void
  onImportJSON: (file: File) => void
  onRescueClusters: () => void
  onGatherFreeGlobs: () => void
  onJumpToSearchResult: (result: SearchResult) => void
}) {
  const closeHelp = () => {
    onSetHelpOpen(false)
    onSetHelpPinned(false)
  }

  return (
    <>
      {clusterCtx && (() => {
        const cluster = clusters.find(c => c.id === clusterCtx.clusterId)
        if (!cluster) return null
        const clusterItems = globs.filter(g => g.clusterId === cluster.id)
        const allAreTodos = clusterItems.length > 0 && clusterItems.every(g => g.isTodo)
        return (
          <ClusterContextMenu
            x={clusterCtx.x}
            y={clusterCtx.y}
            cluster={cluster}
            itemCount={clusterItems.length}
            allAreTodos={allAreTodos}
            menuRef={clampMenuToViewport}
            onRename={() => { onSetEditingClusterId(cluster.id); onSetClusterCtx(null) }}
            onToggleCollapse={() => { onToggleClusterCollapse(cluster.id); onSetClusterCtx(null) }}
            onToggleAllTodos={() => { onToggleAllTodosInCluster(cluster.id); onSetClusterCtx(null) }}
            onRecolorBorder={() => {
              onSetRecolorPopover({ x: clusterCtx.x, y: clusterCtx.y, target: { kind: 'cluster-border', id: cluster.id } })
              onSetClusterCtx(null)
            }}
            onRecolorItems={() => {
              onSetRecolorPopover({ x: clusterCtx.x, y: clusterCtx.y, target: { kind: 'cluster-items', id: cluster.id } })
              onSetClusterCtx(null)
            }}
            onDissolve={() => { onDissolveCluster(cluster.id); onSetClusterCtx(null) }}
            onDelete={() => { onSetClusterTrashConfirm(cluster.id); onSetClusterCtx(null) }}
          />
        )
      })()}

      {bulkCtx && (() => {
        const ids = Array.from(selectedIds)
        const selectedGlobs = globs.filter(g => selectedIds.has(g.id))
        const allAreTodos = selectedGlobs.length > 0 && selectedGlobs.every(g => g.isTodo)
        return (
          <BulkContextMenu
            x={bulkCtx.x}
            y={bulkCtx.y}
            count={ids.length}
            allAreTodos={allAreTodos}
            menuRef={clampMenuToViewport}
            onToggleTodos={() => { onToggleAllTodosInGlobs(ids); onSetBulkCtx(null) }}
            onRecolor={() => {
              onSetRecolorPopover({ x: bulkCtx.x, y: bulkCtx.y, target: { kind: 'bulk', ids } })
              onSetBulkCtx(null)
            }}
            onTransferToNewCluster={() => {
              onTransferToNewCluster(ids)
              onSetBulkCtx(null)
              onSetSelectedIds(new Set())
            }}
            onDelete={() => {
              onDeleteGlobs(ids)
              onSetBulkCtx(null)
              onSetSelectedIds(new Set())
            }}
          />
        )
      })()}

      {recolorPopover && (
        <RecolorPopover
          x={recolorPopover.x}
          y={recolorPopover.y}
          target={recolorPopover.target}
          menuRef={clampMenuToViewport}
          onPickColor={(color, target) => {
            if (target.kind === 'glob') onRecolor(target.id, color)
            else if (target.kind === 'cluster-border') onRecolorCluster(target.id, color)
            else if (target.kind === 'cluster-items') onRecolorAllInCluster(target.id, color)
            else onRecolorGlobs(target.ids, color)
            onSetRecolorPopover(null)
          }}
        />
      )}

      {contextMenu && (() => {
        const glob = globs.find(g => g.id === contextMenu.globId)
        return (
          <GlobContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            inCluster={contextMenu.inCluster}
            isTodo={!!glob?.isTodo}
            menuRef={clampMenuToViewport}
            onEdit={() => { onSetEditingId(contextMenu.globId); onSetContextMenu(null) }}
            onToggleFlag={() => { onToggleFlag(contextMenu.globId); onSetContextMenu(null) }}
            onToggleTodo={() => { onToggleTodo(contextMenu.globId); onSetContextMenu(null) }}
            onDuplicate={() => { onDuplicate(contextMenu.globId); onSetContextMenu(null) }}
            onRecolor={() => {
              onSetRecolorPopover({ x: contextMenu.x, y: contextMenu.y, target: { kind: 'glob', id: contextMenu.globId } })
              onSetContextMenu(null)
            }}
            onConvertToCluster={() => {
              onConvertToCluster(contextMenu.globId)
              onSetContextMenu(null)
            }}
            onPopOut={() => {
              const menuGlob = globs.find(g => g.id === contextMenu.globId)
              if (menuGlob?.clusterId) {
                const cluster = clusters.find(c => c.id === menuGlob.clusterId)
                if (cluster && cluster.globIds.length === 1) {
                  onSetLastGlobPrompt({ globId: menuGlob.id, clusterId: cluster.id, x: menuGlob.x, y: menuGlob.y })
                  onSetContextMenu(null)
                  return
                }
              }
              onRemoveFromCluster(contextMenu.globId)
              onSetContextMenu(null)
            }}
            onDelete={() => { onDelete(contextMenu.globId); onSetContextMenu(null) }}
          />
        )
      })()}

      {newGlobPos && (
        <NewGlobInput
          x={newGlobPos.x}
          y={newGlobPos.y}
          onAdd={text => onAddGlobAt(text, newGlobPos.x, newGlobPos.y)}
          onCancel={() => onSetNewGlobPos(null)}
        />
      )}

      <TrashZone visible={draggingFreeGlob || !!draggingClusterId} />

      {trashConfirm && (
        <TrashConfirmToast
          label="delete?"
          confirmLabel="delete"
          onConfirm={() => { onDelete(trashConfirm); onSetTrashConfirm(null) }}
          onCancel={() => onSetTrashConfirm(null)}
        />
      )}

      {clusterTrashConfirm && (() => {
        const cluster = clusters.find(c => c.id === clusterTrashConfirm)
        if (!cluster) return null
        const globCount = cluster.globIds.length
        return (
          <TrashConfirmToast
            label={`delete cluster "${cluster.name}"${globCount > 0 ? ` and ${globCount} glob${globCount > 1 ? 's' : ''}` : ''}?`}
            confirmLabel="delete all"
            onConfirm={() => {
              cluster.globIds.forEach(gid => onDelete(gid))
              onDeleteCluster(clusterTrashConfirm)
              onSetClusterTrashConfirm(null)
            }}
            onCancel={() => onSetClusterTrashConfirm(null)}
            secondary={globCount > 0 ? {
              label: 'release globs',
              onClick: () => {
                onDissolveCluster(clusterTrashConfirm)
                onSetClusterTrashConfirm(null)
              },
            } : undefined}
          />
        )
      })()}

      {shakeDissolve && (() => {
        const shakeCluster = clusters.find(c => c.id === shakeDissolve)
        const globCount = shakeCluster?.globIds.length ?? 0
        return (
          <ShakeDissolveModal
            globCount={globCount}
            onCancel={() => onSetShakeDissolve(null)}
            onConfirm={() => {
              onSetShakeDissolve(null)
              if (shakeCluster && globCount === 1) {
                onSetLastGlobPrompt({
                  globId: shakeCluster.globIds[0],
                  clusterId: shakeDissolve,
                  x: shakeCluster.x,
                  y: shakeCluster.y,
                })
              } else {
                onDissolveCluster(shakeDissolve)
              }
            }}
          />
        )
      })()}

      {lastGlobPrompt && (
        <LastGlobPromptModal
          onCancel={() => onSetLastGlobPrompt(null)}
          onDestroy={() => {
            onRemoveFromCluster(lastGlobPrompt.globId)
            onUpdatePos(lastGlobPrompt.globId, lastGlobPrompt.x, lastGlobPrompt.y)
            onDeleteCluster(lastGlobPrompt.clusterId)
            onSetLastGlobPrompt(null)
          }}
          onKeepEmpty={() => {
            onRemoveFromCluster(lastGlobPrompt.globId)
            onUpdatePos(lastGlobPrompt.globId, lastGlobPrompt.x, lastGlobPrompt.y)
            onSetLastGlobPrompt(null)
          }}
        />
      )}

      {mergePrompt && (() => {
        const c1 = clusters.find(c => c.id === mergePrompt.c1Id)
        const c2 = clusters.find(c => c.id === mergePrompt.c2Id)
        if (!c1 || !c2) return null
        return (
          <MergePromptModal
            firstName={c1.name}
            secondName={c2.name}
            onCancel={() => onSetMergePrompt(null)}
            onMerge={name => {
              onMergeClusters(mergePrompt.c1Id, mergePrompt.c2Id, name)
              onSetMergePrompt(null)
            }}
          />
        )
      })()}

      <HelpPanel
        open={helpOpen}
        onToggle={() => {
          if (helpPinned) {
            onSetHelpPinned(false)
            onSetHelpOpen(false)
          } else {
            onSetHelpPinned(true)
            onSetHelpOpen(true)
          }
        }}
        onClose={closeHelp}
        onExportJSON={onExportJSON}
        onImportJSON={onImportJSON}
        onRescueClusters={onRescueClusters}
        onGatherFreeGlobs={onGatherFreeGlobs}
        onRequestClear={() => onSetClearConfirm(true)}
      />

      {searchOpen && (
        <SearchModal
          inputRef={searchInputRef}
          query={searchQ}
          results={searchResults}
          onQueryChange={onSetSearchQ}
          onJump={onJumpToSearchResult}
          onClose={() => { onSetSearchOpen(false); onSetSearchQ('') }}
        />
      )}

      {clearConfirm && (
        <ClearConfirmModal
          onCancel={() => onSetClearConfirm(false)}
          onConfirm={() => {
            onClearAll()
            onSetClearConfirm(false)
            closeHelp()
          }}
        />
      )}
    </>
  )
}
