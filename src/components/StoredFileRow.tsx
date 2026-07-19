import { Download, File, Trash2 } from 'lucide-preact'
import type { StoredFile } from '../api'

interface StoredFileRowProps {
  file: StoredFile
  onDelete: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function StoredFileRow({ file, onDelete }: StoredFileRowProps) {
  return (
    <div className="stored-file">
      <span className="file-mark">
        <File size={19} />
      </span>
      <div>
        <strong>{file.name}</strong>
        <small>
          {formatBytes(file.size)} / {file.contentType}
        </small>
      </div>
      <a className="icon-button" href={file.downloadPath} title="Download">
        <Download size={17} />
      </a>
      <button
        className="icon-button danger-icon"
        type="button"
        title="Delete file"
        onClick={onDelete}
      >
        <Trash2 size={17} />
      </button>
    </div>
  )
}