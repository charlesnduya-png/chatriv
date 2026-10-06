import { useEffect, useRef, useState } from 'react'
import type { ConversationSummary, Message, User } from '../types'
import { REACTION_EMOJIS, STICKERS } from '../types'
import { apiUrl } from '../api'
import { Logo } from './Logo'
import { InstallPrompt } from './InstallPrompt'

type ChatShellProps = {
  me: User
  conversations: ConversationSummary[]
  active: ConversationSummary | null
  messages: Message[]
  error: string | null
  sendingPhoto: boolean
  searchQuery: string
  searchResults: User[]
  searching: boolean
  searchHint: string | null
  onSearch: (name: string) => void
  onStartChat: (otherUserId: string) => void
  onOpenConversation: (conversationId: string) => void
  onCloseConversation: () => void
  onSendMessage: (text: string) => void
  onSendPhoto: (file: File) => void
  onSendSticker: (sticker: string) => void
  onReact: (messageId: string, emoji: string) => void
  onDeleteConversation: (conversationId: string) => void
  onSignOut: () => void
  onVoiceCall: () => void
  onVideoCall: () => void
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatThreadTime(ts: number) {
  const date = new Date(ts)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return formatTime(ts)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  if (isYesterday) return 'Yesterday'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function formatDayLabel(ts: number) {
  const date = new Date(ts)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  if (isYesterday) return 'Yesterday'
  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function sameCalendarDay(a: number, b: number) {
  const left = new Date(a)
  const right = new Date(b)
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function previewText(conversation: ConversationSummary, meId: string) {
  const last = conversation.lastMessage
  if (!last) return 'Say hello'
  const mine = last.senderId === meId
  const prefix = mine ? 'You: ' : ''
  return `${prefix}${last.text}`
}

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function MessageTicks({ status }: { status?: Message['status'] }) {
  const current = status || 'sent'
  const label =
    current === 'read'
      ? 'Read'
      : current === 'delivered'
        ? 'Delivered'
        : 'Sent'

  return (
    <span
      className={`ticks ticks--${current}`}
      title={label}
      aria-label={label}
    >
      <svg viewBox="0 0 16 11" width="16" height="11" aria-hidden>
        <path
          className="ticks__check ticks__check--a"
          d="M1.5 5.8 4.2 8.6 9.8 1.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {current !== 'sent' ? (
          <path
            className="ticks__check ticks__check--b"
            d="M5.2 5.8 7.9 8.6 13.5 1.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
    </span>
  )
}

function groupReactions(reactions: Record<string, string> = {}) {
  const counts = new Map<string, { emoji: string; count: number; mine: boolean }>()
  for (const [, emoji] of Object.entries(reactions)) {
    const current = counts.get(emoji) || { emoji, count: 0, mine: false }
    current.count += 1
    counts.set(emoji, current)
  }
  return [...counts.values()]
}

function MessageBubble({
  message,
  mine,
  meId,
  clustered,
  showMeta,
  onReact,
}: {
  message: Message
  mine: boolean
  meId: string
  clustered: boolean
  showMeta: boolean
  onReact: (messageId: string, emoji: string) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const lastTap = useRef(0)
  const myReaction = message.reactions?.[meId]
  const reactionGroups = groupReactions(message.reactions).map((group) => ({
    ...group,
    mine: myReaction === group.emoji,
  }))

  function handleDoubleTap() {
    const now = Date.now()
    if (now - lastTap.current < 320) {
      onReact(message.id, '❤️')
      setPickerOpen(false)
    }
    lastTap.current = now
  }

  return (
    <div
      className={`bubble-wrap${mine ? ' bubble-wrap--mine' : ''}${clustered ? ' bubble-wrap--cluster' : ''}${reactionGroups.length ? ' has-reactions' : ''}`}
    >
      <article
        className={`bubble${mine ? ' bubble--mine' : ''}${message.type === 'photo' ? ' bubble--photo' : ''}${message.type === 'sticker' ? ' bubble--sticker' : ''}${clustered ? ' bubble--cluster' : ''}${pickerOpen ? ' is-picking' : ''}`}
        onClick={handleDoubleTap}
        onContextMenu={(event) => {
          event.preventDefault()
          setPickerOpen((open) => !open)
        }}
      >
        {message.type === 'photo' ? (
          <PhotoMessage message={message} mine={mine} />
        ) : message.type === 'sticker' ? (
          <p className="bubble__sticker" aria-label="Sticker">
            {message.sticker}
          </p>
        ) : (
          <p className="bubble__text">{message.text}</p>
        )}
        {showMeta ? (
          <div className="bubble__foot">
            <time className="bubble__time" dateTime={new Date(message.createdAt).toISOString()}>
              {formatTime(message.createdAt)}
            </time>
            {mine ? <MessageTicks status={message.status} /> : null}
          </div>
        ) : null}

        {pickerOpen ? (
          <div className={`react-picker${mine ? ' react-picker--mine' : ''}`} role="toolbar" aria-label="React">
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={`react-picker__btn${myReaction === emoji ? ' is-active' : ''}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onReact(message.id, emoji)
                  setPickerOpen(false)
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}
      </article>

      {reactionGroups.length > 0 ? (
        <div className={`react-chips${mine ? ' react-chips--mine' : ''}`}>
          {reactionGroups.map((group) => (
            <button
              key={group.emoji}
              type="button"
              className={`react-chip${group.mine ? ' is-mine' : ''}`}
              onClick={() => onReact(message.id, group.emoji)}
              title={group.mine ? 'Remove your reaction' : 'React'}
            >
              <span>{group.emoji}</span>
              {group.count > 1 ? <span className="react-chip__count">{group.count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className="react-open"
        aria-label="Add reaction"
        onClick={() => setPickerOpen((open) => !open)}
      >
        +
      </button>
    </div>
  )
}

function PhotoMessage({
  message,
  mine,
}: {
  message: Message
  mine: boolean
}) {
  const [, setTick] = useState(0)
  const expired =
    Boolean(message.expired) ||
    !message.photoId ||
    (message.expiresAt != null && Date.now() >= message.expiresAt)
  const remaining =
    message.expiresAt != null ? message.expiresAt - Date.now() : 0

  useEffect(() => {
    if (expired || !message.expiresAt) return
    const id = window.setInterval(() => setTick((value) => value + 1), 1000)
    return () => window.clearInterval(id)
  }, [expired, message.expiresAt])

  if (expired) {
    return (
      <div className="photo photo--gone">
        <p className="photo__gone-label">Photo disappeared</p>
        <p className="photo__gone-copy">The 10-minute save window ended.</p>
      </div>
    )
  }

  const src = apiUrl(`/api/photos/${message.photoId}`)

  async function savePhoto() {
    try {
      const response = await fetch(src)
      if (!response.ok) throw new Error('expired')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = message.fileName || 'photo.jpg'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      // Server expiry will refresh the bubble shortly.
    }
  }

  return (
    <div className="photo">
      <img className="photo__image" src={src} alt={message.fileName || 'Shared photo'} />
      <div className="photo__meta">
        <span className="photo__timer">Save window {formatRemaining(remaining)}</span>
        {!mine ? (
          <button type="button" className="photo__save" onClick={savePhoto}>
            Save
          </button>
        ) : (
          <span className="photo__hint">Visible for 10 minutes</span>
        )}
      </div>
    </div>
  )
}

export function ChatShell({
  me,
  conversations,
  active,
  messages,
  error,
  sendingPhoto,
  searchQuery,
  searchResults,
  searching,
  searchHint,
  onSearch,
  onStartChat,
  onOpenConversation,
  onCloseConversation,
  onSendMessage,
  onSendPhoto,
  onSendSticker,
  onReact,
  onDeleteConversation,
  onSignOut,
  onVoiceCall,
  onVideoCall,
}: ChatShellProps) {
  const [draft, setDraft] = useState('')
  const [nameDraft, setNameDraft] = useState(searchQuery)
  const [stickerOpen, setStickerOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, active?.id])

  useEffect(() => {
    setDraft('')
    setStickerOpen(false)
  }, [active?.id])

  useEffect(() => {
    setNameDraft(searchQuery)
  }, [searchQuery])

  return (
    <div className={`shell${active ? ' shell--chat-open' : ''}`}>
      <aside className="sidebar">
        <header className="sidebar__brand">
          <div className="sidebar__brand-row">
            <Logo size="sm" />
            <button
              type="button"
              className="sidebar__signout"
              onClick={onSignOut}
            >
              Sign out
            </button>
          </div>
          <p className="sidebar__you">{me.name}</p>
          <InstallPrompt />
        </header>

        <section className="sidebar__section">
          <h2 className="sidebar__heading">Chats</h2>
          <p className="sidebar__empty">
            Search a display name to start messaging. Demo: <strong>dolly</strong>.
          </p>
          <form
            className="search"
            onSubmit={(event) => {
              event.preventDefault()
              onSearch(nameDraft)
            }}
          >
            <input
              className="search__input"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              placeholder="Find someone"
              maxLength={32}
              autoComplete="off"
            />
            <button className="search__button" type="submit" disabled={searching || !nameDraft.trim()}>
              {searching ? '…' : 'Search'}
            </button>
          </form>

          {searchHint ? <p className="sidebar__empty">{searchHint}</p> : null}

          {searchResults.length > 0 ? (
            <ul className="people">
              {searchResults.map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    className="people__item"
                    onClick={() => onStartChat(user.id)}
                  >
                    <span className="people__dot" aria-hidden />
                    <span>{user.name}</span>
                    <span className="people__action">Message</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="sidebar__section sidebar__section--grow">
          <h2 className="sidebar__heading">Recent</h2>
          {conversations.length === 0 ? (
            <p className="sidebar__empty">No chats yet.</p>
          ) : (
            <ul className="threads">
              {conversations.map((conversation) => {
                const isActive = conversation.id === active?.id
                const stamp = conversation.lastMessage?.createdAt ?? conversation.createdAt
                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      className={`threads__item${isActive ? ' is-active' : ''}`}
                      onClick={() => onOpenConversation(conversation.id)}
                    >
                      <span
                        className={`threads__avatar${conversation.otherOnline ? ' is-online' : ''}`}
                        aria-hidden
                      >
                        {initials(conversation.other.name)}
                      </span>
                      <span className="threads__body">
                        <span className="threads__top">
                          <span className="threads__name">{conversation.other.name}</span>
                          <time className="threads__time" dateTime={new Date(stamp).toISOString()}>
                            {formatThreadTime(stamp)}
                          </time>
                        </span>
                        <span className="threads__preview">
                          {previewText(conversation, me.id)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </aside>

      <main className="stage">
        {!active ? (
          <div className="stage__empty">
            <Logo size="lg" />
            <h1>Find a contact to begin.</h1>
            <p>
              Search an exact display name to open a conversation. Shared photos
              remain available for ten minutes before they expire.
            </p>
          </div>
        ) : (
          <>
            <header className="stage__header">
              <div className="stage__identity">
                <button
                  type="button"
                  className="stage__back"
                  onClick={onCloseConversation}
                  aria-label="Back to chats"
                >
                  ←
                </button>
                <span
                  className={`stage__avatar${active.otherOnline ? ' is-online' : ''}`}
                  aria-hidden
                >
                  {initials(active.other.name)}
                </span>
                <div className="stage__titles">
                  <h1 className="stage__title">{active.other.name}</h1>
                  <p className={`stage__subtitle${active.otherOnline ? ' is-online' : ''}`}>
                    {active.otherOnline ? 'online' : 'offline'}
                  </p>
                </div>
              </div>
              <div className="stage__actions">
                <button
                  type="button"
                  className="stage__call"
                  onClick={onVoiceCall}
                  aria-label="Voice call"
                  title="Voice call"
                >
                  Call
                </button>
                <button
                  type="button"
                  className="stage__call"
                  onClick={onVideoCall}
                  aria-label="Video call"
                  title="Video call"
                >
                  Video
                </button>
                <button
                  type="button"
                  className="stage__delete"
                  onClick={() => onDeleteConversation(active.id)}
                  aria-label="Delete conversation"
                  title="Delete conversation"
                >
                  Delete
                </button>
              </div>
            </header>

            <div className="messages" role="log" aria-live="polite">
              {messages.length === 0 ? (
                <p className="messages__empty">No messages yet. Start the thread.</p>
              ) : (
                messages.map((message, index) => {
                  const mine = message.senderId === me.id
                  const previous = messages[index - 1]
                  const next = messages[index + 1]
                  const showDay =
                    !previous || !sameCalendarDay(previous.createdAt, message.createdAt)
                  const clustered = Boolean(
                    previous &&
                      previous.senderId === message.senderId &&
                      sameCalendarDay(previous.createdAt, message.createdAt) &&
                      message.createdAt - previous.createdAt < 5 * 60 * 1000,
                  )
                  const showMeta = !(
                    next &&
                    next.senderId === message.senderId &&
                    sameCalendarDay(next.createdAt, message.createdAt) &&
                    next.createdAt - message.createdAt < 5 * 60 * 1000
                  )
                  return (
                    <div key={message.id} className="messages__row">
                      {showDay ? (
                        <div className="messages__day" role="separator">
                          <span>{formatDayLabel(message.createdAt)}</span>
                        </div>
                      ) : null}
                      <MessageBubble
                        message={message}
                        mine={mine}
                        meId={me.id}
                        clustered={clustered}
                        showMeta={showMeta}
                        onReact={onReact}
                      />
                    </div>
                  )
                })
              )}
              <div ref={bottomRef} />
            </div>

            {error ? <p className="stage__error">{error}</p> : null}

            {stickerOpen ? (
              <div className="sticker-panel" role="dialog" aria-label="Stickers">
                <div className="sticker-panel__head">
                  <p className="sticker-panel__title">Stickers</p>
                  <button
                    type="button"
                    className="sticker-panel__close"
                    onClick={() => setStickerOpen(false)}
                  >
                    Close
                  </button>
                </div>
                <div className="sticker-panel__grid">
                  {STICKERS.map((sticker) => (
                    <button
                      key={sticker}
                      type="button"
                      className="sticker-panel__item"
                      onClick={() => {
                        onSendSticker(sticker)
                        setStickerOpen(false)
                      }}
                    >
                      {sticker}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault()
                const text = draft.trim()
                if (!text) return
                onSendMessage(text)
                setDraft('')
              }}
            >
              <input
                ref={fileRef}
                className="composer__file"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) onSendPhoto(file)
                }}
              />
              <button
                type="button"
                className="composer__photo"
                disabled={sendingPhoto}
                onClick={() => fileRef.current?.click()}
              >
                {sendingPhoto ? 'Sending…' : 'Photo'}
              </button>
              <button
                type="button"
                className={`composer__sticker${stickerOpen ? ' is-open' : ''}`}
                onClick={() => setStickerOpen((open) => !open)}
                aria-label="Open stickers"
              >
                😊
              </button>
              <input
                className="composer__input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={`Message ${active.other.name}`}
                maxLength={2000}
                autoFocus
              />
              <button className="composer__send" type="submit" disabled={!draft.trim()} aria-label="Send">
                ➤
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  )
}
