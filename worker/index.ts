export { DropRoom } from "./drop-room";
import { Hono } from "hono";
import { normalizeRoomCode } from "../src/utils";
import { api, clearExpired } from "./api";
import { networkAddress } from "./network-address";

export const app = new Hono<{ Bindings: Env }>();

app.route("/api", api);

app.all("/drop/ws", (context) => {
  const code = normalizeRoomCode(context.req.query("room") ?? "");
  const address = networkAddress(
    context.req.header("CF-Connecting-IP") ?? "local",
  );
  const room = code ? `code:${code}` : `network:${address}`;
  return context.env.DROP_ROOMS.getByName(room).fetch(context.req.raw);
});

app.all("*", (context) => context.env.ASSETS.fetch(context.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await clearExpired(env);
  },
} satisfies ExportedHandler<Env>;