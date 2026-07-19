import { useEffect, useRef, useState } from 'preact/hooks'

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
  const [roomCode, setRoomCodeState] = useState('')
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
          setOutgoing((value) =>
            value ? { ...value, status: 'error', error: 'Transfer declined' } : value,
          )
        } else if (message.type === 'complete') {
          const blob = new Blob(state.chunks)
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
      setIncoming((value) =>
        value
          ? {
              ...value,
              status: 'receiving',
              progress: Math.min(100, Math.round((state.received / value.size) * 100)),
            }
          : value,
      )
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
      let sent = 0

      while (true) {
        const part = await reader.read()
        if (part.done) break

        while (channel.bufferedAmount > 4 * 1024 * 1024) {
          await new Promise((resolve) => window.setTimeout(resolve, 40))
        }
        channel.send(part.value as Uint8Array<ArrayBuffer>)
        sent += part.value.byteLength
        setOutgoing((value) =>
          value ? { ...value, progress: Math.round((sent / file.size) * 100) } : value,
        )
      }

      channel.send(JSON.stringify({ type: 'complete' }))
      setOutgoing((value) =>
        value ? { ...value, progress: 100, status: 'complete' } : value,
      )
    } catch (error) {
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
      ...(roomCode.length === 6 ? { room: roomCode } : {}),
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
    setRoomCodeState(value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
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