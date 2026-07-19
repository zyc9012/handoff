export type Role = 'admin' | 'user'

export interface User {
  id: string
  username: string
  displayName: string
  role: Role
  createdAt?: string
}

export interface SessionState {
  setupRequired: boolean
  user: User | null
}

export interface TabSummary {
  id: string
  title: string
  expiresAt: string | null
  createdAt: string
  updatedAt: string
  snippetCount: number
  fileCount: number
}

export interface Snippet {
  id: string
  tab_id: string
  title: string
  content: string
  language: string
  created_at: string
  updated_at: string
}

export interface StoredFile {
  id: string
  tabId: string
  name: string
  contentType: string
  size: number
  createdAt: string
  downloadPath: string
}

export interface TabDetail {
  tab: TabSummary
  snippets: Snippet[]
  files: StoredFile[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Request failed' })) as { error?: string }
    throw new Error(body.error ?? `Request failed (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }
}

export const api = {
  session: () => request<SessionState>('/api/session'),
  bootstrap: (body: { username: string; displayName: string; password: string }) => request<{ user: User }>('/api/auth/bootstrap', jsonInit('POST', body)),
  login: (body: { username: string; password: string }) => request<{ user: User }>('/api/auth/login', jsonInit('POST', body)),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  tabs: () => request<{ tabs: TabSummary[] }>('/api/tabs'),
  tab: (id: string) => request<TabDetail>(`/api/tabs/${id}`),
  createTab: (body: { title: string; expiresAt: string | null }) => request<{ tab: TabSummary }>('/api/tabs', jsonInit('POST', body)),
  updateTab: (id: string, body: { title: string; expiresAt: string | null }) => request<{ ok: true }>(`/api/tabs/${id}`, jsonInit('PATCH', body)),
  deleteTab: (id: string) => request<void>(`/api/tabs/${id}`, { method: 'DELETE' }),
  createSnippet: (tabId: string, body: { title: string; content: string; language: string }) => request<{ snippet: Snippet }>(`/api/tabs/${tabId}/snippets`, jsonInit('POST', body)),
  updateSnippet: (id: string, body: { title: string; content: string; language: string }) => request<{ ok: true }>(`/api/snippets/${id}`, jsonInit('PATCH', body)),
  deleteSnippet: (id: string) => request<void>(`/api/snippets/${id}`, { method: 'DELETE' }),
  uploadFile: (tabId: string, file: File) => request<{ file: StoredFile }>(`/api/tabs/${tabId}/files`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': file.name },
    body: file,
  }),
  deleteFile: (id: string) => request<void>(`/api/files/${id}`, { method: 'DELETE' }),
  users: () => request<{ users: User[] }>('/api/users'),
  createUser: (body: { username: string; displayName: string; password: string; role: Role }) => request<{ user: User }>('/api/users', jsonInit('POST', body)),
  deleteUser: (id: string) => request<void>(`/api/users/${id}`, { method: 'DELETE' }),
}