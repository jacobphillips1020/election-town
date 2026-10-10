// Database-level tests: authorization, sealed picks, time boundary, scoring, settlement, ledger.
// Runs the real migrations on an in-process Postgres (PGlite) as different users.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test } from 'vitest'
import { AUTH_STUB, MIGRATIONS } from '../src/data/migrations'
import { rpc, select } from '../src/data/pgliteRpc'

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const U = { jake: id(1), maya: id(2), dev: id(3), priya: id(4), alex: id(5), sam: id(6) }
const NAMES: Record<string, string> = { jake: 'Jake', maya: 'Maya', dev: 'Dev', priya: 'Priya', alex: 'Alex', sam: 'Sam' }
const bootstrapSql = readFileSync('supabase/seed/bootstrap_admin.sql', 'utf8')

let db: PGlite

beforeEach(async () => {
  db = new PGlite()
  await db.exec(AUTH_STUB)
  for (const m of MIGRATIONS) await db.exec(m)
  for (const [k, uid] of Object.entries(U)) {
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
      uid, `${k}@example.test`, JSON.stringify({ display_name: NAMES[k] }),
    ])
  }
  // Trusted bootstrap, exactly as the owner would run it.
  await db.exec(bootstrapSql.replace('REPLACE_WITH_YOUR_EMAIL', 'jake@example.test'))
  const token = await rpc<string>(db, U.jake, 'create_invite')
  for (const m of [U.maya, U.dev, U.priya, U.alex]) await rpc(db, m, 'redeem_invite', { p_token: token })
})

const CANDS = [{ name: 'Garcia', party: 'D' }, { name: 'Whitfield', party: 'R' }]
const inOneHour = () => new Date(Date.now() + 3600e3).toISOString()

async function openRace(o: { kind?: string; buyIn?: number; deadline?: string; hasOther?: boolean; proposer?: string } = {}) {
  const mid = await rpc<string>(db, o.proposer ?? U.maya, 'propose_market', {
    p_kind: o.kind ?? 'senate', p_title: 'Testland Senate', p_jurisdiction: 'Testland',
    p_candidates: CANDS, p_has_other: o.hasOther ?? true,
  })
  await rpc(db, U.jake, 'approve_market', {
    p_id: mid, p_candidates: CANDS, p_has_other: o.hasOther ?? true, p_basis: 'single_round',
    p_rules_note: 'Certified state canvass.', p_buy_in_cents: o.buyIn ?? 1000,
    p_deadline: o.deadline ?? inOneHour(),
  })
  return mid
}
const pick = (who: string, mid: string, winner: string, c1: number, c2: number, other = 0) =>
  rpc(db, who, 'submit_entry', { p_market: mid, p_winner: winner, p_shares: { c1, c2, other } })
const backdate = (mid: string) =>
  db.exec(`set session_replication_role = replica;
           update public.markets set entry_deadline = clock_timestamp() - interval '1 minute' where id = '${mid}';
           set session_replication_role = origin;`)
const result = (mid: string, winner: string, tenths: number) =>
  rpc(db, U.jake, 'enter_result', { p_market: mid, p_winner: winner, p_share_tenths: tenths, p_seats: null, p_source_url: 'https://example.test/canvass' })
async function settleRace(mid: string, winner: string, tenths: number) {
  await backdate(mid)
  await result(mid, winner, tenths)
  return rpc<{ run_id: string; already_settled: boolean }>(db, U.jake, 'confirm_settlement', { p_market: mid })
}
type Payout = { user_id: string; gross_cents: number; refund_cents: number; eligible: boolean; error_value: number | null }
const payoutsFor = async (mid: string) =>
  (await rpc<{ payouts: Payout[] }>(db, U.jake, 'get_market', { p_id: mid })).payouts

