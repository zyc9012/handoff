import { useEffect, useRef, useState } from 'preact/hooks'
import { normalizeRoomCode, roomCodeFromPath } from './utils'

export interface NearbyPeer {
  id: string
  name: string
}

type TransferStatus = 'connecting' | 'waiting' | 'sending' | 'receiving' | 'complete' | 'error'

interface Outgoing {
  peerName: string
  fileName: string
  size: number
  progress: number
  status: TransferStatus
  error?: string
}

interface Incoming {
  peerName: string
  fileName: string
  size: number
  mime: string
  progress: number
  status: 'waiting' | 'receiving' | 'complete' | 'error'
  error?: string
  downloadUrl?: string
}

interface SignalEnvelope {
  type: string
  id?: string
  peers?: NearbyPeer[]
  peer?: NearbyPeer
  from?: string
  signal?: RTCSessionDescriptionInit | RTCIceCandidateInit
}

interface PeerState {
  connection: RTCPeerConnection
  channel?: RTCDataChannel
  peer: NearbyPeer
  file?: File
  chunks: BlobPart[]
  received: number
}

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
}

const DATA_CHUNK_BYTES = 64 * 1024
const BUFFER_HIGH_WATER_BYTES = 1024 * 1024
const BUFFER_LOW_WATER_BYTES = 256 * 1024

function chunkSize(connection: RTCPeerConnection): number {
  const negotiatedMaximum = connection.sctp?.maxMessageSize
  if (!negotiatedMaximum || !Number.isFinite(negotiatedMaximum)) return DATA_CHUNK_BYTES
  return Math.max(1, Math.min(DATA_CHUNK_BYTES, negotiatedMaximum))
}

function waitForWritableChannel(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState !== 'open') {
    return Promise.reject(new Error('Connection closed during transfer'))
  }
  if (channel.bufferedAmount <= BUFFER_HIGH_WATER_BYTES) return Promise.resolve()

  channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER_BYTES
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      channel.removeEventListener('bufferedamountlow', handleLowBuffer)
      channel.removeEventListener('close', handleClose)
      channel.removeEventListener('error', handleError)
    }
    const handleLowBuffer = () => {
      cleanup()
      resolve()
    }
    const handleClose = () => {
      cleanup()
      reject(new Error('Connection closed during transfer'))
    }
    const handleError = () => {
      cleanup()
      reject(new Error('Connection failed during transfer'))
    }

    channel.addEventListener('bufferedamountlow', handleLowBuffer)
    channel.addEventListener('close', handleClose)
    channel.addEventListener('error', handleError)
    if (channel.bufferedAmount <= BUFFER_LOW_WATER_BYTES) handleLowBuffer()
  })
}

function randomName(): string {
  const first =
    ['Amber', 'Blue', 'Calm', 'Silver', 'Swift'][
      crypto.getRandomValues(new Uint8Array(1))[0] % 5
    ]
  const second =
    ['Bridge', 'Maple', 'Paper', 'Signal', 'Window'][
      crypto.getRandomValues(new Uint8Array(1))[0] % 5
    ]
  return `${first} ${second}`
}

