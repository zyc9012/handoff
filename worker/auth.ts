const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 100_000;
const SESSION_SECONDS = 60 * 60 * 24 * 14;

export type Role = "admin" | "user";

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toBase64Url(new Uint8Array(hash));
}

export async function hashPassword(
  password: string,
  salt = toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
): Promise<{ hash: string; salt: string }> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: fromBase64Url(salt),
      iterations: PASSWORD_ITERATIONS,
    },
    key,
    256,
  );
  return { hash: toBase64Url(new Uint8Array(bits)), salt };
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> {
  const { hash } = await hashPassword(password, salt);
  const digests = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(hash)),
    crypto.subtle.digest("SHA-256", encoder.encode(expectedHash)),
  ]);
  const actual = new Uint8Array(digests[0]);
  const expected = new Uint8Array(digests[1]);
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual[index] ^ expected[index];
  }
  return difference === 0;
}

function readCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get("Cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

export async function currentUser(
  request: Request,
  db: D1Database,
): Promise<CurrentUser | null> {
  const token = readCookie(request, "handoff_session");
  if (!token) return null;

  const tokenHash = await digest(token);
  const row = await db
    .prepare(`
      SELECT users.id, users.username, users.display_name, users.role
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now')
    `)
    .bind(tokenHash)
    .first<{ id: string; username: string; display_name: string; role: Role }>();

  return row
    ? {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
      }
    : null;
}

export async function createSession(userId: string, db: D1Database): Promise<string> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await digest(token);
  await db
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))",
    )
    .bind(tokenHash, userId, `+${SESSION_SECONDS} seconds`)
    .run();
  return (
    `handoff_session=${encodeURIComponent(token)}; HttpOnly; Secure; ` +
    `SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`
  );
}

export async function deleteSession(request: Request, db: D1Database): Promise<void> {
  const token = readCookie(request, "handoff_session");
  if (token) {
    await db
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await digest(token))
      .run();
  }
}

export const expiredSessionCookie =
  "handoff_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0";