describe('authorization', () => {
  test('anonymous users have no table or function access', async () => {
    await expect(select(db, null, 'select * from public.markets')).rejects.toThrow(/permission denied/i)
    await expect(select(db, null, 'select * from public.entries')).rejects.toThrow(/permission denied/i)
    await expect(rpc(db, null, 'list_markets')).rejects.toThrow(/permission denied/i)
  })

  test('a signed-in non-member reads nothing and cannot call group functions', async () => {
    const mid = await openRace()
    await pick(U.maya, mid, 'c1', 520, 480)
    await backdate(mid)
    for (const t of ['markets', 'entries', 'members', 'settlement_runs', 'payouts', 'polling_snapshots', 'money_transfers', 'group_settings']) {
      expect(await select(db, U.sam, `select * from public.${t}`), t).toHaveLength(0)
    }
    await expect(rpc(db, U.sam, 'list_markets')).rejects.toThrow(/members only/i)
    await expect(rpc(db, U.sam, 'get_market', { p_id: mid })).rejects.toThrow(/members only/i)
    await expect(rpc(db, U.sam, 'submit_entry', { p_market: mid, p_winner: 'c1', p_shares: { c1: 520, c2: 480, other: 0 } })).rejects.toThrow()
    await expect(select(db, U.sam, `select * from app.market_stats('${mid}')`)).rejects.toThrow(/members only/i)
    const me = await rpc<{ is_member: boolean; group: unknown }>(db, U.sam, 'get_me')
    expect(me.is_member).toBe(false)
    expect(me.group).toBeNull()
  })

  test('a bad invitation does not grant membership; a revoked one is refused', async () => {
    await expect(rpc(db, U.sam, 'redeem_invite', { p_token: 'nope' })).rejects.toThrow(/not valid/i)
    const token = await rpc<string>(db, U.jake, 'create_invite')
    await rpc(db, U.jake, 'revoke_invite', { p_token: token })
    await expect(rpc(db, U.sam, 'redeem_invite', { p_token: token })).rejects.toThrow(/not valid/i)
    const good = await rpc<string>(db, U.jake, 'create_invite')
    await rpc(db, U.sam, 'redeem_invite', { p_token: good })
    expect((await rpc<{ is_member: boolean }>(db, U.sam, 'get_me')).is_member).toBe(true)
  })

  test('members cannot use admin functions; proposing grants nothing', async () => {
    const mid = await openRace({ proposer: U.maya })
    const t = inOneHour()
    await expect(rpc(db, U.maya, 'approve_market', { p_id: mid, p_candidates: CANDS, p_has_other: true, p_basis: 'single_round', p_rules_note: 'x', p_buy_in_cents: 1000, p_deadline: t })).rejects.toThrow(/admin only/i)
    await expect(rpc(db, U.maya, 'set_group_defaults', { p_buy_in_cents: 1000, p_deadline: t })).rejects.toThrow(/admin only/i)
    await expect(rpc(db, U.maya, 'create_invite')).rejects.toThrow(/admin only/i)
    await expect(rpc(db, U.maya, 'cancel_market', { p_id: mid, p_reason: 'x' })).rejects.toThrow(/admin only/i)
    await expect(rpc(db, U.maya, 'confirm_settlement', { p_market: mid })).rejects.toThrow(/admin only/i)
    await expect(rpc(db, U.maya, 'admin_ledger')).rejects.toThrow(/admin only/i)
    await expect(rpc(db, U.maya, 'record_transfer', { p_member: U.dev, p_direction: 'collected', p_amount_cents: 1000, p_occurred_on: '2026-11-04' })).rejects.toThrow(/admin only/i)
  })

  test('no route to become admin or write tables directly', async () => {
    await expect(select(db, U.maya, `insert into public.admins (user_id) values ('${U.maya}')`)).rejects.toThrow(/permission denied/i)
    await expect(select(db, U.maya, `insert into public.members (user_id) values ('${U.sam}')`)).rejects.toThrow(/permission denied/i)
    await expect(select(db, U.maya, `update public.markets set entry_deadline = now()`)).rejects.toThrow(/permission denied/i)
    await expect(select(db, U.maya, `delete from public.entries`)).rejects.toThrow(/permission denied/i)
    await expect(select(db, U.maya, `select * from app.compute_outcome(gen_random_uuid(), null, null, null)`)).rejects.toThrow(/permission denied/i)
    expect((await rpc<{ is_admin: boolean }>(db, U.maya, 'get_me')).is_admin).toBe(false)
  })

  test('members see display names, never email addresses', async () => {
    const rows = await select<Record<string, unknown>>(db, U.maya, 'select * from public.profiles')
    expect(rows.length).toBeGreaterThanOrEqual(5)
    expect(JSON.stringify(rows)).not.toMatch(/example\.test/)
    await expect(select(db, U.maya, 'select * from auth.users')).rejects.toThrow(/permission denied/i)
  })
})

