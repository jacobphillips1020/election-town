import { createClient } from '@supabase/supabase-js'
import type { Backend } from './backend'

export function createLiveBackend(url: string, anonKey: string): Backend {
  const sb = createClient(url, anonKey, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } })
  let uid: string | null = null
  const listeners = new Set<() => void>()

  const ready = sb.auth.getSession().then(({ data }) => {
    uid = data.session?.user.id ?? null
  })
  sb.auth.onAuthStateChange((_event, session) => {
    const next = session?.user.id ?? null
    if (next !== uid) {
      uid = next
      listeners.forEach((l) => l())
    }
  })

  const fail = (error: { message: string } | null) => {
    if (error) throw new Error(error.message)
  }

  return {
    mode: 'live',
    ready,
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      const { data, error } = await sb.rpc(fn, args)
      fail(error)
      return data as T
    },
    userId: () => uid,
    subscribe(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password })
      fail(error)
    },
    async signUp(email, password, displayName, phone) {
      // "Confirm email" is turned OFF in Supabase, so no email is ever sent; the phone number is the contact.
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName, phone } },
      })
      fail(error)
      return { needsVerification: !data.session }
    },
    async signOut() {
      await sb.auth.signOut()
    },
    async accessToken() {
      return (await sb.auth.getSession()).data.session?.access_token ?? null
    },
  }
}