export function useNearbyTransfer() {
  const [name, setNameState] = useState(
    () => localStorage.getItem('handoff:device-name') ?? randomName(),
  )
  const [roomCode, setRoomCodeState] = useState(() => roomCodeFromPath(location.pathname))
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'offline'>('connecting')
  const [peers, setPeers] = useState<NearbyPeer[]>([])
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null)
  const [incoming, setIncoming] = useState<Incoming | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const statesRef = useRef(new Map<string, PeerState>())
  const incomingPeerRef = useRef<string | null>(null)

  const relay = (to: string, signal: RTCSessionDescriptionInit | RTCIceCandidateInit) => {
    socketRef.current?.send(JSON.stringify({ type: 'signal', to, signal }))
  }

  const bindChannel = (state: PeerState, channel: RTCDataChannel) => {
    state.channel = channel
    channel.binaryType = 'arraybuffer'
    const failActiveTransfer = (message: string) => {
      if (state.file) {
        state.file = undefined
        setOutgoing((value) =>
          value && value.status !== 'complete'
            ? { ...value, status: 'error', error: message }
            : value,
        )
      }
      if (incomingPeerRef.current === state.peer.id) {
        incomingPeerRef.current = null
        setIncoming((value) =>
          value && value.status !== 'complete'
            ? { ...value, status: 'error', error: message }
            : value,
        )
      }
    }
    channel.onerror = () => failActiveTransfer('Connection failed during transfer')
    channel.onclose = () => failActiveTransfer('Connection closed during transfer')
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const message = JSON.parse(event.data) as {
          type: string
          name?: string
          size?: number
          mime?: string
        }

        if (message.type === 'meta' && message.name && typeof message.size === 'number') {
          state.chunks = []
          state.received = 0
          incomingPeerRef.current = state.peer.id
          setIncoming({
            peerName: state.peer.name,
            fileName: message.name,
            size: message.size,
            mime: message.mime || 'application/octet-stream',
            progress: 0,
            status: 'waiting',
          })
        } else if (message.type === 'accept' && state.file) {
          setOutgoing((value) => (value ? { ...value, status: 'sending' } : value))
          void sendBytes(state)
        } else if (message.type === 'decline') {
          state.file = undefined
          setOutgoing((value) =>
            value ? { ...value, status: 'error', error: 'Transfer declined' } : value,
          )
        } else if (message.type === 'complete') {
          const blob = new Blob(state.chunks)
          incomingPeerRef.current = null
          setIncoming((value) =>
            value
              ? {
                  ...value,
                  status: 'complete',
                  progress: 100,
                  downloadUrl: URL.createObjectURL(blob),
                }
              : value,
          )
        }
        return
      }

      state.chunks.push(event.data as ArrayBuffer)
      state.received += (event.data as ArrayBuffer).byteLength
      setIncoming((value) => {
        if (!value) return value
        const progress = Math.min(100, Math.round((state.received / value.size) * 100))
        return progress > value.progress ? { ...value, status: 'receiving', progress } : value
      })
    }
  }

  const makeConnection = (peer: NearbyPeer): PeerState => {
    const existing = statesRef.current.get(peer.id)
    if (existing) return existing

    const state: PeerState = {
      connection: new RTCPeerConnection(rtcConfig),
      peer,
      chunks: [],
      received: 0,
    }
    state.connection.onicecandidate = (event) => {
      if (event.candidate) relay(peer.id, event.candidate.toJSON())
    }
    state.connection.ondatachannel = (event) => bindChannel(state, event.channel)
    state.connection.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(state.connection.connectionState)) {
        statesRef.current.delete(peer.id)
      }
    }
    statesRef.current.set(peer.id, state)
    return state
  }

  const sendBytes = async (state: PeerState) => {
    const channel = state.channel
    const file = state.file
    if (!channel || !file) return

    try {
      const reader = file.stream().getReader()
      const maximumChunkSize = chunkSize(state.connection)
      let sent = 0

      while (true) {
        const part = await reader.read()
        if (part.done) break

        for (let offset = 0; offset < part.value.byteLength; offset += maximumChunkSize) {
          await waitForWritableChannel(channel)
          const chunk = part.value.subarray(offset, offset + maximumChunkSize)
          channel.send(chunk as Uint8Array<ArrayBuffer>)
          sent += chunk.byteLength
        }
        const progress = Math.round((sent / file.size) * 100)
        setOutgoing((value) =>
          value && progress > value.progress ? { ...value, progress } : value,
        )
      }

      await waitForWritableChannel(channel)
      channel.send(JSON.stringify({ type: 'complete' }))
      state.file = undefined
      setOutgoing((value) =>
        value ? { ...value, progress: 100, status: 'complete' } : value,
      )
    } catch (error) {
      state.file = undefined
      setOutgoing((value) =>
        value
          ? {
              ...value,
              status: 'error',
              error: error instanceof Error ? error.message : 'Transfer failed',
            }
          : value,
      )
    }
  }

  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const query = new URLSearchParams({
      name,
      ...(roomCode ? { room: roomCode } : {}),
    })
    const socket = new WebSocket(`${protocol}//${location.host}/drop/ws?${query}`)
    socketRef.current = socket
    setConnection('connecting')
    setPeers([])

    socket.onopen = () => setConnection('connected')
    socket.onclose = () => setConnection('offline')
    socket.onerror = () => setConnection('offline')
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as SignalEnvelope
      if (message.type === 'welcome') setPeers(message.peers ?? [])
      if (message.type === 'peer-joined' && message.peer) {
        setPeers((value) => [
          ...value.filter((peer) => peer.id !== message.peer!.id),
          message.peer!,
        ])
      }
      if (message.type === 'peer-left' && message.id) {
        setPeers((value) => value.filter((peer) => peer.id !== message.id))
      }
      if (message.type === 'signal' && message.from && message.signal) {
        const signal = message.signal
        void (async () => {
          const peer = peers.find((item) => item.id === message.from) ?? {
            id: message.from!,
            name: 'Nearby device',
          }
          const state = makeConnection(peer)

          if ('type' in signal && signal.type) {
            await state.connection.setRemoteDescription(signal as RTCSessionDescriptionInit)
            if (signal.type === 'offer') {
              const answer = await state.connection.createAnswer()
              await state.connection.setLocalDescription(answer)
              relay(peer.id, answer)
            }
          } else {
            await state.connection.addIceCandidate(signal as RTCIceCandidateInit)
          }
        })()
      }
    }

    return () => {
      socket.close()
      for (const state of statesRef.current.values()) state.connection.close()
      statesRef.current.clear()
    }
  }, [name, roomCode])

  const sendFile = async (peer: NearbyPeer, file: File) => {
    const state = makeConnection(peer)
    state.file = file
    const channel = state.connection.createDataChannel('handoff', { ordered: true })
    bindChannel(state, channel)
    channel.onopen = () => {
      channel.send(
        JSON.stringify({ type: 'meta', name: file.name, size: file.size, mime: file.type }),
      )
      setOutgoing((value) => (value ? { ...value, status: 'waiting' } : value))
    }
    setOutgoing({
      peerName: peer.name,
      fileName: file.name,
      size: file.size,
      progress: 0,
      status: 'connecting',
    })

    const offer = await state.connection.createOffer()
    await state.connection.setLocalDescription(offer)
    relay(peer.id, offer)
  }

  const setName = (value: string) => {
    const next = value.trim().slice(0, 32) || randomName()
    localStorage.setItem('handoff:device-name', next)
    setNameState(next)
  }

  const setRoomCode = (value: string) => {
    const next = normalizeRoomCode(value)
    history.replaceState(null, '', next ? `/drop/${next}` : '/drop')
    setRoomCodeState(next)
  }

  const acceptTransfer = async () => {
    const state = incomingPeerRef.current
      ? statesRef.current.get(incomingPeerRef.current)
      : undefined
    state?.channel?.send(JSON.stringify({ type: 'accept' }))
    setIncoming((value) => (value ? { ...value, status: 'receiving' } : value))
  }

  const declineTransfer = () => {
    const state = incomingPeerRef.current
      ? statesRef.current.get(incomingPeerRef.current)
      : undefined
    state?.channel?.send(JSON.stringify({ type: 'decline' }))
    incomingPeerRef.current = null
    setIncoming(null)
  }

  const cancelOutgoing = () => {
    for (const state of statesRef.current.values()) state.connection.close()
    statesRef.current.clear()
    setOutgoing(null)
  }

  const dismissIncoming = () => {
    if (incoming?.downloadUrl) URL.revokeObjectURL(incoming.downloadUrl)
    setIncoming(null)
  }

  return {
    name,
    setName,
    roomCode,
    setRoomCode,
    connection,
    peers,
    outgoing,
    incoming,
    sendFile,
    acceptTransfer,
    declineTransfer,
    cancelOutgoing,
    dismissOutgoing: () => setOutgoing(null),
    dismissIncoming,
  }
}