describe('sealed picks', () => {
  test('before close only the owner sees a pick; admin has no exception', async () => {
    const mid = await openRace()
    await pick(U.maya, mid, 'c1', 520, 480)
    await pick(U.dev, mid, 'c2', 300, 700)

    expect(await select(db, U.maya, 'select user_id from public.entries')).toEqual([{ user_id: U.maya }])
    expect(await select(db, U.jake, 'select * from public.entries')).toHaveLength(0)
    expect(await select(db, U.priya, 'select * from public.entries')).toHaveLength(0)

    for (const who of [U.jake, U.priya]) {
      const m = await rpc<Record<string, unknown>>(db, who, 'get_market', { p_id: mid })
      expect(m.entries).toBeNull()
      expect(m.my_entry).toBeNull()
      expect(m.payouts).toEqual([])
      const mk = m.market as { entrants: number; pool_cents: number }
      expect([mk.entrants, mk.pool_cents]).toEqual([2, 2000])
      expect(JSON.stringify(m)).not.toMatch(/Garcia.*520|"shares"/)
    }
    const own = await rpc<{ my_entry: { winner_id: string } }>(db, U.maya, 'get_market', { p_id: mid })
    expect(own.my_entry.winner_id).toBe('c1')
  })

  test('admin ledger does not reveal who has entered before close', async () => {
    const mid = await openRace()
    await pick(U.maya, mid, 'c1', 520, 480)
    await pick(U.dev, mid, 'c2', 400, 600)
    const led = await rpc<{ people: { display_name: string }[]; breakdown: unknown[] }>(db, U.jake, 'admin_ledger')
    expect(led.people).toEqual([])
    expect(led.breakdown).toEqual([])
    await backdate(mid)
    const after = await rpc<{ people: { display_name: string; unresolved_cents: number }[] }>(db, U.jake, 'admin_ledger')
    expect(after.people.map((p) => [p.display_name, p.unresolved_cents])).toEqual([['Dev', 1000], ['Maya', 1000]])
  })

  test('after close all members see everyone\'s picks and names; non-members still nothing', async () => {
    const mid = await openRace()
    await pick(U.maya, mid, 'c1', 520, 480)
    await pick(U.dev, mid, 'c2', 300, 700)
    await backdate(mid)
    const m = await rpc<{ entries: { display_name: string; winner_id: string }[] }>(db, U.priya, 'get_market', { p_id: mid })
    expect(m.entries.map((e) => [e.display_name, e.winner_id])).toEqual([['Dev', 'c2'], ['Maya', 'c1']])
    expect(await select(db, U.priya, 'select * from public.entries')).toHaveLength(2)
    expect(await select(db, U.sam, 'select * from public.entries')).toHaveLength(0)
  })

  test('canceling before close keeps picks and refund rows hidden from others', async () => {
    const mid = await openRace()
    await pick(U.maya, mid, 'c1', 520, 480)
    await pick(U.dev, mid, 'c2', 300, 700)
    await rpc(db, U.jake, 'cancel_market', { p_id: mid, p_reason: 'Candidate list was wrong' })
    expect(await select(db, U.priya, 'select * from public.payouts')).toHaveLength(0)
    expect(await select(db, U.jake, 'select * from public.payouts')).toHaveLength(0)
    expect(await select(db, U.maya, 'select * from public.payouts')).toHaveLength(1)
    const led = await rpc<{ people: unknown[] }>(db, U.jake, 'admin_ledger')
    expect(led.people).toEqual([])
    const mine = await rpc<{ totals: { committed_cents: number; refund_cents: number; remaining_cents: number } }>(db, U.maya, 'my_ledger')
    expect(mine.totals).toMatchObject({ committed_cents: 1000, refund_cents: 1000, remaining_cents: 0 })
  })
})

