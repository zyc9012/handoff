import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  createSession,
  currentUser,
  deleteSession,
  hashPassword,
  SESSION_SECONDS,
  type CurrentUser,
  type Role,
  verifyPassword,
} from "./auth";

const MAX_JSON_BYTES = 1_100_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const SESSION_COOKIE = "handoff_session";

type ApiEnv = { Bindings: Env };
type ApiContext = Context<ApiEnv>;

const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "Strict",
  path: "/",
  maxAge: SESSION_SECONDS,
} as const;

class ApiError extends Error {
  constructor(readonly status: ContentfulStatusCode, message: string) {
    super(message);
  }
}

interface Credentials {
  username?: string;
  password?: string;
  displayName?: string;
  role?: Role;
}

interface TabInput {
  title?: string;
  expiresAt?: string | null;
}

interface SnippetInput {
  title?: string;
  content?: string;
  language?: string;
}

interface TabRow {
  id: string;
  title: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  snippet_count: number;
  file_count: number;
}

interface FileRow {
  id: string;
  tab_id: string;
  r2_key: string;
  name: string;
  content_type: string;
  size: number;
  created_at: string;
}

function normalizeUsername(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_.-]{3,32}$/.test(value)) {
    throw new ApiError(
      400,
      "Username must be 3-32 letters, numbers, dots, dashes, or underscores",
    );
  }
  return value.toLowerCase();
}

function validatePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 10 || value.length > 128) {
    throw new ApiError(400, "Password must be 10-128 characters");
  }
  return value;
}

function cleanText(value: unknown, fallback: string, max: number): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new ApiError(400, "Invalid text value");
  return value.trim().slice(0, max) || fallback;
}

function parseExpiry(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new ApiError(400, "Invalid expiration");

  const time = Date.parse(value);
  if (
    !Number.isFinite(time) ||
    time <= Date.now() ||
    time > Date.now() + 366 * 24 * 60 * 60 * 1000
  ) {
    throw new ApiError(400, "Expiration must be within the next year");
  }
  return new Date(time).toISOString();
}

async function readJson<T>(context: ApiContext): Promise<T> {
  const length = Number(context.req.header("Content-Length") ?? 0);
  if (length > MAX_JSON_BYTES) throw new ApiError(413, "Request is too large");

  const text = await context.req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new ApiError(413, "Request is too large");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(400, "Invalid JSON");
  }
}

async function requireUser(context: ApiContext): Promise<CurrentUser> {
  const user = await currentUser(getCookie(context, SESSION_COOKIE), context.env.DB);
  if (!user) throw new ApiError(401, "Sign in required");
  return user;
}

async function requireAdmin(context: ApiContext): Promise<CurrentUser> {
  const user = await requireUser(context);
  if (user.role !== "admin") throw new ApiError(403, "Admin access required");
  return user;
}

function routeParam(context: ApiContext, name: string): string {
  const value = context.req.param(name);
  if (!value) throw new ApiError(400, "Invalid route parameter");
  return value;
}

async function ownedTab(tabId: string, userId: string, env: Env): Promise<void> {
  const tab = await env.DB
    .prepare(`
      SELECT id FROM tabs
      WHERE id = ? AND user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    `)
    .bind(tabId, userId)
    .first();
  if (!tab) throw new ApiError(404, "Tab not found");
}

function mapTab(row: TabRow): object {
  return {
    id: row.id,
    title: row.title,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    snippetCount: row.snippet_count,
    fileCount: row.file_count,
  };
}

function mapFile(row: FileRow): object {
  return {
    id: row.id,
    tabId: row.tab_id,
    name: row.name,
    contentType: row.content_type,
    size: row.size,
    createdAt: row.created_at,
    downloadPath: `/api/files/${row.id}/content`,
  };
}

async function getSession(context: ApiContext): Promise<Response> {
  const [count, user] = await Promise.all([
    context.env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>(),
    currentUser(getCookie(context, SESSION_COOKIE), context.env.DB),
  ]);
  return context.json({ setupRequired: (count?.count ?? 0) === 0, user });
}

