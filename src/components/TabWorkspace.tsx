import { ChevronDown, FilePlus2, Plus, Save, Trash2, Upload } from 'lucide-preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { api, type TabDetail } from '../api'
import { ErrorLine } from './ErrorLine'
import { SnippetEditor } from './SnippetEditor'
import { StoredFileRow } from './StoredFileRow'

interface TabWorkspaceProps {
  detail: TabDetail
  onChanged: () => Promise<void>
  onDeleted: () => Promise<void>
}

function expiryFromChoice(choice: string): string | null {
  if (choice === 'never') return null
  return new Date(Date.now() + Number(choice) * 60 * 60 * 1000).toISOString()
}

export function TabWorkspace({ detail, onChanged, onDeleted }: TabWorkspaceProps) {
  const [title, setTitle] = useState(detail.tab.title)
  const [expiry, setExpiry] = useState(detail.tab.expiresAt ? '24' : 'never')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTitle(detail.tab.title)
    setExpiry(detail.tab.expiresAt ? '24' : 'never')
  }, [detail.tab.id, detail.tab.title, detail.tab.expiresAt])

  const saveTab = async () => {
    setError('')
    try {
      await api.updateTab(detail.tab.id, {
        title,
        expiresAt: expiryFromChoice(expiry),
      })
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save tab')
    }
  }

  const addSnippet = async () => {
    await api.createSnippet(detail.tab.id, {
      title: `Snippet ${detail.snippets.length + 1}`,
      content: '',
      language: 'text',
    })
    await onChanged()
  }

  const upload = async (files: FileList | null) => {
    if (!files?.length) return

    setUploading(true)
    setError('')
    try {
      for (const file of Array.from(files)) {
        await api.uploadFile(detail.tab.id, file)
      }
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <section className="workspace-main">
      <header className="tab-heading">
        <div>
          <p className="eyebrow">Tab workspace</p>
          <input
            className="tab-title"
            value={title}
            onInput={(event) => setTitle(event.currentTarget.value)}
            maxLength={120}
          />
        </div>
        <div className="tab-actions">
          <span className="expiration-select">
            <select
              value={expiry}
              onChange={(event) => setExpiry(event.currentTarget.value)}
              aria-label="Expiration"
            >
              <option value="never">No expiration</option>
              <option value="1">1 hour</option>
              <option value="24">1 day</option>
              <option value="168">7 days</option>
              <option value="720">30 days</option>
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </span>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void saveTab()}
          >
            <Save size={16} /> Save
          </button>
          <button
            className="icon-button danger-icon"
            type="button"
            title="Delete tab"
            onClick={() => {
              if (confirm('Delete this tab and all of its content?')) void onDeleted()
            }}
          >
            <Trash2 size={17} />
          </button>
        </div>
      </header>

      <ErrorLine error={error} />

      <div className="content-section-heading">
        <div>
          <h2>Text snippets</h2>
          <span>{detail.snippets.length} created</span>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => void addSnippet()}
        >
          <Plus size={16} /> Add snippet
        </button>
      </div>

      <div className="snippet-list">
        {detail.snippets.length ? (
          detail.snippets.map((snippet) => (
            <SnippetEditor
              key={snippet.id}
              snippet={snippet}
              onSaved={() => void onChanged()}
              onDelete={() => {
                if (confirm('Delete this snippet?')) {
                  void api.deleteSnippet(snippet.id).then(onChanged)
                }
              }}
            />
          ))
        ) : (
          <button
            className="empty-action"
            type="button"
            onClick={() => void addSnippet()}
          >
            <FilePlus2 size={24} />
            <strong>Add your first snippet</strong>
            <span>Your text stays private to your account.</span>
          </button>
        )}
      </div>

      <div className="content-section-heading files-heading">
        <div>
          <h2>Files</h2>
          <span>{detail.files.length} uploaded</span>
        </div>
        <>
          <input
            ref={fileInput}
            hidden
            type="file"
            multiple
            onChange={(event) => void upload(event.currentTarget.files)}
          />
          <button
            className="secondary-button"
            type="button"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={16} /> {uploading ? 'Uploading...' : 'Upload files'}
          </button>
        </>
      </div>

      <div className="file-list">
        {detail.files.map((file) => (
          <StoredFileRow
            key={file.id}
            file={file}
            onDelete={() => void api.deleteFile(file.id).then(onChanged)}
          />
        ))}
        {!detail.files.length && <p className="empty-copy">No files in this tab.</p>}
      </div>
    </section>
  )
}