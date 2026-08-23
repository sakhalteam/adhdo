import type { KeyboardEvent, RefObject } from 'react'
import type { User } from '@supabase/supabase-js'
import type { VoiceCapture } from './useVoiceCapture'

export function HomeButton() {
  return (
    <a href="https://sakhalteam.github.io/" className="home-btn" title="Back to island">
      <svg width="20" height="12" viewBox="0 0 32 18" fill="currentColor" aria-hidden="true">
        <path d="M 4,10 C 5,4 9,2 14,3 C 18,4 20,2 24,4 C 28,6 29,11 26,15 C 22,18 12,18 6,15 C 2,13 2,11 4,10 Z" />
      </svg>
      sakhalteam
    </a>
  )
}

export function AuthButton({ user, onLogin, onLogout }: { user: User | null; onLogin: () => void; onLogout: () => void }) {
  return (
    <button
      className="auth-btn"
      onClick={e => { e.stopPropagation(); user ? onLogout() : onLogin() }}
      title={user ? `Signed in as ${user.user_metadata?.user_name ?? user.email}` : 'Sign in to sync across devices'}
    >
      {user ? (
        <>
          <span className="auth-dot synced" />
          {user.user_metadata?.user_name ?? 'signed in'}
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          sign in
        </>
      )}
    </button>
  )
}

export function UndoRedoBar({
  undoLen,
  redoLen,
  onUndo,
  onRedo,
}: {
  undoLen: number
  redoLen: number
  onUndo: () => void
  onRedo: () => void
}) {
  // Nothing to undo yet means two dead buttons and, on a phone, a floating pill
  // sitting on top of the list for no reason. Show up only once there's history.
  if (undoLen === 0 && redoLen === 0) return null
  return (
    <div className="undo-redo-bar">
      <button
        className="undo-redo-btn"
        onClick={e => { e.stopPropagation(); onUndo() }}
        disabled={undoLen === 0}
        title="Undo (Ctrl+Z)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      </button>
      <button
        className="undo-redo-btn"
        onClick={e => { e.stopPropagation(); onRedo() }}
        disabled={redoLen === 0}
        title="Redo (Ctrl+Y)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
        </svg>
      </button>
    </div>
  )
}

export function CaptureBar({
  inputRef,
  onboardingActive,
  onKeyDown,
  onSend,
  voice,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  onboardingActive: boolean
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  onSend: () => void
  voice: VoiceCapture
}) {
  return (
    <div className={`capture-bar ${voice.supported ? 'has-mic' : ''}`}>
      <div className="capture-wrap">
        {voice.supported && <MicButton voice={voice} />}
        <input
          ref={inputRef}
          type="text"
          className="capture-input"
          placeholder={onboardingActive ? 'start here... type one thought and hit enter' : 'brain dump here... hit enter to launch'}
          onKeyDown={onKeyDown}
          onClick={e => e.stopPropagation()}
          autoFocus
        />
        <button
          className="capture-send"
          onClick={e => { e.stopPropagation(); onSend() }}
          aria-label="Launch glob"
          title="Launch glob"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export function MicButton({ voice }: { voice: VoiceCapture }) {
  const on = voice.status === 'listening'
  return (
    <button
      className={`capture-mic ${on ? 'on' : ''}`}
      onClick={e => { e.stopPropagation(); voice.toggle() }}
      aria-label={on ? 'Stop dictation' : 'Capture by voice'}
      aria-pressed={on}
      title={on ? 'Stop dictation' : 'Talk instead of typing — every sentence becomes a thought'}
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="2" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
      </svg>
    </button>
  )
}

/**
 * Live dictation readout, shared by both layouts.
 *
 * Deliberately large and low on the screen: during a hands-free session the
 * question is only ever "is it still hearing me, and did that one land?", and
 * that has to be answerable with a glance.
 */
export function VoiceOverlay({ voice }: { voice: VoiceCapture }) {
  if (voice.status === 'listening') {
    return (
      <div className="voice-panel">
        <div className="voice-panel-head">
          <span className="voice-dot" />
          listening
          <span className="voice-banked">{voice.captured} captured</span>
        </div>
        <p className="voice-interim">{voice.interim || 'say anything…'}</p>
        <button className="voice-stop" onClick={voice.stop}>Done</button>
      </div>
    )
  }
  if (voice.status === 'denied') {
    return (
      <div className="voice-error">
        Microphone blocked. Enable it for this site in your browser settings — or use the
        🎤 on your keyboard instead.
      </div>
    )
  }
  if (voice.status === 'error') {
    return <div className="voice-error">Dictation stopped. Tap the mic to try again.</div>
  }
  return null
}

export function SaveIndicator({ visible }: { visible: boolean }) {
  return (
    <div className={`save-indicator ${visible ? 'visible' : ''}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      saved
    </div>
  )
}

/**
 * 'pulled' = this device adopted a newer copy from the cloud.
 * 'merged' = this device and the cloud had both moved on, and the two were
 *            reconciled rather than one overwriting the other.
 */
export type CloudStatus = 'saving' | 'saved' | 'merged' | 'pulled' | 'error'

export function CloudIndicator({ status }: { status: CloudStatus }) {
  return (
    <div className={`cloud-indicator ${status}`}>
      {status === 'saving' && 'syncing...'}
      {status === 'saved' && 'cloud synced'}
      {status === 'merged' && 'merged with cloud'}
      {status === 'pulled' && 'loaded from cloud'}
      {status === 'error' && 'sync failed'}
    </div>
  )
}