async function bootstrap(context: ApiContext): Promise<Response> {
  const body = await readJson<Credentials>(context);
  const username = normalizeUsername(body.username);
  const password = validatePassword(body.password);
  const displayName = cleanText(body.displayName, username, 80);
  const id = crypto.randomUUID();
  const passwordData = await hashPassword(password);
  const result = await context.env.DB
    .prepare(`
      INSERT INTO users (id, username, display_name, role, password_hash, password_salt)
      SELECT ?, ?, ?, 'admin', ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)
    `)
    .bind(id, username, displayName, passwordData.hash, passwordData.salt)
    .run();
  if (result.meta.changes !== 1) {
    throw new ApiError(409, "Handoff has already been initialized");
  }
  setCookie(
    context,
    SESSION_COOKIE,
    await createSession(id, context.env.DB),
    sessionCookieOptions,
  );
  return context.json({ user: { id, username, displayName, role: "admin" } }, 201);
}

async function login(context: ApiContext): Promise<Response> {
  const body = await readJson<Credentials>(context);
  const username = normalizeUsername(body.username);
  const password = validatePassword(body.password);
  const row = await context.env.DB
    .prepare(
      "SELECT id, username, display_name, role, password_hash, password_salt FROM users WHERE username = ?",
    )
    .bind(username)
    .first<{
      id: string;
      username: string;
      display_name: string;
      role: Role;
      password_hash: string;
      password_salt: string;
    }>();
  if (!row || !(await verifyPassword(password, row.password_salt, row.password_hash))) {
    throw new ApiError(401, "Invalid username or password");
  }
  setCookie(
    context,
    SESSION_COOKIE,
    await createSession(row.id, context.env.DB),
    sessionCookieOptions,
  );
  return context.json({
    user: {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
    },
  });
}

async function logout(context: ApiContext): Promise<Response> {
  await deleteSession(getCookie(context, SESSION_COOKIE), context.env.DB);
  deleteCookie(context, SESSION_COOKIE, sessionCookieOptions);
  return context.body(null, 204);
}

async function listUsers(context: ApiContext): Promise<Response> {
  await requireAdmin(context);
  const rows = await context.env.DB
    .prepare(
      "SELECT id, username, display_name, role, created_at FROM users ORDER BY created_at",
    )
    .all();
  return context.json({
    users: rows.results.map((row) => ({
      ...row,
      displayName: row.display_name,
      createdAt: row.created_at,
    })),
  });
}

