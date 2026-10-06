import { useState } from 'react'
import { apiUrl } from '../api'

type CryptoChickenProps = {
  fromName: string
  conversationId: string
  peerLabel: string
  onShareLink: (text: string) => void
}

export function CryptoChicken({
  fromName,
  conversationId,
  peerLabel,
  onShareLink,
}: CryptoChickenProps) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('5')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createCharge() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(apiUrl('/api/crypto/charge'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          note,
          fromName,
          conversationId,
        }),
      })
      const payload = (await response.json()) as {
        error?: string
        hostedUrl?: string
        amount?: string
        currency?: string
      }
      if (!response.ok || !payload.hostedUrl) {
        throw new Error(payload.error || 'Could not create crypto payment.')
      }

      const shareText = `🐔 Crypto for ${peerLabel}: $${payload.amount || amount} ${payload.currency || 'USD'} — pay here: ${payload.hostedUrl}`
      onShareLink(shareText)
      window.open(payload.hostedUrl, '_blank', 'noopener,noreferrer')
      setOpen(false)
      setNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`crypto-chicken${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="crypto-chicken__toggle"
        onClick={() => {
          setOpen((value) => !value)
          setError(null)
        }}
        aria-expanded={open}
        aria-label="Send crypto with the chicken"
        title="Send crypto"
      >
        <span className="crypto-chicken__emoji" aria-hidden>
          🐔
        </span>
        <span className="crypto-chicken__label">Send crypto</span>
      </button>

      {open ? (
        <div className="crypto-chicken__panel" role="dialog" aria-label="Send crypto">
          <p className="crypto-chicken__copy">
            Pay with Coinbase Commerce. The chicken opens a secure crypto checkout.
          </p>
          <label className="crypto-chicken__field">
            <span>Amount (USD)</span>
            <input
              className="crypto-chicken__input"
              type="number"
              min="1"
              max="10000"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="crypto-chicken__field">
            <span>Note (optional)</span>
            <input
              className="crypto-chicken__input"
              type="text"
              maxLength={120}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={`For ${peerLabel}`}
            />
          </label>
          {error ? (
            <p className="crypto-chicken__error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className="crypto-chicken__pay"
            disabled={busy}
            onClick={() => void createCharge()}
          >
            {busy ? 'Opening…' : '🐔 Pay with crypto'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
