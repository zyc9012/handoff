# AGENTS.md

## Project Overview

Handoff is a private pastebin and nearby file-transfer application deployed as a Cloudflare Worker.

- `src/`: Preact single-page application.
- `worker/`: Worker API, authentication, scheduled cleanup, and Durable Object signaling.
- `migrations/`: D1 schema migrations.
- `wrangler.jsonc`: Worker bindings, assets, cron, and deployment configuration.
- `dist/`: generated Vite output; do not edit by hand.

## Setup and Commands

Use the repository scripts rather than recreating their commands.

```sh
npm install
npm run types
npm run db:migrate:local
npm run dev
```

Common checks:

```sh
npm run build             # Build the Preact frontend
npm run check             # Typecheck, build, and Wrangler deployment dry run
npm run db:migrate:local  # Apply D1 migrations locally
npm run db:migrate:remote # Apply D1 migrations in production
```

`npm run dev` runs the Vite watcher and Wrangler together. Local Cloudflare state is stored under `.wrangler/`.

There is currently no automated test suite. Do not report tests as passing unless tests have been added and run. For frontend-only changes, run `npm run build`; for Worker, schema, binding, or cross-boundary changes, run `npm run check`.

## Architecture and Ownership

- Keep browser API calls and shared response types in `src/api.ts`.
- Keep rendered UI behavior in Preact components and hooks under `src/`.
- Keep request routing and storage operations in `worker/api.ts`.
- Keep password and session logic in `worker/auth.ts`.
- Keep nearby-room signaling behavior in `worker/drop-room.ts`.
- Keep the Worker entry point small; `worker/index.ts` should route requests and scheduled events to owning modules.
- Store snippets and relational metadata in D1. Store uploaded file bodies in R2.
- Nearby file bytes must remain peer-to-peer; the Durable Object relays presence and connection messages only.
- `/drop` is the SPA route. `/drop/ws` is the Worker-first WebSocket route. Do not merge them.

## Security Invariants

- Every tab, snippet, and stored-file operation must authenticate the caller and verify ownership.
- User administration is admin-only. Admins cannot delete themselves, and the final admin cannot be removed.
- Only the initial administrator may be self-created. Later users must be created by an admin.
- Never store plaintext passwords or session tokens. Preserve the existing password hashing and hashed opaque-session design.
- Keep session cookies `HttpOnly`, `Secure`, `SameSite=Strict`, and scoped to `/`.
- Validate request sizes before buffering content. Preserve the documented snippet, file, and signaling limits unless the task explicitly changes them.
- Delete R2 objects before deleting their D1 metadata during expiration or destructive cleanup.
- Return plain user-safe API errors; log internal failure details server-side.

## Frontend Conventions

- Use Preact patterns already present in the codebase and `lucide-preact` for interface icons.
- Use the Inter variable font everywhere.
- Visible text must be at least `11px`; primary labels should be larger than secondary metadata.
- Keep user-facing copy product-focused. Do not expose implementation terms such as D1, R2, Workers, Durable Objects, WebSockets, or WebRTC in rendered pages.
- Preserve the existing restrained operational visual language and responsive behavior.
- The authenticated dashboard is viewport-height: the sidebar tab list and main workspace scroll independently.
- The nearby page itself must not scroll. Only its device list may scroll, with the self-configuration bar fixed at the bottom.
- Check desktop and mobile layouts when changing dimensions, overflow, wrapping, or navigation.

## Code Style

- Follow the style of the file being edited. The frontend currently uses single quotes and no semicolons; Worker files use double quotes and semicolons.
- Keep changes focused and avoid unrelated formatting or generated-file churn.
- Prefer existing helpers and platform APIs over new abstractions.
- Use strict TypeScript types. Avoid `any` and unsafe casts unless an external platform boundary requires a narrow, documented cast.
- Do not edit `worker-configuration.d.ts` manually; regenerate it with `npm run types` after binding changes.
- Add D1 schema changes as new migration files; do not rewrite an applied migration.

## Cloudflare Configuration

The production D1 ID in `wrangler.jsonc` is intentionally a placeholder until provisioning. Do not invent or commit account IDs, tokens, or secrets. Binding names are part of the application contract:

- `DB`: D1 database
- `FILES`: R2 bucket
- `DROP_ROOMS`: Durable Object namespace
- `ASSETS`: static frontend assets

When changing bindings or Worker configuration, regenerate types and run the full check.
