import { io, Socket } from 'socket.io-client'
import type { ConversationSummary, Message, MessageStatus, User } from './types'
import { apiUrl } from './api'

type Ack<T> = T & { error?: string }

export type ClientToServer = {
  join: (
    payload: { name: string },
    callback: (res: Ack<{ user: User; conversations: ConversationSummary[] }>) => void,
  ) => void
  'users:search': (
    payload: { name: string },
    callback: (res: Ack<{ users: User[] }>) => void,
  ) => void
  'conversation:start': (
    payload: { otherUserId: string },
    callback: (res: Ack<{ conversation: ConversationSummary }>) => void,
  ) => void
  'conversation:open': (
    payload: { conversationId: string },
    callback: (res: Ack<{ conversation: ConversationSummary; messages: Message[] }>) => void,
  ) => void
  'conversation:blur': () => void
  'message:send': (
    payload: { conversationId: string; text: string },
    callback: (res: Ack<{ message: Message }>) => void,
  ) => void
  'message:photo': (
    payload: {
      conversationId: string
      data: string
      mime: string
      fileName: string
    },
    callback: (res: Ack<{ message: Message }>) => void,
  ) => void
  'message:sticker': (
    payload: { conversationId: string; sticker: string },
    callback: (res: Ack<{ message: Message }>) => void,
  ) => void
  'conversation:delete': (
    payload: { conversationId: string },
    callback: (res: Ack<{ ok: boolean }>) => void,
  ) => void
  'message:react': (
    payload: { conversationId: string; messageId: string; emoji: string },
    callback: (res: Ack<{ reactions: Record<string, string> }>) => void,
  ) => void
}

export type ServerToClient = {
  'conversation:upsert': (conversation: ConversationSummary) => void
  'conversation:deleted': (payload: { conversationId: string }) => void
  'message:new': (message: Message) => void
  'message:expired': (payload: { conversationId: string; messageId: string }) => void
  'message:status': (payload: {
    conversationId: string
    updates: { id: string; status: MessageStatus }[]
  }) => void
  'message:reacted': (payload: {
    conversationId: string
    messageId: string
    reactions: Record<string, string>
  }) => void
  'presence:update': (payload: {
    userId: string
    online: boolean
    conversationId: string
  }) => void
}

export type AppSocket = Socket<ServerToClient, ClientToServer>

export function createSocket(): AppSocket {
  return io(apiUrl(''), {
    autoConnect: false,
    transports: ['websocket', 'polling'],
  })
}
