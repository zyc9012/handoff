import { Check, Save, Trash2 } from 'lucide-preact'
import { useState } from 'preact/hooks'
import { api, type Snippet } from '../api'

interface SnippetEditorProps {
  snippet: Snippet
  onSaved: () => void
  onDelete: () => void
}

export function SnippetEditor({ snippet, onSaved, onDelete }: SnippetEditorProps) {
  const [title, setTitle] = useState(snippet.title)
  const [content, setContent] = useState(snippet.content)
  const [language, setLanguage] = useState(snippet.language)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await api.updateSnippet(snippet.id, { title, content, language })
      setSaved(true)
      onSaved()
      window.setTimeout(() => setSaved(false), 1200)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="snippet-editor">
      <div className="snippet-toolbar">
        <input
          value={title}
          onInput={(event) => setTitle(event.currentTarget.value)}
          aria-label="Snippet title"
        />
        <input
          className="language-input"
          value={language}
          onInput={(event) => setLanguage(event.currentTarget.value)}
          aria-label="Language"
        />
        <button
          className="icon-button"
          type="button"
          title="Save snippet"
          disabled={busy}
          onClick={() => void save()}
        >
          {saved ? <Check size={17} /> : <Save size={17} />}
        </button>
        <button
          className="icon-button danger-icon"
          type="button"
          title="Delete snippet"
          onClick={onDelete}
        >
          <Trash2 size={17} />
        </button>
      </div>
      <textarea
        value={content}
        onInput={(event) => setContent(event.currentTarget.value)}
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