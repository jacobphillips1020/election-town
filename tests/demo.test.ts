import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { AUTH_STUB, MIGRATIONS } from '../src/data/migrations'
import { rpc } from '../src/data/pgliteRpc'

const P = (n: number) => `d0000000-0000-4000-8000-00000000000${n}`

test('demo seed loads: pool open with sealed ballots; side bets open, closed, settled', async () => {
  const db = new PGlite()
  await db.exec(AUTH_STUB)
  for (const m of MIGRATIONS) await db.exec(m)
  await db.exec(readFileSync('src/demo/polling.sql', 'utf8'))
  await db.exec(readFileSync('src/demo/seed.sql', 'utf8'))

  type Pool = { ballots: number; pot_cents: number; closed: boolean; my_ballot: Record<string, unknown> | null; ballots_grid: unknown; forecasts: { senate?: { r_median: number } }; senate: { polling: unknown }[] }
  const asAlex = await rpc<Pool>(db, P(5), 'get_pool')
  expect([asAlex.ballots, asAlex.pot_cents, asAlex.closed, asAlex.my_ballot, asAlex.ballots_grid]).toEqual([3, 12500, false, null, null]) // two $50 ballots and Priya's $25
  expect(asAlex.forecasts.senate?.r_median).toBeCloseTo(48.4, 1)
  expect(asAlex.senate.filter((s) => s.polling).length).toBe(27)
  expect(Object.keys((await rpc<Pool>(db, P(2), 'get_pool')).my_ballot!)).toHaveLength(12)

  type M = { id: string; title: string; phase: string; entrants: number; featured: boolean }
  const side = (await rpc<M[]>(db, P(2), 'list_markets')).filter((m) => !m.featured && m.phase !== 'canceled')
  const byTitle = (t: string) => side.find((m) => m.title.includes(t))!
  expect(byTitle('NY-17').phase).toBe('open')
  expect(byTitle('Kansas').phase).toBe('closed')
  expect(byTitle('Minnesota').phase).toBe('settled')

  // Closed: everyone in the group sees all four picks; the non-member sees none.
  expect((await rpc<{ entries: unknown[] }>(db, P(4), 'get_market', { p_id: byTitle('Kansas').id })).entries).toHaveLength(4)
  expect((await rpc<{ entries: unknown }>(db, P(6), 'get_market', { p_id: byTitle('Kansas').id })).entries).toBeNull()
  // Settled: 52.7% certified; Dev's 52.0 is the closest right-winner pick (Maya 53.5, Alex 54.5) and takes the $20 pot.
  const settled = await rpc<{ payouts: { user_id: string; gross_cents: number }[] }>(db, P(2), 'get_market', { p_id: byTitle('Minnesota').id })
  expect(settled.payouts.find((p) => p.user_id === P(3))!.gross_cents).toBe(2000)
})
