import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSocket } from './socket'
import type { CallMode, CallSignal, User } from './types'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Public TURN so mobile carriers / strict NATs can still exchange media.
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
]

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connected'

export type ActiveCall = {
  callId: string
  conversationId: string
  mode: CallMode
  peer: User
  phase: Exclude<CallPhase, 'idle'>
  isCaller: boolean
}

type UseCallOptions = {
  socket: AppSocket | null
  onError: (message: string) => void
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

export function useCall({ socket, onError }: UseCallOptions) {
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const callRef = useRef<ActiveCall | null>(null)
  const signalingCallIdRef = useRef<string | null>(null)
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])
  const remoteReadyRef = useRef(false)

  useEffect(() => {
    callRef.current = activeCall
  }, [activeCall])

  const cleanupMedia = useCallback(() => {
    stopStream(localStreamRef.current)
    localStreamRef.current = null
    remoteStreamRef.current = null
    setLocalStream(null)
    setRemoteStream(null)
    if (pcRef.current) {
      pcRef.current.onicecandidate = null
      pcRef.current.ontrack = null
      pcRef.current.onconnectionstatechange = null
      pcRef.current.close()
    }
    pcRef.current = null
    signalingCallIdRef.current = null
    pendingIceRef.current = []
    remoteReadyRef.current = false
    setMuted(false)
    setCameraOff(false)
  }, [])

  const resetCall = useCallback(() => {
    cleanupMedia()
    setActiveCall(null)
  }, [cleanupMedia])

  const sendSignal = useCallback(
    (callId: string, signal: CallSignal) => {
      socket?.emit('call:signal', { callId, signal }, (res) => {
        if (res.error) onError(res.error)
      })
    },
    [socket, onError],
  )

  const flushIce = useCallback(async (pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current
    pendingIceRef.current = []
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate)
      } catch {
        // Ignore stale candidates after hangup.
      }
    }
  }, [])

  const ensurePeerConnection = useCallback(
    (callId?: string) => {
      if (callId) signalingCallIdRef.current = callId
      if (pcRef.current) return pcRef.current

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      pcRef.current = pc

      pc.onicecandidate = (event) => {
        const activeId = signalingCallIdRef.current
        if (event.candidate && activeId && !activeId.startsWith('pending-')) {
          sendSignal(activeId, {
            type: 'ice',
            candidate: event.candidate.toJSON(),
          })
        }
      }

      pc.ontrack = (event) => {
        let stream = remoteStreamRef.current
        if (!stream) {
          stream = new MediaStream()
          remoteStreamRef.current = stream
        }
        if (!stream.getTracks().some((track) => track.id === event.track.id)) {
          stream.addTrack(event.track)
        }
        // New MediaStream instance so React rebinds <audio>/<video>.
        setRemoteStream(new MediaStream(stream.getTracks()))
      }

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        if (state === 'failed') {
          const current = callRef.current
          if (current) {
            socket?.emit('call:end', { callId: current.callId }, () => {})
            onError('Call connection failed — try again on the same Wi‑Fi if possible')
            resetCall()
          }
        }
      }

      return pc
    },
    [sendSignal, socket, onError, resetCall],
  )

  const attachLocalMedia = useCallback(
    async (mode: CallMode, callId?: string) => {
      if (callId) signalingCallIdRef.current = callId
      if (localStreamRef.current) {
        return localStreamRef.current
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video:
          mode === 'video'
            ? {
                facingMode: 'user',
                width: { ideal: 1280 },
                height: { ideal: 720 },
              }
            : false,
      })

      localStreamRef.current = stream
      setLocalStream(stream)

      const pc = ensurePeerConnection(callId)
      const senders = pc.getSenders()
      for (const track of stream.getTracks()) {
        const already = senders.some((sender) => sender.track?.id === track.id)
        if (!already) {
          pc.addTrack(track, stream)
        }
      }
      return stream
    },
    [ensurePeerConnection],
  )

  const createOffer = useCallback(
    async (callId: string) => {
      signalingCallIdRef.current = callId
      const pc = ensurePeerConnection(callId)
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      sendSignal(callId, { type: 'offer', sdp: pc.localDescription || offer })
    },
    [ensurePeerConnection, sendSignal],
  )

  const handleSignal = useCallback(
    async (callId: string, signal: CallSignal) => {
      const current = callRef.current
      if (!current || current.callId !== callId) return

      const pc = ensurePeerConnection(callId)

      try {
        if (signal.type === 'offer') {
          signalingCallIdRef.current = callId
          if (!localStreamRef.current) {
            await attachLocalMedia(current.mode, callId)
          }
          await pc.setRemoteDescription(signal.sdp)
          remoteReadyRef.current = true
          await flushIce(pc)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          sendSignal(callId, { type: 'answer', sdp: pc.localDescription || answer })
        } else if (signal.type === 'answer') {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(signal.sdp)
            remoteReadyRef.current = true
            await flushIce(pc)
          }
        } else if (signal.type === 'ice' && signal.candidate) {
          if (!remoteReadyRef.current || !pc.remoteDescription) {
            pendingIceRef.current.push(signal.candidate)
          } else {
            try {
              await pc.addIceCandidate(signal.candidate)
            } catch {
              // Ignore late ICE.
            }
          }
        }
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Call signaling failed')
      }
    },
    [ensurePeerConnection, attachLocalMedia, flushIce, sendSignal, onError],
  )

  useEffect(() => {
    if (!socket) return

    const onIncoming = (payload: {
      callId: string
      conversationId: string
      mode: CallMode
      from: User
    }) => {
      if (callRef.current) {
        socket.emit('call:reject', { callId: payload.callId }, () => {})
        return
      }
      setActiveCall({
        callId: payload.callId,
        conversationId: payload.conversationId,
        mode: payload.mode,
        peer: payload.from,
        phase: 'incoming',
        isCaller: false,
      })
    }

    const onAccepted = (payload: {
      callId: string
      conversationId: string
      mode: CallMode
    }) => {
      const current = callRef.current
      if (!current || current.callId !== payload.callId) return

      setActiveCall((prev) =>
        prev && prev.callId === payload.callId
          ? { ...prev, phase: 'connected' }
          : prev,
      )

      void (async () => {
        try {
          await attachLocalMedia(payload.mode, payload.callId)
          await createOffer(payload.callId)
        } catch {
          socket.emit('call:end', { callId: payload.callId }, () => {})
          resetCall()
          onError('Could not access microphone or camera')
        }
      })()
    }

    const onEnded = (payload: { callId: string }) => {
      if (callRef.current?.callId === payload.callId) {
        resetCall()
      }
    }

    const onSignal = (payload: { callId: string; signal: CallSignal }) => {
      void handleSignal(payload.callId, payload.signal)
    }

    socket.on('call:incoming', onIncoming)
    socket.on('call:accepted', onAccepted)
    socket.on('call:ended', onEnded)
    socket.on('call:signal', onSignal)

    return () => {
      socket.off('call:incoming', onIncoming)
      socket.off('call:accepted', onAccepted)
      socket.off('call:ended', onEnded)
      socket.off('call:signal', onSignal)
    }
  }, [socket, attachLocalMedia, createOffer, handleSignal, resetCall, onError])

  const startCall = useCallback(
    async (conversationId: string, mode: CallMode, peer: User) => {
      if (!socket) return
      if (callRef.current) {
        onError('You are already in a call')
        return
      }
      if (!peer) return

      // Capture media in the same user gesture as the Call/Video tap.
      try {
        await attachLocalMedia(mode)
      } catch {
        onError('Allow microphone/camera access to place a call')
        cleanupMedia()
        return
      }

      socket.emit('call:invite', { conversationId, mode }, (res) => {
        if (res.error) {
          onError(res.error)
          cleanupMedia()
          return
        }

        signalingCallIdRef.current = res.callId
        setActiveCall({
          callId: res.callId,
          conversationId: res.conversationId,
          mode: res.mode,
          peer: res.to,
          phase: 'outgoing',
          isCaller: true,
        })
      })
    },
    [socket, onError, attachLocalMedia, cleanupMedia],
  )

  const acceptCall = useCallback(async () => {
    const current = callRef.current
    if (!socket || !current || current.phase !== 'incoming') return

    // getUserMedia must stay inside the Accept tap (mobile browsers).
    try {
      await attachLocalMedia(current.mode, current.callId)
    } catch {
      onError('Allow microphone/camera access to answer the call')
      return
    }

    socket.emit('call:accept', { callId: current.callId }, (res) => {
      if (res.error) {
        onError(res.error)
        resetCall()
        return
      }
      setActiveCall((prev) =>
        prev && prev.callId === current.callId
          ? { ...prev, phase: 'connected' }
          : prev,
      )
    })
  }, [socket, attachLocalMedia, resetCall, onError])

  const rejectCall = useCallback(() => {
    const current = callRef.current
    if (!socket || !current) return
    socket.emit('call:reject', { callId: current.callId }, () => {})
    resetCall()
  }, [socket, resetCall])

  const hangUp = useCallback(() => {
    const current = callRef.current
    if (!socket || !current) return
    socket.emit('call:end', { callId: current.callId }, () => {})
    resetCall()
  }, [socket, resetCall])

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current
    if (!stream) return
    const next = !muted
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !next
    })
    setMuted(next)
  }, [muted])

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current
    if (!stream) return
    const next = !cameraOff
    stream.getVideoTracks().forEach((track) => {
      track.enabled = !next
    })
    setCameraOff(next)
  }, [cameraOff])

  return {
    activeCall,
    localStream,
    remoteStream,
    muted,
    cameraOff,
    startCall,
    acceptCall,
    rejectCall,
    hangUp,
    toggleMute,
    toggleCamera,
    resetCall,
  }
}
