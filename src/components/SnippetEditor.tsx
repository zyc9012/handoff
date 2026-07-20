import { Check, LoaderCircle, Save, Trash2 } from 'lucide-preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { api, type Snippet } from '../api'

interface SnippetEditorProps {
  snippet: Snippet
  deleting: boolean
  onSaved: () => Promise<void>
  onDelete: () => void
  onError: (error: string) => void
}

interface SnippetDraft {
  title: string
  content: string
  revision: number
}

export function SnippetEditor({ snippet, deleting, onSaved, onDelete, onError }: SnippetEditorProps) {
  const [title, setTitle] = useState(snippet.title)
  const [content, setContent] = useState(snippet.content)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const revision = useRef(0)
  const saving = useRef(false)
  const pendingDraft = useRef<SnippetDraft | null>(null)
  const latestDraft = useRef<SnippetDraft>({
    title: snippet.title,
    content: snippet.content,
    revision: 0,
  })
  const savedTimeout = useRef<number | null>(null)

  const persistPendingDrafts = async () => {
    if (saving.current) return

    saving.current = true
    setBusy(true)
    try {
      while (pendingDraft.current) {
        const draft = pendingDraft.current
        pendingDraft.current = null
        onError('')
        await api.updateSnippet(snippet.id, {
          title: draft.title,
          content: draft.content,
          language: snippet.language,
        })

        if (revision.current === draft.revision && !pendingDraft.current) {
          setDirty(false)
          setSaved(true)
          await onSaved()
          if (savedTimeout.current !== null) window.clearTimeout(savedTimeout.current)
          savedTimeout.current = window.setTimeout(() => setSaved(false), 1200)
        }
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Could not save snippet')
      pendingDraft.current = null
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  const queueSave = () => {
    pendingDraft.current = latestDraft.current
    void persistPendingDrafts()
  }

  useEffect(() => {
    if (!dirty) return
    const timeout = window.setTimeout(queueSave, 600)
    return () => window.clearTimeout(timeout)
  }, [title, content, dirty])

  useEffect(() => () => {
    if (savedTimeout.current !== null) window.clearTimeout(savedTimeout.current)
  }, [])

  const changeTitle = (value: string) => {
    revision.current += 1
    setDirty(true)
    setSaved(false)
    setTitle(value)
    latestDraft.current = { ...latestDraft.current, title: value, revision: revision.current }
  }

  const changeContent = (value: string) => {
    revision.current += 1
    setDirty(true)
    setSaved(false)
    setContent(value)
    latestDraft.current = { ...latestDraft.current, content: value, revision: revision.current }
  }

  return (
    <article className="snippet-editor">
      <div className="snippet-toolbar">
        <input
          value={title}
          onInput={(event) => changeTitle(event.currentTarget.value)}
          onBlur={queueSave}
          aria-label="Snippet title"
        />
        <button
          className="icon-button"
          type="button"
          title="Save snippet"
          disabled={busy}
          onClick={queueSave}
        >
          {busy ? <LoaderCircle className="loading-spinner" size={17} /> : saved ? <Check size={17} /> : <Save size={17} />}
        </button>
        <button
          className="icon-button danger-icon"
          type="button"
          title={deleting ? 'Deleting snippet' : 'Delete snippet'}
          disabled={deleting}
          onClick={onDelete}
        >
          {deleting ? <LoaderCircle className="loading-spinner" size={17} /> : <Trash2 size={17} />}
        </button>
      </div>
      <textarea
        value={content}
        onInput={(event) => changeContent(event.currentTarget.value)}
        onBlur={queueSave}
        placeholder="Paste text or code..."
        aria-label={`${title} content`}
      />
      <div className="snippet-meta">
        <span>{new TextEncoder().encode(content).byteLength.toLocaleString()} bytes</span>
        <span>{content.split('\n').length} lines</span>
      </div>
    </article>
  )
}