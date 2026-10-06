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
  senderName?: string
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
  kind?: 'dm' | 'group'
  name?: string
  memberCount?: number
  other: User
  otherOnline: boolean
  createdAt: number
  lastMessage: {
    text: string
    createdAt: number
    senderId: string
  } | null
}

export type OpenGroup = {
  id: string
  name: string
  memberCount: number
  createdAt: number
}

export type CallMode = 'audio' | 'video'

export type CallSignal =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
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

export function isGroup(conversation: ConversationSummary | null | undefined) {
  return conversation?.kind === 'group'
}

export function conversationTitle(conversation: ConversationSummary) {
  if (isGroup(conversation)) return conversation.name || 'Group'
  return conversation.other.name
}