describe('closing boundary and locked terms', () => {
  test('deadline boundary is inclusive of the closing instant', async () => {
    const r = await db.query<{ a: boolean; b: boolean; c: boolean }>(
      `select app.deadline_passed_at('2026-11-03 01:00:00+00', '2026-11-03 00:59:59.999999+00') a,
              app.deadline_passed_at('2026-11-03 01:00:00+00', '2026-11-03 01:00:00+00') b,
              app.deadline_passed_at(null, '2026-11-03 01:00:00+00') c`)
    expect(r.rows[0]).toEqual({ a: false, b: true, c: false })
  })

  test('writes are rejected by database time even if the page still shows the form', async () => {
    const mid = await openRace({ deadline: new Date(Date.now() + 1500).toISOString() })
    await pick(U.maya, mid, 'c1', 520, 480)
    await pick(U.dev, mid, 'c2', 400, 600)
    await new Promise((r) => setTimeout(r, 1700))
    await expect(pick(U.priya, mid, 'c1', 510, 490)).rejects.toThrow(/closed/i)
    await expect(pick(U.maya, mid, 'c1', 600, 400)).rejects.toThrow(/closed/i)
    await expect(rpc(db, U.maya, 'withdraw_entry', { p_market: mid })).rejects.toThrow(/closed/i)
    const m = await rpc<{ entries: unknown[] }>(db, U.priya, 'get_market', { p_id: mid })
    expect(m.entries).toHaveLength(2)
  })

  test('terms lock with the first entry; closed markets cannot be reopened', async () => {
    const mid = await openRace()
    const edit = (over: Record<string, unknown>) => rpc(db, U.jake, 'approve_market', {
      p_id: mid, p_candidates: CANDS, p_has_other: true, p_basis: 'single_round', p_rules_note: 'Certified state canvass.',
      p_buy_in_cents: 1000, p_deadline: inOneHour(), ...over,
    })
    await edit({ p_buy_in_cents: 2000 }) // allowed: no entries yet
    await pick(U.maya, mid, 'c1', 520, 480)
    await expect(edit({ p_buy_in_cents: 1500 })).rejects.toThrow(/locked/i)
    await expect(edit({})).rejects.toThrow(/locked/i)
    await expect(db.exec(`update public.markets set entry_deadline = entry_deadline + interval '1 day' where id = '${mid}'`)).rejects.toThrow(/locked/i)

    const empty = await openRace()
    await backdate(empty)
    await expect(rpc(db, U.jake, 'approve_market', {
      p_id: empty, p_candidates: CANDS, p_has_other: true, p_basis: 'single_round', p_rules_note: 'x',
      p_buy_in_cents: 1000, p_deadline: inOneHour(),
    })).rejects.toThrow(/reopened|cannot be edited/i)
  })

  test('deadlines must be in the future and before Election Day; defaults are admin-only and lock', async () => {
    const mid = await rpc<string>(db, U.maya, 'propose_market', { p_kind: 'house', p_title: 'TX-01', p_jurisdiction: 'TX', p_candidates: CANDS })
    const base = { p_id: mid, p_candidates: CANDS, p_has_other: true, p_basis: 'single_round', p_rules_note: 'x', p_buy_in_cents: 1000 }
    await expect(rpc(db, U.jake, 'approve_market', { ...base, p_deadline: '2026-11-03T05:00:01Z' })).rejects.toThrow(/before Election Day/i)
    await expect(rpc(db, U.jake, 'approve_market', { ...base, p_deadline: '2020-01-01T00:00:00Z' })).rejects.toThrow(/future/i)
    await rpc(db, U.jake, 'approve_market', { ...base, p_deadline: '2026-11-03T01:00:00Z' })
    await rpc(db, U.jake, 'set_group_defaults', { p_buy_in_cents: 1500, p_deadline: '2026-11-03T00:00:00Z' })
    const cong = (await rpc<{ id: string; kind: string; entry_deadline: string }[]>(db, U.maya, 'list_markets')).find((m) => m.kind === 'congress')!
    expect(new Date(cong.entry_deadline).toISOString()).toBe('2026-11-03T00:00:00.000Z')
    await rpc(db, U.maya, 'submit_entry', {
      p_market: cong.id, p_seats: { house: { d: 220, r: 215, o: 0 }, senate: { d: 49, r: 50, o: 1 } },
    })
    await expect(rpc(db, U.jake, 'set_group_defaults', { p_buy_in_cents: 1000, p_deadline: '2026-11-02T00:00:00Z' })).rejects.toThrow(/locked/i)
  })
})

