import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSocket } from './socket'
import type { CallMode, CallSignal, User } from './types'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
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
  const makingOfferRef = useRef(false)
  const pendingSignalsRef = useRef<CallSignal[]>([])

  useEffect(() => {
    callRef.current = activeCall
  }, [activeCall])

  const cleanupMedia = useCallback(() => {
    stopStream(localStreamRef.current)
    stopStream(remoteStreamRef.current)
    localStreamRef.current = null
    remoteStreamRef.current = null
    setLocalStream(null)
    setRemoteStream(null)
    if (pcRef.current) {
      pcRef.current.onicecandidate = null
      pcRef.current.ontrack = null
      pcRef.current.onconnectionstatechange = null
      pcRef.current.close()
      pcRef.current = null
    }
    pendingSignalsRef.current = []
    makingOfferRef.current = false
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

  const ensurePeerConnection = useCallback(
    (callId: string) => {
      if (pcRef.current) return pcRef.current

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      pcRef.current = pc

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(callId, {
            type: 'ice',
            candidate: event.candidate.toJSON(),
          })
        }
      }

      pc.ontrack = (event) => {
        const stream = event.streams[0] || new MediaStream([event.track])
        remoteStreamRef.current = stream
        setRemoteStream(stream)
      }

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          const current = callRef.current
          if (current && state === 'failed') {
            socket?.emit('call:end', { callId: current.callId }, () => {})
            onError('Call connection failed')
            resetCall()
          }
        }
      }

      return pc
    },
    [sendSignal, socket, onError, resetCall],
  )

  const attachLocalMedia = useCallback(
    async (callId: string, mode: CallMode) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mode === 'video',
      })
      localStreamRef.current = stream
      setLocalStream(stream)
      const pc = ensurePeerConnection(callId)
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream)
      }
      return stream
    },
    [ensurePeerConnection],
  )

  const createOffer = useCallback(
    async (callId: string) => {
      const pc = ensurePeerConnection(callId)
      makingOfferRef.current = true
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      makingOfferRef.current = false
      sendSignal(callId, { type: 'offer', sdp: offer })
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
          if (makingOfferRef.current || pc.signalingState !== 'stable') {
            pendingSignalsRef.current.push(signal)
            return
          }
          await pc.setRemoteDescription(signal.sdp)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          sendSignal(callId, { type: 'answer', sdp: answer })
        } else if (signal.type === 'answer') {
          await pc.setRemoteDescription(signal.sdp)
        } else if (signal.type === 'ice' && signal.candidate) {
          try {
            await pc.addIceCandidate(signal.candidate)
          } catch {
            // Ignore late ICE after hangup.
          }
        }
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Call signaling failed')
      }
    },
    [ensurePeerConnection, sendSignal, onError],
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

    const onAccepted = async (payload: {
      callId: string
      conversationId: string
      mode: CallMode
      from: User
    }) => {
      const current = callRef.current
      if (!current || current.callId !== payload.callId) return

      try {
        await attachLocalMedia(payload.callId, payload.mode)
        setActiveCall((prev) =>
          prev && prev.callId === payload.callId
            ? { ...prev, phase: 'connected', peer: payload.from }
            : prev,
        )
        await createOffer(payload.callId)
      } catch {
        socket.emit('call:end', { callId: payload.callId }, () => {})
        resetCall()
        onError('Could not access microphone or camera')
      }
    }

    const onEnded = (payload: { callId: string }) => {
      if (callRef.current?.callId === payload.callId) {
        resetCall()
      }
    }

    const onSignal = (payload: {
      callId: string
      signal: CallSignal
    }) => {
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
    (conversationId: string, mode: CallMode, peer: User) => {
      if (!socket) return
      if (callRef.current) {
        onError('You are already in a call')
        return
      }
      if (!peer) return

      socket.emit('call:invite', { conversationId, mode }, (res) => {
        if (res.error) {
          onError(res.error)
          return
        }
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
    [socket, onError],
  )

  const acceptCall = useCallback(async () => {
    const current = callRef.current
    if (!socket || !current || current.phase !== 'incoming') return

    socket.emit('call:accept', { callId: current.callId }, async (res) => {
      if (res.error) {
        onError(res.error)
        resetCall()
        return
      }
      try {
        await attachLocalMedia(current.callId, current.mode)
        setActiveCall((prev) =>
          prev && prev.callId === current.callId
            ? { ...prev, phase: 'connected' }
            : prev,
        )
      } catch {
        socket.emit('call:end', { callId: current.callId }, () => {})
        resetCall()
        onError('Could not access microphone or camera')
      }
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
