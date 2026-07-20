import { Files, HardDrive, LoaderCircle, LogOut, Plus, Radio, Users } from 'lucide-preact'
import { useEffect, useState } from 'preact/hooks'
import { api, type TabDetail, type TabSummary, type User } from '../api'
import { AdminPanel } from './AdminPanel'
import { ErrorLine } from './ErrorLine'
import { TabWorkspace } from './TabWorkspace'

interface DashboardProps {
  user: User
  onLogout: () => Promise<void>
  onNearby: () => void
}

export function Dashboard({ user, onLogout, onNearby }: DashboardProps) {
  const [tabs, setTabs] = useState<TabSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TabDetail | null>(null)
  const [adminOpen, setAdminOpen] = useState(false)
  const [error, setError] = useState('')
  const [loadingTabs, setLoadingTabs] = useState(true)
  const [creatingTab, setCreatingTab] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const loadTabs = async () => {
    setLoadingTabs(true)
    try {
      const result = await api.tabs()
      setTabs(result.tabs)
      setActiveId((current) =>
        current && result.tabs.some((tab) => tab.id === current)
          ? current
          : result.tabs[0]?.id ?? null,
      )
    } finally {
      setLoadingTabs(false)
    }
  }

  const loadDetail = async () => {
    if (!activeId) {
      setDetail(null)
      return
    }

    if (detail?.tab.id !== activeId) setDetail(null)
    setDetail(await api.tab(activeId))
  }

  useEffect(() => {
    void loadTabs().catch((caught: Error) => setError(caught.message))
  }, [])

  useEffect(() => {
    void loadDetail().catch((caught: Error) => setError(caught.message))
  }, [activeId])

  const refresh = async () => {
    await Promise.all([loadTabs(), loadDetail()])
  }

  const createTab = async () => {
    setCreatingTab(true)
    setError('')
    try {
      const result = await api.createTab({ title: 'Untitled tab', expiresAt: null })
      await loadTabs()
      setActiveId(result.tab.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create tab')
    } finally {
      setCreatingTab(false)
    }
  }

  const deleteCurrent = async () => {
    if (!activeId) return
    await api.deleteTab(activeId)
    setActiveId(null)
    setDetail(null)
    await loadTabs()
  }

  const signOut = async () => {
    setSigningOut(true)
    setError('')
    try {
      await onLogout()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign out')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="dashboard">
      <header className="app-header">
        <a className="wordmark" href="/">
          <span>H</span> HANDOFF
        </a>
        <div className="header-actions">
          <button className="header-button" type="button" onClick={onNearby}>
            <Radio size={17} /> Nearby
          </button>
          {user.role === 'admin' && (
            <button
              className="header-button"
              type="button"
              onClick={() => setAdminOpen(true)}
            >
              <Users size={17} /> Users
            </button>
          )}
          <div className="profile">
            <span>{user.displayName.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{user.displayName}</strong>
              <small>{user.role}</small>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            title={signingOut ? 'Signing out' : 'Sign out'}
            disabled={signingOut}
            onClick={() => void signOut()}
          >
            {signingOut ? <LoaderCircle className="loading-spinner" size={17} /> : <LogOut size={17} />}
          </button>
        </div>
      </header>

      <aside className="tab-sidebar">
        <div className="sidebar-heading">
          <span>Your tabs</span>
          <button
            className="icon-button"
            type="button"
            title="Create tab"
            disabled={creatingTab}
            onClick={() => void createTab()}
          >
            {creatingTab ? <LoaderCircle className="loading-spinner" size={17} /> : <Plus size={17} />}
          </button>
        </div>
        <nav>
          {loadingTabs && !tabs.length && (
            <span className="sidebar-loading" role="status">
              <LoaderCircle className="loading-spinner" size={16} /> Loading tabs
            </span>
          )}
          {tabs.map((tab) => (
            <button
              className="tab-nav-item"
              data-active={tab.id === activeId}
              type="button"
              key={tab.id}
              onClick={() => setActiveId(tab.id)}
            >
              <span className="tab-icon">
                <HardDrive size={17} />
              </span>
              <span>
                <strong>{tab.title}</strong>
                <small>
                  {tab.snippetCount} snippets / {tab.fileCount} files
                </small>
              </span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="workspace">
        <ErrorLine error={error} />
        {(activeId !== null && detail?.tab.id !== activeId) || (loadingTabs && !tabs.length) ? (
          <section className="workspace-loading" role="status">
            <LoaderCircle className="loading-spinner" size={24} />
            <span>Loading workspace</span>
          </section>
        ) : detail ? (
          <TabWorkspace
            detail={detail}
            onChanged={refresh}
            onDeleted={deleteCurrent}
          />
        ) : (
          <section className="workspace-empty">
            <Files size={32} />
            <h1>Your handoff space is clear.</h1>
            <p>Create a tab to collect snippets and files for the next move.</p>
            <button
              className="primary-button"
              type="button"
              disabled={creatingTab}
              onClick={() => void createTab()}
            >
              {creatingTab ? <LoaderCircle className="loading-spinner" size={17} /> : <Plus size={17} />}
              {creatingTab ? 'Creating...' : 'Create a tab'}
            </button>
          </section>
        )}
      </div>

      {adminOpen && (
        <AdminPanel currentUser={user} onClose={() => setAdminOpen(false)} />
      )}
    </div>
  )
}