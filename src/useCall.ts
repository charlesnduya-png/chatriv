import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSocket } from './socket'
import type { CallMode, CallSignal, User } from './types'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
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

function friendlyMediaError(err: unknown, mode: CallMode) {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Allow microphone and camera access to continue the call'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return mode === 'video'
      ? 'No camera or microphone found on this device'
      : 'No microphone found on this device'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Camera or microphone is already in use by another app'
  }
  return mode === 'video'
    ? 'Could not start camera or microphone'
    : 'Could not start microphone'
}

function friendlySignalError(err: unknown) {
  const message = err instanceof Error ? err.message : ''
  if (/setRemoteDescription|wrong state|InvalidStateError/i.test(message)) {
    return 'Call setup hit a glitch — hang up and try again'
  }
  if (/setLocalDescription/i.test(message)) {
    return 'Could not start the call connection — try again'
  }
  return 'Call signaling failed — try again'
}

async function getCallMedia(mode: CallMode) {
  if (mode === 'audio') {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })
  }

  const attempts: MediaStreamConstraints[] = [
    {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: { facingMode: 'user' },
    },
    { audio: true, video: true },
    { audio: true, video: { width: 640, height: 480 } },
  ]

  let lastError: unknown
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error('getUserMedia failed')
}

function sdpFromDescription(desc: RTCSessionDescription | RTCSessionDescriptionInit | null) {
  if (!desc?.sdp || !desc.type) return null
  if (desc.type !== 'offer' && desc.type !== 'answer') return null
  return { type: desc.type as 'offer' | 'answer', sdp: desc.sdp }
}

/** Accept plain SDP string or legacy nested { type, sdp } payloads. */
function normalizeSdp(value: unknown) {
  if (typeof value === 'string' && value.includes('v=0')) return value
  if (
    value &&
    typeof value === 'object' &&
    'sdp' in value &&
    typeof (value as { sdp: unknown }).sdp === 'string'
  ) {
    return (value as { sdp: string }).sdp
  }
  return null
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
  const makingOfferRef = useRef(false)
  const ignoreOfferRef = useRef(false)

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
    makingOfferRef.current = false
    ignoreOfferRef.current = false
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
        if (res?.error) onError(res.error)
      })
    },
    [socket, onError],
  )

  const flushIce = useCallback(async (pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current.splice(0, pendingIceRef.current.length)
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

      const pc = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        iceCandidatePoolSize: 4,
      })
      pcRef.current = pc

      pc.onicecandidate = (event) => {
        const activeId = signalingCallIdRef.current
        if (!activeId || !event.candidate) return
        sendSignal(activeId, {
          type: 'ice',
          candidate: event.candidate.toJSON(),
        })
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
        setRemoteStream(new MediaStream(stream.getTracks()))
      }

      pc.onconnectionstatechange = () => {
        if (pc.connectionState !== 'failed') return
        const current = callRef.current
        if (!current) return
        socket?.emit('call:end', { callId: current.callId }, () => {})
        onError('Video/call connection failed — try again on the same network')
        resetCall()
      }

      return pc
    },
    [sendSignal, socket, onError, resetCall],
  )

  const attachLocalMedia = useCallback(
    async (mode: CallMode, callId?: string) => {
      if (callId) signalingCallIdRef.current = callId
      if (localStreamRef.current) {
        const pc = ensurePeerConnection(callId)
        const senders = pc.getSenders()
        for (const track of localStreamRef.current.getTracks()) {
          if (!senders.some((sender) => sender.track?.id === track.id)) {
            pc.addTrack(track, localStreamRef.current)
          }
        }
        return localStreamRef.current
      }

      const stream = await getCallMedia(mode)
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
      signalingCallIdRef.current = callId
      const pc = ensurePeerConnection(callId)
      if (makingOfferRef.current || pc.signalingState !== 'stable') return

      makingOfferRef.current = true
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        const local = sdpFromDescription(pc.localDescription)
        if (!local) throw new Error('Missing local offer')
        sendSignal(callId, { type: 'offer', sdp: local.sdp })
      } finally {
        makingOfferRef.current = false
      }
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
          const polite = !current.isCaller
          const offerCollision =
            makingOfferRef.current || pc.signalingState !== 'stable'
          ignoreOfferRef.current = !polite && offerCollision
          if (ignoreOfferRef.current) return

          const offerSdp = normalizeSdp(signal.sdp)
          if (!offerSdp) throw new Error('Invalid offer')

          signalingCallIdRef.current = callId
          if (!localStreamRef.current) {
            await attachLocalMedia(current.mode, callId)
          }

          await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp })
          remoteReadyRef.current = true
          await flushIce(pc)

          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          const local = sdpFromDescription(pc.localDescription)
          if (!local) throw new Error('Missing local answer')
          sendSignal(callId, { type: 'answer', sdp: local.sdp })
        } else if (signal.type === 'answer') {
          if (pc.signalingState !== 'have-local-offer') return
          const answerSdp = normalizeSdp(signal.sdp)
          if (!answerSdp) throw new Error('Invalid answer')
          await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
          remoteReadyRef.current = true
          await flushIce(pc)
        } else if (signal.type === 'ice') {
          if (!signal.candidate?.candidate) return
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
        onError(friendlySignalError(err))
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
        } catch (err) {
          socket.emit('call:end', { callId: payload.callId }, () => {})
          resetCall()
          onError(friendlyMediaError(err, payload.mode))
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
      if (!navigator.mediaDevices?.getUserMedia) {
        onError('This browser does not support calls')
        return
      }

      try {
        await attachLocalMedia(mode)
      } catch (err) {
        onError(friendlyMediaError(err, mode))
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

    try {
      await attachLocalMedia(current.mode, current.callId)
    } catch (err) {
      onError(friendlyMediaError(err, current.mode))
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
