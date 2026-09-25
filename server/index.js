import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3001
const DEMO_NAME = 'dolly'
const PHOTO_TTL_MS = 10 * 60 * 1000
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
 *  reactions?: Record<string, string>
 * }} Message */
/** @typedef {{ id: string, participants: [string, string], names: Record<string, string>, createdAt: number }} Conversation */
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
/** @type {Map<string, string | null>} */
const viewingConversation = new Map()

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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
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

function publicMessage(message) {
  const status = message.status || 'sent'
  const reactions = message.reactions || {}
  const base = {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    createdAt: message.createdAt,
    status,
    reactions,
  }

  if (message.type === 'sticker') {
    return {
      ...base,
      type: 'sticker',
      text: 'Sticker',
      sticker: message.sticker,
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

function previewText(message) {
  if (!message) return null
  if (message.type === 'photo') {
    return message.expired ? 'Photo disappeared' : 'Photo'
  }
  if (message.type === 'sticker') return 'Sticker'
  return message.text
}

function conversationFor(userId, conversation) {
  const otherId = conversation.participants.find((id) => id !== userId)
  const liveOther = usersById.get(otherId)
  const messages = messagesByConversation.get(conversation.id) || []
  const last = messages[messages.length - 1]
  return {
    id: conversation.id,
    other: {
      id: otherId,
      name: liveOther?.name || conversation.names[otherId] || 'Someone',
    },
    otherOnline: Boolean(liveOther),
    createdAt: conversation.createdAt,
    lastMessage: last
      ? {
          text: previewText(publicMessage(last)) || '',
          createdAt: last.createdAt,
          senderId: last.senderId,
        }
      : null,
  }
}

function notifyPresence(userId, online) {
  for (const conversation of conversations.values()) {
    if (!conversation.participants.includes(userId)) continue
    const otherId = conversation.participants.find((id) => id !== userId)
    if (!otherId) continue
    io.to(`user:${otherId}`).emit('presence:update', {
      userId,
      online,
      conversationId: conversation.id,
    })
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

function findConversationBetween(a, b) {
  return [...conversations.values()].find(
    (c) =>
      c.participants.includes(a) &&
      c.participants.includes(b) &&
      c.participants.length === 2,
  )
}

function applyDeliveryAndRead(conversation, message) {
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

function publishMessage(conversation, message) {
  if (!message.status) message.status = 'sent'
  if (!message.reactions) message.reactions = {}

  const list = messagesByConversation.get(conversation.id) || []
  list.push(message)
  messagesByConversation.set(conversation.id, list)

  const payload = publicMessage(message)
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
  const record = photos.get(photoId)
  if (record) {
    clearTimeout(record.timer)
    photos.delete(photoId)
  }

  const list = messagesByConversation.get(conversationId)
  const conversation = conversations.get(conversationId)
  if (!list || !conversation) return

  const message = list.find((m) => m.id === messageId)
  if (!message || message.type !== 'photo') return

  message.expired = true
  message.photoId = undefined

  for (const participantId of conversation.participants) {
    io.to(`user:${participantId}`).emit('message:expired', {
      conversationId,
      messageId,
    })
    io.to(`user:${participantId}`).emit(
      'conversation:upsert',
      conversationFor(participantId, conversation),
    )
  }
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
    socket.join(`user:${user.id}`)
    notifyPresence(user.id, true)

    callback?.({
      user: publicUser(user),
      conversations: listConversationsFor(user.id),
    })
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
      .filter(
        (u) =>
          u.id !== me.id && u.name.toLowerCase() === query,
      )
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
      publicMessage,
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

  socket.on('message:send', ({ conversationId, text }, callback) => {
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
    }

    publishMessage(conversation, message)
    callback?.({ message: publicMessage(message) })
    maybeDemoReply(conversation, me, trimmed)
  })

  socket.on('message:sticker', ({ conversationId, sticker }, callback) => {
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
    }

    publishMessage(conversation, message)
    callback?.({ message: publicMessage(message) })
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
    ({ conversationId, data, mime, fileName }, callback) => {
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
      const expiresAt = createdAt + PHOTO_TTL_MS
      const safeName = String(fileName || 'photo.jpg')
        .replace(/[^\w.\- ()]/g, '_')
        .slice(0, 80)

      const timer = setTimeout(() => {
        expirePhoto(photoId, conversationId, messageId)
      }, PHOTO_TTL_MS)

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
      }

      publishMessage(conversation, message)
      callback?.({ message: publicMessage(message) })
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

    const list = messagesByConversation.get(conversationId) || []
    for (const message of list) {
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

  socket.on('disconnect', () => {
    const user = usersBySocket.get(socket.id)
    if (!user || user.isDemo) return

    usersBySocket.delete(socket.id)
    usersById.delete(user.id)
    viewingConversation.delete(user.id)
    notifyPresence(user.id, false)
  })
})

const distPath = join(__dirname, '..', 'dist')
if (existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('/{*path}', (_req, res) => {
    res.sendFile(join(distPath, 'index.html'))
  })
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`chatriv server on http://0.0.0.0:${PORT}`)
  console.log(`demo account online: search “${DEMO_NAME}”`)
})
