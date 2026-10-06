/** Chatriv custom tones — unique ring + message note in /public/sounds */

const RING_SRC = '/sounds/chatriv-ring.wav'
const MESSAGE_SRC = '/sounds/chatriv-message.wav'

let ringAudio: HTMLAudioElement | null = null
let messageAudio: HTMLAudioElement | null = null
let unlocked = false

function ensureAudio(kind: 'ring' | 'message') {
  if (kind === 'ring') {
    if (!ringAudio) {
      ringAudio = new Audio(RING_SRC)
      ringAudio.preload = 'auto'
      ringAudio.loop = true
      ringAudio.volume = 0.85
    }
    return ringAudio
  }
  if (!messageAudio) {
    messageAudio = new Audio(MESSAGE_SRC)
    messageAudio.preload = 'auto'
    messageAudio.loop = false
    messageAudio.volume = 0.9
  }
  return messageAudio
}

/** Call once after a user gesture so browsers allow later playback. */
export async function unlockSounds() {
  if (unlocked || typeof window === 'undefined') return
  try {
    const ring = ensureAudio('ring')
    const note = ensureAudio('message')
    ring.muted = true
    note.muted = true
    await Promise.allSettled([ring.play(), note.play()])
    ring.pause()
    note.pause()
    ring.currentTime = 0
    note.currentTime = 0
    ring.muted = false
    note.muted = false
    unlocked = true
  } catch {
    // Wait for a later gesture.
  }
}

export async function playRing() {
  const audio = ensureAudio('ring')
  try {
    audio.currentTime = 0
    await audio.play()
  } catch {
    // Autoplay blocked until unlockSounds().
  }
}

export function stopRing() {
  if (!ringAudio) return
  ringAudio.pause()
  ringAudio.currentTime = 0
}

export async function playMessageNote() {
  const audio = ensureAudio('message')
  try {
    audio.pause()
    audio.currentTime = 0
    await audio.play()
  } catch {
    // Autoplay blocked until unlockSounds().
  }
}
