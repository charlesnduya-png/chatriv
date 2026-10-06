export type MessageStatus = 'sent' | 'delivered' | 'read'

export type User = {
  id: string
  name: string
}

export type MessageReply = {
  id: string
  senderId: string
  senderName: string
  text: string
  type?: 'text' | 'photo' | 'sticker'
}

export type Message = {
  id: string
  conversationId: string
  senderId: string
  text: string
  createdAt: number
  type?: 'text' | 'photo' | 'sticker'
  sticker?: string
  photoId?: string
  fileName?: string
  mime?: string
  expiresAt?: number
  expired?: boolean
  status?: MessageStatus
  reactions?: Record<string, string>
  replyTo?: MessageReply
}

export type ConversationSummary = {
  id: string
  other: User
  otherOnline: boolean
  createdAt: number
  lastMessage: {
    text: string
    createdAt: number
    senderId: string
  } | null
}

export type CallMode = 'audio' | 'video'

export type CallSignal =
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; candidate: RTCIceCandidateInit | null }

export const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '👍'] as const

export const STICKERS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '🤩', '😎',
  '🥳', '😇', '🤗', '🤔', '😴', '😭', '😤', '🤯',
  '🥰', '😘', '😏', '🙄', '😳', '🫠', '🫡', '😈',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '✌️', '🤝',
  '❤️', '🔥', '⭐', '✨', '🎉', '💯', '✅', '🚀',
  '🐱', '🐶', '🐼', '🦊', '🐸', '🦄', '🐝', '🌸',
] as const
