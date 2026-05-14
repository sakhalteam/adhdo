import type { KeyboardEvent, MouseEvent, RefObject } from 'react'
import type { Cluster } from './types'
import { PALETTE } from './store'

export type RecolorTarget =
  | { kind: 'glob'; id: string }
  | { kind: 'cluster-border'; id: string }
  | { kind: 'cluster-items'; id: string }
  | { kind: 'bulk'; ids: string[] }

export type SearchResult = {
  type: 'glob' | 'cluster'
  id: string
  label: string
  sub?: string
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