describe('entry validation', () => {
  test('distribution must total 100.0, cover all candidates, and have a strict winner', async () => {
    const mid = await openRace()
    await expect(pick(U.maya, mid, 'c1', 520, 470)).rejects.toThrow(/total exactly/i)
    await expect(pick(U.maya, mid, 'c1', 500, 500)).rejects.toThrow(/largest/i)
    await expect(pick(U.maya, mid, 'c1', 400, 600)).rejects.toThrow(/largest/i)
    await expect(pick(U.maya, mid, 'c9', 520, 480)).rejects.toThrow(/listed candidates/i)
    await expect(rpc(db, U.maya, 'submit_entry', { p_market: mid, p_winner: 'c1', p_shares: { c1: 520, c2: 480 } })).rejects.toThrow(/cover every/i)
    await expect(rpc(db, U.maya, 'submit_entry', { p_market: mid, p_winner: 'c1', p_shares: { c1: 520.5, c2: 479.5, other: 0 } })).rejects.toThrow()
    await expect(rpc(db, U.maya, 'submit_entry', { p_market: mid, p_winner: 'c1', p_seats: { house: { d: 1, r: 1, o: 433 }, senate: { d: 1, r: 1, o: 98 } }, p_shares: { c1: 520, c2: 480, other: 0 } })).rejects.toThrow()
  })

  test('a plurality winner under 50% is valid; the stored commitment is the market buy-in', async () => {
    const mid = await openRace({ buyIn: 2500 })
    const e = (await pick(U.maya, mid, 'c1', 400, 350, 250)) as { commitment_cents: number }
    expect(e.commitment_cents).toBe(2500)
  })

  test('one active entry per person: resubmitting edits, withdrawing removes', async () => {
    const mid = await openRace()
    await pick(U.maya, mid, 'c1', 520, 480)
    await pick(U.maya, mid, 'c2', 450, 550)
    const rows = await db.query<{ winner_id: string }>(`select winner_id from public.entries where market_id = $1`, [mid])
    expect(rows.rows).toEqual([{ winner_id: 'c2' }])
    expect((await rpc<{ market: { entrants: number } }>(db, U.maya, 'get_market', { p_id: mid })).market.entrants).toBe(1)
    expect(await rpc(db, U.maya, 'withdraw_entry', { p_market: mid })).toBe(true)
    expect((await rpc<{ market: { entrants: number } }>(db, U.maya, 'get_market', { p_id: mid })).market.entrants).toBe(0)
  })

  test('seat entries must total 435 and 100', async () => {
    const cong = (await rpc<{ id: string; kind: string }[]>(db, U.maya, 'list_markets')).find((m) => m.kind === 'congress')!
    const seats = (h: number[], s: number[]) => ({ house: { d: h[0], r: h[1], o: h[2] }, senate: { d: s[0], r: s[1], o: s[2] } })
    await expect(rpc(db, U.maya, 'submit_entry', { p_market: cong.id, p_seats: seats([220, 214, 0], [49, 50, 1]) })).rejects.toThrow(/House seats must total 435/)
    await expect(rpc(db, U.maya, 'submit_entry', { p_market: cong.id, p_seats: seats([220, 215, 0], [49, 50, 2]) })).rejects.toThrow(/Senate seats must total 100/)
    await rpc(db, U.maya, 'submit_entry', { p_market: cong.id, p_seats: seats([220, 215, 0], [49, 50, 1]) })
  })

  test('only one live Control of Congress market, and congress cannot be proposed', async () => {
    await expect(rpc(db, U.maya, 'propose_market', { p_kind: 'congress', p_title: 'Again', p_jurisdiction: '', p_candidates: CANDS })).rejects.toThrow()
    await expect(db.exec(`insert into public.markets (kind, title) values ('congress', 'Dup')`)).rejects.toThrow(/one_live_congress_market|duplicate/i)
  })
})

