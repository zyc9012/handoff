import {
  createSession,
  currentUser,
  deleteSession,
  expiredSessionCookie,
  hashPassword,
  type CurrentUser,
  type Role,
  verifyPassword,
} from "./auth";

const MAX_JSON_BYTES = 1_100_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

class ApiError extends Error {
  constructor(readonly status: number, message: string) {
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

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(data, { status, headers });
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

async function readJson<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > MAX_JSON_BYTES) throw new ApiError(413, "Request is too large");

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new ApiError(413, "Request is too large");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(400, "Invalid JSON");
  }
}

async function requireUser(request: Request, env: Env): Promise<CurrentUser> {
  const user = await currentUser(request, env.DB);
  if (!user) throw new ApiError(401, "Sign in required");
  return user;
}

async function requireAdmin(request: Request, env: Env): Promise<CurrentUser> {
  const user = await requireUser(request, env);
  if (user.role !== "admin") throw new ApiError(403, "Admin access required");
  return user;
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

async function handleAuth(
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> {
  if (path === "/api/session" && request.method === "GET") {
    const [count, user] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>(),
      currentUser(request, env.DB),
    ]);
    return json({ setupRequired: (count?.count ?? 0) === 0, user });
  }

  if (path === "/api/auth/bootstrap" && request.method === "POST") {
    const body = await readJson<Credentials>(request);
    const username = normalizeUsername(body.username);
    const password = validatePassword(body.password);
    const displayName = cleanText(body.displayName, username, 80);
    const id = crypto.randomUUID();
    const passwordData = await hashPassword(password);
    const result = await env.DB
      .prepare(`
        INSERT INTO users (id, username, display_name, role, password_hash, password_salt)
        SELECT ?, ?, ?, 'admin', ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)
      `)
      .bind(id, username, displayName, passwordData.hash, passwordData.salt)
      .run();
    if (result.meta.changes !== 1) {
      throw new ApiError(409, "Handoff has already been initialized");
    }
    return json(
      { user: { id, username, displayName, role: "admin" } },
      201,
      { "Set-Cookie": await createSession(id, env.DB) },
    );
  }

  if (path === "/api/auth/login" && request.method === "POST") {
    const body = await readJson<Credentials>(request);
    const username = normalizeUsername(body.username);
    const password = validatePassword(body.password);
    const row = await env.DB
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
    return json(
      {
        user: {
          id: row.id,
          username: row.username,
          displayName: row.display_name,
          role: row.role,
        },
      },
      200,
      { "Set-Cookie": await createSession(row.id, env.DB) },
    );
  }

  if (path === "/api/auth/logout" && request.method === "POST") {
    await deleteSession(request, env.DB);
    return new Response(null, {
      status: 204,
      headers: { "Set-Cookie": expiredSessionCookie },
    });
  }
  return null;
}