async function createUser(context: ApiContext): Promise<Response> {
  await requireAdmin(context);
  const body = await readJson<Credentials>(context);
  const username = normalizeUsername(body.username);
  const password = validatePassword(body.password);
  const displayName = cleanText(body.displayName, username, 80);
  const role: Role = body.role === "admin" ? "admin" : "user";
  const id = crypto.randomUUID();
  const passwordData = await hashPassword(password);
  try {
    await context.env.DB
      .prepare(`
        INSERT INTO users (id, username, display_name, role, password_hash, password_salt)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(id, username, displayName, role, passwordData.hash, passwordData.salt)
      .run();
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new ApiError(409, "Username already exists");
    throw error;
  }
  return context.json({ user: { id, username, displayName, role } }, 201);
}

async function deleteUser(context: ApiContext): Promise<Response> {
  const admin = await requireAdmin(context);
  const userId = routeParam(context, "userId");
  if (userId === admin.id) {
    throw new ApiError(400, "You cannot delete your own account");
  }

  const target = await context.env.DB
    .prepare("SELECT role FROM users WHERE id = ?")
    .bind(userId)
    .first<{ role: Role }>();
  if (!target) throw new ApiError(404, "User not found");

  if (target.role === "admin") {
    const count = await context.env.DB
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'")
      .first<{ count: number }>();
    if ((count?.count ?? 0) <= 1) throw new ApiError(400, "Handoff must retain an admin");
  }

  const keys = await context.env.DB
    .prepare(
      "SELECT files.r2_key FROM files JOIN tabs ON tabs.id = files.tab_id WHERE tabs.user_id = ?",
    )
    .bind(userId)
    .all<{ r2_key: string }>();
  await Promise.all(keys.results.map((file) => context.env.FILES.delete(file.r2_key)));
  await context.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
  return context.body(null, 204);
}

async function listTabs(context: ApiContext): Promise<Response> {
  const user = await requireUser(context);
  const rows = await context.env.DB
    .prepare(`
      SELECT tabs.*, (SELECT COUNT(*) FROM snippets WHERE snippets.tab_id = tabs.id) AS snippet_count,
        (SELECT COUNT(*) FROM files WHERE files.tab_id = tabs.id) AS file_count
      FROM tabs
      WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY updated_at DESC
    `)
    .bind(user.id)
    .all<TabRow>();
  return context.json({ tabs: rows.results.map(mapTab) });
}

async function createTab(context: ApiContext): Promise<Response> {
  const user = await requireUser(context);
  const body = await readJson<TabInput>(context);
  const id = crypto.randomUUID();
  const title = cleanText(body.title, "Untitled tab", 120);
  const expiresAt = parseExpiry(body.expiresAt);
  await context.env.DB
    .prepare("INSERT INTO tabs (id, user_id, title, expires_at) VALUES (?, ?, ?, ?)")
    .bind(id, user.id, title, expiresAt)
    .run();
  const row = await context.env.DB
    .prepare("SELECT tabs.*, 0 AS snippet_count, 0 AS file_count FROM tabs WHERE id = ?")
    .bind(id)
    .first<TabRow>();
  return context.json({ tab: mapTab(row!) }, 201);
}

async function requireOwnedTab(context: ApiContext): Promise<{ tabId: string; user: CurrentUser }> {
  const user = await requireUser(context);
  const tabId = routeParam(context, "tabId");
  await ownedTab(tabId, user.id, context.env);
  return { tabId, user };
}

async function getTab(context: ApiContext): Promise<Response> {
  const { tabId } = await requireOwnedTab(context);
  const [tab, snippets, files] = await Promise.all([
    context.env.DB
      .prepare(`
        SELECT tabs.*, (SELECT COUNT(*) FROM snippets WHERE snippets.tab_id = tabs.id) AS snippet_count,
          (SELECT COUNT(*) FROM files WHERE files.tab_id = tabs.id) AS file_count
        FROM tabs WHERE id = ?
      `)
      .bind(tabId)
      .first<TabRow>(),
    context.env.DB
      .prepare(`
        SELECT id, tab_id, title, content, language, created_at, updated_at
        FROM snippets WHERE tab_id = ? ORDER BY created_at
      `)
      .bind(tabId)
      .all(),
    context.env.DB
      .prepare("SELECT * FROM files WHERE tab_id = ? ORDER BY created_at")
      .bind(tabId)
      .all<FileRow>(),
  ]);
  return context.json({
    tab: mapTab(tab!),
    snippets: snippets.results,
    files: files.results.map(mapFile),
  });
}

async function updateTab(context: ApiContext): Promise<Response> {
  const { tabId } = await requireOwnedTab(context);
  const body = await readJson<TabInput>(context);
  const title = cleanText(body.title, "Untitled tab", 120);
  const expiresAt = parseExpiry(body.expiresAt);
  await context.env.DB
    .prepare(
      "UPDATE tabs SET title = ?, expires_at = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(title, expiresAt, tabId)
    .run();
  return context.json({ ok: true });
}

async function deleteTab(context: ApiContext): Promise<Response> {
  const { tabId } = await requireOwnedTab(context);
  const keys = await context.env.DB
    .prepare("SELECT r2_key FROM files WHERE tab_id = ?")
    .bind(tabId)
    .all<{ r2_key: string }>();
  await Promise.all(keys.results.map((file) => context.env.FILES.delete(file.r2_key)));
  await context.env.DB.prepare("DELETE FROM tabs WHERE id = ?").bind(tabId).run();
  return context.body(null, 204);
}

function validateSnippetContent(content: unknown): string {
  if (
    typeof content !== "string" ||
    new TextEncoder().encode(content).byteLength > 1024 * 1024
  ) {
    throw new ApiError(400, "Snippet content is required and limited to 1 MiB");
  }
  return content;
}

async function createSnippet(context: ApiContext): Promise<Response> {
  const { tabId } = await requireOwnedTab(context);
  const body = await readJson<SnippetInput>(context);
  const snippet = {
    id: crypto.randomUUID(),
    title: cleanText(body.title, "Untitled snippet", 120),
    content: validateSnippetContent(body.content),
    language: cleanText(body.language, "text", 40),
  };
  await context.env.DB
    .prepare(
      "INSERT INTO snippets (id, tab_id, title, content, language) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(snippet.id, tabId, snippet.title, snippet.content, snippet.language)
    .run();
  await context.env.DB
    .prepare("UPDATE tabs SET updated_at = datetime('now') WHERE id = ?")
    .bind(tabId)
    .run();
  return context.json({ snippet }, 201);
}

async function ownedSnippet(
  context: ApiContext,
): Promise<{ id: string; tabId: string }> {
  const user = await requireUser(context);
  const id = routeParam(context, "snippetId");
  const existing = await context.env.DB
    .prepare(`
      SELECT snippets.tab_id FROM snippets
      JOIN tabs ON tabs.id = snippets.tab_id
      WHERE snippets.id = ? AND tabs.user_id = ?
    `)
    .bind(id, user.id)
    .first<{ tab_id: string }>();
  if (!existing) throw new ApiError(404, "Snippet not found");
  return { id, tabId: existing.tab_id };
}

async function updateSnippet(context: ApiContext): Promise<Response> {
  const { id, tabId } = await ownedSnippet(context);
  const body = await readJson<SnippetInput>(context);
  await context.env.DB
    .prepare(
      "UPDATE snippets SET title = ?, content = ?, language = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(
      cleanText(body.title, "Untitled snippet", 120),
      validateSnippetContent(body.content),
      cleanText(body.language, "text", 40),
      id,
    )
    .run();
  await context.env.DB
    .prepare("UPDATE tabs SET updated_at = datetime('now') WHERE id = ?")
    .bind(tabId)
    .run();
  return context.json({ ok: true });
}

async function deleteSnippet(context: ApiContext): Promise<Response> {
  const { id } = await ownedSnippet(context);
  await context.env.DB.prepare("DELETE FROM snippets WHERE id = ?").bind(id).run();
  return context.body(null, 204);
}

async function uploadFile(context: ApiContext): Promise<Response> {
  const { tabId, user } = await requireOwnedTab(context);
  const declaredSize = Number(context.req.header("Content-Length") ?? 0);
  const body = context.req.raw.body;
  if (declaredSize > MAX_FILE_BYTES || !body) {
    throw new ApiError(
      declaredSize > MAX_FILE_BYTES ? 413 : 400,
      "File is missing or exceeds 25 MiB",
    );
  }

  const name = cleanText(context.req.header("X-File-Name"), "download", 240);
  const id = crypto.randomUUID();
  const key = `${user.id}/${tabId}/${id}`;
  const contentType = context.req.header("Content-Type") ?? "application/octet-stream";
  const object = await context.env.FILES.put(key, body, {
    httpMetadata: { contentType },
  });
  if (object.size > MAX_FILE_BYTES) {
    await context.env.FILES.delete(key);
    throw new ApiError(413, "File exceeds 25 MiB");
  }

  try {
    await context.env.DB
      .prepare(
        "INSERT INTO files (id, tab_id, r2_key, name, content_type, size) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(id, tabId, key, name, contentType, object.size)
      .run();
    await context.env.DB
      .prepare("UPDATE tabs SET updated_at = datetime('now') WHERE id = ?")
      .bind(tabId)
      .run();
  } catch (error) {
    await context.env.FILES.delete(key);
    throw error;
  }
  return context.json(
    {
      file: {
        id,
        tabId,
        name,
        size: object.size,
        contentType,
        downloadPath: `/api/files/${id}/content`,
      },
    },
    201,
  );
}

async function ownedFile(context: ApiContext): Promise<FileRow> {
  const user = await requireUser(context);
  const fileId = routeParam(context, "fileId");
  const file = await context.env.DB
    .prepare(`
      SELECT files.* FROM files JOIN tabs ON tabs.id = files.tab_id
      WHERE files.id = ? AND tabs.user_id = ?
        AND (tabs.expires_at IS NULL OR tabs.expires_at > datetime('now'))
    `)
    .bind(fileId, user.id)
    .first<FileRow>();
  if (!file) throw new ApiError(404, "File not found");
  return file;
}

async function downloadFile(context: ApiContext): Promise<Response> {
  const file = await ownedFile(context);
  const object = await context.env.FILES.get(file.r2_key, {
    range: new Headers(context.req.header()),
  });
  if (!object) throw new ApiError(404, "File content not found");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
  );
  return context.body(
    object.body,
    object.range ? 206 : 200,
    Object.fromEntries(headers.entries()),
  );
}

async function deleteFile(context: ApiContext): Promise<Response> {
  const file = await ownedFile(context);
  await context.env.FILES.delete(file.r2_key);
  await context.env.DB.prepare("DELETE FROM files WHERE id = ?").bind(file.id).run();
  return context.body(null, 204);
}

export const api = new Hono<ApiEnv>();

api.get("/health", (context) => context.json({ status: "ok" }));

api.get("/session", getSession);
api.post("/auth/bootstrap", bootstrap);
api.post("/auth/login", login);
api.post("/auth/logout", logout);

api.get("/users", listUsers);
api.post("/users", createUser);
api.delete("/users/:userId", deleteUser);

api.get("/tabs", listTabs);
api.post("/tabs", createTab);
api.get("/tabs/:tabId", getTab);
api.patch("/tabs/:tabId", updateTab);
api.delete("/tabs/:tabId", deleteTab);

api.post("/tabs/:tabId/snippets", createSnippet);
api.patch("/snippets/:snippetId", updateSnippet);
api.delete("/snippets/:snippetId", deleteSnippet);

api.post("/tabs/:tabId/files", uploadFile);
api.get("/files/:fileId/content", downloadFile);
api.delete("/files/:fileId", deleteFile);

api.all("*", (context) => context.json({ error: "Not found" }, 404));

api.onError((error, context) => {
  if (error instanceof ApiError) {
    return context.json({ error: error.message }, error.status);
  }
  console.error(
    JSON.stringify({
      message: "API request failed",
      path: context.req.path,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return context.json({ error: "Internal server error" }, 500);
});

export async function clearExpired(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  const expired = await env.DB
    .prepare(
      "SELECT id FROM tabs WHERE expires_at IS NOT NULL AND expires_at <= datetime('now') LIMIT 100",
    )
    .all<{ id: string }>();

  for (const tab of expired.results) {
    const files = await env.DB
      .prepare("SELECT r2_key FROM files WHERE tab_id = ?")
      .bind(tab.id)
      .all<{ r2_key: string }>();
    await Promise.all(files.results.map((file) => env.FILES.delete(file.r2_key)));
    await env.DB
      .prepare("DELETE FROM tabs WHERE id = ?")
      .bind(tab.id)
      .run();
  }

  console.log(
    JSON.stringify({
      message: "expiration cleanup complete",
      tabsDeleted: expired.results.length,
    }),
  );
}