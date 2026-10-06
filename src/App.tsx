import { useEffect, useRef, useState } from 'react'
import { createSocket, type AppSocket } from './socket'
import type { CallMode, ConversationSummary, Message, MessageStatus, User } from './types'
import { isGroup } from './types'
import { JoinScreen } from './components/JoinScreen'
import { ChatShell } from './components/ChatShell'
import { CallOverlay } from './components/CallOverlay'
import { useCall } from './useCall'
import { useIdleSignOut } from './useIdleSignOut'
import { playMessageNote, unlockSounds } from './sounds'
import { useViewportHeight } from './useViewportHeight'
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
  return messages.map((message) => {
    if (message.id !== messageId) return message
    if (message.type === 'photo') {
      return {
        ...message,
        expired: true,
        photoId: undefined,
        text: 'Photo disappeared',
      }
    }
    if (message.type === 'sticker') {
      return {
        ...message,
        expired: true,
        sticker: undefined,
        text: 'Sticker disappeared',
      }
    }
    return {
      ...message,
      expired: true,
      text: 'Message disappeared',
    }
  })
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
  useViewportHeight()
  const socketRef = useRef<AppSocket | null>(null)
  const meRef = useRef<User | null>(null)
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
  const [socketReady, setSocketReady] = useState<AppSocket | null>(null)

  const call = useCall({
    socket: socketReady,
    onError: (message) => setError(message),
  })

  useEffect(() => {
    meRef.current = me
  }, [me])

  const clearSessionRef = useRef<(message?: string) => void>(() => {})

  clearSessionRef.current = (message?: string) => {
    sessionStorage.removeItem('chatriv:name')
    call.resetCall()
    setMe(null)
    setConversations([])
    setActiveId(null)
    setMessages([])
    setError(message || null)
    setSearchResults([])
    setSearchQuery('')
    setSearchHint(null)
    setJoining(false)
    setSendingPhoto(false)
  }

  useIdleSignOut({
    enabled: Boolean(me),
    socket: socketReady,
    onIdle: () => {
      const socket = socketRef.current
      if (socket?.connected) socket.disconnect()
      clearSessionRef.current('Signed out after 10 minutes of inactivity.')
      socket?.connect()
    },
  })

  useEffect(() => {
    const socket = createSocket()
    socketRef.current = socket
    setSocketReady(socket)
    socket.connect()

    const rejoinIfNeeded = () => {
      const savedName = sessionStorage.getItem('chatriv:name')
      if (!savedName || meRef.current) return
      socket.emit('join', { name: savedName }, (res) => {
        if (res.error) {
          sessionStorage.removeItem('chatriv:name')
          setError(res.error)
          return
        }
        setMe(res.user)
        setConversations(res.conversations)
      })
    }

    socket.on('connect', rejoinIfNeeded)

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
      const selfId = meRef.current?.id
      if (selfId && message.senderId !== selfId) {
        void playMessageNote()
      }
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

    socket.on('session:expired', (payload) => {
      clearSessionRef.current(
        payload.message || 'Signed out after 10 minutes of inactivity.',
      )
      if (!socket.connected) socket.connect()
    })

    return () => {
      socket.off('connect', rejoinIfNeeded)
      socket.off('session:expired')
      socket.disconnect()
      socketRef.current = null
      setSocketReady(null)
    }
  }, [])

  function join(name: string) {
    const socket = socketRef.current
    if (!socket) return
    setJoining(true)
    setError(null)
    void unlockSounds()

    if (!socket.connected) {
      socket.connect()
    }

    const trimmed = name.trim()
    if (!trimmed) {
      setJoining(false)
      setError('Enter a display name to continue.')
      return
    }

    let settled = false
    const fail = (message: string) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      setJoining(false)
      setError(message)
    }

    const timeout = window.setTimeout(() => {
      fail(
        'Could not reach the chat server. The realtime backend may be offline — try again in a moment.',
      )
    }, 10000)

    const onConnectError = (err: Error) => {
      fail(err.message || 'Unable to connect to the chat server.')
    }

    socket.once('connect_error', onConnectError)

    const emitJoin = () => {
      socket.emit('join', { name: trimmed }, (res) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        socket.off('connect_error', onConnectError)
        setJoining(false)
        if (res.error) {
          setError(res.error)
          return
        }
        setMe(res.user)
        setConversations(res.conversations)
        sessionStorage.setItem('chatriv:name', trimmed)
      })
    }

    if (socket.connected) {
      emitJoin()
    } else {
      socket.once('connect', emitJoin)
    }
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

    const runSearch = () => {
      setSearching(true)
      socket.emit('users:search', { name: trimmed }, (res) => {
        setSearching(false)
        if (res.error) {
          if (res.error === 'Not joined') {
            const saved = sessionStorage.getItem('chatriv:name')
            if (saved) {
              socket.emit('join', { name: saved }, (joinRes) => {
                if (joinRes.error) {
                  setError(joinRes.error)
                  setSearchResults([])
                  return
                }
                setMe(joinRes.user)
                setConversations(joinRes.conversations)
                runSearch()
              })
              return
            }
          }
          setError(res.error)
          setSearchResults([])
          return
        }
        setSearchResults(res.users)
        if (res.users.length === 0) {
          setSearchHint(
            `No one signed in as “${trimmed}”. Use their exact display name — try “dolly” for the demo.`,
          )
        }
      })
    }

    if (!socket.connected) {
      socket.connect()
      socket.once('connect', runSearch)
      return
    }
    runSearch()
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

  function createGroup(name: string) {
    const socket = socketRef.current
    if (!socket) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a group name to create.')
      return
    }
    setError(null)
    socket.emit('group:create', { name: trimmed }, (res) => {
      if (res.error) {
        setError(res.error)
        return
      }
      setConversations((prev) => upsertConversation(prev, res.conversation))
      openConversation(res.conversation.id)
    })
  }

  function joinGroup(name: string) {
    const socket = socketRef.current
    if (!socket) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter the exact group name to join.')
      return
    }
    setError(null)
    socket.emit('group:join', { name: trimmed }, (res) => {
      if (res.error) {
        setError(res.error)
        return
      }
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

  function closeConversation() {
    const socket = socketRef.current
    socket?.emit('conversation:blur')
    setActiveId(null)
    setMessages([])
    setError(null)
  }

  function sendMessage(text: string, replyToMessageId?: string) {
    const socket = socketRef.current
    if (!socket || !activeId) return
    socket.emit(
      'message:send',
      { conversationId: activeId, text, replyToMessageId },
      (res) => {
        if (res.error) setError(res.error)
      },
    )
  }

  function sendSticker(sticker: string, replyToMessageId?: string) {
    const socket = socketRef.current
    if (!socket || !activeId) return
    socket.emit(
      'message:sticker',
      { conversationId: activeId, sticker, replyToMessageId },
      (res) => {
        if (res.error) setError(res.error)
      },
    )
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

  async function sendPhoto(file: File, replyToMessageId?: string) {
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
          replyToMessageId,
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
    const conv = conversations.find((c) => c.id === conversationId)
    const group = isGroup(conv)
    const confirmed = window.confirm(
      group
        ? 'Leave this group? You can join again later with the exact group name.'
        : 'Delete this conversation for both people? Messages will be gone. You can search their name again to start a new chat.',
    )
    if (!confirmed) return
    socket.emit('conversation:delete', { conversationId }, (res) => {
      if (res.error) {
        setError(res.error)
        return
      }
      if (!group && conv?.other.name) {
        setSearchHint(
          `Chat with ${conv.other.name} deleted. Tap Message to start a new conversation.`,
        )
        searchUsers(conv.other.name)
      }
    })
  }

  function signOut() {
    const socket = socketRef.current
    if (socket?.connected) socket.disconnect()
    clearSessionRef.current()
    socket?.connect()
  }

  if (!me) {
    return <JoinScreen onJoin={join} joining={joining} error={error} />
  }

  const active = conversations.find((c) => c.id === activeId) ?? null

  function startVoiceOrVideo(mode: CallMode) {
    if (!active || isGroup(active)) return
    setError(null)
    void call.startCall(active.id, mode, active.other)
  }

  return (
    <>
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
        onCreateGroup={createGroup}
        onJoinGroup={joinGroup}
        onOpenConversation={openConversation}
        onCloseConversation={closeConversation}
        onSendMessage={sendMessage}
        onSendPhoto={sendPhoto}
        onSendSticker={sendSticker}
        onReact={reactToMessage}
        onDeleteConversation={deleteConversation}
        onSignOut={signOut}
        onVoiceCall={() => startVoiceOrVideo('audio')}
        onVideoCall={() => startVoiceOrVideo('video')}
      />
      {call.activeCall ? (
        <CallOverlay
          phase={call.activeCall.phase}
          mode={call.activeCall.mode}
          peer={call.activeCall.peer}
          muted={call.muted}
          cameraOff={call.cameraOff}
          localStream={call.localStream}
          remoteStream={call.remoteStream}
          error={error}
          onAccept={() => {
            setError(null)
            void call.acceptCall()
          }}
          onReject={call.rejectCall}
          onHangUp={() => {
            setError(null)
            call.hangUp()
          }}
          onToggleMute={call.toggleMute}
          onToggleCamera={call.toggleCamera}
          onDismissError={() => setError(null)}
        />
      ) : null}
    </>
  )
}