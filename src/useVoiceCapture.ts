import { useCallback, useEffect, useRef, useState } from 'react'

/*
 * Hands-free capture.
 *
 * The brief this exists for: catching an idea while driving over a pass. That
 * rules out typing, and it rules out anything needing a second glance at the
 * screen. So this runs as a *dictation session*, not a one-shot: you tap once,
 * talk, and every sentence you finish becomes its own thought while the mic
 * stays open. Tap once more when you're done.
 *
 * Two details do the heavy lifting for eyes-free use:
 *   - each finished utterance is committed immediately, so a session that gets
 *     interrupted still keeps everything said before the interruption;
 *   - a short audio blip confirms each capture, because the whole point is that
 *     you are not looking at the phone.
 */

// The Web Speech API isn't in TypeScript's DOM lib. Declare the slice we use.
interface SpeechAlternative { transcript: string }
interface SpeechResult { readonly length: number; isFinal: boolean;[i: number]: SpeechAlternative }
interface SpeechResultList { readonly length: number;[i: number]: SpeechResult }
interface SpeechEvent extends Event { resultIndex: number; results: SpeechResultList }
interface SpeechErrorEvent extends Event { error: string }

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechEvent) => void) | null
  onerror: ((e: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognition

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export type VoiceStatus = 'idle' | 'listening' | 'denied' | 'error'

/** A short, soft confirmation tone. Cheap enough to build fresh each time. */
function blip(ok: boolean) {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = ok ? 880 : 320
    // Quick fade out — a hard stop on a sine clicks.
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.18)
    osc.onended = () => ctx.close().catch(() => {})
  } catch { /* audio is a nicety, never a failure path */ }
}

export function useVoiceCapture(onCapture: (text: string) => void) {
  const supported = useRef(getCtor()).current !== null
  const [status, setStatus] = useState<VoiceStatus>('idle')
  /** What's being said right now, before the engine commits it. */
  const [interim, setInterim] = useState('')
  /** How many thoughts this session has banked — shown as reassurance. */
  const [captured, setCaptured] = useState(0)

  const recRef = useRef<SpeechRecognition | null>(null)
  // The user's intent, which outlives any individual recognition session:
  // engines (especially on iOS) end a session after each pause, and we restart.
  const wantRef = useRef(false)
  const runningRef = useRef(false)
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null)
  // Latest callback without re-subscribing the recognition handlers.
  const onCaptureRef = useRef(onCapture)
  useEffect(() => { onCaptureRef.current = onCapture }, [onCapture])

  /** Keep the screen on while dictating — a locked phone stops listening. */
  const acquireWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
      if (nav.wakeLock) wakeRef.current = await nav.wakeLock.request('screen')
    } catch { /* not fatal; dictation still works while the screen is on */ }
  }, [])

  const releaseWakeLock = useCallback(() => {
    wakeRef.current?.release().catch(() => {})
    wakeRef.current = null
  }, [])

  const stop = useCallback(() => {
    wantRef.current = false
    setInterim('')
    setStatus('idle')
    releaseWakeLock()
    try { recRef.current?.stop() } catch { /* already stopped */ }
  }, [releaseWakeLock])

  const start = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor || runningRef.current) return

    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = navigator.language || 'en-US'

    rec.onstart = () => { runningRef.current = true }

    rec.onresult = (e: SpeechEvent) => {
      let pending = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) {
          const trimmed = text.trim()
          if (trimmed) {
            // Bank it the instant the engine is sure. Nothing is held back
            // waiting for the session to end.
            onCaptureRef.current(trimmed)
            setCaptured(n => n + 1)
            blip(true)
          }
        } else {
          pending += text
        }
      }
      setInterim(pending)
    }

    rec.onerror = (e: SpeechErrorEvent) => {
      // 'no-speech' and 'aborted' are just silence and normal teardown — the
      // onend restart handles both. Anything else ends the session.
      if (e.error === 'no-speech' || e.error === 'aborted') return
      wantRef.current = false
      releaseWakeLock()
      setInterim('')
      setStatus(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : 'error')
      blip(false)
    }

    rec.onend = () => {
      runningRef.current = false
      // iOS ends the session after every pause. Restarting is what turns this
      // into one continuous dictation rather than a single sentence.
      if (!wantRef.current) return
      setTimeout(() => {
        if (!wantRef.current || runningRef.current) return
        try { rec.start() } catch { /* a failed restart just ends the session */ }
      }, 250)
    }

    recRef.current = rec
    wantRef.current = true
    setCaptured(0)
    setInterim('')
    setStatus('listening')
    void acquireWakeLock()
    try {
      rec.start()
    } catch {
      wantRef.current = false
      setStatus('error')
    }
  }, [acquireWakeLock, releaseWakeLock])

  const toggle = useCallback(() => {
    if (wantRef.current) stop()
    else start()
  }, [start, stop])

  // A backgrounded tab loses the mic anyway; end cleanly so the UI doesn't lie
  // about still listening.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden' && wantRef.current) stop() }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      wantRef.current = false
      try { recRef.current?.abort() } catch { /* nothing to abort */ }
      wakeRef.current?.release().catch(() => {})
    }
  }, [stop])

  return { supported, status, interim, captured, start, stop, toggle }
}

/** The shape the capture bars and the overlay share. */
export type VoiceCapture = ReturnType<typeof useVoiceCapture>
