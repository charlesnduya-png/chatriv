import { useEffect, useState } from 'react'

/**
 * Best-effort chat privacy guard.
 * Browsers cannot fully block OS screenshots; this reduces casual capture
 * via selection, context menus, app-switcher previews, and PrintScreen.
 */
export function useScreenGuard(enabled: boolean) {
  const [obscured, setObscured] = useState(false)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setObscured(false)
      setFlash(false)
      return
    }

    const root = document.documentElement
    root.classList.add('screen-guard-on')

    const obscure = () => setObscured(true)
    const reveal = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        setObscured(false)
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') obscure()
      else reveal()
    }

    const onBlur = () => obscure()
    const onFocus = () => reveal()
    const onPageHide = () => obscure()

    const flashCover = () => {
      setFlash(true)
      window.setTimeout(() => setFlash(false), 900)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key?.toLowerCase?.() || ''
      const isPrintScreen = key === 'printscreen' || event.keyCode === 44
      const isMacCapture =
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        (key === '3' || key === '4' || key === '5' || key === 's')
      const isWinSnip = event.metaKey && event.shiftKey && key === 's'

      if (isPrintScreen || isMacCapture || isWinSnip) {
        obscure()
        flashCover()
      }
    }

    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.messages, .call-overlay, .photo')) {
        event.preventDefault()
      }
    }

    const onCopy = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const selection = window.getSelection()?.toString()
      if (selection && selection.trim()) {
        event.preventDefault()
      }
    }

    const onDragStart = (event: DragEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.messages img, .photo__image')) {
        event.preventDefault()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('contextmenu', onContextMenu, true)
    document.addEventListener('copy', onCopy, true)
    document.addEventListener('cut', onCopy, true)
    document.addEventListener('dragstart', onDragStart, true)

    // Initial state
    if (document.visibilityState === 'hidden' || !document.hasFocus()) {
      obscure()
    }

    return () => {
      root.classList.remove('screen-guard-on')
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('contextmenu', onContextMenu, true)
      document.removeEventListener('copy', onCopy, true)
      document.removeEventListener('cut', onCopy, true)
      document.removeEventListener('dragstart', onDragStart, true)
    }
  }, [enabled])

  return { obscured, flash }
}
