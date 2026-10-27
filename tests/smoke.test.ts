import { PGlite } from '@electric-sql/pglite'
import { expect, test } from 'vitest'
import { AUTH_STUB, MIGRATIONS } from '../src/data/migrations'
import { rpc, select } from '../src/data/pgliteRpc'

test('migrations load; markets are public, picks and people are not', async () => {
  const db = new PGlite()
  await db.exec(AUTH_STUB)
  for (const m of MIGRATIONS) await db.exec(m)
  await db.exec('update public.group_settings set open_signup = false')
  const u = '00000000-0000-0000-0000-000000000001'
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'a@example.test', '{"display_name":"Ann"}')`, [u])
  // signed-in non-member: can browse markets, sees no entries or people
  // 12 main-pool picks plus the retired Control of Congress market
  expect(await select(db, u, 'select * from public.markets')).toHaveLength(13)
  expect(await select(db, u, 'select * from public.entries')).toHaveLength(0)
  expect(await select(db, u, 'select * from public.members')).toHaveLength(0)
  expect((await rpc<unknown[]>(db, u, 'list_markets')).length).toBe(13)
  // visitor: can browse, no table access to private data
  expect((await rpc<unknown[]>(db, null, 'list_markets')).length).toBe(13)
  expect((await rpc<{ markets: unknown[] }>(db, null, 'get_pool')).markets).toHaveLength(12)
  await expect(select(db, null, 'select * from public.entries')).rejects.toThrow(/permission denied/i)
})

// Supabase runs API requests with pg-safeupdate: an UPDATE or DELETE without a WHERE clause is rejected, even inside a
// function ("UPDATE requires a WHERE clause"). PGlite doesn't have that extension, so check every function's body here.
test('no function updates or deletes without a WHERE clause (Supabase pg-safeupdate)', async () => {
  const db = new PGlite()
  await db.exec(AUTH_STUB)
  for (const m of MIGRATIONS) await db.exec(m)
  const fns = (await db.query<{ name: string; src: string }>(
    `select n.nspname || '.' || p.proname as name, p.prosrc as src
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app')`)).rows
  const offenders: string[] = []
  for (const f of fns) {
    const body = f.src.replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''")
    for (const stmt of body.split(';')) {
      const s = stmt.trim().replace(/\s+/g, ' ')
      const m = s.match(/\b(update\s+\S+\s+(?:\w+\s+)?set\b|delete\s+from\b)[\s\S]*$/i)
      if (m && !/\bwhere\b/i.test(m[0])) offenders.push(`${f.name}: ${m[0].slice(0, 80)}`)
    }
  }
  expect(offenders).toEqual([])
  expect(fns.length).toBeGreaterThan(40)
})