describe('scoring', () => {
  test('winner first, then closest share; wrong winner is never competitive', async () => {
    const mid = await openRace()
    await pick(U.maya, mid, 'c1', 518, 482) // right winner, err 3
    await pick(U.dev, mid, 'c1', 560, 440)  // right winner, err 45
    await pick(U.priya, mid, 'c2', 479, 521) // wrong winner, even though 52.1% is near the real 51.5%
    await settleRace(mid, 'c1', 515)
    const p = await payoutsFor(mid)
    const by = Object.fromEntries(p.map((x) => [x.user_id, x]))
    expect(by[U.maya]).toMatchObject({ gross_cents: 3000, eligible: true, error_value: 3 })
    expect(by[U.dev]).toMatchObject({ gross_cents: 0, eligible: true, error_value: 45 })
    expect(by[U.priya]).toMatchObject({ gross_cents: 0, eligible: false, error_value: null })
  })

  test('exact ties split the whole pool and conserve every cent', async () => {
    const mid = await openRace({ buyIn: 1000 })
    await pick(U.maya, mid, 'c1', 520, 480)  // err 10 vs 51.0
    await pick(U.dev, mid, 'c1', 500, 400, 100) // err 10
    await pick(U.priya, mid, 'c1', 520, 380, 100) // err 10
    await pick(U.alex, mid, 'c2', 300, 700)   // wrong winner
    await settleRace(mid, 'c1', 510)
    const p = await payoutsFor(mid)
    const winners = p.filter((x) => x.gross_cents > 0)
    expect(winners).toHaveLength(3)
    expect(p.reduce((s, x) => s + x.gross_cents + x.refund_cents, 0)).toBe(4000)
    expect(Math.max(...winners.map((w) => w.gross_cents)) - Math.min(...winners.map((w) => w.gross_cents))).toBe(1)
    expect(winners.map((w) => w.gross_cents).sort()).toEqual([1333, 1333, 1334])
  })

  test('leftover cents go to the lowest entry ids, deterministically', async () => {
    const mid = await openRace({ buyIn: 1000 })
    await pick(U.maya, mid, 'c1', 520, 480)
    await pick(U.dev, mid, 'c1', 520, 480)
    await pick(U.priya, mid, 'c1', 520, 480)
    await pick(U.alex, mid, 'c2', 300, 700)
    await settleRace(mid, 'c1', 520)
    const ids = (await db.query<{ id: string; user_id: string }>(`select id, user_id from public.entries where market_id = $1`, [mid])).rows
    const p = await payoutsFor(mid)
    const top = ids.filter((e) => p.find((x) => x.user_id === e.user_id && x.gross_cents === 1334))
    expect(top).toHaveLength(1)
    const winnerIds = ids.filter((e) => p.find((x) => x.user_id === e.user_id && x.gross_cents > 0)).map((e) => e.id).sort()
    expect(top[0].id).toBe(winnerIds[0])
  })

  test('nobody picked the winner: everyone is refunded', async () => {
    const mid = await openRace()
    await pick(U.maya, mid, 'c2', 400, 600)
    await pick(U.dev, mid, 'c2', 450, 550)
    await settleRace(mid, 'c1', 520)
    const p = await payoutsFor(mid)
    expect(p.map((x) => [x.gross_cents, x.refund_cents])).toEqual([[0, 1000], [0, 1000]])
    const m = await rpc<{ runs: { outcome: string }[] }>(db, U.jake, 'get_market', { p_id: mid })
    expect(m.runs[0].outcome).toBe('no_winner_refund')
  })

  test('fewer than two entrants at close cancels the market and refunds', async () => {
    const one = await openRace()
    await pick(U.maya, one, 'c1', 520, 480)
    const none = await openRace()
    await backdate(one)
    await backdate(none)
    const list = await rpc<{ id: string; phase: string }[]>(db, U.priya, 'list_markets')
    expect(list.find((m) => m.id === one)!.phase).toBe('canceled')
    expect(list.find((m) => m.id === none)!.phase).toBe('canceled')
    const mine = await rpc<{ totals: Record<string, number> }>(db, U.maya, 'my_ledger')
    expect(mine.totals).toMatchObject({ committed_cents: 1000, refund_cents: 1000, remaining_cents: 0 })
    // running the sweep again changes nothing
    await rpc(db, U.maya, 'list_markets')
    expect((await db.query(`select count(*)::int c from public.settlement_runs where market_id = $1`, [one])).rows[0]).toEqual({ c: 1 })
  })

  test('seat markets: half the sum of six absolute differences; ties split', async () => {
    const cong = (await rpc<{ id: string; kind: string }[]>(db, U.maya, 'list_markets')).find((m) => m.kind === 'congress')!
    const seats = (h: number[], s: number[]) => ({ house: { d: h[0], r: h[1], o: h[2] }, senate: { d: s[0], r: s[1], o: s[2] } })
    const enter = (who: string, h: number[], s: number[]) => rpc(db, who, 'submit_entry', { p_market: cong.id, p_seats: seats(h, s) })
    await enter(U.maya, [220, 215, 0], [49, 50, 1])   // actual -> error 0
    await enter(U.dev, [223, 212, 0], [48, 51, 1])    // house off 3, senate off 1 -> 4
    await enter(U.priya, [219, 214, 2], [49, 50, 1])  // house: 1+1+2 = 4 -> /2 = 2
    await backdate(cong.id)
    await rpc(db, U.jake, 'enter_result', { p_market: cong.id, p_winner: null, p_share_tenths: null, p_seats: seats([220, 215, 0], [49, 50, 1]), p_source_url: 'https://example.test/seats' })
    await rpc(db, U.jake, 'confirm_settlement', { p_market: cong.id })
    const p = await payoutsFor(cong.id)
    const by = Object.fromEntries(p.map((x) => [x.user_id, x]))
    expect(by[U.maya]).toMatchObject({ error_value: 0, gross_cents: 3000 })
    expect(by[U.dev]).toMatchObject({ error_value: 4, gross_cents: 0 })
    expect(by[U.priya]).toMatchObject({ error_value: 2, gross_cents: 0 })
  })
})

