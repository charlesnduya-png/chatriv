import { Logo } from './Logo'

type JoinScreenProps = {
  onJoin: (name: string) => void
  joining: boolean
  error: string | null
}

export function JoinScreen({ onJoin, joining, error }: JoinScreenProps) {
  return (
    <div className="join">
      <div className="join__glow join__glow--a" aria-hidden />
      <div className="join__glow join__glow--b" aria-hidden />
      <main className="join__panel">
        <Logo size="lg" />
        <h1 className="join__title">
          chat quiet. <span className="join__riv">riv</span> loud.
        </h1>
        <p className="join__copy">
          Pick a name, then search <strong>dolly</strong> to try a demo chat.
          Real people stay hidden until you look them up by exact name.
        </p>
        <form
          className="join__form"
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            const name = String(data.get('name') || '')
            onJoin(name)
          }}
        >
          <label className="join__label" htmlFor="name">
            Display name
          </label>
          <input
            id="name"
            name="name"
            className="join__input"
            placeholder="e.g. Maya"
            autoComplete="nickname"
            maxLength={32}
            autoFocus
            required
          />
          {error ? <p className="join__error">{error}</p> : null}
          <button className="join__button" type="submit" disabled={joining}>
            {joining ? 'Entering…' : 'Enter Chatriv'}
          </button>
        </form>
      </main>
    </div>
  )
}
