interface ErrorLineProps {
  error: string
}

export function ErrorLine({ error }: ErrorLineProps) {
  return error ? <p className="error-message">{error}</p> : null
}