import { useEffect, useState } from 'react'
import { Logo } from './Logo'

type JoinScreenProps = {
  onJoin: (name: string) => void
  joining: boolean
  error: string | null
}

const PLACEHOLDER_FULL = 'Enter your name'

export function JoinScreen({ onJoin, joining, error }: JoinScreenProps) {
  const [name, setName] = useState('')
  const [typed, setTyped] = useState('')
  const showAnimation = name.length === 0

  useEffect(() => {
    if (!showAnimation) return

    let index = 0
    let deleting = false
    let timer = 0

    const tick = () => {
      if (!deleting) {
        index += 1
        setTyped(PLACEHOLDER_FULL.slice(0, index))
        if (index === PLACEHOLDER_FULL.length) {
          deleting = true
          timer = window.setTimeout(tick, 1500)
          return
        }
        timer = window.setTimeout(tick, 90)
        return
      }

      index -= 1
      setTyped(PLACEHOLDER_FULL.slice(0, Math.max(index, 0)))
      if (index <= 0) {
        deleting = false
        timer = window.setTimeout(tick, 450)
        return
      }
      timer = window.setTimeout(tick, 48)
    }

    timer = window.setTimeout(tick, 350)
    return () => window.clearTimeout(timer)
  }, [showAnimation])

  return (
    <div className="join">
      <div className="join__glow join__glow--a" aria-hidden />
      <div className="join__glow join__glow--b" aria-hidden />
      <main className="join__panel">
        <Logo size="lg" />
        <p className="join__eyebrow">Private messaging</p>
        <h1 className="join__title">
          Conversations that stay intentional.
        </h1>
        <p className="join__copy">
          Choose a display name to begin. Online users remain private and appear
          only when searched by their exact name.
        </p>
        <form
          className="join__form"
          onSubmit={(event) => {
            event.preventDefault()
            onJoin(name)
          }}
        >
          <label className="join__label" htmlFor="name">
            Display name
          </label>
          <div className="join__field">
            {showAnimation ? (
              <span className="join__placeholder" aria-hidden>
                {typed}
                <span className="join__caret" />
              </span>
            ) : null}
            <input
              id="name"
              name="name"
              className="join__input"
              value={name}
              placeholder=""
              autoComplete="nickname"
              maxLength={32}
              autoFocus
              required
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {error ? <p className="join__error">{error}</p> : null}
          <button className="join__button" type="submit" disabled={joining}>
            {joining ? 'Signing in…' : 'Continue'}
          </button>
        </form>
      </main>
    </div>
  )
}