describe('settlement and ledger', () => {
  test('confirming twice is idempotent', async () => {
    const mid = await openRace()
    await pick(U.maya, mid, 'c1', 520, 480)
    await pick(U.dev, mid, 'c2', 400, 600)
    const first = await settleRace(mid, 'c1', 520)
    const second = await rpc<{ run_id: string; already_settled: boolean }>(db, U.jake, 'confirm_settlement', { p_market: mid })
    expect(first.already_settled).toBe(false)
    expect(second).toEqual({ run_id: first.run_id, already_settled: true })
    expect((await db.query(`select count(*)::int c from public.payouts`)).rows[0]).toEqual({ c: 2 })
    expect((await db.query(`select count(*)::int c from public.settlement_runs where market_id = $1`, [mid])).rows[0]).toEqual({ c: 1 })
  })

  test('settlement needs a closed market and a recorded result with a source', async () => {
    const mid = await openRace()
    await pick(U.maya, mid, 'c1', 520, 480)
    await pick(U.dev, mid, 'c2', 400, 600)
    await expect(result(mid, 'c1', 520)).rejects.toThrow(/still open/i)
    await backdate(mid)
    await expect(rpc(db, U.jake, 'confirm_settlement', { p_market: mid })).rejects.toThrow(/Enter the certified result/i)
    await expect(rpc(db, U.jake, 'enter_result', { p_market: mid, p_winner: 'c1', p_share_tenths: 520, p_seats: null, p_source_url: '' })).rejects.toThrow(/source/i)
    await result(mid, 'c1', 520)
    const prev = await rpc<{ outcome: string; rows: { display_name: string; gross_cents: number }[] }>(db, U.jake, 'preview_settlement', { p_market: mid })
    expect(prev.outcome).toBe('settled')
    expect(prev.rows.map((r) => [r.display_name, r.gross_cents])).toEqual([['Dev', 0], ['Maya', 2000]])
    expect((await db.query(`select count(*)::int c from public.payouts`)).rows[0]).toEqual({ c: 0 })
  })
})

