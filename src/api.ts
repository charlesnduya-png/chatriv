export function apiUrl(path: string) {
  const configured = import.meta.env.VITE_SOCKET_URL as string | undefined
  const base =
    configured ||
    (typeof window !== 'undefined' && window.location.hostname !== 'localhost'
      ? 'https://chatriv.fly.dev'
      : 'http://localhost:3001')
  return `${base.replace(/\/$/, '')}${path}`
}
