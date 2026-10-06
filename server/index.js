import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { generateJwt } from '@coinbase/cdp-sdk/auth'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3001
const DEMO_NAME = 'dolly'
const PHOTO_TTL_MS = 10 * 60 * 1000
const GROUP_MSG_TTL_MS = 5 * 60 * 1000
const IDLE_TTL_MS = 10 * 60 * 1000
const IDLE_CHECK_MS = 30 * 1000
const MAX_PHOTO_BYTES = 4 * 1024 * 1024
const ALLOWED_PHOTO_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])
const ALLOWED_STICKERS = new Set([
  '😀', '😁', '😂', '🤣', '😊', '😍', '🤩', '😎',
  '🥳', '😇', '🤗', '🤔', '😴', '😭', '😤', '🤯',
  '🥰', '😘', '😏', '🙄', '😳', '🫠', '🫡', '😈',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '✌️', '🤝',
  '❤️', '🔥', '⭐', '✨', '🎉', '💯', '✅', '🚀',
  '🐱', '🐶', '🐼', '🦊', '🐸', '🦄', '🐝', '🌸',
])

/** @typedef {{ id: string, name: string, socketId: string | null, isDemo?: boolean }} User */
/** @typedef {{
 *  id: string,
 *  conversationId: string,
 *  senderId: string,
 *  text: string,
 *  createdAt: number,
 *  type?: 'text' | 'photo' | 'sticker',
 *  sticker?: string,
 *  photoId?: string,
 *  fileName?: string,
 *  mime?: string,
 *  expiresAt?: number,
 *  expired?: boolean,
 *  status?: 'sent' | 'delivered' | 'read',
 *  reactions?: Record<string, string>,
 *  replyTo?: {
 *    id: string,
 *    senderId: string,
 *    senderName: string,
 *    text: string,
 *    type?: 'text' | 'photo' | 'sticker'
 *  }
 * }} Message */
/** @typedef {{
 *  id: string,
 *  kind?: 'dm' | 'group',
 *  name?: string,
 *  participants: string[],
 *  names: Record<string, string>,
 *  createdAt: number
 * }} Conversation */
/** @typedef {{ buffer: Buffer, mime: string, fileName: string, conversationId: string, expiresAt: number, timer: NodeJS.Timeout }} PhotoRecord */

/** @type {Map<string, User>} */
const usersBySocket = new Map()
/** @type {Map<string, User>} */
const usersById = new Map()
/** @type {Map<string, Conversation>} */
const conversations = new Map()
/** @type {Map<string, Message[]>} */
const messagesByConversation = new Map()
/** @type {Map<string, PhotoRecord>} */
const photos = new Map()
/** @type {Map<string, string>} */
const groupsByName = new Map()
/** @type {Map<string, NodeJS.Timeout>} */
const messageExpireTimers = new Map()
/** @type {Map<string, string | null>} */
const viewingConversation = new Map()
/** @typedef {{
 *  id: string,
 *  conversationId: string,
 *  mode: 'audio' | 'video',
 *  fromUserId: string,
 *  toUserId: string
 * }} CallSession */
/** @type {Map<string, CallSession>} */
const activeCalls = new Map()
/** @type {Map<string, number>} */
const lastActivityByUser = new Map()

const demoUser = {
  id: 'demo-dolly',
  name: DEMO_NAME,
  socketId: null,
  isDemo: true,
}
usersById.set(demoUser.id, demoUser)

const app = express()
const httpServer = createServer(app)

const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://chatriv.com',
  'https://www.chatriv.com',
  'https://chatriv.fly.dev',
]
const envOrigins = String(process.env.CLIENT_URLS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const allowedOrigins = [...new Set([...defaultOrigins, ...envOrigins])]

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 5 * 1024 * 1024,
})

app.use('/api', (req, res, next) => {
  const origin = String(req.headers.origin || '')
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  next()
})

