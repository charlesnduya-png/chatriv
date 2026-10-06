import { randomBytes, randomUUID } from 'crypto'
import { SignJWT, importJWK, importPKCS8 } from 'jose'

const CHECKOUT_HOST = 'business.coinbase.com'
const CHECKOUT_PATH = '/api/v1/checkouts'

function getCdpCredentials() {
  const apiKeyId = String(
    process.env.COINBASE_CDP_API_KEY_ID || process.env.CDP_API_KEY_ID || '',
  ).trim()
  const apiKeySecret = String(
    process.env.COINBASE_CDP_API_KEY_SECRET ||
      process.env.CDP_API_KEY_SECRET ||
      '',
  ).trim()
  return { apiKeyId, apiKeySecret }
}

function isEd25519Secret(secret) {
  try {
    return Buffer.from(secret, 'base64').length === 64
  } catch {
    return false
  }
}

async function buildEdwardsJwt(apiKeyId, apiKeySecret, uri) {
  const decoded = Buffer.from(apiKeySecret, 'base64')
  if (decoded.length !== 64) {
    throw new Error('Invalid Ed25519 key length')
  }

  const seed = decoded.subarray(0, 32)
  const publicKey = decoded.subarray(32)
  const key = await importJWK(
    {
      kty: 'OKP',
      crv: 'Ed25519',
      d: seed.toString('base64url'),
      x: publicKey.toString('base64url'),
    },
    'EdDSA',
  )

  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    sub: apiKeyId,
    iss: 'cdp',
    aud: ['cdp_service'],
    uri,
  })
    .setProtectedHeader({
      alg: 'EdDSA',
      typ: 'JWT',
      kid: apiKeyId,
      nonce: randomBytes(16).toString('hex'),
    })
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + 120)
    .sign(key)
}

async function buildEcJwt(apiKeyId, apiKeySecret, uri) {
  const pem = apiKeySecret.includes('\\n')
    ? apiKeySecret.replace(/\\n/g, '\n')
    : apiKeySecret
  const key = await importPKCS8(pem, 'ES256')
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    sub: apiKeyId,
    iss: 'cdp',
    aud: ['cdp_service'],
    uri,
  })
    .setProtectedHeader({
      alg: 'ES256',
      typ: 'JWT',
      kid: apiKeyId,
      nonce: randomBytes(16).toString('hex'),
    })
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + 120)
    .sign(key)
}

export async function generateCdpJwt({ method, host, path }) {
  const { apiKeyId, apiKeySecret } = getCdpCredentials()
  if (!apiKeyId || !apiKeySecret) {
    throw new Error('Coinbase CDP API key is not configured')
  }

  const uri = `${method.toUpperCase()} ${host}${path}`
  if (isEd25519Secret(apiKeySecret)) {
    return buildEdwardsJwt(apiKeyId, apiKeySecret, uri)
  }
  return buildEcJwt(apiKeyId, apiKeySecret, uri)
}

export function hasCdpCredentials() {
  const { apiKeyId, apiKeySecret } = getCdpCredentials()
  return Boolean(apiKeyId && apiKeySecret)
}

export async function createBusinessCheckout({
  amount,
  currency = 'USD',
  description,
  metadata = {},
}) {
  const jwt = await generateCdpJwt({
    method: 'POST',
    host: CHECKOUT_HOST,
    path: CHECKOUT_PATH,
  })

  const response = await fetch(`https://${CHECKOUT_HOST}${CHECKOUT_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify({
      amount,
      currency,
      description,
      metadata,
      successRedirectUrl: 'https://chatriv.com/',
      failRedirectUrl: 'https://chatriv.com/',
    }),
  })

  const raw = await response.text()
  let payload = {}
  try {
    payload = JSON.parse(raw)
  } catch {
    payload = { raw }
  }

  if (!response.ok) {
    let message =
      payload?.errorMessage ||
      payload?.error?.message ||
      (typeof payload?.error === 'string' ? payload.error : null) ||
      `Coinbase Checkout error (${response.status})`
    if (response.status === 403) {
      message =
        'Coinbase blocked checkout creation for this API key. In Coinbase Developer Platform, recreate the Secret API Key with View (+ Receive if shown) for Coinbase Business Checkouts, and make sure Checkouts/payments are enabled on the Business account.'
    }
    const err = new Error(String(message))
    err.status = response.status
    err.payload = payload
    throw err
  }

  return payload
}
