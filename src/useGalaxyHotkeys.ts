import { useEffect } from 'react'

function isTypingTarget(active: HTMLElement | null) {
  return !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
}

export function useGalaxyHotkeys({
  onClose,
  onClearConfirm,
  onShakeDissolve,
  onLastGlobPrompt,
  onMergePrompt,
  onTrashConfirm,
  onClusterTrashConfirm,
  onNewGlobPos,
  onToggleSearch,
  onCloseSearch,
  onClearFocusedCluster,
  onPointerMode,
  onSelectionMode,
}: {
  onClose: () => void
  onClearConfirm: (value: boolean) => void
  onShakeDissolve: (value: string | null) => void
  onLastGlobPrompt: (value: { globId: string; clusterId: string; x: number; y: number } | null) => void
  onMergePrompt: (value: { c1Id: string; c2Id: string; connectionId: string } | null) => void
  onTrashConfirm: (value: string | null) => void
  onClusterTrashConfirm: (value: string | null) => void
  onNewGlobPos: (value: { x: number; y: number } | null) => void
  onToggleSearch: () => void
  onCloseSearch: () => void
  onClearFocusedCluster: () => void
  onPointerMode: () => void
  onSelectionMode: () => void
}) {
  useEffect(() => {
    const onEsc = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return

      const active = document.activeElement as HTMLElement | null
      if (isTypingTarget(active)) active?.blur()

      onClose()
      onClearConfirm(false)
      onShakeDissolve(null)
      onLastGlobPrompt(null)
      onMergePrompt(null)
      onTrashConfirm(null)
      onClusterTrashConfirm(null)
      onNewGlobPos(null)
      onCloseSearch()
      onClearFocusedCluster()
      onPointerMode()
    }

    const onSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onToggleSearch()
      }
    }

    const onModeKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const active = document.activeElement as HTMLElement | null
      if (isTypingTarget(active)) return

      const key = event.key.toLowerCase()
      if (key === 'm') onSelectionMode()
      else if (key === 'v') onPointerMode()
    }

    window.addEventListener('keydown', onEsc)
    window.addEventListener('keydown', onSearch)
    window.addEventListener('keydown', onModeKey)
    return () => {
      window.removeEventListener('keydown', onEsc)
      window.removeEventListener('keydown', onSearch)
      window.removeEventListener('keydown', onModeKey)
    }
  }, [
    onClearConfirm,
    onClearFocusedCluster,
    onClose,
    onCloseSearch,
    onClusterTrashConfirm,
    onLastGlobPrompt,
    onMergePrompt,
    onNewGlobPos,
    onPointerMode,
    onSelectionMode,
    onShakeDissolve,
    onToggleSearch,
    onTrashConfirm,
  ])
}
