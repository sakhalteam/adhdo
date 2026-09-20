import { useState, useEffect, useRef, useCallback } from 'react'
import { loadLocal, saveLocal, saveRemote, loadRemote, touchLocal, getRemoteSeen, getRemoteBase, markRemoteSeen, saveRescue, isDirty, setDirty, planSync, listVersions, loadVersion, exportPayload, parseImport, mergeStates, hasSeenOnboarding, markOnboardingSeen, stateSignature, makeGlob, makeCluster, makeConnection, genId, randomColor } from './store'
import type { RemoteState, GalaxyVersion } from './store'
import { supabase } from './supabaseClient'
import type { GalaxyState, Glob, Cluster, Priority } from './types'
import type { User } from '@supabase/supabase-js'
import Galaxy from './Galaxy'
import MobileApp from './MobileApp'
import { useIsMobile } from './useIsMobile'
import { AuthButton, BackupsPanel, CaptureBar, CloudIndicator, DiagnosticsPanel, HomeButton, SaveIndicator, UndoRedoBar, VoiceOverlay } from './AppChrome'
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
  const [backupsOpen, setBackupsOpen] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [versions, setVersions] = useState<GalaxyVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)

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
    // We hold it now — and only now is the compare-and-swap allowed to believe
    // a later save of ours builds on this version.
    markRemoteSeen(remote.updatedAt, remote.state)
    needsRemoteSave.current = false
    setDirty(false)
  }, [])

  /**
   * Fold a cloud copy into what this device holds, writing the result back.
   *
   * The one path that reconciles, shared by both directions of sync, because
   * the question is the same either way: the cloud row carries a version we
   * never took in, and both copies may hold thoughts the other has never seen.
   * Picking a winner is what lost the galaxy — signing in after capturing a few
   * notes offline made the phone look like the freshest writer, and five
   * seconds later its five notes were the whole cloud.
   *
   * `mustPush` is set by the save path, where we already know we're holding
   * unsaved work; the pull path only writes back when the merge actually added
   * something the cloud lacks.
   */
  const reconcile = useCallback(async (remote: RemoteState, mustPush: boolean) => {
    const plan = planSync(stateRef.current, remote, {
      seen: getRemoteSeen(), base: getRemoteBase(), mustPush,
    })
    if (plan.action === 'hold') return
    // Anything this device is about to stop holding goes in the rescue slot
    // first. A merge cannot tell a real bulk delete from another client having
    // overwritten the cloud row with less than it held, so it doesn't try —
    // it just makes sure the fuller copy is still on disk afterwards.
    if (plan.dropped.length) saveRescue(stateRef.current)
    if (plan.action === 'adopt') {
      adoptRemote(remote)
      flash('pulled')
      return
    }
    const merged = plan.state
    setStateRaw(merged)
    saveLocal(merged)
    lastSavedRef.current = stateSignature(merged)
    // Force past the compare-and-swap: we've just read the cloud's version and
    // folded it in, so the merged copy is strictly the most complete one.
    const ok = (await saveRemote(supabase, merged, { force: true })) === 'saved'
    needsRemoteSave.current = !ok
    setDirty(!ok)
    flash(ok ? 'merged' : 'error')
  }, [adoptRemote, flash])

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
      // The cloud holds a version this device never took in.
      const remote = await loadRemote(supabase)
      if (!remote) { flash('error'); return }
      await reconcile(remote, true)
      return
    }

    const ok = result === 'saved'
    needsRemoteSave.current = !ok
    setDirty(!ok)
    flash(ok ? 'saved' : 'error')
  }, [flash, reconcile])

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
    if (!remote) return
    // No timestamp comparison here on purpose — `planSync` asks whether we
    // already hold the cloud's contents, not whose clock reads later. Clocks
    // can't answer it: capturing while signed out moves the local stamp without
    // the cloud hearing a word, so the device that has seen the least of the
    // galaxy looks like its freshest writer.
    await reconcile(remote, false)
  }, [push, reconcile])

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
    if (target.closest('.cluster, .glob, .ctx-menu, .trash-toast, .shake-modal, .help-trigger, .search-modal, .new-glob-input, .spawn-menu, .onboarding-panel, .cluster-tools, .cluster-browser, .agenda-panel')) {
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

  /**
   * Todoist-style capture: one call that can land a thought in a project with a
   * due date and priority already attached. Anything scheduled or prioritized
   * is a to-do by definition; a bare text stays a plain thought.
   */
  const addTask = useCallback((text: string, opts: {
    clusterId?: string | null
    dueDate?: string | null
    priority?: Priority
  } = {}) => {
    if (!text.trim()) return
    if (onboardingActive) finishOnboarding()
    setState(prev => {
      const cluster = opts.clusterId ? prev.clusters.find(c => c.id === opts.clusterId) : undefined
      const base = makeGlob(
        text.trim(),
        cluster ? cluster.x : window.innerWidth / 2,
        cluster ? cluster.y : window.innerHeight / 2,
      )
      const g: Glob = {
        ...base,
        clusterId: cluster ? cluster.id : null,
        dueDate: opts.dueDate ?? null,
        priority: opts.priority ?? 4,
        isTodo: !!opts.dueDate || (opts.priority !== undefined && opts.priority < 4),
      }
      return {
        ...prev,
        globs: [...prev.globs, g],
        clusters: cluster
          ? prev.clusters.map(c =>
              c.id === cluster.id
                ? { ...c, globIds: [...c.globIds, g.id], lastInteraction: Date.now() }
                : c
            )
          : prev.clusters,
      }
    })
  }, [finishOnboarding, onboardingActive, setState])

  /** Scheduling something makes it a to-do; clearing the date leaves that alone. */
  const setGlobDueDate = useCallback((id: string, dueDate: string | null) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g =>
        g.id === id ? { ...g, dueDate, isTodo: g.isTodo || !!dueDate } : g
      ),
    }))
  }, [setState])

  const setGlobPriority = useCallback((id: string, priority: Priority) => {
    setState(prev => ({
      ...prev,
      globs: prev.globs.map(g =>
        g.id === id ? { ...g, priority, isTodo: g.isTodo || priority < 4 } : g
      ),
    }))
  }, [setState])

  /**
   * An empty project. Mobile's Browse tab ("Add project") names it up front and
   * lets it land anywhere; the desktop canvas passes the spot you right-clicked
   * and renames in place, so it needs the id back.
   */
  const addCluster = useCallback((name: string, at?: { x: number; y: number }) => {
    const trimmed = name.trim()
    if (!trimmed) return null
    const w = window.innerWidth, h = window.innerHeight
    const cluster = makeCluster(
      trimmed,
      at?.x ?? w * (0.25 + Math.random() * 0.5),
      at?.y ?? h * (0.25 + Math.random() * 0.5),
      [],
    )
    setState(prev => ({ ...prev, clusters: [...prev.clusters, cluster] }))
    return cluster.id
  }, [setState])

  const deleteGlob = useCallback((id: string) => {
    // Emptied clusters survive. They used to be swept away here, but on mobile a
    // cluster is a first-class project — completing and clearing its last task
    // must not delete the project. Desktop keeps its explicit delete/dissolve paths.
    setState(prev => ({
      ...prev,
      globs: prev.globs.filter(g => g.id !== id),
      clusters: prev.clusters.map(c => ({
        ...c,
        globIds: c.globIds.filter(gid => gid !== id),
      })),
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

  /**
   * Desktop's toggle. Out on the canvas a free glob has no checkbox, so
   * todo-ness is invisible there — you'd flip it on and see nothing change.
   * Wrap it in its own cluster on the way in, in one undo step, where the
   * checkbox exists. Mobile deliberately keeps plain toggleTodo: there an
   * unclustered glob IS the Inbox and already shows a checkbox, so wrapping
   * would yank the task out of Inbox into a project called "new cluster".
   */
  const toggleTodoOnCanvas = useCallback((id: string) => {
    setState(prev => {
      const target = prev.globs.find(g => g.id === id)
      if (!target) return prev
      if (!target.isTodo && !target.clusterId) {
        const cluster = makeCluster('new cluster', target.x, target.y, [id])
        return {
          ...prev,
          globs: prev.globs.map(g => g.id === id ? { ...g, isTodo: true, done: false, clusterId: cluster.id } : g),
          clusters: [...prev.clusters, cluster],
        }
      }
      return {
        ...prev,
        globs: prev.globs.map(g => g.id === id ? { ...g, isTodo: !g.isTodo, done: false } : g),
      }
    })
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

  /**
   * Sweep the ticked-off to-dos out of one cluster. Returning `prev` untouched
   * when nothing is done means an empty sweep pushes no undo snapshot — the
   * menu item is disabled in that case anyway, but a no-op should stay a no-op.
   */
  const clearCompletedInCluster = useCallback((clusterId: string) => {
    setState(prev => {
      const doneIds = new Set(
        prev.globs.filter(g => g.clusterId === clusterId && g.isTodo && g.done).map(g => g.id)
      )
      if (doneIds.size === 0) return prev
      return {
        ...prev,
        globs: prev.globs.filter(g => !doneIds.has(g.id)),
        clusters: prev.clusters.map(c =>
          c.id === clusterId
            ? { ...c, globIds: c.globIds.filter(id => !doneIds.has(id)), lastInteraction: Date.now() }
            : c
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

  /**
   * The cluster AND everything in it, in one undo step. (deleteCluster, despite
   * the name, sets the globs loose.) Looping deleteGlob would push one undo
   * snapshot per glob and leave half-emptied clusters between them.
   */
  const destroyCluster = useCallback((id: string) => {
    setState(prev => {
      const cluster = prev.clusters.find(c => c.id === id)
      if (!cluster) return prev
      const doomed = new Set(cluster.globIds)
      return {
        ...prev,
        globs: prev.globs.filter(g => !doomed.has(g.id) && g.clusterId !== id),
        clusters: prev.clusters.filter(c => c.id !== id),
        connections: prev.connections.filter(cn => cn.cluster1Id !== id && cn.cluster2Id !== id),
      }
    })
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
    const blob = new Blob([exportPayload(stateRef.current)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `adhdo-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [])

  /**
   * Import **merges**; it never replaces.
   *
   * It used to `setState(() => incoming)`, which makes the recovery tool one
   * more way to lose everything: pick the wrong file, or a stale one, and the
   * thoughts you captured since are gone. Union instead — the file wins ties,
   * because restoring is the whole point — and nothing on either side is lost.
   * One undo step, so a mistaken import is `Ctrl+Z`.
   */
  const importJSON = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const incoming = parseImport(String(reader.result))
      if (!incoming) {
        alert('That does not look like an adhdo backup — no globs/clusters in it.')
        return
      }
      finishOnboarding()
      setState(prev => mergeStates(prev, incoming))
      setBackupsOpen(false)
    }
    reader.readAsText(file)
  }, [finishOnboarding, setState])

  const refreshVersions = useCallback(async () => {
    if (!user) { setVersions([]); return }
    setVersionsLoading(true)
    setVersions(await listVersions(supabase))
    setVersionsLoading(false)
  }, [user])

  const openBackups = useCallback(() => {
    setBackupsOpen(true)
    void refreshVersions()
  }, [refreshVersions])

  /**
   * Roll the galaxy back to an archived version.
   *
   * Reversible on both sides, which is what makes it safe to offer at all: the
   * copy being left goes to the rescue slot, `setState` puts it on the undo
   * stack, and the forced save archives the cloud row it replaces — so the
   * state you restored *away* from becomes the newest version in the list.
   */
  const restoreVersion = useCallback(async (id: string) => {
    const restored = await loadVersion(supabase, id)
    if (!restored) { flash('error'); return }
    saveRescue(stateRef.current)
    finishOnboarding()
    setState(() => restored)
    setBackupsOpen(false)
    if (!user) return
    setCloudStatus('saving')
    // `archive` is not optional here: a restore usually *grows* the galaxy, so
    // it trips none of the usual snapshot heuristics — and a rollback you
    // cannot roll back is not a safety net.
    const ok = (await saveRemote(supabase, restored, { force: true, archive: true })) === 'saved'
    needsRemoteSave.current = !ok
    setDirty(!ok)
    flash(ok ? 'saved' : 'error')
    void refreshVersions()
  }, [finishOnboarding, flash, refreshVersions, setState, user])

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
          onAddTask={addTask}
          onSetDueDate={setGlobDueDate}
          onSetPriority={setGlobPriority}
          onAddCluster={addCluster}
          onRecolorCluster={recolorCluster}
          onToggleDone={toggleDone}
          onToggleTodo={toggleTodo}
          onToggleFlag={toggleFlag}
          onUpdateText={updateGlobText}
          onDelete={deleteGlob}
          onAddToCluster={addToCluster}
          onMoveGlobToCluster={moveGlobToCluster}
          onRemoveFromCluster={removeFromCluster}
          onRenameCluster={renameCluster}
          onToggleAllTodosInCluster={toggleAllTodosInCluster}
          onClearCompletedInCluster={clearCompletedInCluster}
          onDissolveCluster={dissolveCluster}
          onDeleteCluster={deleteCluster}
          onMoveGlobsToCluster={moveGlobsToCluster}
          onToggleFlagGlobs={toggleFlagGlobs}
          onToggleAllTodosInGlobs={toggleAllTodosInGlobs}
          onDeleteGlobs={deleteGlobs}
          onOpenBackups={openBackups}
          onOpenDiagnostics={() => setDiagnosticsOpen(true)}
        />
        <DiagnosticsPanel open={diagnosticsOpen} onClose={() => setDiagnosticsOpen(false)} />
        <BackupsPanel
          open={backupsOpen}
          user={user}
          versions={versions}
          loading={versionsLoading}
          onClose={() => setBackupsOpen(false)}
          onExport={exportJSON}
          onImport={importJSON}
          onRestore={restoreVersion}
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
        onToggleTodo={toggleTodoOnCanvas}
        onSetDueDate={setGlobDueDate}
        onSetPriority={setGlobPriority}
        onToggleAllTodosInCluster={toggleAllTodosInCluster}
        onClearCompletedInCluster={clearCompletedInCluster}
        onToggleDone={toggleDone}
        onDuplicate={duplicateGlob}
        onUpdatePos={updateGlobPos}
        onCreateCluster={createCluster}
        onAddCluster={addCluster}
        onConvertToCluster={convertToCluster}
        onAddToCluster={addToCluster}
        onMoveGlobToCluster={moveGlobToCluster}
        onAddGlobToCluster={addGlobToCluster}
        onRemoveFromCluster={removeFromCluster}
        onRenameCluster={renameCluster}
        onToggleClusterCollapse={toggleClusterCollapse}
        onDissolveCluster={dissolveCluster}
        onDeleteCluster={deleteCluster}
        onDestroyCluster={destroyCluster}
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
        onOpenBackups={openBackups}
      />

      <BackupsPanel
          open={backupsOpen}
          user={user}
          versions={versions}
          loading={versionsLoading}
          onClose={() => setBackupsOpen(false)}
          onExport={exportJSON}
          onImport={importJSON}
          onRestore={restoreVersion}
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
