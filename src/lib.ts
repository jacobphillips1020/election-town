/** Only allow in-app paths as post-login destinations. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

const PENDING = 'et-pending-next'
export function rememberDestination(path: string) {
  try {
    localStorage.setItem(PENDING, path)
  } catch {
    /* private mode: fall back to home */
  }
}
export function takeDestination(): string {
  try {
    const v = localStorage.getItem(PENDING)
    localStorage.removeItem(PENDING)
    return safeNext(v)
  } catch {
    return '/'
  }
}
