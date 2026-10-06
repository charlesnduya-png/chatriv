/** Own chat API (Express + Socket.io). Not a third-party realtime SaaS. */
const OWN_CHAT_HOST = 'https://chatriv.fly.dev'

/**
 * Resolve API / realtime base URL.
 * - Same-origin when UI is served with the chat server (Fly Docker).
 * - Own chat host when UI is on a static CDN (Vercel / chatriv.com).
 * - Optional VITE_SOCKET_URL override.
 */
export function apiUrl(path: string) {
  const configured = (import.meta.env.VITE_SOCKET_URL as string | undefined)?.trim()
  if (configured) {
    return `${configured.replace(/\/$/, '')}${path}`
  }

  if (typeof window !== 'undefined') {
    const { hostname, port, origin } = window.location
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1'
    if (isLocalHost && port !== '3001') {
      return `http://localhost:3001${path}`
    }
    // Static frontend hosts still talk to our in-house Socket.io server.
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
