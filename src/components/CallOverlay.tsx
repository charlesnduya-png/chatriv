import { useEffect, useRef, useState } from 'react'
import type { CallMode, User } from '../types'

type CallOverlayProps = {
  phase: 'outgoing' | 'incoming' | 'connected'
  mode: CallMode
  peer: User
  muted: boolean
  cameraOff: boolean
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  error?: string | null
  onAccept: () => void
  onReject: () => void
  onHangUp: () => void
  onToggleMute: () => void
  onToggleCamera: () => void
  onDismissError?: () => void
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

async function playMedia(
  element: HTMLMediaElement | null,
  stream: MediaStream | null,
) {
  if (!element) return
  if (element.srcObject !== stream) {
    element.srcObject = stream
  }
  if (!stream) return
  try {
    await element.play()
  } catch {
    // Autoplay may wait for a gesture; Call/Accept already provides one.
  }
}

export function CallOverlay({
  phase,
  mode,
  peer,
  muted,
  cameraOff,
  localStream,
  remoteStream,
  error,
  onAccept,
  onReject,
  onHangUp,
  onToggleMute,
  onToggleCamera,
  onDismissError,
}: CallOverlayProps) {
  const localRef = useRef<HTMLVideoElement>(null)
  const remoteRef = useRef<HTMLVideoElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (phase !== 'connected') {
      setElapsed(0)
      return
    }
    const started = Date.now()
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000))
    }, 1000)
    return () => window.clearInterval(id)
  }, [phase])

  useEffect(() => {
    void playMedia(localRef.current, localStream)
  }, [localStream, phase, mode])

  useEffect(() => {
    void playMedia(remoteRef.current, remoteStream)
    void playMedia(remoteAudioRef.current, remoteStream)
  }, [remoteStream, phase, mode])

  const statusLabel =
    phase === 'outgoing'
      ? `Calling ${peer.name}…`
      : phase === 'incoming'
        ? `${peer.name} is calling`
        : mode === 'video'
          ? 'Video call'
          : 'Voice call'

  const showVideo = mode === 'video'
  const showRemoteVideo = Boolean(remoteStream?.getVideoTracks().length)

  return (
    <div className={`call-overlay call-overlay--${mode}${phase === 'connected' ? ' is-live' : ''}`}>
      <audio ref={remoteAudioRef} autoPlay playsInline className="call-overlay__audio" />

      <div className="call-overlay__stage">
        {showVideo ? (
          <>
            <video
              ref={remoteRef}
              className={`call-overlay__remote${showRemoteVideo ? ' is-on' : ''}`}
              autoPlay
              playsInline
              muted
            />
            {!showRemoteVideo ? (
              <div className="call-overlay__avatar-panel call-overlay__avatar-panel--overlay">
                <span className="call-overlay__avatar" aria-hidden>
                  {initials(peer.name)}
                </span>
              </div>
            ) : null}
            {!cameraOff && localStream ? (
              <video
                ref={localRef}
                className="call-overlay__local"
                autoPlay
                playsInline
                muted
              />
            ) : (
              <div className="call-overlay__local call-overlay__local--off">
                Camera off
              </div>
            )}
          </>
        ) : (
          <div className="call-overlay__avatar-panel">
            <span className="call-overlay__avatar" aria-hidden>
              {initials(peer.name)}
            </span>
          </div>
        )}

        <div className="call-overlay__meta">
          <p className="call-overlay__name">{peer.name}</p>
          <p className="call-overlay__status">
            {phase === 'connected' ? formatDuration(elapsed) : statusLabel}
          </p>
          {phase === 'incoming' ? (
            <p className="call-overlay__kind">
              Incoming {mode === 'video' ? 'video' : 'voice'} call
            </p>
          ) : null}
          {error ? (
            <p className="call-overlay__error" role="alert">
              {error}
              {onDismissError ? (
                <button type="button" className="call-overlay__error-dismiss" onClick={onDismissError}>
                  Dismiss
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>

      <div className="call-overlay__controls">
        {phase === 'incoming' ? (
          <>
            <button type="button" className="call-btn call-btn--decline" onClick={onReject}>
              Decline
            </button>
            <button type="button" className="call-btn call-btn--accept" onClick={onAccept}>
              Accept
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`call-btn call-btn--mute${muted ? ' is-active' : ''}`}
              onClick={onToggleMute}
              aria-pressed={muted}
            >
              {muted ? 'Unmute' : 'Mute'}
            </button>
            {mode === 'video' ? (
              <button
                type="button"
                className={`call-btn call-btn--camera${cameraOff ? ' is-active' : ''}`}
                onClick={onToggleCamera}
                aria-pressed={cameraOff}
              >
                {cameraOff ? 'Cam on' : 'Cam off'}
              </button>
            ) : null}
            <button type="button" className="call-btn call-btn--hangup" onClick={onHangUp}>
              {phase === 'outgoing' ? 'Cancel' : 'End'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
