import { useEffect, useState } from 'preact/hooks'
import { api, type SessionState } from './api'
import { AuthScreen } from './components/AuthScreen'
import { Dashboard } from './components/Dashboard'
import { NearbyDrop } from './components/NearbyDrop'

export default function App() {
  const [session, setSession] = useState<SessionState | null>(null)
  const [nearby, setNearby] = useState(location.pathname === '/drop')

  useEffect(() => {
    void api
      .session()
      .then(setSession)
      .catch(() => setSession({ setupRequired: false, user: null }))
  }, [])

  const leaveNearby = () => {
    history.replaceState(null, '', '/')
    setNearby(false)
  }

  const enterNearby = () => {
    history.replaceState(null, '', '/drop')
    setNearby(true)
  }

  if (nearby) return <NearbyDrop onBack={leaveNearby} />
  if (!session) {
    return (
      <div className="app-loading">
        <span>H</span>
      </div>
    )
  }
  if (!session.user) {
    return (
      <AuthScreen
        session={session}
        onAuthenticated={(user) => setSession({ setupRequired: false, user })}
        onNearby={enterNearby}
      />
    )
  }

  return (
    <Dashboard
      user={session.user}
      onNearby={enterNearby}
      onLogout={() =>
        void api
          .logout()
          .finally(() => setSession({ setupRequired: false, user: null }))
      }
    />
  )
}