async function handleUsers(
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> {
  if (path === "/api/users" && request.method === "GET") {
    await requireAdmin(request, env);
    const rows = await env.DB
      .prepare(
        "SELECT id, username, display_name, role, created_at FROM users ORDER BY created_at",
      )
      .all();
    return json({
      users: rows.results.map((row) => ({
        ...row,
        displayName: row.display_name,
        createdAt: row.created_at,
      })),
    });
  }

  if (path === "/api/users" && request.method === "POST") {
    await requireAdmin(request, env);
    const body = await readJson<Credentials>(request);
    const username = normalizeUsername(body.username);
    const password = validatePassword(body.password);
    const displayName = cleanText(body.displayName, username, 80);
    const role: Role = body.role === "admin" ? "admin" : "user";
    const id = crypto.randomUUID();
    const passwordData = await hashPassword(password);
    try {
      await env.DB
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
    return json({ user: { id, username, displayName, role } }, 201);
  }

  const match = /^\/api\/users\/([^/]+)$/.exec(path);
  if (match && request.method === "DELETE") {
    const admin = await requireAdmin(request, env);
    if (match[1] === admin.id) {
      throw new ApiError(400, "You cannot delete your own account");
    }

    const target = await env.DB
      .prepare("SELECT role FROM users WHERE id = ?")
      .bind(match[1])
      .first<{ role: Role }>();
    if (!target) throw new ApiError(404, "User not found");

    if (target.role === "admin") {
      const count = await env.DB
        .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'")
        .first<{ count: number }>();
      if ((count?.count ?? 0) <= 1) throw new ApiError(400, "Handoff must retain an admin");
    }

    const keys = await env.DB
      .prepare(
        "SELECT files.r2_key FROM files JOIN tabs ON tabs.id = files.tab_id WHERE tabs.user_id = ?",
      )
      .bind(match[1])
      .all<{ r2_key: string }>();
    await Promise.all(keys.results.map((file) => env.FILES.delete(file.r2_key)));
    await env.DB
      .prepare("DELETE FROM users WHERE id = ?")
      .bind(match[1])
      .run();
    return new Response(null, { status: 204 });
  }
  return null;
}

async function handleTabs(
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> {
  if (path === "/api/tabs" && request.method === "GET") {
    const user = await requireUser(request, env);
    const rows = await env.DB
      .prepare(`
        SELECT tabs.*, (SELECT COUNT(*) FROM snippets WHERE snippets.tab_id = tabs.id) AS snippet_count,
          (SELECT COUNT(*) FROM files WHERE files.tab_id = tabs.id) AS file_count
        FROM tabs
        WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
        ORDER BY updated_at DESC
      `)
      .bind(user.id)
      .all<TabRow>();
    return json({ tabs: rows.results.map(mapTab) });
  }

  if (path === "/api/tabs" && request.method === "POST") {
    const user = await requireUser(request, env);
    const body = await readJson<TabInput>(request);
    const id = crypto.randomUUID();
    const title = cleanText(body.title, "Untitled tab", 120);
    const expiresAt = parseExpiry(body.expiresAt);
    await env.DB
      .prepare("INSERT INTO tabs (id, user_id, title, expires_at) VALUES (?, ?, ?, ?)")
      .bind(id, user.id, title, expiresAt)
      .run();
    const row = await env.DB
      .prepare("SELECT tabs.*, 0 AS snippet_count, 0 AS file_count FROM tabs WHERE id = ?")
      .bind(id)
      .first<TabRow>();
    return json({ tab: mapTab(row!) }, 201);
  }

  const match = /^\/api\/tabs\/([^/]+)$/.exec(path);
  if (!match) return null;
  const user = await requireUser(request, env);
  await ownedTab(match[1], user.id, env);

  if (request.method === "GET") {
    const [tab, snippets, files] = await Promise.all([
      env.DB
        .prepare(`
          SELECT tabs.*, (SELECT COUNT(*) FROM snippets WHERE snippets.tab_id = tabs.id) AS snippet_count,
            (SELECT COUNT(*) FROM files WHERE files.tab_id = tabs.id) AS file_count
          FROM tabs WHERE id = ?
        `)
        .bind(match[1])
        .first<TabRow>(),
      env.DB
        .prepare(`
          SELECT id, tab_id, title, content, language, created_at, updated_at
          FROM snippets WHERE tab_id = ? ORDER BY created_at
        `)
        .bind(match[1])
        .all(),
      env.DB
        .prepare("SELECT * FROM files WHERE tab_id = ? ORDER BY created_at")
        .bind(match[1])
        .all<FileRow>(),
    ]);
    return json({
      tab: mapTab(tab!),
      snippets: snippets.results,
      files: files.results.map(mapFile),
    });
  }

  if (request.method === "PATCH") {
    const body = await readJson<TabInput>(request);
    const title = cleanText(body.title, "Untitled tab", 120);
    const expiresAt = parseExpiry(body.expiresAt);
    await env.DB
      .prepare(
        "UPDATE tabs SET title = ?, expires_at = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .bind(title, expiresAt, match[1])
      .run();
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    const keys = await env.DB
      .prepare("SELECT r2_key FROM files WHERE tab_id = ?")
      .bind(match[1])
      .all<{ r2_key: string }>();
    await Promise.all(keys.results.map((file) => env.FILES.delete(file.r2_key)));
    await env.DB
      .prepare("DELETE FROM tabs WHERE id = ?")
      .bind(match[1])
      .run();
    return new Response(null, { status: 204 });
  }
  return null;
}

async function handleSnippets(
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> {
  const createMatch = /^\/api\/tabs\/([^/]+)\/snippets$/.exec(path);
  if (createMatch && request.method === "POST") {
    const user = await requireUser(request, env);
    await ownedTab(createMatch[1], user.id, env);
    const body = await readJson<SnippetInput>(request);
    if (
      typeof body.content !== "string" ||
      new TextEncoder().encode(body.content).byteLength > 1024 * 1024
    ) {
      throw new ApiError(400, "Snippet content is required and limited to 1 MiB");
    }
    const snippet = {
      id: crypto.randomUUID(),
      title: cleanText(body.title, "Untitled snippet", 120),
      content: body.content,
      language: cleanText(body.language, "text", 40),
    };
    await env.DB
      .prepare(
        "INSERT INTO snippets (id, tab_id, title, content, language) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(snippet.id, createMatch[1], snippet.title, snippet.content, snippet.language)
      .run();
    await env.DB
      .prepare("UPDATE tabs SET updated_at = datetime('now') WHERE id = ?")
      .bind(createMatch[1])
      .run();
    return json({ snippet }, 201);
  }

  const match = /^\/api\/snippets\/([^/]+)$/.exec(path);
  if (!match) return null;
  const user = await requireUser(request, env);
  const existing = await env.DB
    .prepare(`
      SELECT snippets.tab_id FROM snippets
      JOIN tabs ON tabs.id = snippets.tab_id
      WHERE snippets.id = ? AND tabs.user_id = ?
    `)
    .bind(match[1], user.id)
    .first<{ tab_id: string }>();
  if (!existing) throw new ApiError(404, "Snippet not found");

  if (request.method === "PATCH") {
    const body = await readJson<SnippetInput>(request);
    if (
      typeof body.content !== "string" ||
      new TextEncoder().encode(body.content).byteLength > 1024 * 1024
    ) {
      throw new ApiError(400, "Snippet content is required and limited to 1 MiB");
    }
    await env.DB
      .prepare(
        "UPDATE snippets SET title = ?, content = ?, language = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .bind(
        cleanText(body.title, "Untitled snippet", 120),
        body.content,
        cleanText(body.language, "text", 40),
        match[1],
      )
      .run();
    await env.DB
      .prepare("UPDATE tabs SET updated_at = datetime('now') WHERE id = ?")
      .bind(existing.tab_id)
      .run();
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    await env.DB
      .prepare("DELETE FROM snippets WHERE id = ?")
      .bind(match[1])
      .run();
    return new Response(null, { status: 204 });
  }
  return null;
}

async function handleFiles(
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> {
  const uploadMatch = /^\/api\/tabs\/([^/]+)\/files$/.exec(path);
  if (uploadMatch && request.method === "POST") {
    const user = await requireUser(request, env);
    await ownedTab(uploadMatch[1], user.id, env);
    const declaredSize = Number(request.headers.get("Content-Length") ?? 0);
    if (declaredSize > MAX_FILE_BYTES || !request.body) {
      throw new ApiError(
        declaredSize > MAX_FILE_BYTES ? 413 : 400,
        "File is missing or exceeds 25 MiB",
      );
    }

    const name = cleanText(request.headers.get("X-File-Name"), "download", 240);
    const id = crypto.randomUUID();
    const key = `${user.id}/${uploadMatch[1]}/${id}`;
    const contentType = request.headers.get("Content-Type") ?? "application/octet-stream";
    const object = await env.FILES.put(key, request.body, {
      httpMetadata: { contentType },
    });
    if (object.size > MAX_FILE_BYTES) {
      await env.FILES.delete(key);
      throw new ApiError(413, "File exceeds 25 MiB");
    }

    try {
      await env.DB
        .prepare(
          "INSERT INTO files (id, tab_id, r2_key, name, content_type, size) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(id, uploadMatch[1], key, name, contentType, object.size)
        .run();
      await env.DB
        .prepare("UPDATE tabs SET updated_at = datetime('now') WHERE id = ?")
        .bind(uploadMatch[1])
        .run();
    } catch (error) {
      await env.FILES.delete(key);
      throw error;
    }
    return json(
      {
        file: {
          id,
          tabId: uploadMatch[1],
          name,
          size: object.size,
          contentType,
          downloadPath: `/api/files/${id}/content`,
        },
      },
      201,
    );
  }

  const match = /^\/api\/files\/([^/]+)(\/content)?$/.exec(path);
  if (!match) return null;
  const user = await requireUser(request, env);
  const file = await env.DB
    .prepare(`
      SELECT files.* FROM files JOIN tabs ON tabs.id = files.tab_id
      WHERE files.id = ? AND tabs.user_id = ?
        AND (tabs.expires_at IS NULL OR tabs.expires_at > datetime('now'))
    `)
    .bind(match[1], user.id)
    .first<FileRow>();
  if (!file) throw new ApiError(404, "File not found");

  if (match[2] && request.method === "GET") {
    const object = await env.FILES.get(file.r2_key, { range: request.headers });
    if (!object) throw new ApiError(404, "File content not found");

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    return new Response(object.body, { status: object.range ? 206 : 200, headers });
  }

  if (!match[2] && request.method === "DELETE") {
    await env.FILES.delete(file.r2_key);
    await env.DB
      .prepare("DELETE FROM files WHERE id = ?")
      .bind(file.id)
      .run();
    return new Response(null, { status: 204 });
  }
  return null;
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  try {
    const response =
      (await handleAuth(request, env, path)) ??
      (await handleUsers(request, env, path)) ??
      (await handleTabs(request, env, path)) ??
      (await handleSnippets(request, env, path)) ??
      (await handleFiles(request, env, path));
    return response ?? json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    console.error(
      JSON.stringify({
        message: "API request failed",
        path,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return json({ error: "Internal server error" }, 500);
  }
}

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