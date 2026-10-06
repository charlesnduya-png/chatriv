import { useEffect } from 'react'

/**
 * Keeps --app-height in sync with the visual viewport so the shell
 * fits phones with dynamic browser chrome and soft keyboards.
 */
export function useViewportHeight() {
  useEffect(() => {
    const root = document.documentElement

    const sync = () => {
      const vv = window.visualViewport
      const height = vv?.height ?? window.innerHeight
      root.style.setProperty('--app-height', `${Math.round(height)}px`)
      if (vv) {
        root.style.setProperty('--vv-offset-top', `${Math.round(vv.offsetTop)}px`)
      } else {
        root.style.setProperty('--vv-offset-top', '0px')
      }
    }

    sync()
    window.addEventListener('resize', sync)
    window.visualViewport?.addEventListener('resize', sync)
    window.visualViewport?.addEventListener('scroll', sync)
    return () => {
      window.removeEventListener('resize', sync)
      window.visualViewport?.removeEventListener('resize', sync)
      window.visualViewport?.removeEventListener('scroll', sync)
    }
  }, [])
}
