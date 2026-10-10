import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Me } from '../domain/types'
import { createBackend, type Backend } from './backend'

type Ctx = { backend: Backend; uid: string | null; me: Me | null; meLoading: boolean; refreshMe: () => void }
const AppCtx = createContext<Ctx | null>(null)

export function useApp(): Ctx {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp outside provider')
  return c
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [backend, setBackend] = useState<Backend | null>(null)
  const [uid, setUid] = useState<string | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [meLoading, setMeLoading] = useState(true)
  const [fatal, setFatal] = useState<string | null>(null)

  useEffect(() => {
    let off = () => {}
    createBackend()
      .then(async (b) => {
        await b.ready
        setBackend(b)
        setUid(b.userId())
        off = b.subscribe(() => {
          setMe(null) // never show one person's data to the next
          setUid(b.userId())
        })
      })
      .catch((e) => setFatal(String(e?.message ?? e)))
    return () => off()
  }, [])

  const [tick, setTick] = useState(0)
  const refreshMe = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!backend) return
    if (!uid) {
      setMe(null)
      setMeLoading(false)
      return
    }
    let live = true
    setMeLoading(true)
    backend
      .rpc<Me>('get_me')
      .then((m) => live && setMe(m))
      .catch(() => live && setMe(null))
      .finally(() => live && setMeLoading(false))
    return () => {
      live = false
    }
  }, [backend, uid, tick])

  if (fatal) return <p className="page">Could not start: {fatal}</p>
  if (!backend) return <p className="page muted">Loading…</p>
  return <AppCtx.Provider value={{ backend, uid, me, meLoading, refreshMe }}>{children}</AppCtx.Provider>
}

/** Fetch an RPC; reloads when the signed-in user changes. Nothing is cached across users. */
export function useRpc<T>(fn: string | null, args: Record<string, unknown> = {}) {
  const { backend, uid } = useApp()
  const [state, set] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  const [tick, setTick] = useState(0)
  const key = JSON.stringify([fn, args, uid])
  useEffect(() => {
    if (!fn) return
    let live = true
    set((s) => ({ ...s, loading: true }))
    backend
      .rpc<T>(fn, args)
      .then((d) => live && set({ data: d, error: null, loading: false }))
      .catch((e) => live && set({ data: null, error: String(e?.message ?? e), loading: false }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, backend])
  return { ...state, reload: () => setTick((t) => t + 1) }
}

export function useAdminName(): string {
  const { me } = useApp()
  return me?.group?.admin_name ?? 'the organizer'
}

/** For actions that need an account: sends visitors to sign-up and back to where they were. */
export function useAccount() {
  const { uid, me } = useApp()
  return {
    signedIn: !!uid,
    isMember: !!me?.is_member,
    signupPath: (next: string) => `/auth?mode=signup&next=${encodeURIComponent(next)}`,
  }
}