app.use(express.json({ limit: '48kb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/crypto/charge', async (req, res) => {
  const apiKeyId = String(
    process.env.CDP_API_KEY_ID || process.env.COINBASE_CDP_API_KEY_ID || '',
  ).trim()
  const apiKeySecret = String(
    process.env.CDP_API_KEY_SECRET ||
      process.env.COINBASE_CDP_API_KEY_SECRET ||
      '',
  ).trim()

  if (!apiKeyId || !apiKeySecret) {
    res.status(503).json({
      error: 'Crypto payments are not configured on this server yet.',
    })
    return
  }

  const amountRaw = req.body?.amount
  const amountNumber = Number(amountRaw)
  if (!Number.isFinite(amountNumber) || amountNumber < 1 || amountNumber > 10000) {
    res.status(400).json({ error: 'Enter an amount between $1 and $10,000.' })
    return
  }

  const amount = amountNumber.toFixed(2)
  const note = String(req.body?.note || '')
    .trim()
    .slice(0, 120)
  const fromName = String(req.body?.fromName || 'Chatriv user')
    .trim()
    .slice(0, 32)
  const conversationId = String(req.body?.conversationId || '').slice(0, 64)
  const requestHost = 'business.coinbase.com'
  const requestPath = '/api/v1/checkouts'
  const requestMethod = 'POST'

  try {
    const jwt = await generateJwt({
      apiKeyId,
      apiKeySecret,
      requestMethod,
      requestHost,
      requestPath,
      expiresIn: 120,
    })

    const response = await fetch(`https://${requestHost}${requestPath}`, {
      method: requestMethod,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${jwt}`,
        'X-Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({
        amount,
        currency: 'USD',
        description: note
          ? `${fromName}: ${note}`
          : `Chatriv crypto payment from ${fromName}`,
        successRedirectUrl: 'https://chatriv.com/',
        failRedirectUrl: 'https://chatriv.com/',
        metadata: {
          source: 'chatriv-chicken',
          fromName,
          conversationId: conversationId || 'none',
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
          'Coinbase rejected this API key for Checkouts. Create a Coinbase Business account, then make a CDP Secret API key with the View scope for Checkouts.'
      }
      res.status(502).json({ error: String(message) })
      return
    }

    const hostedUrl = payload?.url
    if (!hostedUrl) {
      res.status(502).json({ error: 'Coinbase did not return a payment link.' })
      return
    }

    res.json({
      hostedUrl,
      code: payload?.id || null,
      amount: payload?.fiatAmount || amount,
      currency: payload?.fiatCurrency || payload?.currency || 'USD',
      expiresAt: payload?.expiresAt || null,
    })
  } catch (error) {
    res.status(502).json({
      error:
        error instanceof Error
          ? error.message
          : 'Could not reach Coinbase Checkout.',
    })
  }
})

app.get('/api/photos/:photoId', (req, res) => {
  const record = photos.get(req.params.photoId)
  if (!record || Date.now() >= record.expiresAt) {
    res.status(410).json({ error: 'Photo expired' })
    return
  }

  res.setHeader('Content-Type', record.mime)
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${record.fileName.replace(/"/g, '')}"`,
  )
  res.setHeader('Cache-Control', 'no-store')
  res.send(record.buffer)
})

function publicUser(user) {
  return { id: user.id, name: user.name }
}

function replyPreviewText(message) {
  if (!message) return ''
  if (message.type === 'photo') {
    return message.expired ? 'Photo disappeared' : 'Photo'
  }
  if (message.type === 'sticker') return message.sticker || 'Sticker'
  return String(message.text || '').slice(0, 140)
}

function buildReplyTo(conversation, replyToMessageId) {
  if (!replyToMessageId) return undefined
  const list = messagesByConversation.get(conversation.id) || []
  const target = list.find((item) => item.id === replyToMessageId)
  if (!target) return undefined
  const sender =
    usersById.get(target.senderId) ||
    ({ name: conversation.names?.[target.senderId] || 'Someone' })
  return {
    id: target.id,
    senderId: target.senderId,
    senderName: sender.name || 'Someone',
    text: replyPreviewText(target),
    type: target.type || 'text',
  }
}

function senderDisplayName(conversation, senderId) {
  return (
    usersById.get(senderId)?.name ||
    conversation?.names?.[senderId] ||
    'Someone'
  )
}

function publicMessage(message, conversation) {
  const status = message.status || 'sent'
  const reactions = message.reactions || {}
  const base = {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderName: senderDisplayName(conversation, message.senderId),
    createdAt: message.createdAt,
    status,
    reactions,
    replyTo: message.replyTo || undefined,
    expiresAt: message.expiresAt,
  }

  if (message.expired) {
    if (message.type === 'photo') {
      return {
        ...base,
        type: 'photo',
        text: 'Photo disappeared',
        expired: true,
        photoId: undefined,
      }
    }
    if (message.type === 'sticker') {
      return {
        ...base,
        type: 'sticker',
        text: 'Sticker disappeared',
        expired: true,
        sticker: undefined,
      }
    }
    return {
      ...base,
      type: 'text',
      text: 'Message disappeared',
      expired: true,
    }
  }

  if (message.type === 'sticker') {
    return {
      ...base,
      type: 'sticker',
      text: 'Sticker',
      sticker: message.sticker,
      expired: false,
    }
  }

  if (message.type === 'photo') {
    const expired =
      Boolean(message.expired) ||
      !message.photoId ||
      !photos.has(message.photoId) ||
      Date.now() >= (message.expiresAt || 0)

    return {
      ...base,
      text: expired ? 'Photo disappeared' : 'Photo',
      type: 'photo',
      photoId: expired ? undefined : message.photoId,
      fileName: message.fileName,
      mime: message.mime,
      expiresAt: message.expiresAt,
      expired,
    }
  }

  return {
    ...base,
    text: message.text,
    type: 'text',
    expired: false,
  }
}

function statusRank(status) {
  if (status === 'read') return 3
  if (status === 'delivered') return 2
  return 1
}

function emitStatus(conversation, updates) {
  if (!updates.length) return
  for (const participantId of conversation.participants) {
    io.to(`user:${participantId}`).emit('message:status', {
      conversationId: conversation.id,
      updates,
    })
  }
}

function setMessageStatus(conversation, message, status) {
  if (!message) return false
  if (statusRank(status) <= statusRank(message.status || 'sent')) return false
  message.status = status
  return true
}

function markMessagesRead(conversation, readerId) {
  const list = messagesByConversation.get(conversation.id) || []
  const updates = []

  for (const message of list) {
    if (message.senderId === readerId) continue
    if (setMessageStatus(conversation, message, 'read')) {
      updates.push({ id: message.id, status: 'read' })
    }
  }

  emitStatus(conversation, updates)
}

function otherParticipant(conversation, userId) {
  return conversation.participants.find((id) => id !== userId)
}

function previewText(message, conversation) {
  if (!message) return null
  const pub = publicMessage(message, conversation)
  return pub.text
}

function conversationFor(userId, conversation) {
  const messages = messagesByConversation.get(conversation.id) || []
  const last = messages[messages.length - 1]
  const lastMessage = last
    ? {
        text: previewText(last, conversation) || '',
        createdAt: last.createdAt,
        senderId: last.senderId,
      }
    : null

  if (conversation.kind === 'group') {
    return {
      id: conversation.id,
      kind: 'group',
      name: conversation.name || 'Group',
      memberCount: conversation.participants.length,
      createdAt: conversation.createdAt,
      lastMessage,
      other: {
        id: conversation.id,
        name: conversation.name || 'Group',
      },
      otherOnline: conversation.participants.some((participantId) => {
        if (participantId === userId) return false
        return Boolean(usersById.get(participantId)?.socketId)
      }),
    }
  }

  const otherId = conversation.participants.find((id) => id !== userId)
  const liveOther = otherId ? usersById.get(otherId) : null
  return {
    id: conversation.id,
    kind: 'dm',
    other: {
      id: otherId || 'unknown',
      name: liveOther?.name || (otherId ? conversation.names[otherId] : null) || 'Someone',
    },
    otherOnline: Boolean(liveOther),
    createdAt: conversation.createdAt,
    lastMessage,
  }
}

function notifyPresence(userId, online) {
  for (const conversation of conversations.values()) {
    if (!conversation.participants.includes(userId)) continue
    if (conversation.kind === 'group') {
      for (const participantId of conversation.participants) {
        if (participantId === userId) continue
        io.to(`user:${participantId}`).emit(
          'conversation:upsert',
          conversationFor(participantId, conversation),
        )
      }
      continue
    }
    const otherId = conversation.participants.find((id) => id !== userId)
    if (!otherId) continue
    io.to(`user:${otherId}`).emit('presence:update', {
      userId,
      online,
      conversationId: conversation.id,
    })
  }
}

function touchActivity(userId) {
  if (!userId || userId === demoUser.id) return
  lastActivityByUser.set(userId, Date.now())
}

function clearMessageExpireTimer(messageId) {
  const timer = messageExpireTimers.get(messageId)
  if (timer) clearTimeout(timer)
  messageExpireTimers.delete(messageId)
}

function purgeConversation(conversationId) {
  const conversation = conversations.get(conversationId)
  const list = messagesByConversation.get(conversationId) || []
  for (const message of list) {
    clearMessageExpireTimer(message.id)
    if (message.type === 'photo' && message.photoId) {
      const record = photos.get(message.photoId)
      if (record) {
        clearTimeout(record.timer)
        photos.delete(message.photoId)
      }
    }
  }
  const wasGroup = conversation?.kind === 'group'
  if (wasGroup && conversation.name) {
    groupsByName.delete(conversation.name.toLowerCase())
  }
  conversations.delete(conversationId)
  messagesByConversation.delete(conversationId)
  if (wasGroup) broadcastOpenGroups()
}

function cleanupOrphanConversations(userId) {
  for (const conversation of [...conversations.values()]) {
    if (!conversation.participants.includes(userId)) continue

    if (conversation.kind === 'group') {
      conversation.participants = conversation.participants.filter(
        (participantId) => participantId !== userId,
      )
      delete conversation.names[userId]
      if (conversation.participants.length === 0) {
        purgeConversation(conversation.id)
        continue
      }
      const someoneOnline = conversation.participants.some((participantId) => {
        const participant = usersById.get(participantId)
        return Boolean(participant && !participant.isDemo)
      })
      if (!someoneOnline) {
        for (const participantId of conversation.participants) {
          io.to(`user:${participantId}`).emit('conversation:deleted', {
            conversationId: conversation.id,
          })
        }
        purgeConversation(conversation.id)
      } else {
        for (const participantId of conversation.participants) {
          io.to(`user:${participantId}`).emit(
            'conversation:upsert',
            conversationFor(participantId, conversation),
          )
        }
      }
      continue
    }

    const someoneOnline = conversation.participants.some((participantId) => {
      const participant = usersById.get(participantId)
      return Boolean(participant && !participant.isDemo)
    })
    if (someoneOnline) continue

    for (const participantId of conversation.participants) {
      io.to(`user:${participantId}`).emit('conversation:deleted', {
        conversationId: conversation.id,
      })
    }
    purgeConversation(conversation.id)
  }
}

function removeLiveUser(user, { reason } = {}) {
  if (!user || user.isDemo) return
  if (!usersById.has(user.id)) return

  for (const [callId, call] of [...activeCalls.entries()]) {
    if (call.fromUserId !== user.id && call.toUserId !== user.id) continue
    activeCalls.delete(callId)
    const otherId =
      call.fromUserId === user.id ? call.toUserId : call.fromUserId
    io.to(`user:${otherId}`).emit('call:ended', { callId })
  }

  if (reason === 'idle' && user.socketId) {
    io.to(user.socketId).emit('session:expired', {
      reason: 'idle',
      message: 'Signed out after 10 minutes of inactivity.',
    })
  }

  const socketId = user.socketId
  if (socketId) usersBySocket.delete(socketId)
  usersById.delete(user.id)
  viewingConversation.delete(user.id)
  lastActivityByUser.delete(user.id)
  notifyPresence(user.id, false)
  cleanupOrphanConversations(user.id)

  if (socketId) {
    const sock = io.sockets.sockets.get(socketId)
    if (sock) sock.disconnect(true)
  }
}

function listConversationsFor(userId) {
  return [...conversations.values()]
    .filter((c) => c.participants.includes(userId))
    .map((c) => conversationFor(userId, c))
    .sort((a, b) => {
      const aTime = a.lastMessage?.createdAt ?? a.createdAt
      const bTime = b.lastMessage?.createdAt ?? b.createdAt
      return bTime - aTime
    })
}

function listOpenGroups() {
  return [...conversations.values()]
    .filter((c) => c.kind === 'group' && c.name)
    .map((c) => ({
      id: c.id,
      name: c.name,
      memberCount: c.participants.length,
      createdAt: c.createdAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

function broadcastOpenGroups() {
  io.emit('groups:update', { groups: listOpenGroups() })
}

function findConversationBetween(a, b) {
  return [...conversations.values()].find(
    (c) =>
      c.kind !== 'group' &&
      c.participants.includes(a) &&
      c.participants.includes(b) &&
      c.participants.length === 2,
  )
}

function applyDeliveryAndRead(conversation, message) {
  if (conversation.kind === 'group') {
    const othersOnline = conversation.participants.some((participantId) => {
      if (participantId === message.senderId) return false
      const participant = usersById.get(participantId)
      return Boolean(participant?.socketId || participant?.isDemo)
    })
    if (othersOnline) {
      if (setMessageStatus(conversation, message, 'delivered')) {
        emitStatus(conversation, [{ id: message.id, status: 'delivered' }])
      }
    }
    const someoneViewing = conversation.participants.some(
      (participantId) =>
        participantId !== message.senderId &&
        viewingConversation.get(participantId) === conversation.id,
    )
    if (someoneViewing) {
      setTimeout(() => {
        if (!conversations.has(conversation.id)) return
        if (setMessageStatus(conversation, message, 'read')) {
          emitStatus(conversation, [{ id: message.id, status: 'read' }])
        }
      }, 0)
    }
    return
  }

  const recipientId = otherParticipant(conversation, message.senderId)
  const recipient = usersById.get(recipientId)

  if (!recipient) return

  if (recipient.socketId || recipient.isDemo) {
    if (setMessageStatus(conversation, message, 'delivered')) {
      emitStatus(conversation, [{ id: message.id, status: 'delivered' }])
    }
  }

  const viewing = viewingConversation.get(recipientId) === conversation.id
  if (viewing || recipient.isDemo) {
    const delay = recipient.isDemo ? 900 : 0
    setTimeout(() => {
      if (!conversations.has(conversation.id)) return
      if (setMessageStatus(conversation, message, 'read')) {
        emitStatus(conversation, [{ id: message.id, status: 'read' }])
      }
    }, delay)
  }
}

function emitMessageExpired(conversation, messageId) {
  for (const participantId of conversation.participants) {
    io.to(`user:${participantId}`).emit('message:expired', {
      conversationId: conversation.id,
      messageId,
    })
    io.to(`user:${participantId}`).emit(
      'conversation:upsert',
      conversationFor(participantId, conversation),
    )
  }
}

function expireMessage(conversationId, messageId) {
  clearMessageExpireTimer(messageId)

  const list = messagesByConversation.get(conversationId)
  const conversation = conversations.get(conversationId)
  if (!list || !conversation) return

  const message = list.find((m) => m.id === messageId)
  if (!message || message.expired) return

  if (message.type === 'photo' && message.photoId) {
    const record = photos.get(message.photoId)
    if (record) {
      clearTimeout(record.timer)
      photos.delete(message.photoId)
    }
    message.photoId = undefined
  }

  message.expired = true
  if (message.type === 'sticker') {
    message.sticker = undefined
    message.text = 'Sticker disappeared'
  } else if (message.type === 'photo') {
    message.text = 'Photo disappeared'
  } else {
    message.text = 'Message disappeared'
  }

  emitMessageExpired(conversation, messageId)
}

function scheduleGroupExpiry(conversation, message) {
  if (conversation.kind !== 'group') return
  const ttl = GROUP_MSG_TTL_MS
  message.expiresAt = (message.createdAt || Date.now()) + ttl
  clearMessageExpireTimer(message.id)

  if (message.type === 'photo' && message.photoId) {
    const record = photos.get(message.photoId)
    if (record) {
      clearTimeout(record.timer)
      record.expiresAt = message.expiresAt
      record.timer = setTimeout(() => {
        expireMessage(conversation.id, message.id)
      }, ttl)
      return
    }
  }

  const timer = setTimeout(() => {
    expireMessage(conversation.id, message.id)
  }, ttl)
  messageExpireTimers.set(message.id, timer)
}

function publishMessage(conversation, message) {
  if (!message.status) message.status = 'sent'
  if (!message.reactions) message.reactions = {}

  const list = messagesByConversation.get(conversation.id) || []
  list.push(message)
  messagesByConversation.set(conversation.id, list)
  scheduleGroupExpiry(conversation, message)

  const payload = publicMessage(message, conversation)
  for (const participantId of conversation.participants) {
    io.to(`user:${participantId}`).emit('message:new', payload)
    io.to(`user:${participantId}`).emit(
      'conversation:upsert',
      conversationFor(participantId, conversation),
    )
  }

  applyDeliveryAndRead(conversation, message)
}

function expirePhoto(photoId, conversationId, messageId) {
  expireMessage(conversationId, messageId)
}

function demoReply(text) {
  const lower = text.toLowerCase()
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return 'Hey! I’m Dolly, the demo account. Ask me anything about the chat.'
  }
  if (lower.includes('sticker')) {
    return 'Love stickers! Tap the sticker button next to Photo to send one.'
  }
  if (lower.includes('photo') || lower.includes('picture') || lower.includes('image')) {
    return 'Nice! Photos stay for 10 minutes — the other person can Save before they disappear.'
  }
  if (lower.includes('delete')) {
    return 'Yep — hit Delete conversation and the whole thread vanishes for both of us.'
  }
  if (lower.includes('help') || lower.includes('how')) {
    return 'Search someone’s exact name to find them. Online people stay hidden until then.'
  }
  if (lower.includes('bye') || lower.includes('thanks')) {
    return 'Anytime. Search “dolly” again anytime you want to try things out.'
  }
  return `Got it — “${text.slice(0, 80)}”. I’m always online so you can demo messaging.`
}

function maybeDemoReply(conversation, fromUser, incomingText) {
  if (conversation.kind === 'group') return
  if (!conversation.participants.includes(demoUser.id)) return
  if (fromUser.id === demoUser.id) return

  setTimeout(() => {
    if (!conversations.has(conversation.id)) return
    publishMessage(conversation, {
      id: randomUUID(),
      conversationId: conversation.id,
      senderId: demoUser.id,
      text: demoReply(incomingText),
      createdAt: Date.now(),
      type: 'text',
      status: 'sent',
    })
  }, 650)
}

function maybeDemoPhotoReply(conversation, fromUser) {
  if (conversation.kind === 'group') return
  if (!conversation.participants.includes(demoUser.id)) return
  if (fromUser.id === demoUser.id) return

  setTimeout(() => {
    if (!conversations.has(conversation.id)) return
    publishMessage(conversation, {
      id: randomUUID(),
      conversationId: conversation.id,
      senderId: demoUser.id,
      text: 'Got your photo! You’ve got 10 minutes to Save it on your side before it disappears.',
      createdAt: Date.now(),
      type: 'text',
      status: 'sent',
    })
  }, 700)
}

io.on('connection', (socket) => {
  socket.onAny(() => {
    const user = usersBySocket.get(socket.id)
    if (user) touchActivity(user.id)
  })

  socket.on('join', ({ name }, callback) => {
    const trimmed = String(name || '').trim().slice(0, 32)
    if (!trimmed) {
      callback?.({ error: 'Name is required' })
      return
    }

    if (trimmed.toLowerCase() === DEMO_NAME) {
      callback?.({ error: 'dolly is the demo account — pick another name' })
      return
    }

    const taken = [...usersById.values()].some(
      (u) => u.name.toLowerCase() === trimmed.toLowerCase(),
    )
    if (taken) {
      callback?.({ error: 'That name is already in use' })
      return
    }

    const user = { id: randomUUID(), name: trimmed, socketId: socket.id }
    usersBySocket.set(socket.id, user)
    usersById.set(user.id, user)
    viewingConversation.set(user.id, null)
    touchActivity(user.id)
    socket.join(`user:${user.id}`)
    notifyPresence(user.id, true)

    callback?.({
      user: publicUser(user),
      conversations: listConversationsFor(user.id),
      openGroups: listOpenGroups(),
      idleTimeoutMs: IDLE_TTL_MS,
    })
  })

  socket.on('groups:list', (callback) => {
    const me = usersBySocket.get(socket.id)
    if (!me) {
      callback?.({ error: 'Not joined' })
      return
    }
    callback?.({ groups: listOpenGroups() })
  })

  socket.on('users:search', ({ name }, callback) => {
    const me = usersBySocket.get(socket.id)
    if (!me) {
      callback?.({ error: 'Not joined' })
      return
    }

    const query = String(name || '').trim().toLowerCase()
    if (query.length < 1) {
      callback?.({ users: [] })
      return
    }

    const users = [...usersById.values()]
      .filter((u) => {
        if (u.id === me.id) return false
        const n = u.name.toLowerCase()
        return n === query || n.startsWith(query)
      })
      .sort((a, b) => {
        const aExact = a.name.toLowerCase() === query ? 0 : 1
        const bExact = b.name.toLowerCase() === query ? 0 : 1
        if (aExact !== bExact) return aExact - bExact
        return a.name.localeCompare(b.name)
      })
      .slice(0, 20)
      .map(publicUser)

    callback?.({ users })
  })

  socket.on('conversation:start', ({ otherUserId }, callback) => {
    const me = usersBySocket.get(socket.id)
    if (!me) {
      callback?.({ error: 'Not joined' })
      return
    }
    const other = usersById.get(otherUserId)
    if (!other || otherUserId === me.id) {
      callback?.({ error: 'Nobody online with that name' })
      return
    }

    let conversation = findConversationBetween(me.id, otherUserId)
    const isNew = !conversation
    if (!conversation) {
      conversation = {
        id: randomUUID(),
        kind: 'dm',
        participants: [me.id, otherUserId],
        names: {
          [me.id]: me.name,
          [otherUserId]: other.name,
        },
        createdAt: Date.now(),
      }
      conversations.set(conversation.id, conversation)
      messagesByConversation.set(conversation.id, [])
    }

    const payload = conversationFor(me.id, conversation)
    callback?.({ conversation: payload })

    if (other.socketId) {
      io.to(`user:${other.id}`).emit(
        'conversation:upsert',
        conversationFor(other.id, conversation),
      )
    }

    if (isNew && other.isDemo) {
      setTimeout(() => {
        if (!conversations.has(conversation.id)) return
        publishMessage(conversation, {
          id: randomUUID(),
          conversationId: conversation.id,
          senderId: demoUser.id,
          text: `Hi ${me.name}! I’m Dolly. Send a message or a photo — photos can be saved for 10 minutes, then they vanish.`,
          createdAt: Date.now(),
          type: 'text',
          status: 'sent',
        })
      }, 400)
    }
  })

  socket.on('group:create', ({ name }, callback) => {
    const me = usersBySocket.get(socket.id)
    if (!me) {
      callback?.({ error: 'Not joined' })
      return
    }

    const trimmed = String(name || '').trim().slice(0, 32)
    if (!trimmed) {
      callback?.({ error: 'Group name is required' })
      return
    }

    const key = trimmed.toLowerCase()
    if (groupsByName.has(key)) {
      callback?.({ error: 'That group name is already taken' })
      return
    }

    const conversation = {
      id: randomUUID(),
      kind: 'group',
      name: trimmed,
      participants: [me.id],
      names: { [me.id]: me.name },
      createdAt: Date.now(),
    }
    conversations.set(conversation.id, conversation)
    messagesByConversation.set(conversation.id, [])
    groupsByName.set(key, conversation.id)

    const payload = conversationFor(me.id, conversation)
    broadcastOpenGroups()
    callback?.({ conversation: payload })
  })

  socket.on('group:join', ({ name }, callback) => {
    const me = usersBySocket.get(socket.id)
    if (!me) {
      callback?.({ error: 'Not joined' })
      return
    }

    const trimmed = String(name || '').trim().slice(0, 32)
    if (!trimmed) {
      callback?.({ error: 'Group name is required' })
      return
    }

    const conversationId = groupsByName.get(trimmed.toLowerCase())
    const conversation = conversationId
      ? conversations.get(conversationId)
      : null
    if (!conversation || conversation.kind !== 'group') {
      callback?.({ error: 'No group with that exact name' })
      return
    }

    const alreadyIn = conversation.participants.includes(me.id)
    if (!alreadyIn) {
      conversation.participants.push(me.id)
      conversation.names[me.id] = me.name
      for (const participantId of conversation.participants) {
        io.to(`user:${participantId}`).emit(
          'conversation:upsert',
          conversationFor(participantId, conversation),
        )
      }
      broadcastOpenGroups()
    }

    callback?.({ conversation: conversationFor(me.id, conversation) })
  })

  socket.on('conversation:open', ({ conversationId }, callback) => {
    const me = usersBySocket.get(socket.id)
    const conversation = conversations.get(conversationId)
    if (!me || !conversation || !conversation.participants.includes(me.id)) {
      callback?.({ error: 'Conversation not found' })
      return
    }

    viewingConversation.set(me.id, conversationId)
    markMessagesRead(conversation, me.id)

    const messages = (messagesByConversation.get(conversationId) || []).map(
      (message) => publicMessage(message, conversation),
    )

    callback?.({
      conversation: conversationFor(me.id, conversation),
      messages,
    })
  })

  socket.on('conversation:blur', () => {
    const me = usersBySocket.get(socket.id)
    if (!me) return
    viewingConversation.set(me.id, null)
  })

  socket.on('presence:ping', (callback) => {
    const me = usersBySocket.get(socket.id)
    if (!me) {
      callback?.({ error: 'Not joined' })
      return
    }
    touchActivity(me.id)
    callback?.({ ok: true })
  })

  socket.on('message:send', ({ conversationId, text, replyToMessageId }, callback) => {
    const me = usersBySocket.get(socket.id)
    const conversation = conversations.get(conversationId)
    const trimmed = String(text || '').trim().slice(0, 2000)

    if (!me || !conversation || !conversation.participants.includes(me.id)) {
      callback?.({ error: 'Conversation not found' })
      return
    }
    if (!trimmed) {
      callback?.({ error: 'Message is empty' })
      return
    }

    const message = {
      id: randomUUID(),
      conversationId,
      senderId: me.id,
      text: trimmed,
      createdAt: Date.now(),
      type: 'text',
      status: 'sent',
      reactions: {},
      replyTo: buildReplyTo(conversation, replyToMessageId),
    }

    publishMessage(conversation, message)
    callback?.({ message: publicMessage(message, conversation) })
    maybeDemoReply(conversation, me, trimmed)
  })

  socket.on('message:sticker', ({ conversationId, sticker, replyToMessageId }, callback) => {
    const me = usersBySocket.get(socket.id)
    const conversation = conversations.get(conversationId)
    const pick = String(sticker || '')

    if (!me || !conversation || !conversation.participants.includes(me.id)) {
      callback?.({ error: 'Conversation not found' })
      return
    }
    if (!ALLOWED_STICKERS.has(pick)) {
      callback?.({ error: 'Sticker not available' })
      return
    }

    const message = {
      id: randomUUID(),
      conversationId,
      senderId: me.id,
      text: 'Sticker',
      sticker: pick,
      createdAt: Date.now(),
      type: 'sticker',
      status: 'sent',
      reactions: {},
      replyTo: buildReplyTo(conversation, replyToMessageId),
    }

    publishMessage(conversation, message)
    callback?.({ message: publicMessage(message, conversation) })
    maybeDemoReply(conversation, me, 'sticker')
  })

  socket.on('message:react', ({ conversationId, messageId, emoji }, callback) => {
    const me = usersBySocket.get(socket.id)
    const conversation = conversations.get(conversationId)
    const allowed = new Set(['❤️', '😂', '😮', '😢', '😡', '👍'])

    if (!me || !conversation || !conversation.participants.includes(me.id)) {
      callback?.({ error: 'Conversation not found' })
      return
    }

    const pick = String(emoji || '')
    if (!allowed.has(pick)) {
      callback?.({ error: 'Reaction not allowed' })
      return
    }

    const list = messagesByConversation.get(conversationId) || []
    const message = list.find((item) => item.id === messageId)
    if (!message) {
      callback?.({ error: 'Message not found' })
      return
    }

    if (!message.reactions) message.reactions = {}

    if (message.reactions[me.id] === pick) {
      delete message.reactions[me.id]
    } else {
      message.reactions[me.id] = pick
    }

    const payload = {
      conversationId,
      messageId,
      reactions: { ...message.reactions },
    }

    for (const participantId of conversation.participants) {
      io.to(`user:${participantId}`).emit('message:reacted', payload)
    }

    callback?.({ reactions: payload.reactions })

    // Dolly often hearts back on demos.
    if (
      conversation.participants.includes(demoUser.id) &&
      me.id !== demoUser.id &&
      pick === '❤️' &&
      !message.reactions[demoUser.id]
    ) {
      setTimeout(() => {
        if (!conversations.has(conversation.id) || !message.reactions) return
        message.reactions[demoUser.id] = '❤️'
        const demoPayload = {
          conversationId,
          messageId,
          reactions: { ...message.reactions },
        }
        for (const participantId of conversation.participants) {
          io.to(`user:${participantId}`).emit('message:reacted', demoPayload)
        }
      }, 500)
    }
  })

  socket.on(
    'message:photo',
    ({ conversationId, data, mime, fileName, replyToMessageId }, callback) => {
      const me = usersBySocket.get(socket.id)
      const conversation = conversations.get(conversationId)

      if (!me || !conversation || !conversation.participants.includes(me.id)) {
        callback?.({ error: 'Conversation not found' })
        return
      }

      const type = String(mime || '').toLowerCase()
      if (!ALLOWED_PHOTO_TYPES.has(type)) {
        callback?.({ error: 'Only JPG, PNG, WEBP, or GIF photos are allowed' })
        return
      }

      const raw = String(data || '')
      const base64 = raw.includes(',') ? raw.split(',')[1] : raw
      let buffer
      try {
        buffer = Buffer.from(base64, 'base64')
      } catch {
        callback?.({ error: 'Invalid photo data' })
        return
      }

      if (!buffer.length) {
        callback?.({ error: 'Photo is empty' })
        return
      }
      if (buffer.length > MAX_PHOTO_BYTES) {
        callback?.({ error: 'Photo must be under 4 MB' })
        return
      }

      const photoId = randomUUID()
      const messageId = randomUUID()
      const createdAt = Date.now()
      const ttl =
        conversation.kind === 'group' ? GROUP_MSG_TTL_MS : PHOTO_TTL_MS
      const expiresAt = createdAt + ttl
      const safeName = String(fileName || 'photo.jpg')
        .replace(/[^\w.\- ()]/g, '_')
        .slice(0, 80)

      const timer = setTimeout(() => {
        expirePhoto(photoId, conversationId, messageId)
      }, ttl)

      photos.set(photoId, {
        buffer,
        mime: type,
        fileName: safeName,
        conversationId,
        expiresAt,
        timer,
      })

      const message = {
        id: messageId,
        conversationId,
        senderId: me.id,
        text: 'Photo',
        createdAt,
        type: 'photo',
        photoId,
        fileName: safeName,
        mime: type,
        expiresAt,
        expired: false,
        status: 'sent',
        reactions: {},
        replyTo: buildReplyTo(conversation, replyToMessageId),
      }

      publishMessage(conversation, message)
      callback?.({ message: publicMessage(message, conversation) })
      maybeDemoPhotoReply(conversation, me)
    },
  )

  socket.on('conversation:delete', ({ conversationId }, callback) => {
    const me = usersBySocket.get(socket.id)
    const conversation = conversations.get(conversationId)

    if (!me || !conversation || !conversation.participants.includes(me.id)) {
      callback?.({ error: 'Conversation not found' })
      return
    }

    if (conversation.kind === 'group') {
      conversation.participants = conversation.participants.filter(
        (participantId) => participantId !== me.id,
      )
      delete conversation.names[me.id]
      io.to(`user:${me.id}`).emit('conversation:deleted', { conversationId })

      if (conversation.participants.length === 0) {
        purgeConversation(conversationId)
      } else {
        for (const participantId of conversation.participants) {
          io.to(`user:${participantId}`).emit(
            'conversation:upsert',
            conversationFor(participantId, conversation),
          )
        }
        broadcastOpenGroups()
      }

      callback?.({ ok: true })
      return
    }

    const list = messagesByConversation.get(conversationId) || []
    for (const message of list) {
      clearMessageExpireTimer(message.id)
      if (message.type === 'photo' && message.photoId) {
        const record = photos.get(message.photoId)
        if (record) {
          clearTimeout(record.timer)
          photos.delete(message.photoId)
        }
      }
    }

    conversations.delete(conversationId)
    messagesByConversation.delete(conversationId)

    for (const participantId of conversation.participants) {
      io.to(`user:${participantId}`).emit('conversation:deleted', {
        conversationId,
      })
    }

    callback?.({ ok: true })
  })

  socket.on('call:invite', ({ conversationId, mode }, callback) => {
    const me = usersBySocket.get(socket.id)
    if (!me) {
      callback?.({ error: 'Not joined' })
      return
    }
    const conversation = conversations.get(conversationId)
    if (!conversation || !conversation.participants.includes(me.id)) {
      callback?.({ error: 'Conversation not found' })
      return
    }
    if (conversation.kind === 'group') {
      callback?.({ error: 'Calls are only for direct chats' })
      return
    }
    const callMode = mode === 'video' ? 'video' : 'audio'
    const otherId = otherParticipant(conversation, me.id)
    const other = usersById.get(otherId)
    if (!other?.socketId) {
      callback?.({ error: 'That person is offline' })
      return
    }
    for (const call of activeCalls.values()) {
      if (call.fromUserId === me.id || call.toUserId === me.id) {
        callback?.({ error: 'You are already in a call' })
        return
      }
      if (call.fromUserId === otherId || call.toUserId === otherId) {
        callback?.({ error: 'That person is already in a call' })
        return
      }
    }
    const callId = randomUUID()
    activeCalls.set(callId, {
      id: callId,
      conversationId,
      mode: callMode,
      fromUserId: me.id,
      toUserId: otherId,
    })
    io.to(`user:${otherId}`).emit('call:incoming', {
      callId,
      conversationId,
      mode: callMode,
      from: publicUser(me),
    })
    callback?.({
      callId,
      conversationId,
      mode: callMode,
      to: publicUser(other),
    })
  })

  socket.on('call:accept', ({ callId }, callback) => {
    const me = usersBySocket.get(socket.id)
    if (!me) {
      callback?.({ error: 'Not joined' })
      return
    }
    const call = activeCalls.get(callId)
    if (!call || call.toUserId !== me.id) {
      callback?.({ error: 'Call not found' })
      return
    }
    io.to(`user:${call.fromUserId}`).emit('call:accepted', {
      callId: call.id,
      conversationId: call.conversationId,
      mode: call.mode,
    })
    callback?.({ ok: true })
  })

  socket.on('call:reject', ({ callId }, callback) => {
    const me = usersBySocket.get(socket.id)
    if (!me) {
      callback?.({ error: 'Not joined' })
      return
    }
    const call = activeCalls.get(callId)
    if (!call || (call.toUserId !== me.id && call.fromUserId !== me.id)) {
      callback?.({ error: 'Call not found' })
      return
    }
    activeCalls.delete(callId)
    const otherId = call.fromUserId === me.id ? call.toUserId : call.fromUserId
    io.to(`user:${otherId}`).emit('call:ended', { callId })
    callback?.({ ok: true })
  })

  socket.on('call:end', ({ callId }, callback) => {
    const me = usersBySocket.get(socket.id)
    if (!me) {
      callback?.({ error: 'Not joined' })
      return
    }
    const call = activeCalls.get(callId)
    if (!call || (call.toUserId !== me.id && call.fromUserId !== me.id)) {
      callback?.({ ok: true })
      return
    }
    activeCalls.delete(callId)
    const otherId = call.fromUserId === me.id ? call.toUserId : call.fromUserId
    io.to(`user:${otherId}`).emit('call:ended', { callId })
    callback?.({ ok: true })
  })

  socket.on('call:signal', ({ callId, signal }, callback) => {
    const me = usersBySocket.get(socket.id)
    if (!me) {
      callback?.({ error: 'Not joined' })
      return
    }
    const call = activeCalls.get(callId)
    if (!call || (call.toUserId !== me.id && call.fromUserId !== me.id)) {
      callback?.({ error: 'Call not found' })
      return
    }
    const otherId = call.fromUserId === me.id ? call.toUserId : call.fromUserId
    io.to(`user:${otherId}`).emit('call:signal', { callId, signal })
    callback?.({ ok: true })
  })

  socket.on('disconnect', () => {
    const user = usersBySocket.get(socket.id)
    if (!user || user.isDemo) return
    removeLiveUser(user)
  })
})

setInterval(() => {
  const now = Date.now()
  for (const [userId, lastActive] of [...lastActivityByUser.entries()]) {
    if (now - lastActive < IDLE_TTL_MS) continue
    const user = usersById.get(userId)
    if (!user || user.isDemo) {
      lastActivityByUser.delete(userId)
      continue
    }
    removeLiveUser(user, { reason: 'idle' })
  }
}, IDLE_CHECK_MS)

const distPath = join(__dirname, '..', 'dist')
if (existsSync(distPath)) {
  app.get(['/privacy', '/privacy.html'], (_req, res) => {
    res.sendFile(join(distPath, 'privacy.html'))
  })
  app.use(express.static(distPath))
  app.get('/{*path}', (_req, res) => {
    res.sendFile(join(distPath, 'index.html'))
  })
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`chatriv server on http://0.0.0.0:${PORT}`)
  console.log(`demo account online: search “${DEMO_NAME}”`)
})
