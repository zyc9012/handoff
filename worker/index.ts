export { DropRoom } from "./drop-room";
import { normalizeRoomCode } from "../src/utils";
import { clearExpired, handleApi } from "./api";
import { networkAddress } from "./network-address";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return Response.json({ status: "ok" });
    if (url.pathname === "/drop/ws") {
      const code = normalizeRoomCode(url.searchParams.get("room") ?? "");
      const address = networkAddress(request.headers.get("CF-Connecting-IP") ?? "local");
      const room = code ? `code:${code}` : `network:${address}`;
      return env.DROP_ROOMS.getByName(room).fetch(request);
    }
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await clearExpired(env);
  },
} satisfies ExportedHandler<Env>;