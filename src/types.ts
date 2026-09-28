export type MessageStatus = 'sent' | 'delivered' | 'read'

export type CallMode = 'audio' | 'video'

export type CallReason = 'ended' | 'rejected' | 'disconnected' | 'failed'

export type User = {
  id: string
  name: string
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

export type CallSignal =
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; candidate: RTCIceCandidateInit }

export const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '👍'] as const

export const STICKERS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '🤩', '😎',
  '🥳', '😇', '🤗', '🤔', '😴', '😭', '😤', '🤯',
  '🥰', '😘', '😏', '🙄', '😳', '🫠', '🫡', '😈',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '✌️', '🤝',
  '❤️', '🔥', '⭐', '✨', '🎉', '💯', '✅', '🚀',
  '🐱', '🐶', '🐼', '🦊', '🐸', '🦄', '🐝', '🌸',
] as const
