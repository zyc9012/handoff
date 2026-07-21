import {
  ArrowLeft,
  Download,
  HardDrive,
  Radio,
  Send,
  ShieldCheck,
  Wifi,
  X,
} from 'lucide-preact'
import { useRef, useState } from 'preact/hooks'
import { MAX_ROOM_CODE_LENGTH } from '../utils'
import { useNearbyTransfer, type NearbyPeer } from '../useNearbyTransfer'

interface NearbyDropProps {
  onBack: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function NearbyDrop({ onBack }: NearbyDropProps) {
  const nearby = useNearbyTransfer()
  const [target, setTarget] = useState<NearbyPeer | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const sendFile = (peer: NearbyPeer, file: File) => {
    setTarget(peer)
    void nearby.sendFile(peer, file)
  }

  return (
    <main className="nearby-page">
      <header>
        <button className="back-button" type="button" onClick={onBack}>
          <ArrowLeft size={17} /> Back to Handoff
        </button>
        <span className="public-badge">
          <ShieldCheck size={15} /> No account required
        </span>
      </header>

      <section className="nearby-stage">
        <input
          ref={fileInput}
          hidden
          type="file"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file && target) sendFile(target, file)
            event.currentTarget.value = ''
          }}
        />

        <div
          className="device-grid"
          onDragOver={(event) => {
            if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
          }}
          onDrop={(event) => {
            if (!event.dataTransfer?.types.includes('Files')) return
            event.preventDefault()
            setDropTargetId(null)
          }}
        >
          {nearby.peers.map((peer) => (
            <button
              className="peer-card"
              data-drop-target={dropTargetId === peer.id}
              type="button"
              key={peer.id}
              onClick={() => {
                setTarget(peer)
                fileInput.current?.click()
              }}
              onDragEnter={(event) => {
                if (!event.dataTransfer?.types.includes('Files')) return
                event.preventDefault()
                setDropTargetId(peer.id)
              }}
              onDragOver={(event) => {
                const transfer = event.dataTransfer
                if (!transfer?.types.includes('Files')) return
                event.preventDefault()
                transfer.dropEffect = 'copy'
              }}
              onDragLeave={(event) => {
                const nextTarget = event.relatedTarget
                if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                  setDropTargetId(null)
                }
              }}
              onDrop={(event) => {
                const transfer = event.dataTransfer
                if (!transfer) return
                event.preventDefault()
                setDropTargetId(null)
                const file = transfer.files[0]
                if (file) sendFile(peer, file)
              }}
            >
              <span>
                <HardDrive size={23} />
              </span>
              <strong>{peer.name}</strong>
              <small>{dropTargetId === peer.id ? 'Drop file to send' : 'Tap or drop a file'}</small>
              <Send size={17} />
            </button>
          ))}
          {!nearby.peers.length && (
            <div className="searching">
              <span className="radar">
                <Radio size={25} />
              </span>
              <strong>Looking for another device</strong>
              <small>Open Nearby on a second device.</small>
            </div>
          )}
        </div>

        {nearby.outgoing && (
          <div className="transfer-banner">
            <div>
              <strong>{nearby.outgoing.fileName}</strong>
              <small>
                To {nearby.outgoing.peerName} / {nearby.outgoing.status}
              </small>
            </div>
            <div className="progress">
              <span style={{ width: `${nearby.outgoing.progress}%` }} />
            </div>
            <button
              className="icon-button"
              type="button"
              title="Cancel transfer"
              onClick={nearby.cancelOutgoing}
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="device-settings">
          <div className="this-device">
            <span className="device-pulse">
              <Wifi size={24} />
            </span>
            <div>
              <small>This device</small>
              <input
                value={nearby.name}
                onChange={(event) => nearby.setName(event.currentTarget.value)}
              />
            </div>
            <span className="connection-label">{nearby.connection}</span>
          </div>
          <div className="room-control">
            <label>
              Optional room code
              <input
                value={nearby.roomCode}
                onInput={(event) => nearby.setRoomCode(event.currentTarget.value)}
                placeholder="ROOM123"
                maxLength={MAX_ROOM_CODE_LENGTH}
              />
            </label>
          </div>
        </div>

        {nearby.incoming && (
          <div className="modal-backdrop">
            <div className="incoming-dialog">
              <p className="eyebrow">Incoming from {nearby.incoming.peerName}</p>
              <h2>{nearby.incoming.fileName}</h2>
              <p>
                {formatBytes(nearby.incoming.size)} / {nearby.incoming.mime}
              </p>
              {nearby.incoming.status === 'waiting' ? (
                <div className="dialog-actions">
                  <button className="secondary-button" onClick={nearby.declineTransfer}>
                    Decline
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => void nearby.acceptTransfer()}
                  >
                    Accept
                  </button>
                </div>
              ) : (
                <div className="dialog-actions">
                  {nearby.incoming.downloadUrl && (
                    <a
                      className="primary-button"
                      href={nearby.incoming.downloadUrl}
                      download={nearby.incoming.fileName}
                    >
                      <Download size={16} /> Download
                    </a>
                  )}
                  <button className="secondary-button" onClick={nearby.dismissIncoming}>
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}