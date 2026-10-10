import { PGlite } from '@electric-sql/pglite'
import { expect, test } from 'vitest'
import { AUTH_STUB, MIGRATIONS } from '../src/data/migrations'
import { rpc, select } from '../src/data/pgliteRpc'

test('migrations load and RLS is enforced', async () => {
  const db = new PGlite()
  await db.exec(AUTH_STUB)
  for (const m of MIGRATIONS) await db.exec(m)
  const u = '00000000-0000-0000-0000-000000000001'
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'a@example.test', '{"display_name":"Ann"}')`, [u])
  // authenticated non-member: no markets, RPC refused
  expect(await select(db, u, 'select * from public.markets')).toHaveLength(0)
  await expect(rpc(db, u, 'list_markets')).rejects.toThrow(/members only/i)
  // anonymous: no table privileges
  await expect(select(db, null, 'select * from public.markets')).rejects.toThrow(/permission denied/i)
  // superuser sees the seeded congress market
  expect((await db.query('select count(*)::int c from public.markets')).rows[0]).toEqual({ c: 1 })
})
