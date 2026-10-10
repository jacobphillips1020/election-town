// Calls the SQL RPC functions on an in-process Postgres (PGlite), acting as a given user.
// Same function names and argument names as the Supabase RPC calls in the app.
import type { PGlite } from '@electric-sql/pglite'

export async function withActor<T>(db: PGlite, actor: string | null, f: () => Promise<T>): Promise<T> {
  await db.exec(actor ? 'set role authenticated' : 'set role anon')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [actor ?? ''])
  try {
    return await f()
  } finally {
    await db.exec('reset role')
  }
}

export async function rpc<T = unknown>(
  db: PGlite,
  actor: string | null,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const keys = Object.keys(args)
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`
  const params = keys.map((k) => {
    const v = args[k]
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
  })
  return withActor(db, actor, async () => (await db.query<{ r: T }>(sql, params)).rows[0].r)
}

export async function select<T = Record<string, unknown>>(
  db: PGlite,
  actor: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return withActor(db, actor, async () => (await db.query<T>(sql, params)).rows)
}
