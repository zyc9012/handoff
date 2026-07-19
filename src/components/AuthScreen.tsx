import { ArrowLeft, Clock3, Files, Radio, ShieldCheck } from 'lucide-preact'
import { useState } from 'preact/hooks'
import { api, type SessionState, type User } from '../api'
import { ErrorLine } from './ErrorLine'

interface AuthScreenProps {
  session: SessionState
  onAuthenticated: (user: User) => void
  onNearby: () => void
}

export function AuthScreen({ session, onAuthenticated, onNearby }: AuthScreenProps) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')

    try {
      const result = session.setupRequired
        ? await api.bootstrap({ username, displayName, password })
        : await api.login({ username, password })
      onAuthenticated(result.user)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not continue')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <span className="brand-kicker">HANDOFF / PRIVATE WORKSPACE</span>
        <h1>Move text and files between the places you work.</h1>
        <div className="auth-features">
          <span>
            <Files size={18} /> Tabs keep each handoff together
          </span>
          <span>
            <Clock3 size={18} /> Automatic expiration and cleanup
          </span>
          <span>
            <Radio size={18} /> Send to nearby devices without an account
          </span>
        </div>
        <button className="nearby-entry" type="button" onClick={onNearby}>
          <Radio size={20} />
          <span>
            <strong>Nearby drop</strong>
            <small>No sign-in required.</small>
          </span>
          <ArrowLeft className="entry-arrow" size={18} />
        </button>
      </section>

      <section className="auth-form-wrap">
        <div className="auth-wordmark">
          <span>H</span> HANDOFF
        </div>
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <p className="eyebrow">
            {session.setupRequired ? 'First run' : 'Private workspace'}
          </p>
          <h2>
            {session.setupRequired ? 'Create the administrator' : 'Sign in to Handoff'}
          </h2>
          {session.setupRequired && (
            <label>
              Display name
              <input
                value={displayName}
                onInput={(event) => setDisplayName(event.currentTarget.value)}
                required
                maxLength={80}
                autoFocus
              />
            </label>
          )}
          <label>
            Username
            <input
              value={username}
              onInput={(event) => setUsername(event.currentTarget.value)}
              required
              minLength={3}
              maxLength={32}
              autoFocus={!session.setupRequired}
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onInput={(event) => setPassword(event.currentTarget.value)}
              required
              minLength={10}
              maxLength={128}
              autoComplete={session.setupRequired ? 'new-password' : 'current-password'}
            />
          </label>
          <ErrorLine error={error} />
          <button className="primary-button auth-submit" disabled={busy}>
            {busy
              ? 'Working...'
              : session.setupRequired
                ? 'Create administrator'
                : 'Sign in'}
          </button>
          {session.setupRequired && (
            <p className="form-note">
              <ShieldCheck size={15} /> Only this first account can be self-created.
              Further accounts require an admin.
            </p>
          )}
        </form>
      </section>
    </main>
  )
}