export { DropRoom } from "./drop-room";
import { clearExpired, handleApi } from "./api";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return Response.json({ status: "ok" });
    if (url.pathname === "/drop/ws") {
      const code = url.searchParams.get("room")?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      const address = request.headers.get("CF-Connecting-IP") ?? "local";
      const room = code?.length === 6 ? `code:${code}` : `network:${request.cf?.colo ?? "local"}:${address}`;
      return env.DROP_ROOMS.getByName(room).fetch(request);
    }
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await clearExpired(env);
  },
} satisfies ExportedHandler<Env>;