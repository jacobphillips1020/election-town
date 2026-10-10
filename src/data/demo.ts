// Demo backend: the REAL migrations running in an in-browser Postgres, seeded with fictional fixtures.
// Not a multiuser service. Data lives only in this browser. "Sign-in" is a persona picker.
import type { Backend, Persona } from './backend'
import { AUTH_STUB, MIGRATIONS } from './migrations'
import { rpc as pgRpc } from './pgliteRpc'
import seedSql from '../demo/seed.sql?raw'

const DB_NAME = 'idb://election-town-demo-v2'
const ACTOR_KEY = 'et-demo-actor'

export const PERSONAS: Persona[] = [
  { id: 'd0000000-0000-4000-8000-000000000001', name: 'Demo Admin', note: 'Group admin' },
  { id: 'd0000000-0000-4000-8000-000000000002', name: 'Maya', note: 'Member' },
  { id: 'd0000000-0000-4000-8000-000000000003', name: 'Dev', note: 'Member' },
  { id: 'd0000000-0000-4000-8000-000000000004', name: 'Priya', note: 'Member' },
  { id: 'd0000000-0000-4000-8000-000000000005', name: 'Alex', note: 'Member' },
  { id: 'd0000000-0000-4000-8000-000000000006', name: 'Sam', note: 'Signed in, not in the group' },
]

async function open() {
  const { PGlite } = await import('@electric-sql/pglite')
  const db = new PGlite(DB_NAME)
  await db.waitReady
  const has = await db.query<{ ok: boolean }>(`select to_regclass('public.markets') is not null as ok`)
  if (!has.rows[0].ok) {
    await db.exec(AUTH_STUB)
    for (const m of MIGRATIONS) await db.exec(m)
    await db.exec(seedSql)
  }
  return db
}

export async function createDemoBackend(): Promise<Backend> {
  const db = await open()
  const listeners = new Set<() => void>()
  let actor: string | null = null
  try {
    actor = localStorage.getItem(ACTOR_KEY)
  } catch {
    /* storage unavailable: start signed out */
  }
  // One query at a time: the in-process database has a single connection and a per-call role.
  let chain: Promise<unknown> = Promise.resolve()
  const demoOnly = () => {
    throw new Error('Demo mode: use the persona picker. Accounts need the live Supabase setup.')
  }

  const actAs = (id: string | null) => {
    actor = id
    try {
      if (id) localStorage.setItem(ACTOR_KEY, id)
      else localStorage.removeItem(ACTOR_KEY)
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l())
  }

  return {
    mode: 'demo',
    ready: Promise.resolve(),
    personas: PERSONAS,
    rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      const run = chain.then(() => pgRpc<T>(db, actor, fn, args))
      chain = run.catch(() => undefined)
      return run
    },
    userId: () => actor,
    subscribe(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    actAs,
    async resetDemo() {
      await db.close()
      indexedDB.deleteDatabase('/pglite/election-town-demo-v2')
      window.location.reload()
    },
    signIn: async () => demoOnly(),
    signUp: async () => demoOnly(),
    accessToken: async () => null,
    async signOut() {
      actAs(null)
    },
  }
}
