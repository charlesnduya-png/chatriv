import { useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isIos() {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function isStandalone() {
  if (typeof window === 'undefined') return true
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // @ts-expect-error iOS Safari
    window.navigator.standalone === true
  )
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  )
  const [showIosTip, setShowIosTip] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (isStandalone()) return

    const onPrompt = (event: Event) => {
      event.preventDefault()
      setDeferred(event as BeforeInstallPromptEvent)
      setShowIosTip(false)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)

    if (isIos()) {
      setShowIosTip(true)
    }

    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (hidden || isStandalone()) return null
  if (!deferred && !showIosTip) return null

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    const choice = await deferred.userChoice
    setDeferred(null)
    if (choice.outcome === 'accepted') setHidden(true)
  }

  return (
    <div className="install" role="region" aria-label="Install Chatrive">
      <div className="install__copy">
        <strong>Install Chatrive</strong>
        {deferred ? (
          <span>Add it to your home screen for quick access.</span>
        ) : (
          <span>
            On iPhone: tap Share, then <em>Add to Home Screen</em>.
          </span>
        )}
      </div>
      <div className="install__actions">
        {deferred ? (
          <button type="button" className="install__button" onClick={install}>
            Install
          </button>
        ) : null}
        <button
          type="button"
          className="install__dismiss"
          onClick={() => setHidden(true)}
          aria-label="Dismiss install tip"
        >
          Not now
        </button>
      </div>
    </div>
  )
}
