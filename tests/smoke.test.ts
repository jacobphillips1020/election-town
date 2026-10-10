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
  expect(await select(db, u, 'select * from public.markets')).toHaveLength(1)
  expect(await select(db, u, 'select * from public.entries')).toHaveLength(0)
  expect(await select(db, u, 'select * from public.members')).toHaveLength(0)
  expect((await rpc<unknown[]>(db, u, 'list_markets')).length).toBe(1)
  // visitor: can browse, no table access to private data
  expect((await rpc<unknown[]>(db, null, 'list_markets')).length).toBe(1)
  await expect(select(db, null, 'select * from public.entries')).rejects.toThrow(/permission denied/i)
})
