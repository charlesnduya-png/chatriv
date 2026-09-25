import { useEffect, useRef, useState } from 'react'
import { createSocket, type AppSocket } from './socket'
import type { ConversationSummary, Message, MessageStatus, User } from './types'
import { JoinScreen } from './components/JoinScreen'
import { ChatShell } from './components/ChatShell'
import './App.css'

function upsertConversation(
  list: ConversationSummary[],
  conversation: ConversationSummary,
) {
  const without = list.filter((c) => c.id !== conversation.id)
  return [conversation, ...without].sort((a, b) => {
    const aTime = a.lastMessage?.createdAt ?? a.createdAt
    const bTime = b.lastMessage?.createdAt ?? b.createdAt
    return bTime - aTime
  })
}

function markExpired(messages: Message[], messageId: string) {
  return messages.map((message) =>
    message.id === messageId
      ? {
          ...message,
          expired: true,
          photoId: undefined,
          text: 'Photo disappeared',
        }
      : message,
  )
}

function applyStatusUpdates(
  messages: Message[],
  updates: { id: string; status: MessageStatus }[],
) {
  const rank = { sent: 1, delivered: 2, read: 3 }
  const byId = new Map(updates.map((update) => [update.id, update.status]))
  return messages.map((message) => {
    const next = byId.get(message.id)
    if (!next) return message
    const current = message.status || 'sent'
    if (rank[next] <= rank[current]) return message
    return { ...message, status: next }
  })
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Could not read photo'))
    reader.readAsDataURL(file)
  })
}

export default function App() {
  const socketRef = useRef<AppSocket | null>(null)
  const [me, setMe] = useState<User | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [joining, setJoining] = useState(false)
  const [sendingPhoto, setSendingPhoto] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<User[]>([])
  const [searching, setSearching] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHint, setSearchHint] = useState<string | null>(null)

  useEffect(() => {
    const socket = createSocket()
    socketRef.current = socket
    socket.connect()

    socket.on('conversation:upsert', (conversation) => {
      setConversations((prev) => upsertConversation(prev, conversation))
    })
    socket.on('conversation:deleted', ({ conversationId }) => {
      setConversations((prev) => prev.filter((c) => c.id !== conversationId))
      setActiveId((current) => {
        if (current === conversationId) {
          setMessages([])
          return null
        }
        return current
      })
    })
    socket.on('message:new', (message) => {
      setActiveId((current) => {
        if (current === message.conversationId) {
          setMessages((prev) =>
            prev.some((m) => m.id === message.id) ? prev : [...prev, message],
          )
        }
        return current
      })
    })
    socket.on('message:expired', ({ conversationId, messageId }) => {
      setActiveId((current) => {
        if (current === conversationId) {
          setMessages((prev) => markExpired(prev, messageId))
        }
        return current
      })
    })
    socket.on('message:status', ({ conversationId, updates }) => {
      setActiveId((current) => {
        if (current === conversationId) {
          setMessages((prev) => applyStatusUpdates(prev, updates))
        }
        return current
      })
    })
    socket.on('presence:update', ({ userId, online, conversationId }) => {
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === conversationId && conversation.other.id === userId
            ? { ...conversation, otherOnline: online }
            : conversation,
        ),
      )
    })
    socket.on('message:reacted', ({ conversationId, messageId, reactions }) => {
      setActiveId((current) => {
        if (current === conversationId) {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === messageId ? { ...message, reactions } : message,
            ),
          )
        }
        return current
      })
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  function join(name: string) {
    const socket = socketRef.current
    if (!socket) return
    setJoining(true)
    setError(null)
    socket.emit('join', { name }, (res) => {
      setJoining(false)
      if (res.error) {
        setError(res.error)
        return
      }
      setMe(res.user)
      setConversations(res.conversations)
    })
  }

  function searchUsers(name: string) {
    const socket = socketRef.current
    if (!socket) return

    const trimmed = name.trim()
    setSearchQuery(trimmed)
    setSearchHint(null)
    setError(null)

    if (!trimmed) {
      setSearchResults([])
      setSearching(false)
      return
    }

    setSearching(true)
    socket.emit('users:search', { name: trimmed }, (res) => {
      setSearching(false)
      if (res.error) {
        setError(res.error)
        setSearchResults([])
        return
      }
      setSearchResults(res.users)
      if (res.users.length === 0) {
        setSearchHint(`No one online named “${trimmed}”.`)
      }
    })
  }

  function startChat(otherUserId: string) {
    const socket = socketRef.current
    if (!socket) return
    socket.emit('conversation:start', { otherUserId }, (res) => {
      if (res.error) {
        setError(res.error)
        return
      }
      setSearchResults([])
      setSearchQuery('')
      setSearchHint(null)
      setConversations((prev) => upsertConversation(prev, res.conversation))
      openConversation(res.conversation.id)
    })
  }

  function openConversation(conversationId: string) {
    const socket = socketRef.current
    if (!socket) return
    setError(null)
    socket.emit('conversation:open', { conversationId }, (res) => {
      if (res.error) {
        setError(res.error)
        return
      }
      setActiveId(conversationId)
      setMessages(res.messages)
      setConversations((prev) => upsertConversation(prev, res.conversation))
    })
  }

  function sendMessage(text: string) {
    const socket = socketRef.current
    if (!socket || !activeId) return
    socket.emit('message:send', { conversationId: activeId, text }, (res) => {
      if (res.error) setError(res.error)
    })
  }

  function reactToMessage(messageId: string, emoji: string) {
    const socket = socketRef.current
    if (!socket || !activeId) return
    socket.emit(
      'message:react',
      { conversationId: activeId, messageId, emoji },
      (res) => {
        if (res.error) setError(res.error)
      },
    )
  }

  async function sendPhoto(file: File) {
    const socket = socketRef.current
    if (!socket || !activeId) return

    setError(null)
    setSendingPhoto(true)
    try {
      const data = await readFileAsDataUrl(file)
      socket.emit(
        'message:photo',
        {
          conversationId: activeId,
          data,
          mime: file.type,
          fileName: file.name,
        },
        (res) => {
          setSendingPhoto(false)
          if (res.error) setError(res.error)
        },
      )
    } catch {
      setSendingPhoto(false)
      setError('Could not read that photo')
    }
  }

  function deleteConversation(conversationId: string) {
    const socket = socketRef.current
    if (!socket) return
    const confirmed = window.confirm(
      'Delete this conversation for both people? Messages will be gone.',
    )
    if (!confirmed) return
    socket.emit('conversation:delete', { conversationId }, (res) => {
      if (res.error) setError(res.error)
    })
  }

  if (!me) {
    return <JoinScreen onJoin={join} joining={joining} error={error} />
  }

  const active = conversations.find((c) => c.id === activeId) ?? null

  return (
    <ChatShell
      me={me}
      conversations={conversations}
      active={active}
      messages={messages}
      error={error}
      sendingPhoto={sendingPhoto}
      searchQuery={searchQuery}
      searchResults={searchResults}
      searching={searching}
      searchHint={searchHint}
      onSearch={searchUsers}
      onStartChat={startChat}
      onOpenConversation={openConversation}
      onSendMessage={sendMessage}
      onSendPhoto={sendPhoto}
      onReact={reactToMessage}
      onDeleteConversation={deleteConversation}
    />
  )
}