describe('settlement accounting (spec example)', () => {
  test('$30 in, $50 out, nothing transferred -> admin owes $20; after paying $30 -> admin owes $50', async () => {
    // Three resolved markets for Maya. Market A has 5 entrants and Maya alone has the winning pick.
    const a = await openRace(); const b = await openRace(); const c = await openRace()
    await pick(U.maya, a, 'c1', 520, 480)
    for (const who of [U.dev, U.priya, U.alex, U.jake]) await pick(who, a, 'c2', 400, 600)
    for (const m of [b, c]) { await pick(U.maya, m, 'c2', 400, 600); await pick(U.dev, m, 'c1', 550, 450) }
    await settleRace(a, 'c1', 520); await settleRace(b, 'c1', 550); await settleRace(c, 'c1', 550)

    const led = async () => (await rpc<{ totals: Record<string, number> }>(db, U.maya, 'my_ledger')).totals
    expect(await led()).toMatchObject({ committed_cents: 3000, gross_cents: 5000, refund_cents: 0, remaining_cents: -2000 })

    await rpc(db, U.jake, 'record_transfer', { p_member: U.maya, p_direction: 'collected', p_amount_cents: 3000, p_occurred_on: '2026-11-04', p_note: 'cash' })
    expect(await led()).toMatchObject({ collected_cents: 3000, remaining_cents: -5000 })

    await rpc(db, U.jake, 'record_transfer', { p_member: U.maya, p_direction: 'paid_out', p_amount_cents: 5000, p_occurred_on: '2026-11-05' })
    expect(await led()).toMatchObject({ paid_out_cents: 5000, remaining_cents: 0 })

    const admin = await rpc<{ people: { display_name: string; remaining_cents: number; is_admin: boolean }[] }>(db, U.jake, 'admin_ledger')
    const jake = admin.people.find((p) => p.display_name === 'Jake')!
    expect(jake.is_admin).toBe(true)
    await expect(rpc(db, U.jake, 'record_transfer', { p_member: U.jake, p_direction: 'collected', p_amount_cents: 100, p_occurred_on: '2026-11-04' })).rejects.toThrow(/themself/i)
  })

  test('refunds and commitments on unresolved markets stay out of the owed balance', async () => {
    const refunded = await openRace()
    await pick(U.maya, refunded, 'c2', 400, 600); await pick(U.dev, refunded, 'c2', 450, 550)
    await settleRace(refunded, 'c1', 520)
    const pending = await openRace()
    await pick(U.maya, pending, 'c1', 520, 480)
    const t = (await rpc<{ totals: Record<string, number> }>(db, U.maya, 'my_ledger')).totals
    expect(t).toMatchObject({ committed_cents: 1000, refund_cents: 1000, remaining_cents: 0, unresolved_cents: 1000 })
  })

  test('corrections append a new version, keep transfers, and refuse stale or reasonless requests', async () => {
    const mid = await openRace()
    await pick(U.maya, mid, 'c1', 520, 480)
    await pick(U.dev, mid, 'c2', 400, 600)
    await settleRace(mid, 'c1', 520)
    await rpc(db, U.jake, 'record_transfer', { p_member: U.dev, p_direction: 'collected', p_amount_cents: 1000, p_occurred_on: '2026-11-04' })
    const fix = (over: Record<string, unknown>) => rpc(db, U.jake, 'correct_settlement', {
      p_market: mid, p_expected_version: 1, p_winner: 'c2', p_share_tenths: 510, p_seats: null,
      p_source_url: 'https://example.test/recount', p_reason: 'Recount changed the winner', ...over,
    })
    await expect(fix({ p_reason: ' ' })).rejects.toThrow(/reason/i)
    await expect(fix({ p_expected_version: 7 })).rejects.toThrow(/already corrected/i)
    await fix({})
    await expect(fix({})).rejects.toThrow(/already corrected/i) // double-click on the same screen
    const dev = (await rpc<{ totals: Record<string, number> }>(db, U.dev, 'my_ledger')).totals
    expect(dev).toMatchObject({ committed_cents: 1000, gross_cents: 2000, collected_cents: 1000, remaining_cents: -2000 })
    const runs = await db.query<{ version: number }>(`select version from public.settlement_runs where market_id = $1 order by version`, [mid])
    expect(runs.rows.map((r) => r.version)).toEqual([1, 2])
    await expect(db.exec(`delete from public.settlement_runs`)).rejects.toThrow(/append-only/i)
  })

  test('voiding a transfer removes it from balances but keeps the record', async () => {
    const t = await rpc<string>(db, U.jake, 'record_transfer', { p_member: U.maya, p_direction: 'collected', p_amount_cents: 1000, p_occurred_on: '2026-11-04' })
    expect((await rpc<{ totals: Record<string, number> }>(db, U.maya, 'my_ledger')).totals.remaining_cents).toBe(-1000)
    await rpc(db, U.jake, 'void_transfer', { p_id: t })
    expect((await rpc<{ totals: Record<string, number> }>(db, U.maya, 'my_ledger')).totals.remaining_cents).toBe(0)
    expect((await db.query(`select count(*)::int c from public.money_transfers`)).rows[0]).toEqual({ c: 1 })
  })
})

describe('polling snapshots', () => {
  test('closing snapshot is the latest one captured before the deadline', async () => {
    const mid = await openRace()
    await rpc(db, U.jake, 'record_polling', { p_market: mid, p_source_name: 'Manual', p_source_url: 'https://example.test/poll', p_as_of: '2026-10-01', p_data: { candidates: [{ name: 'Garcia', party: 'D', pct: 48 }, { name: 'Whitfield', party: 'R', pct: 45 }], undecided: 7 } })
    await db.exec(`update public.polling_snapshots set fetched_at = clock_timestamp() - interval '1 hour'`)
    await backdate(mid)
    await rpc(db, U.jake, 'record_polling', { p_market: mid, p_source_name: 'Manual', p_source_url: null, p_as_of: '2026-11-04', p_data: { candidates: [{ name: 'Garcia', party: 'D', pct: 52 }] } })
    const m = await rpc<{ polling: { latest: { as_of: string }; at_close: { as_of: string; data: { undecided: number } } } }>(db, U.maya, 'get_market', { p_id: mid })
    expect(m.polling.latest.as_of).toBe('2026-11-04')
    expect(m.polling.at_close.as_of).toBe('2026-10-01')
    expect(m.polling.at_close.data.undecided).toBe(7)
    await expect(rpc(db, U.maya, 'record_polling', { p_market: mid, p_source_name: 'x', p_source_url: null, p_as_of: '2026-10-01', p_data: { candidates: [] } })).rejects.toThrow(/admin only/i)
  })
})
