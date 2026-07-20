import { DurableObject } from "cloudflare:workers";

interface PeerAttachment {
  id: string;
  name: string;
}

interface SignalMessage {
  type: "signal";
  to: string;
  signal: unknown;
}

function attachment(socket: WebSocket): PeerAttachment | null {
  return socket.deserializeAttachment() as PeerAttachment | null;
}

export class DropRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket required", { status: 426 });
    const name = (new URL(request.url).searchParams.get("name") ?? "Nearby device").trim().slice(0, 32) || "Nearby device";
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const peer: PeerAttachment = { id: crypto.randomUUID(), name };
    server.serializeAttachment(peer);
    this.ctx.acceptWebSocket(server);

    const peers = this.ctx.getWebSockets().filter((socket) => socket !== server).flatMap((socket) => {
      const connected = attachment(socket);
      return connected ? [connected] : [];
    });
    server.send(JSON.stringify({ type: "welcome", id: peer.id, peers }));
    this.broadcast({ type: "peer-joined", peer }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > 64_000) {
      socket.close(1009, "Message too large");
      return;
    }
    const sender = attachment(socket);
    if (!sender) return;
    try {
      const parsed = JSON.parse(message) as SignalMessage;
      if (parsed.type !== "signal" || typeof parsed.to !== "string") return;
      const target = this.ctx.getWebSockets().find((candidate) => attachment(candidate)?.id === parsed.to);
      target?.send(JSON.stringify({ type: "signal", from: sender.id, signal: parsed.signal }));
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "Invalid signaling message" }));
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const peer = attachment(socket);
    if (peer) this.broadcast({ type: "peer-left", id: peer.id }, socket);
    // Compatibility dates >= 2026-04-07 automatically reply to the close frame.
    // No need to call socket.close here
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    const peer = attachment(socket);
    if (peer) this.broadcast({ type: "peer-left", id: peer.id }, socket);
  }

  private broadcast(message: object, except?: WebSocket): void {
    const encoded = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== except) socket.send(encoded);
    }
  }
}