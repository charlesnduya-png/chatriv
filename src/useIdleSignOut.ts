import { useEffect, useRef } from 'react'
import type { AppSocket } from './socket'

const IDLE_MS = 10 * 60 * 1000
const PING_MS = 60 * 1000

const WINDOW_ACTIVITY_EVENTS = [
  'pointerdown',
  'keydown',
  'mousemove',
  'touchstart',
  'scroll',
] as const

type UseIdleSignOutOptions = {
  enabled: boolean
  socket: AppSocket | null
  onIdle: () => void
}

/** Client-side idle sign-out aligned with the server's 10-minute dormancy policy. */
export function useIdleSignOut({ enabled, socket, onIdle }: UseIdleSignOutOptions) {
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle

  useEffect(() => {
    if (!enabled) return

    let idleTimer: number | null = null
    let pingTimer: number | null = null

    const clearIdle = () => {
      if (idleTimer != null) window.clearTimeout(idleTimer)
      idleTimer = null
    }

    const armIdle = () => {
      clearIdle()
      idleTimer = window.setTimeout(() => {
        onIdleRef.current()
      }, IDLE_MS)
    }

    const onActivity = () => {
      if (document.visibilityState === 'hidden') return
      armIdle()
      socket?.emit('presence:ping', () => {})
    }

    armIdle()
    pingTimer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      socket?.emit('presence:ping', () => {})
    }, PING_MS)

    for (const eventName of WINDOW_ACTIVITY_EVENTS) {
      window.addEventListener(eventName, onActivity, { passive: true })
    }
    document.addEventListener('visibilitychange', onActivity)

    return () => {
      clearIdle()
      if (pingTimer != null) window.clearInterval(pingTimer)
      for (const eventName of WINDOW_ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, onActivity)
      }
      document.removeEventListener('visibilitychange', onActivity)
    }
  }, [enabled, socket])
}
