import { generateJwt } from '@coinbase/cdp-sdk/auth'
import { randomUUID } from 'crypto'

const BUSINESS_HOST = 'business.coinbase.com'
const CHECKOUTS_PATH = '/api/v1/checkouts'

function getCdpCredentials() {
  const apiKeyId = String(
    process.env.COINBASE_CDP_API_KEY_ID || process.env.KEY_ID || '',
  ).trim()
  const apiKeySecret = String(
    process.env.COINBASE_CDP_API_KEY_SECRET || process.env.KEY_SECRET || '',
  ).trim()
  return { apiKeyId, apiKeySecret }
}

export function isCoinbaseConfigured() {
  const { apiKeyId, apiKeySecret } = getCdpCredentials()
  return Boolean(apiKeyId && apiKeySecret)
}

async function createBusinessJwt() {
  const { apiKeyId, apiKeySecret } = getCdpCredentials()
  if (!apiKeyId || !apiKeySecret) {
    throw new Error('Coinbase CDP API key is not configured.')
  }

  return generateJwt({
    apiKeyId,
    apiKeySecret,
    requestMethod: 'POST',
    requestHost: BUSINESS_HOST,
    requestPath: CHECKOUTS_PATH,
    expiresIn: 120,
  })
}

/**
 * Create a Coinbase Business Checkout payment link.
 * @param {{ amount: string, fromName: string, note?: string, conversationId?: string }} input
 */
export async function createCryptoCheckout(input) {
  const token = await createBusinessJwt()
  const description =
    input.note?.trim() ||
    `Chatriv crypto payment from ${input.fromName || 'a user'}`

  const response = await fetch(`https://${BUSINESS_HOST}${CHECKOUTS_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify({
      amount: input.amount,
      currency: 'USD',
      description: description.slice(0, 500),
      successRedirectUrl: 'https://chatriv.com/',
      failRedirectUrl: 'https://chatriv.com/',
      metadata: {
        source: 'chatriv-chicken',
        fromName: String(input.fromName || 'Chatriv').slice(0, 100),
        conversationId: String(input.conversationId || '').slice(0, 100),
      },
    }),
  })

  const raw = await response.text()
  let payload = {}
  try {
    payload = JSON.parse(raw)
  } catch {
    payload = {}
  }

  if (!response.ok) {
    let message =
      payload?.errorMessage ||
      payload?.error?.message ||
      (typeof payload?.error === 'string' ? payload.error : null) ||
      `Coinbase Checkout error (${response.status})`
    if (response.status === 403) {
      message =
        'Coinbase rejected this key for Business Checkouts. In Coinbase Developer Platform, enable Coinbase Business / Checkout permissions for this Secret API key (or create the key under a Coinbase Business account).'
    }
    const error = new Error(String(message))
    error.status = response.status
    error.payload = payload
    throw error
  }

  const hostedUrl = payload?.url
  if (!hostedUrl) {
    throw new Error('Coinbase did not return a payment link.')
  }

  return {
    hostedUrl,
    code: payload?.id || null,
    amount: payload?.fiatAmount || payload?.amount || input.amount,
    currency: payload?.fiatCurrency || payload?.currency || 'USD',
    expiresAt: payload?.expiresAt || null,
  }
}
