import { LoaderCircle, Trash2, UserPlus, X } from 'lucide-preact'
import { useEffect, useState } from 'preact/hooks'
import { api, type User } from '../api'
import { ErrorLine } from './ErrorLine'

interface AdminPanelProps {
  currentUser: User
  onClose: () => void
}

const emptyForm = {
  username: '',
  displayName: '',
  password: '',
  role: 'user' as const,
}

export function AdminPanel({ currentUser, onClose }: AdminPanelProps) {
  const [users, setUsers] = useState<User[]>([])
  const [form, setForm] = useState<{
    username: string
    displayName: string
    password: string
    role: 'admin' | 'user'
  }>(emptyForm)
  const [error, setError] = useState('')
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [creatingUser, setCreatingUser] = useState(false)
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)

  const load = async () => {
    setLoadingUsers(true)
    try {
      const result = await api.users()
      setUsers(result.users)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load users')
    } finally {
      setLoadingUsers(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const create = async (event: SubmitEvent) => {
    event.preventDefault()
    setCreatingUser(true)
    setError('')
    try {
      await api.createUser(form)
      setForm(emptyForm)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create user')
    } finally {
      setCreatingUser(false)
    }
  }

  const deleteUser = async (user: User) => {
    setDeletingUserId(user.id)
    setError('')
    try {
      await api.deleteUser(user.id)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete user')
    } finally {
      setDeletingUserId(null)
    }
  }

  return (
    <div className="modal-backdrop">
      <section
        className="admin-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-title"
      >
        <header>
          <div>
            <p className="eyebrow">Administration</p>
            <h2 id="admin-title">People with access</h2>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <form className="user-form" onSubmit={(event) => void create(event)}>
          <input
            placeholder="Display name"
            value={form.displayName}
            disabled={creatingUser}
            onInput={(event) =>
              setForm({ ...form, displayName: event.currentTarget.value })
            }
            required
          />
          <input
            placeholder="Username"
            value={form.username}
            disabled={creatingUser}
            onInput={(event) => setForm({ ...form, username: event.currentTarget.value })}
            required
          />
          <input
            type="password"
            placeholder="Temporary password (10+ characters)"
            value={form.password}
            disabled={creatingUser}
            onInput={(event) => setForm({ ...form, password: event.currentTarget.value })}
            required
            minLength={10}
          />
          <select
            value={form.role}
            disabled={creatingUser}
            onChange={(event) =>
              setForm({ ...form, role: event.currentTarget.value as 'admin' | 'user' })
            }
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <button className="primary-button" disabled={creatingUser}>
            {creatingUser ? <LoaderCircle className="loading-spinner" size={16} /> : <UserPlus size={16} />}
            {creatingUser ? 'Creating...' : 'Create user'}
          </button>
        </form>

        <ErrorLine error={error} />
        <div className="user-list">
          {loadingUsers && !users.length && (
            <div className="list-loading" role="status">
              <LoaderCircle className="loading-spinner" size={17} /> Loading users
            </div>
          )}
          {users.map((user) => (
            <div className="user-row" key={user.id}>
              <span className="user-avatar">
                {user.displayName.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{user.displayName}</strong>
                <small>@{user.username}</small>
              </div>
              <span className="role-badge">{user.role}</span>
              {user.id !== currentUser.id && (
                <button
                  className="icon-button danger-icon"
                  type="button"
                  title={deletingUserId === user.id ? 'Deleting user' : 'Delete user'}
                  disabled={deletingUserId !== null}
                  onClick={() => {
                    if (confirm(`Delete ${user.displayName} and all their tabs?`)) {
                      void deleteUser(user)
                    }
                  }}
                >
                  {deletingUserId === user.id ? <LoaderCircle className="loading-spinner" size={16} /> : <Trash2 size={16} />}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}