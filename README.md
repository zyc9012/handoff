# Handoff

Handoff is a private, user-based pastebin for Cloudflare Workers. Users organize multiple text snippets and files into tabs; admins can provision and remove accounts. A separate public nearby view transfers files directly between browsers without requiring an account.

## Features

- First-run administrator bootstrap, then admin-only account creation
- `admin` and `user` roles; admins retain all normal user capabilities
- Multiple tabs per user, each with a title and optional expiration
- Multiple D1-backed text snippets and R2-backed files per tab
- Cron cleanup every 15 minutes for expired tabs, related rows, and R2 objects
- Anonymous nearby discovery and room codes using a hibernating Durable Object
- Direct WebRTC file transfer; file bytes do not pass through the Worker
- Preact frontend served with Workers Static Assets

Passwords use PBKDF2-SHA-256 with per-password salts. Sessions are opaque, hashed in D1, and carried by `HttpOnly`, `Secure`, `SameSite=Strict` cookies. Every stored-content endpoint checks tab ownership.

## Local Development

```sh
npm install
npm run types
npm run db:migrate:local
npm run build
npx wrangler dev
```

Open the URL Wrangler prints, normally `http://localhost:8787`. The first visit prompts you to create the initial administrator. Local D1, R2, and Durable Object state lives under `.wrangler/`.

Run all build and deployment checks with:

```sh
npm run check
```

To invoke expiration cleanup locally, start Wrangler with `--test-scheduled` or request:

```sh
curl http://localhost:8787/cdn-cgi/handler/scheduled
```

## Cloudflare Deployment

Authenticate and provision the persistent resources:

```sh
npx wrangler login
npx wrangler d1 create handoff
npx wrangler r2 bucket create handoff-files
```

Copy the D1 ID returned by the first command into `wrangler.jsonc`, replacing `replace-with-your-d1-database-id`. The R2 bucket name already matches the configuration.

Apply the production schema and deploy:

```sh
npm run db:migrate:remote
npm run deploy
```

The first deployment creates the `DropRoom` Durable Object class. The configured `*/15 * * * *` cron trigger then handles expiration cleanup.

## Limits

- Snippet content: 1 MiB each
- Stored file: 25 MiB each
- Tab expiration: at most one year
- Nearby signaling message: 64 KiB; file bytes use WebRTC instead

R2 uploads and downloads are streamed through the Worker. Expiration cleanup processes at most 100 tabs per cron invocation so large backlogs are drained in bounded batches.
