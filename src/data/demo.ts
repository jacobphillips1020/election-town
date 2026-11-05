// Demo backend: the REAL migrations running in an in-browser Postgres, seeded with fictional fixtures.
// Not a multiuser service. Data lives only in this browser. "Sign-in" is a persona picker.
import type { Backend, Persona } from './backend'
import { AUTH_STUB, MIGRATIONS } from './migrations'
import { rpc as pgRpc } from './pgliteRpc'
import pollingSql from '../demo/polling.sql?raw'
import seedSql from '../demo/seed.sql?raw'

// Dev only: open with ?demo=closed to see the pool after it closes (picks revealed); ?demo=open to go back.
const SCENARIO_KEY = 'et-demo-scenario'
function scenario(): 'open' | 'closed' {
  try {
    const q = new URLSearchParams(window.location.search).get('demo')
    if (import.meta.env.DEV && (q === 'open' || q === 'closed')) localStorage.setItem(SCENARIO_KEY, q)
    return import.meta.env.DEV && localStorage.getItem(SCENARIO_KEY) === 'closed' ? 'closed' : 'open'
  } catch {
    return 'open'
  }
}
const SCENARIO = scenario()
const DB_NAME = `idb://election-town-demo-v24${SCENARIO === 'closed' ? '-closed' : ''}`
const ACTOR_KEY = 'et-demo-actor'

export const PERSONAS: Persona[] = [
  { id: 'd0000000-0000-4000-8000-000000000001', name: 'Demo Admin', note: 'Group admin' },
  { id: 'd0000000-0000-4000-8000-000000000002', name: 'Maya', note: 'Member' },
  { id: 'd0000000-0000-4000-8000-000000000003', name: 'Dev', note: 'Member' },
  { id: 'd0000000-0000-4000-8000-000000000004', name: 'Priya', note: 'Member' },
  { id: 'd0000000-0000-4000-8000-000000000005', name: 'Alex', note: 'Member' },
  { id: 'd0000000-0000-4000-8000-000000000006', name: 'Sam', note: 'Signed in, not in the group' },
]

/** The demo's Results page: this election's real public vote counts against the demo's fictional ballots. */
async function seedLive(db: import('@electric-sql/pglite').PGlite) {
  const [{ project }, { shortName }, { RACES }, counts] = await Promise.all([
    import('../live/model'), import('../live/names'), import('../live/config'), import('../demo/live-counts.json'),
  ])
  type M = { id: string; title: string; kind: string; sort_order: number; featured: boolean; candidates: { id: string; name: string; party: string }[] }
  const fixed = counts.default as unknown as { counts: Record<string, import('../live/feed').Count>; mississippi: import('../live/feed').Count; senateSeats: import('../live/feed').SeatCount[]; houseSeats: import('../live/feed').SeatCount[] }
  const entries = (await db.query<{ id: string; user_id: string; display_name: string; market_id: string; commitment_cents: number; winner_id: string | null; shares: Record<string, number> | null; seats: { r?: number } | null }>(
    `select e.id, e.user_id, p.display_name, e.market_id, e.commitment_cents, e.winner_id, e.shares, e.seats from public.entries e join public.profiles p on p.user_id = e.user_id`)).rows
  const markets = (await db.query<M>(`select id, title, kind, sort_order, featured, candidates from public.markets where status = 'open'`)).rows
    .filter((m) => entries.some((e) => e.market_id === m.id) && (RACES[m.title] || m.kind.endsWith('_seats')))
  const fetchedAt = new Date().toISOString()
  const { pub, members } = project({
    markets, fetchedAt,
    entries: entries.filter((e) => markets.some((m) => m.id === e.market_id)).map((e) => ({ id: e.id, user: e.user_id, name: shortName(e.display_name), market: e.market_id, cents: e.commitment_cents, winner: e.winner_id, shares: e.shares, r: e.seats?.r ?? null })),
    counts: Object.fromEntries(markets.filter((m) => RACES[m.title]).map((m) => [m.id, fixed.counts[m.title]])),
    mississippi: fixed.mississippi, senateSeats: fixed.senateSeats, houseSeats: fixed.houseSeats,
  }, 10000)
  await db.query(`insert into public.live_snapshots (fetched_at, public, members) values ($1, $2, $3)`, [fetchedAt, JSON.stringify(pub), JSON.stringify(members)])
}

async function open() {
  const { PGlite } = await import('@electric-sql/pglite')
  const db = new PGlite(DB_NAME)
  await db.waitReady
  const has = await db.query<{ ok: boolean }>(`select to_regclass('public.markets') is not null as ok`)
  if (!has.rows[0].ok) {
    await db.exec(AUTH_STUB)
    for (const m of MIGRATIONS) await db.exec(m)
    await db.exec(pollingSql)
    // The migrations carry the real closing date, now past. The demo's fictional ballots are submitted against a future one.
    const closes = new Date(Date.now() + 30 * 24 * 3600e3).toISOString()
    const electionDay = new Date(Date.now() + (30 * 24 + 4) * 3600e3).toISOString()
    await db.exec(`set session_replication_role = replica;
      update public.markets set entry_deadline = '${closes}' where entry_deadline is not null;
      update public.group_settings set default_deadline = '${closes}' where id;
      set session_replication_role = origin;
      create or replace function app.election_day_start() returns timestamptz language sql immutable as $$ select timestamptz '${electionDay}' $$;`)
    await db.exec(seedSql)
    if (SCENARIO === 'closed') await db.exec(`update public.markets set entry_deadline = now() - interval '1 hour' where featured`)
    await seedLive(db)
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
      indexedDB.deleteDatabase(`/pglite/${DB_NAME.slice('idb://'.length)}`)
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
