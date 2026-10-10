import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { AUTH_STUB, MIGRATIONS } from '../src/data/migrations'
import { rpc } from '../src/data/pgliteRpc'

const P = (n: number) => `d0000000-0000-4000-8000-00000000000${n}`

test('demo seed loads and keeps sealed picks sealed', async () => {
  const db = new PGlite()
  await db.exec(AUTH_STUB)
  for (const m of MIGRATIONS) await db.exec(m)
  await db.exec(readFileSync('src/demo/seed.sql', 'utf8'))

  type M = { id: string; title: string; phase: string; entrants: number; has_entry: boolean }
  const asMaya = await rpc<M[]>(db, P(2), 'list_markets')
  const byTitle = (t: string) => asMaya.find((m) => m.title.includes(t))!
  expect(byTitle('Fictional State').phase).toBe('open')
  expect(byTitle('Example State').phase).toBe('closed')
  expect(byTitle('Sample District').phase).toBe('settled')
  expect(byTitle('Placeholder').phase).toBe('proposed')

  // Open market: Priya (no entry) sees counts only.
  const open = byTitle('Fictional State')
  const asPriya = await rpc<{ entries: unknown; my_entry: unknown; market: { entrants: number } }>(db, P(4), 'get_market', { p_id: open.id })
  expect(asPriya.entries).toBeNull()
  expect(asPriya.my_entry).toBeNull()
  expect(asPriya.market.entrants).toBe(2)

  // Closed market: everyone in the group sees all four picks; the non-member sees nothing.
  const closed = byTitle('Example State')
  const shown = await rpc<{ entries: unknown[] }>(db, P(4), 'get_market', { p_id: closed.id })
  expect(shown.entries).toHaveLength(4)
  expect((await rpc<{ entries: unknown }>(db, P(6), 'get_market', { p_id: closed.id })).entries).toBeNull()

  // Settled market has a payout for each entrant; Dev (closest right winner) takes the $40 pool.
  const settled = await rpc<{ payouts: { user_id: string; gross_cents: number }[] }>(db, P(2), 'get_market', { p_id: byTitle('Sample District').id })
  expect(settled.payouts.find((p) => p.user_id === P(3))!.gross_cents).toBe(4000)
})
