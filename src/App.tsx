import { useState, useEffect, useRef, useCallback } from 'react'
import { loadLocal, saveLocal, saveRemote, loadRemote, getLocalUpdatedAt, touchLocal, isNewer, isDirty, setDirty, isEmptyState, mergeStates, hasSeenOnboarding, markOnboardingSeen, stateSignature, makeGlob, makeCluster, makeConnection, genId, randomColor } from './store'
import type { RemoteState } from './store'
import { supabase } from './supabaseClient'
import type { GalaxyState, Glob, Cluster } from './types'
import type { User } from '@supabase/supabase-js'
import Galaxy from './Galaxy'
import MobileApp from './MobileApp'
import { useIsMobile } from './useIsMobile'
import { AuthButton, CaptureBar, CloudIndicator, HomeButton, SaveIndicator, UndoRedoBar, VoiceOverlay } from './AppChrome'
import { useVoiceCapture } from './useVoiceCapture'

const MAX_UNDO = 40
const REMOTE_SAVE_DELAY = 5000 // 5s debounce for cloud saves

export default function App() {
  const [state, setStateRaw] = useState<GalaxyState>(loadLocal)
  const inputRef = useRef<HTMLInputElement>(null)
  // Seeded with the signature of what we just loaded, NOT ''. Otherwise the
  // autosave interval sees a "change" two seconds after boot and stamps
  // updated-at on a device that hasn't been touched — which is enough to make a
  // brand-new install look like the freshest writer and refuse to pull.
  const lastSavedRef = useRef<string>(stateSignature(state))
  const [showSaved, setShowSaved] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [cloudStatus, setCloudStatus] = useState<'idle' | 'saving' | 'saved' | 'merged' | 'pulled' | 'error'>('idle')

  // Always-current state for callbacks that fire outside React's render cycle
  // (sync timers, focus/online listeners).
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])
  const [seenOnboarding, setSeenOnboarding] = useState<boolean>(hasSeenOnboarding)
  const remoteSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const needsRemoteSave = useRef(false)
  const isMobile = useIsMobile()
  const isGalaxyEmpty = state.globs.length === 0 && state.clusters.length === 0 && state.connections.length === 0
  const onboardingActive = isGalaxyEmpty && !seenOnboarding

  // Auth state
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const login = useCallback(() => {
    supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: window.location.origin + window.location.pathname },
    })
  }, [])

  const logout = useCallback(() => {
    supabase.auth.signOut()
    setUser(null)
  }, [])

  const flash = useCallback((status: typeof cloudStatus) => {
    setCloudStatus(status)
    setTimeout(() => setCloudStatus('idle'), 1800)
  }, [])

  /** Take the cloud copy as this device's truth. */
  const adoptRemote = useCallback((remote: RemoteState) => {
    setStateRaw(remote.state)
    saveLocal(remote.state)
    lastSavedRef.current = stateSignature(remote.state)
    // Inherit the cloud's stamp rather than claiming we edited just now.
    touchLocal(remote.updatedAt)
    needsRemoteSave.current = false
    setDirty(false)
  }, [])

  /**
   * Does the cloud copy win? Normally that's just "is it newer", but the first
   * time a device ever sees the cloud row its local stamp isn't trustworthy — a
   * fresh install stamps one the moment it boots. An untouched device therefore
   * yields to the cloud; one holding real captures still defends them.
   */
  const cloudWins = useCallback((remote: RemoteState, local: GalaxyState) => {
    if (remote.firstSight && isEmptyState(local)) return true
    return isNewer(remote.updatedAt, getLocalUpdatedAt())
  }, [])

  /**
   * Push the galaxy to the cloud, reconciling if the cloud moved ahead.
   *
   * Every outcome lands in the dirty flag, which is what makes a failed save
   * recoverable after a reload instead of forgotten.
   */
  const push = useCallback(async (s: GalaxyState, force = false) => {
    setCloudStatus('saving')
    const result = await saveRemote(supabase, s, { force })

    if (result === 'stale') {
      // The cloud holds a version this device never read. Both copies may hold
      // real thoughts, so union them instead of picking a winner.
      const remote = await loadRemote(supabase)
      if (!remote) { flash('error'); return }
      // An untouched device has nothing worth merging; just take the cloud copy.
      if (isEmptyState(stateRef.current)) {
        adoptRemote(remote)
        flash('pulled')
        return
      }
      const merged = mergeStates(stateRef.current, remote.state)
      setStateRaw(merged)
      saveLocal(merged)
      lastSavedRef.current = stateSignature(merged)
      // Force past the compare-and-swap: we've just read the cloud's version and
      // folded it in, so the merged copy is strictly the most complete one.
      const after = await saveRemote(supabase, merged, { force: true })
      const ok = after === 'saved'
      needsRemoteSave.current = !ok
      setDirty(!ok)
      flash(ok ? 'merged' : 'error')
      return
    }

    const ok = result === 'saved'
    needsRemoteSave.current = !ok
    setDirty(!ok)
    flash(ok ? 'saved' : 'error')
  }, [adoptRemote, flash])

  // Debounced remote save
  const scheduleRemoteSave = useCallback((s: GalaxyState) => {
    needsRemoteSave.current = true
    setDirty(true)
    clearTimeout(remoteSaveTimer.current)
    remoteSaveTimer.current = setTimeout(() => {
      if (!needsRemoteSave.current) return
      void push(s)
    }, REMOTE_SAVE_DELAY)
  }, [push])

  /**
   * Reconcile with the cloud. One entry point on purpose: the direction is
   * decided by whether we're holding unsynced captures, so a pull and a push can
   * never race and undo one another.
   */
  const sync = useCallback(async () => {
    if (!navigator.onLine) return
    if (isDirty()) {
      clearTimeout(remoteSaveTimer.current)
      needsRemoteSave.current = true
      await push(stateRef.current)
      return
    }
    const remote = await loadRemote(supabase)
    if (remote && cloudWins(remote, stateRef.current)) {
      adoptRemote(remote)
      flash('pulled')
    }
  }, [adoptRemote, cloudWins, flash, push])

  /**
   * Sync on sign-in, when the tab comes back to the foreground, and the moment
   * the network returns. That last one is what rescues thoughts captured on a
   * pass with no bars: without it a failed save waits for the next edit.
   */
  useEffect(() => {
    if (!user) return
    const run = () => {
      if (document.visibilityState === 'hidden') return
      void sync()
    }
    run()
    window.addEventListener('focus', run)
    window.addEventListener('online', run)
    document.addEventListener('visibilitychange', run)
    return () => {
      window.removeEventListener('focus', run)
      window.removeEventListener('online', run)
      document.removeEventListener('visibilitychange', run)
    }
  }, [user, sync])

  // Undo/redo stacks
  const undoStack = useRef<GalaxyState[]>([])
  const redoStack = useRef<GalaxyState[]>([])
  const [undoLen, setUndoLen] = useState(0)
  const [redoLen, setRedoLen] = useState(0)

  // Tracked setState — snapshots before applying (for user actions)
  // Also triggers remote save
  const setState = useCallback((updater: GalaxyState | ((prev: GalaxyState) => GalaxyState)) => {
    setStateRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (next === prev) return prev
      undoStack.current.push(prev)
      if (undoStack.current.length > MAX_UNDO) undoStack.current.shift()
      redoStack.current = []
      setUndoLen(undoStack.current.length)
      setRedoLen(0)
      if (user) scheduleRemoteSave(next)
      return next
    })
  }, [user, scheduleRemoteSave])

  const undo = useCallback(() => {
    setStateRaw(prev => {
      const snapshot = undoStack.current.pop()
      if (!snapshot) return prev
      redoStack.current.push(prev)
      setUndoLen(undoStack.current.length)
      setRedoLen(redoStack.current.length)
      return snapshot
    })
  }, [])

  const redo = useCallback(() => {
    setStateRaw(prev => {
      const snapshot = redoStack.current.pop()
      if (!snapshot) return prev
      undoStack.current.push(prev)
      setUndoLen(undoStack.current.length)
      setRedoLen(redoStack.current.length)
      return snapshot
    })
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  /**
   * Auto-save locally: every 2s, write if anything *meaningful* changed.
   *
   * Reads through stateRef with an empty dep array, and that is the whole point.
   * Depending on `state` here meant the effect tore down and re-armed the
   * interval on every state change — and the galaxy's physics loop pushes a new
   * state object every animation frame, so the timer was reset ~60 times a
   * second and **never once reached two seconds**. Local autosave silently did
   * nothing on desktop; only the beforeunload handler was saving, so anything
   * that ended the page without it (a crash, a killed tab) lost the session.
   *
   * stateSignature is what keeps the write cheap: it ignores x/y/velocity, so
   * perpetual drift doesn't count as a change worth persisting.
   */
  useEffect(() => {
    const interval = setInterval(() => {
      const current = stateRef.current
      const sig = stateSignature(current)
      if (sig === lastSavedRef.current) return
      saveLocal(current)
      lastSavedRef.current = sig
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 1200)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  // Also save on beforeunload. Same reasoning for the ref: re-registering this
  // listener every frame is pure waste.
  useEffect(() => {
    const onUnload = () => saveLocal(stateRef.current)
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  // Focus input on load
  useEffect(() => { inputRef.current?.focus() }, [])

  const refocusInput = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('.cluster, .glob, .ctx-menu, .trash-toast, .shake-modal, .help-trigger, .search-modal, .new-glob-input, .onboarding-panel, .cluster-tools, .cluster-browser')) {
      return
    }
    inputRef.current?.focus()
  }, [])

  const finishOnboarding = useCallback(() => {
    setSeenOnboarding(prev => {
      if (prev) return prev
      markOnboardingSeen()
      return true
    })
  }, [])

  // ── Tracked actions (create undo snapshots) ──────────

  useEffect(() => {
    if (!seenOnboarding && !isGalaxyEmpty) finishOnboarding()
  }, [finishOnboarding, isGalaxyEmpty, seenOnboarding])

  const addGlob = useCallback((text: string) => {
    if (!text.trim()) return
    if (onboardingActive) finishOnboarding()
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    setState(prev => ({
      ...prev,
      globs: [...prev.globs, makeGlob(text.trim(), cx, cy)],
    }))
  }, [finishOnboarding, onboardingActive, setState])

  const addGlobAt = useCallback((text: string, x: number, y: number) => {
    if (!text.trim()) return
    if (onboardingActive) finishOnboarding()
    setState(prev => ({
      ...prev,
      globs: [...prev.globs, makeGlob(text.trim(), x, y)],
    }))
  }, [finishOnboarding, onboardingActive, setState])

  const deleteGlob = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.filter(g => g.id !== id),
      clusters: prev.clusters.map(c => ({
        ...c,
        globIds: c.globIds.filter(gid => gid !== id),
      })).filter(c => c.globIds.length > 0),
    }))
  }, [setState])

  const updateGlobText = useCallback((id: string, text: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, text, radius: Math.min(28 + text.length * 1.5, 60) } : g),
    }))
  }, [setState])

  const toggleFlag = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, flagged: !g.flagged } : g),
    }))
  }, [setState])

  const toggleTodo = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, isTodo: !g.isTodo, done: false } : g),
    }))
  }, [setState])

  // Set-all semantics: if any item in the cluster isn't a todo, mark all as todos.
  // If every item is already a todo, flip all back to non-todo. Predictable two-state behavior.
  const toggleAllTodosInCluster = useCallback((clusterId: string) => {
    setState(prev => {
      const cluster = prev.clusters.find(c => c.id === clusterId)
      if (!cluster) return prev
      const items = prev.globs.filter(g => g.clusterId === clusterId)
      if (items.length === 0) return prev
      const allAreTodos = items.every(g => g.isTodo)
      const nextIsTodo = !allAreTodos
      return {
        ...prev,
        globs: prev.globs.map(g =>
          g.clusterId === clusterId ? { ...g, isTodo: nextIsTodo, done: false } : g
        ),
        clusters: prev.clusters.map(c =>
          c.id === clusterId ? { ...c, lastInteraction: Date.now() } : c
        ),
      }
    })
  }, [setState])

  const toggleDone = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, done: !g.done } : g),
    }))
  }, [setState])

  const duplicateGlob = useCallback((id: string) => {
    setState(prev => {
      const orig = prev.globs.find(g => g.id === id)
      if (!orig) return prev
      const dupe: Glob = {
        ...orig,
        id: genId(),
        x: orig.x + 30,
        y: orig.y + 30,
        vx: -orig.vx,
        vy: -orig.vy,
        createdAt: Date.now(),
        blobSeed: Math.random() * 1000,
      }
      return { ...prev, globs: [...prev.globs, dupe] }
    })
  }, [setState])

  const createCluster = useCallback((globId1: string, globId2: string, x: number, y: number) => {
    const cluster = makeCluster('new cluster', x, y, [globId1, globId2])
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g =>
        g.id === globId1 || g.id === globId2
          ? { ...g, clusterId: cluster.id }
          : g
      ),
      clusters: [...prev.clusters, cluster],
    }))
  }, [setState])

  const convertToCluster = useCallback((globId: string) => {
    setState(prev => {
      const g = prev.globs.find(g => g.id === globId)
      if (!g) return prev
      const cluster = makeCluster('new cluster', g.x, g.y, [globId])
      return {
        ...prev,
        globs: prev.globs.map(gl => gl.id === globId ? { ...gl, clusterId: cluster.id } : gl),
        clusters: [...prev.clusters, cluster],
      }
    })
  }, [setState])

  const addToCluster = useCallback((globId: string, clusterId: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === globId ? { ...g, clusterId } : g),
      clusters: prev.clusters.map(c =>
        c.id === clusterId
          ? { ...c, globIds: [...c.globIds, globId], lastInteraction: Date.now() }
          : c
      ),
    }))
  }, [setState])

  const moveGlobToCluster = useCallback((globId: string, targetClusterId: string, beforeGlobId?: string | null) => {
    setState(prev => {
      const glob = prev.globs.find(g => g.id === globId)
      const targetCluster = prev.clusters.find(c => c.id === targetClusterId)
      if (!glob || !targetCluster) return prev

      const sourceClusterId = glob.clusterId
      const nextClusters = prev.clusters.map(cluster => {
        if (cluster.id === targetClusterId) {
          const filtered = cluster.globIds.filter(id => id !== globId)
          const insertAt = beforeGlobId ? filtered.indexOf(beforeGlobId) : -1
          const nextGlobIds = [...filtered]
          if (insertAt >= 0) {
            nextGlobIds.splice(insertAt, 0, globId)
          } else {
            nextGlobIds.push(globId)
          }
          return { ...cluster, globIds: nextGlobIds, lastInteraction: Date.now() }
        }

        if (cluster.id === sourceClusterId) {
          return {
            ...cluster,
            globIds: cluster.globIds.filter(id => id !== globId),
            lastInteraction: Date.now(),
          }
        }

        return cluster
      })

      return {
        ...prev,
        globs: prev.globs.map(g => g.id === globId ? { ...g, clusterId: targetClusterId } : g),
        clusters: nextClusters,
      }
    })
  }, [setState])

  const addGlobToCluster = useCallback((text: string, clusterId: string) => {
    if (!text.trim()) return
    setState(prev => {
      const cluster = prev.clusters.find(c => c.id === clusterId)
      if (!cluster) return prev
      const g = { ...makeGlob(text.trim(), cluster.x, cluster.y), clusterId }
      return {
        ...prev,
        globs: [...prev.globs, g],
        clusters: prev.clusters.map(c =>
          c.id === clusterId
            ? { ...c, globIds: [...c.globIds, g.id], lastInteraction: Date.now() }
            : c
        ),
      }
    })
  }, [setState])

  const removeFromCluster = useCallback((globId: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === globId ? { ...g, clusterId: null } : g),
      clusters: prev.clusters.map(c => ({
        ...c,
        globIds: c.globIds.filter(id => id !== globId),
      })),
    }))
  }, [setState])

  const deleteCluster = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.clusterId === id ? { ...g, clusterId: null } : g),
      clusters: prev.clusters.filter(c => c.id !== id),
      connections: prev.connections.filter(cn => cn.cluster1Id !== id && cn.cluster2Id !== id),
    }))
  }, [setState])

  const renameCluster = useCallback((id: string, name: string) => {
    setState(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === id ? { ...c, name, lastInteraction: Date.now() } : c),
    }))
  }, [setState])

  const toggleClusterCollapse = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === id ? { ...c, collapsed: !c.collapsed, lastInteraction: Date.now() } : c),
    }))
  }, [setState])

  const dissolveCluster = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.clusterId === id ? { ...g, clusterId: null } : g),
      clusters: prev.clusters.filter(c => c.id !== id),
      connections: prev.connections.filter(cn => cn.cluster1Id !== id && cn.cluster2Id !== id),
    }))
  }, [setState])

  const reorderClusterGlobs = useCallback((clusterId: string, globIds: string[]) => {
    setState(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === clusterId ? { ...c, globIds, lastInteraction: Date.now() } : c),
    }))
  }, [setState])

  const recolorGlob = useCallback((id: string, color?: string) => {
    const next = color ?? randomColor()
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, color: next } : g),
    }))
  }, [setState])

  const recolorCluster = useCallback((id: string, color: string) => {
    setState(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === id ? { ...c, color, lastInteraction: Date.now() } : c),
    }))
  }, [setState])

  const recolorAllInCluster = useCallback((clusterId: string, color: string) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.clusterId === clusterId ? { ...g, color } : g),
      clusters: prev.clusters.map(c => c.id === clusterId ? { ...c, lastInteraction: Date.now() } : c),
    }))
  }, [setState])

  // Bulk-recolor an arbitrary set of globs.
  const recolorGlobs = useCallback((ids: string[], color: string) => {
    const set = new Set(ids)
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g => set.has(g.id) ? { ...g, color } : g),
    }))
  }, [setState])

  // Bulk-toggle todo across an arbitrary set of globs. Set-all semantics matching the cluster-level version.
  const toggleAllTodosInGlobs = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    const set = new Set(ids)
    setState(prev => {
      const items = prev.globs.filter(g => set.has(g.id))
      const allAreTodos = items.every(g => g.isTodo)
      const nextIsTodo = !allAreTodos
      return {
        ...prev,
        globs: prev.globs.map(g => set.has(g.id) ? { ...g, isTodo: nextIsTodo, done: false } : g),
      }
    })
  }, [setState])

  // Bulk-delete an arbitrary set of globs, and clean their entries out of any clusters' globIds.
  const deleteGlobs = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    const set = new Set(ids)
    setState(prev => ({
      ...prev,
      globs: prev.globs.filter(g => !set.has(g.id)),
      clusters: prev.clusters.map(c => ({
        ...c,
        globIds: c.globIds.filter(id => !set.has(id)),
      })),
    }))
  }, [setState])

  // Move an arbitrary set of globs into a brand-new cluster (cross-cluster transfer).
  /**
   * File a whole selection into an existing cluster in one step.
   *
   * Looping `moveGlobToCluster` would work but would push one undo snapshot per
   * glob, so undoing a mis-filed batch of nine would take nine taps. Sorting a
   * backlog is exactly when you want one clean undo.
   */
  const moveGlobsToCluster = useCallback((ids: string[], targetClusterId: string) => {
    if (ids.length === 0) return
    const set = new Set(ids)
    setState(prev => {
      if (!prev.clusters.some(c => c.id === targetClusterId)) return prev
      // Preserve the order they appear in the list, not the order they were tapped.
      const ordered = prev.globs.filter(g => set.has(g.id)).map(g => g.id)
      return {
        ...prev,
        globs: prev.globs.map(g => set.has(g.id) ? { ...g, clusterId: targetClusterId } : g),
        clusters: prev.clusters.map(c => {
          const without = c.globIds.filter(id => !set.has(id))
          if (c.id === targetClusterId) {
            return { ...c, globIds: [...without, ...ordered], lastInteraction: Date.now() }
          }
          return without.length === c.globIds.length ? c : { ...c, globIds: without }
        }),
      }
    })
  }, [setState])

  /** Flag or unflag a selection together (set-all: any unflagged → flag them all). */
  const toggleFlagGlobs = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    const set = new Set(ids)
    setState(prev => {
      const picked = prev.globs.filter(g => set.has(g.id))
      if (picked.length === 0) return prev
      const nextFlagged = !picked.every(g => g.flagged)
      return {
        ...prev,
        globs: prev.globs.map(g => set.has(g.id) ? { ...g, flagged: nextFlagged } : g),
      }
    })
  }, [setState])

  /**
   * `at` places the new cluster where the user actually dropped the selection.
   * Without it the cluster lands on the centroid of where the thoughts came
   * from, which is the right guess for a menu action and the wrong one for a
   * drag — you put them *there* for a reason.
   */
  const transferToNewCluster = useCallback((
    ids: string[],
    name: string = 'new cluster',
    at?: { x: number; y: number },
  ) => {
    if (ids.length === 0) return
    const set = new Set(ids)
    setState(prev => {
      const items = prev.globs.filter(g => set.has(g.id))
      if (items.length === 0) return prev
      // New cluster centroid: average of source clusters' positions (fall back to item x,y if no parent).
      const sourceClusterIds = Array.from(new Set(items.map(g => g.clusterId).filter((v): v is string => !!v)))
      let cx = 0, cy = 0, count = 0
      if (at) {
        cx = at.x; cy = at.y; count = 1
      } else if (sourceClusterIds.length) {
        for (const cid of sourceClusterIds) {
          const c = prev.clusters.find(cl => cl.id === cid)
          if (c) { cx += c.x; cy += c.y; count++ }
        }
      }
      if (count === 0) {
        for (const g of items) { cx += g.x; cy += g.y; count++ }
      }
      cx /= count; cy /= count
      const cluster = makeCluster(name, cx, cy, ids)
      return {
        ...prev,
        globs: prev.globs.map(g => set.has(g.id) ? { ...g, clusterId: cluster.id } : g),
        clusters: [
          ...prev.clusters.map(c => ({
            ...c,
            globIds: c.globIds.filter(id => !set.has(id)),
          })),
          cluster,
        ],
      }
    })
  }, [setState])

  const connectClusters = useCallback((c1Id: string, c2Id: string) => {
    setState(prev => {
      const exists = prev.connections.some(
        cn => (cn.cluster1Id === c1Id && cn.cluster2Id === c2Id) ||
              (cn.cluster1Id === c2Id && cn.cluster2Id === c1Id)
      )
      if (exists) return prev
      return { ...prev, connections: [...prev.connections, makeConnection(c1Id, c2Id)] }
    })
  }, [setState])

  const disconnectClusters = useCallback((connectionId: string) => {
    setState(prev => ({
      ...prev,
      connections: prev.connections.filter(cn => cn.id !== connectionId),
    }))
  }, [setState])

  const gatherFreeGlobs = useCallback((minAgeMs = 0) => {
    setState(prev => {
      const cutoff = Date.now() - minAgeMs
      const targets = prev.globs.filter(g => !g.clusterId && g.createdAt <= cutoff)
      if (targets.length === 0) return prev
      const targetIds = new Set(targets.map(g => g.id))

      const existing = prev.clusters.find(c => c.role === 'orphans')
      if (existing) {
        return {
          ...prev,
          globs: prev.globs.map(g => targetIds.has(g.id) ? { ...g, clusterId: existing.id } : g),
          clusters: prev.clusters.map(c =>
            c.id === existing.id
              ? { ...c, globIds: [...c.globIds, ...targets.map(g => g.id)], lastInteraction: Date.now() }
              : c
          ),
        }
      }

      const cx = targets.reduce((s, g) => s + g.x, 0) / targets.length
      const cy = targets.reduce((s, g) => s + g.y, 0) / targets.length
      const bucket: Cluster = {
        ...makeCluster('orphans', cx, cy, targets.map(g => g.id)),
        role: 'orphans',
      }
      return {
        ...prev,
        globs: prev.globs.map(g => targetIds.has(g.id) ? { ...g, clusterId: bucket.id } : g),
        clusters: [...prev.clusters, bucket],
      }
    })
  }, [setState])

  // Auto-gather: sweep free globs older than 7 days into the orphans bucket.
  // Runs once on mount and again every 6 hours — gentle nudge, not aggressive.
  useEffect(() => {
    const ORPHAN_AGE_MS = 7 * 24 * 60 * 60 * 1000
    const sweep = () => gatherFreeGlobs(ORPHAN_AGE_MS)
    const t = setTimeout(sweep, 2000)
    const interval = setInterval(sweep, 6 * 60 * 60 * 1000)
    return () => { clearTimeout(t); clearInterval(interval) }
  }, [gatherFreeGlobs])

  const clearAll = useCallback(() => {
    setState(() => ({ globs: [], clusters: [], connections: [] }))
  }, [setState])

  const exportJSON = useCallback(() => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      state,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `adhdo-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [state])

  const importJSON = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        const incoming: unknown = parsed?.state ?? parsed
        if (
          !incoming ||
          typeof incoming !== 'object' ||
          !Array.isArray((incoming as GalaxyState).globs) ||
          !Array.isArray((incoming as GalaxyState).clusters) ||
          !Array.isArray((incoming as GalaxyState).connections)
        ) {
          alert('Invalid backup file — missing globs/clusters/connections.')
          return
        }
        finishOnboarding()
        setState(() => incoming as GalaxyState)
      } catch {
        alert('Could not parse backup file.')
      }
    }
    reader.readAsText(file)
  }, [finishOnboarding, setState])

  const mergeClusters = useCallback((c1Id: string, c2Id: string, newName: string) => {
    setState(prev => {
      const c1 = prev.clusters.find(c => c.id === c1Id)
      const c2 = prev.clusters.find(c => c.id === c2Id)
      if (!c1 || !c2) return prev
      const mergedGlobIds = [...c1.globIds, ...c2.globIds]
      const mx = (c1.x + c2.x) / 2
      const my = (c1.y + c2.y) / 2
      const merged = makeCluster(newName, mx, my, mergedGlobIds)

      // Connections: preserve external links to either source cluster by redirecting them to the merged.
      // Drop the c1↔c2 self-loop and dedupe parallel edges (e.g., A↔c1 + A↔c2 becomes one A↔merged).
      const isMergingPair = (a: string, b: string) =>
        (a === c1Id && b === c2Id) || (a === c2Id && b === c1Id)
      const redirected = prev.connections
        .filter(cn => !isMergingPair(cn.cluster1Id, cn.cluster2Id))
        .map(cn => ({
          ...cn,
          cluster1Id: cn.cluster1Id === c1Id || cn.cluster1Id === c2Id ? merged.id : cn.cluster1Id,
          cluster2Id: cn.cluster2Id === c1Id || cn.cluster2Id === c2Id ? merged.id : cn.cluster2Id,
        }))
      const seen = new Set<string>()
      const dedupedConnections = redirected.filter(cn => {
        const key = cn.cluster1Id < cn.cluster2Id
          ? `${cn.cluster1Id}|${cn.cluster2Id}`
          : `${cn.cluster2Id}|${cn.cluster1Id}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      return {
        ...prev,
        globs: prev.globs.map(g =>
          g.clusterId === c1Id || g.clusterId === c2Id
            ? { ...g, clusterId: merged.id }
            : g
        ),
        clusters: [
          ...prev.clusters.filter(c => c.id !== c1Id && c.id !== c2Id),
          merged,
        ],
        connections: dedupedConnections,
      }
    })
  }, [setState])

  // ── Untracked updates (physics, drag position, touch) ──

  const updateGlobPos = useCallback((id: string, x: number, y: number) => {
    setStateRaw(prev => ({
      ...prev,
      globs: prev.globs.map(g => g.id === id ? { ...g, x, y, vx: 0, vy: 0 } : g),
    }))
  }, [])

  const updateGlobs = useCallback((updater: (globs: Glob[]) => Glob[]) => {
    setStateRaw(prev => ({ ...prev, globs: updater(prev.globs) }))
  }, [])

  const updateState = useCallback((updater: (s: GalaxyState) => GalaxyState) => {
    setStateRaw(updater)
  }, [])

  const updateClusterPos = useCallback((id: string, x: number, y: number) => {
    // Clamp the cluster's center to the viewport so it can't be dragged off-screen.
    // Cluster transform is translate(-50%, -50%), so x/y IS the center.
    // Same margins the old drift loop bounced against — keeps drag handle + link button
    // reachable on the left, and the cluster header in view at the top.
    const w = window.innerWidth, h = window.innerHeight
    const cx = Math.max(100, Math.min(x, w - 100))
    const cy = Math.max(60, Math.min(y, h - 120))
    setStateRaw(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === id ? { ...c, x: cx, y: cy, vx: 0, vy: 0, lastInteraction: Date.now() } : c),
    }))
  }, [])

  const touchCluster = useCallback((id: string) => {
    setStateRaw(prev => ({
      ...prev,
      clusters: prev.clusters.map(c => c.id === id ? { ...c, lastInteraction: Date.now() } : c),
    }))
  }, [])

  /**
   * One dictation session for the whole app. Owned here rather than inside each
   * capture bar so the mobile and desktop layouts can never hold two open mic
   * sessions between them.
   */
  const voice = useVoiceCapture(addGlob)

  // Handle input submit
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      addGlob(e.currentTarget.value)
      e.currentTarget.value = ''
    }
  }

  const handleSend = () => {
    const input = inputRef.current
    if (!input) return
    addGlob(input.value)
    input.value = ''
    input.focus()
  }

  if (isMobile) {
    return (
      <div className="app mobile-root">
        <HomeButton />
        <UndoRedoBar undoLen={undoLen} redoLen={redoLen} onUndo={undo} onRedo={redo} />
        <MobileApp
          state={state}
          onboardingActive={onboardingActive}
          voice={voice}
          onAdd={addGlob}
          onToggleDone={toggleDone}
          onToggleTodo={toggleTodo}
          onToggleFlag={toggleFlag}
          onUpdateText={updateGlobText}
          onDelete={deleteGlob}
          onAddToCluster={addToCluster}
          onMoveGlobToCluster={moveGlobToCluster}
          onConvertToCluster={convertToCluster}
          onTransferToNewCluster={transferToNewCluster}
          onRemoveFromCluster={removeFromCluster}
          onToggleClusterCollapse={toggleClusterCollapse}
          onRenameCluster={renameCluster}
          onToggleAllTodosInCluster={toggleAllTodosInCluster}
          onDissolveCluster={dissolveCluster}
          onDeleteCluster={deleteCluster}
          onMoveGlobsToCluster={moveGlobsToCluster}
          onToggleFlagGlobs={toggleFlagGlobs}
          onToggleAllTodosInGlobs={toggleAllTodosInGlobs}
          onDeleteGlobs={deleteGlobs}
        />
        <AuthButton user={user} onLogin={login} onLogout={logout} />
        <SaveIndicator visible={showSaved} />
        {user && cloudStatus !== 'idle' && <CloudIndicator status={cloudStatus} />}
      </div>
    )
  }

  return (
    <div className="app" onClick={refocusInput}>
      <HomeButton />
      <UndoRedoBar undoLen={undoLen} redoLen={redoLen} onUndo={undo} onRedo={redo} />

      <Galaxy
        state={state}
        showOnboarding={onboardingActive}
        onDismissOnboarding={finishOnboarding}
        updateGlobs={updateGlobs}
        updateState={updateState}
        onAddGlobAt={addGlobAt}
        onDelete={deleteGlob}
        onUpdateText={updateGlobText}
        onToggleFlag={toggleFlag}
        onToggleTodo={toggleTodo}
        onToggleAllTodosInCluster={toggleAllTodosInCluster}
        onToggleDone={toggleDone}
        onDuplicate={duplicateGlob}
        onUpdatePos={updateGlobPos}
        onCreateCluster={createCluster}
        onConvertToCluster={convertToCluster}
        onAddToCluster={addToCluster}
        onMoveGlobToCluster={moveGlobToCluster}
        onAddGlobToCluster={addGlobToCluster}
        onRemoveFromCluster={removeFromCluster}
        onRenameCluster={renameCluster}
        onToggleClusterCollapse={toggleClusterCollapse}
        onDissolveCluster={dissolveCluster}
        onDeleteCluster={deleteCluster}
        onUpdateClusterPos={updateClusterPos}
        onTouchCluster={touchCluster}
        onReorderClusterGlobs={reorderClusterGlobs}
        onRecolor={recolorGlob}
        onRecolorCluster={recolorCluster}
        onRecolorAllInCluster={recolorAllInCluster}
        onRecolorGlobs={recolorGlobs}
        onToggleAllTodosInGlobs={toggleAllTodosInGlobs}
        onDeleteGlobs={deleteGlobs}
        onTransferToNewCluster={transferToNewCluster}
        onMoveGlobsToCluster={moveGlobsToCluster}
        onConnectClusters={connectClusters}
        onDisconnectClusters={disconnectClusters}
        onMergeClusters={mergeClusters}
        onGatherFreeGlobs={gatherFreeGlobs}
        onClearAll={clearAll}
        onExportJSON={exportJSON}
        onImportJSON={importJSON}
      />

      <CaptureBar
        inputRef={inputRef}
        onboardingActive={onboardingActive}
        onKeyDown={handleKeyDown}
        onSend={handleSend}
        voice={voice}
      />
      <VoiceOverlay voice={voice} />
      <AuthButton user={user} onLogin={login} onLogout={logout} />
      <SaveIndicator visible={showSaved} />
      {user && cloudStatus !== 'idle' && <CloudIndicator status={cloudStatus} />}
    </div>
  )
}
