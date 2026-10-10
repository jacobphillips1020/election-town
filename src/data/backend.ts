export type Persona = { id: string; name: string; note: string }

/** Everything the UI needs from "the server". Two implementations: live (Supabase) and demo (in-browser Postgres). */
export interface Backend {
  mode: 'live' | 'demo'
  ready: Promise<void>
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>
  userId(): string | null
  subscribe(cb: () => void): () => void
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string, displayName: string, next: string): Promise<{ needsVerification: boolean }>
  signOut(): Promise<void>
  sendReset(email: string): Promise<void>
  setPassword(password: string): Promise<void>
  // Demo only
  personas?: Persona[]
  actAs?(id: string | null): void
  resetDemo?(): Promise<void>
}

export async function createBackend(): Promise<Backend> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (url && key) {
    const { createLiveBackend } = await import('./live')
    return createLiveBackend(url, key)
  }
  const { createDemoBackend } = await import('./demo')
  return createDemoBackend()
}
