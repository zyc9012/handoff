import { Files, HardDrive, LogOut, Plus, Radio, Users } from 'lucide-preact'
import { useEffect, useState } from 'preact/hooks'
import { api, type TabDetail, type TabSummary, type User } from '../api'
import { AdminPanel } from './AdminPanel'
import { ErrorLine } from './ErrorLine'
import { TabWorkspace } from './TabWorkspace'

interface DashboardProps {
  user: User
  onLogout: () => void
  onNearby: () => void
}

export function Dashboard({ user, onLogout, onNearby }: DashboardProps) {
  const [tabs, setTabs] = useState<TabSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TabDetail | null>(null)
  const [adminOpen, setAdminOpen] = useState(false)
  const [error, setError] = useState('')

  const loadTabs = async () => {
    const result = await api.tabs()
    setTabs(result.tabs)
    if (!activeId && result.tabs[0]) setActiveId(result.tabs[0].id)
  }

  const loadDetail = async () => {
    if (activeId) setDetail(await api.tab(activeId))
    else setDetail(null)
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
    const result = await api.createTab({ title: 'Untitled tab', expiresAt: null })
    await loadTabs()
    setActiveId(result.tab.id)
  }

  const deleteCurrent = async () => {
    if (!activeId) return
    await api.deleteTab(activeId)
    setActiveId(null)
    setDetail(null)
    await loadTabs()
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
          <button className="icon-button" type="button" title="Sign out" onClick={onLogout}>
            <LogOut size={17} />
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
            onClick={() => void createTab()}
          >
            <Plus size={17} />
          </button>
        </div>
        <nav>
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
        {detail ? (
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
              onClick={() => void createTab()}
            >
              <Plus size={17} /> Create a tab
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