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

/** "(312) 555-0123" -> "+13125550123" (US default); null if it isn't a phone number. */
export function normalizePhone(input: string): string | null {
  const d = input.replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length >= 11 && d.length <= 15) return `+${d}`
  return null
}

/**
 * Accounts are keyed by phone number. Supabase Auth needs an email-shaped login, so we derive one that is
 * never emailed ("Confirm email" is off). Older accounts created with a real email still sign in with it.
 */
export function loginIdFor(input: string): string | null {
  const v = input.trim()
  if (v.includes('@')) return v
  const p = normalizePhone(v)
  return p ? `p${p.slice(1)}@election-town.vercel.app` : null
}
