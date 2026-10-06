/** Own chat API (Express + Socket.io). Not a third-party realtime SaaS. */
const OWN_CHAT_HOST = 'https://chatriv.fly.dev'

function isNativeApp() {
  if (typeof window === 'undefined') return false
  const capacitor = (
    window as Window & {
      Capacitor?: { isNativePlatform?: () => boolean }
    }
  ).Capacitor
  return Boolean(capacitor?.isNativePlatform?.())
}

/**
 * Resolve API / realtime base URL.
 * - Capacitor Android/iOS → own chat host
 * - Same-origin when UI is served with the chat server (Fly Docker)
 * - Own chat host when UI is on a static CDN (Vercel / chatriv.com)
 * - Optional VITE_SOCKET_URL override
 */
export function apiUrl(path: string) {
  const configured = (import.meta.env.VITE_SOCKET_URL as string | undefined)?.trim()
  if (configured) {
    return `${configured.replace(/\/$/, '')}${path}`
  }

  if (typeof window !== 'undefined') {
    if (isNativeApp()) {
      return `${OWN_CHAT_HOST}${path}`
    }

    const { hostname, port, origin } = window.location
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1'
    if (isLocalHost && port !== '3001') {
      return `http://localhost:3001${path}`
    }
    if (
      hostname === 'chatriv.com' ||
      hostname === 'www.chatriv.com' ||
      hostname.endsWith('.vercel.app')
    ) {
      return `${OWN_CHAT_HOST}${path}`
    }
    return `${origin}${path}`
  }

  return path
}
