import { Download, File, LoaderCircle, Trash2 } from 'lucide-preact'
import { useState } from 'preact/hooks'
import { api, type StoredFile } from '../api'

interface StoredFileRowProps {
  file: StoredFile
  deleting: boolean
  onDelete: () => void
  onError: (error: string) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function StoredFileRow({ file, deleting, onDelete, onError }: StoredFileRowProps) {
  const [downloading, setDownloading] = useState(false)

  const download = async () => {
    setDownloading(true)
    onError('')
    try {
      const blob = await api.downloadFile(file.downloadPath)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      link.click()
      URL.revokeObjectURL(url)
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

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
      <button
        className="icon-button"
        type="button"
        title={downloading ? 'Downloading file' : 'Download file'}
        disabled={downloading}
        onClick={() => void download()}
      >
        {downloading ? <LoaderCircle className="loading-spinner" size={17} /> : <Download size={17} />}
      </button>
      <button
        className="icon-button danger-icon"
        type="button"
        title={deleting ? 'Deleting file' : 'Delete file'}
        disabled={deleting}
        onClick={onDelete}
      >
        {deleting ? <LoaderCircle className="loading-spinner" size={17} /> : <Trash2 size={17} />}
      </button>
    </div>
  )
}