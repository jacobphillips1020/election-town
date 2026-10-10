// The main pool: one ballot of 12 picks (10 Senate races + Senate and House seat counts), entered,
// edited and withdrawn as a whole; sealed until the pool closes; then the group's split is public and
// every ballot (anonymized) is visible to members. Runs the real migrations on PGlite.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test } from 'vitest'
import { AUTH_STUB, MIGRATIONS } from '../src/data/migrations'
import { rpc, select } from '../src/data/pgliteRpc'

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const U = { jake: id(1), maya: id(2), dev: id(3), priya: id(4), sam: id(6) }
const NAMES: Record<string, string> = { jake: 'Jake', maya: 'Maya', dev: 'Dev', priya: 'Priya', sam: 'Sam' }

type PoolMarket = {
  id: string; kind: string; title: string; buy_in_cents: number; entry_deadline: string; phase: string; sort_order: number
  candidates: { id: string; name: string; party: string }[]; has_other: boolean; entrants: number; pool_cents: number
  tally: null | { n: number; picks: Record<string, number>; mean_shares: Record<string, number>; r_mean: number | null; r_median: number | null }
}
type Pool = {
  deadline: string; closed: boolean; ballot_cents: number; ballots: number; pot_cents: number; pay_note: string | null
  my_ballot: Record<string, unknown> | null; markets: PoolMarket[]
  ballots_grid: { you: boolean; picks: Record<string, { w?: string; s?: number; r?: number }> }[] | null
  senate: { state: string; special: boolean; market: { featured: boolean } | null }[]
}

let db: PGlite
const pool = (who: string | null = U.maya) => rpc<Pool>(db, who, 'get_pool')

beforeEach(async () => {
  db = new PGlite()
  await db.exec(AUTH_STUB)
  for (const m of MIGRATIONS) await db.exec(m)
  await db.exec('update public.group_settings set open_signup = false')
  for (const [k, uid] of Object.entries(U)) {
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
      uid, `${k}@example.test`, JSON.stringify({ display_name: NAMES[k] }),
    ])
  }
  await db.exec(readFileSync('supabase/seed/bootstrap_admin.sql', 'utf8').replace('REPLACE_WITH_YOUR_EMAIL', 'jake@example.test'))
  const token = await rpc<string>(db, U.jake, 'create_invite')
  for (const m of [U.maya, U.dev, U.priya]) await rpc(db, m, 'redeem_invite', { p_token: token })
})

/** A full ballot: every race goes to c1 with the given share (tenths), seats as given. */
async function ballot(share = 520, senateR = 48, houseR = 205, over: Record<string, unknown> = {}) {
  const p = await pool()
  const picks: Record<string, unknown> = {}
  for (const m of p.markets) {
    if (m.kind === 'senate_seats') picks[m.id] = { seats: { r: senateR } }
    else if (m.kind === 'house_seats') picks[m.id] = { seats: { r: houseR } }
    else picks[m.id] = { winner_id: 'c1', shares: { c1: share, c2: 1000 - share } }
  }
  return { ...picks, ...over }
}
const submit = (who: string, picks: Record<string, unknown>) => rpc(db, who, 'submit_ballot', { p_picks: picks })
const closePool = () =>
  db.exec(`set session_replication_role = replica;
           update public.markets set entry_deadline = clock_timestamp() - interval '1 minute' where featured;
           set session_replication_role = origin;`)
const byKind = async (kind: string, state?: string) =>
  (await pool()).markets.find((m) => m.kind === kind && (!state || m.title.startsWith(state)))!

describe('the slate', () => {
  test('10 Senate races that decide control plus two seat counts; $50 a ballot; Congress market retired', async () => {
    const p = await pool(null)
    expect(p.markets.map((m) => m.title)).toEqual([
      'Alaska Senate', 'Georgia Senate', 'Iowa Senate', 'Maine Senate', 'Michigan Senate', 'Nebraska Senate',
      'New Hampshire Senate', 'North Carolina Senate', 'Ohio Senate (special)', 'Texas Senate', 'Senate seats', 'House seats',
    ])
    expect(p.ballot_cents).toBe(5000)
    expect(p.markets.filter((m) => m.kind === 'senate').every((m) => m.buy_in_cents === 400 && !m.has_other)).toBe(true)
    expect(p.markets.filter((m) => m.kind !== 'senate').every((m) => m.buy_in_cents === 500)).toBe(true)
    expect(new Date(p.deadline).toISOString()).toBe('2026-10-28T03:59:00.000Z') // Oct 27, 11:59 p.m. ET
    const ne = p.markets.find((m) => m.title === 'Nebraska Senate')!
    expect(ne.candidates.map((c) => [c.name, c.party])).toEqual([['Dan Osborn', 'I'], ['Pete Ricketts', 'R']])
    expect(p.senate).toHaveLength(35)
    expect(p.senate.filter((s) => s.market?.featured)).toHaveLength(10)
    const cong = (await rpc<{ kind: string; phase: string }[]>(db, U.maya, 'list_markets')).find((m) => m.kind === 'congress')!
    expect(cong.phase).toBe('canceled')
  })

  test('the retired Congress market refunded what was in it', async () => {
    // Re-run the slate migration on a database where the Congress market had an entry.
    const fresh = new PGlite()
    await fresh.exec(AUTH_STUB)
    const poolAt = MIGRATIONS.findIndex((m) => /Election Town v2: the main pool/.test(m))
    for (const m of MIGRATIONS.slice(0, poolAt)) await fresh.exec(m)
    await fresh.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'a@example.test', '{"display_name":"A"}')`, [U.maya])
    const cong = (await fresh.query<{ id: string }>(`select id from public.markets where kind = 'congress'`)).rows[0].id
    await rpc(fresh, U.maya, 'submit_entry', { p_market: cong, p_seats: { house: { d: 220, r: 215, o: 0 }, senate: { d: 49, r: 50, o: 1 } } })
    await fresh.exec(MIGRATIONS[poolAt])
    const led = await rpc<{ totals: Record<string, number> }>(fresh, U.maya, 'my_ledger')
    expect(led.totals).toMatchObject({ committed_cents: 1000, refund_cents: 1000, remaining_cents: 0, unresolved_cents: 0 })
  })
})

describe('the ballot', () => {
  test('visitors see the pool and polling but cannot enter; non-members cannot enter', async () => {
    const p = await pool(null)
    expect([p.my_ballot, p.pay_note, p.ballots_grid]).toEqual([null, null, null])
    await expect(submit(U.maya, await ballot()).then(() => rpc(db, null, 'submit_ballot', { p_picks: {} }))).rejects.toThrow(/permission denied/i)
    await expect(submit(U.sam, await ballot())).rejects.toThrow(/members only/i)
  })

  test('all or nothing: a bad pick saves nothing; no picks at all is refused', async () => {
    const full = await ballot()
    const ia = await byKind('senate', 'Iowa')
    await expect(submit(U.maya, {})).rejects.toThrow(/at least one pick/)
    await expect(submit(U.maya, { [ia.id]: {} })).rejects.toThrow(/at least one pick/)
    await expect(submit(U.maya, { ...full, [ia.id]: { winner_id: 'c1' } })).rejects.toThrow(/Iowa Senate: .*share/)
    await expect(submit(U.maya, { ...full, [ia.id]: { winner_id: 'c1', shares: { c1: 480, c2: 520 } } })).rejects.toThrow(/Iowa Senate: .*more than 50%/)
    await expect(submit(U.maya, { ...full, [ia.id]: { winner_id: 'c1', shares: { c1: 520, c2: 470 } } })).rejects.toThrow(/total exactly/)
    const seats = await byKind('senate_seats')
    await expect(submit(U.maya, { ...full, [seats.id]: { seats: { r: 101 } } })).rejects.toThrow(/Senate seats: Republican seats must be a whole number from 0 to 100/)
    await expect(submit(U.maya, { ...full, [seats.id]: { seats: { r: 48.5 } } })).rejects.toThrow(/whole number/)
    expect((await db.query(`select count(*)::int c from public.entries`)).rows[0]).toEqual({ c: 0 })
  })

  test('a skipped pick is entered blank: its stake still goes in that pot, and the ballot is still $50', async () => {
    const full = await ballot()
    const ia = await byKind('senate', 'Iowa')
    const house = await byKind('house_seats')
    const { [ia.id]: _, ...missing } = full
    const r = await submit(U.maya, { ...missing, [house.id]: {} }) as { picks: number; blank: number }
    expect([r.picks, r.blank]).toEqual([10, 2])
    const p = await pool()
    expect([p.ballots, p.pot_cents]).toEqual([1, 5000])
    expect(p.my_ballot![ia.id]).toEqual({ winner_id: null, shares: null, seats: null })
    expect(p.markets.find((m) => m.id === ia.id)!.pool_cents).toBe(400)
  })

  test('submit, resubmit, withdraw; the stake is per pick and the ballot totals $50', async () => {
    await submit(U.maya, await ballot(520, 48, 205))
    let p = await pool()
    expect([p.ballots, p.pot_cents]).toEqual([1, 5000])
    const ia = p.markets.find((m) => m.title === 'Iowa Senate')!
    expect(p.my_ballot![ia.id]).toEqual({ winner_id: 'c1', shares: { c1: 520, c2: 480 }, seats: null })
    await submit(U.maya, await ballot(555, 51, 199))
    p = await pool()
    expect([p.ballots, p.pot_cents]).toEqual([1, 5000])
    const sen = p.markets.find((m) => m.kind === 'senate_seats')!
    expect(p.my_ballot![sen.id]).toMatchObject({ seats: { r: 51 } })
    expect(await rpc(db, U.maya, 'withdraw_ballot')).toBe(12)
    p = await pool()
    expect([p.ballots, p.pot_cents, p.my_ballot]).toEqual([0, 0, null])
  })

  test('main-pool picks cannot be entered or withdrawn one at a time', async () => {
    const ia = await byKind('senate', 'Iowa')
    await expect(rpc(db, U.maya, 'submit_entry', { p_market: ia.id, p_winner: 'c1', p_shares: { c1: 520, c2: 480 } })).rejects.toThrow(/made on the ballot/)
    await submit(U.maya, await ballot())
    await expect(rpc(db, U.maya, 'withdraw_entry', { p_market: ia.id })).rejects.toThrow(/made on the ballot/)
  })

  test('no ballots after the close, by database time', async () => {
    await submit(U.maya, await ballot())
    await submit(U.priya, await ballot())
    await closePool()
    await expect(submit(U.dev, await ballot())).rejects.toThrow(/pool has closed/i)
    await expect(submit(U.maya, await ballot(600))).rejects.toThrow(/pool has closed/i)
    await expect(rpc(db, U.maya, 'withdraw_ballot')).rejects.toThrow(/closed/i)
  })
})

describe('sealed until close, then revealed', () => {
  test('before close: counts and pots only; nobody (not even the admin) sees another ballot', async () => {
    await submit(U.maya, await ballot(520))
    await submit(U.dev, await ballot(560))
    for (const who of [U.jake, U.priya, null]) {
      const p = await pool(who)
      expect([p.ballots, p.pot_cents, p.my_ballot, p.ballots_grid]).toEqual([2, 10000, null, null])
      expect(p.markets.every((m) => m.tally === null)).toBe(true)
      expect(JSON.stringify(p)).not.toMatch(/"shares"|"c1":5/)
    }
    const ia = await byKind('senate', 'Iowa')
    expect([ia.entrants, ia.pool_cents]).toEqual([2, 800])
  })

  test('after close: the group split is public; members also see every ballot, anonymized', async () => {
    await submit(U.maya, await ballot(520, 47, 200))
    const ia = await byKind('senate', 'Iowa')
    await submit(U.dev, await ballot(560, 50, 210, { [ia.id]: { winner_id: 'c2', shares: { c1: 450, c2: 550 } } }))
    await submit(U.priya, await ballot(510, 53, 220))
    await submit(U.jake, await ballot(510, 50, 210, { [ia.id]: {} }))
    await closePool()

    const visitor = await pool(null)
    const t = visitor.markets.find((m) => m.id === ia.id)!.tally! as PoolMarket['tally'] & { blank: number }
    expect([t.n, t.blank]).toEqual([3, 1])
    expect(t.picks).toEqual({ c1: 2, c2: 1 })
    expect(t.mean_shares).toEqual({ c1: 493.3, c2: 506.7 })
    const st = visitor.markets.find((m) => m.kind === 'senate_seats')!.tally!
    expect([st.r_mean, st.r_median]).toEqual([50, 50])
    expect(visitor.ballots_grid).toBeNull()
    expect(JSON.stringify(visitor)).not.toMatch(/Maya|Dev|Priya/)

    const asMaya = await pool(U.maya)
    expect(asMaya.ballots_grid).toHaveLength(4)
    expect(asMaya.ballots_grid!.filter((b) => b.you)).toHaveLength(1)
    const mine = asMaya.ballots_grid!.find((b) => b.you)!
    expect(mine.picks[ia.id]).toEqual({ w: 'c1', s: 520 })
    expect(JSON.stringify(asMaya.ballots_grid)).not.toMatch(/Maya|Dev|Priya|0000-0000/)
    expect((await pool(U.sam)).ballots_grid).toBeNull()
  })
})

describe('scoring', () => {
  test('races: right winner first, then closest share takes the race pot', async () => {
    const ia = await byKind('senate', 'Iowa')
    await submit(U.maya, await ballot(518))
    await submit(U.dev, await ballot(560))
    await submit(U.priya, await ballot(510, 48, 205, { [ia.id]: { winner_id: 'c2', shares: { c1: 485, c2: 515 } } }))
    await submit(U.jake, await ballot(515, 48, 205, { [ia.id]: {} })) // skipped Iowa: in the pot, can't win
    await closePool()
    await rpc(db, U.jake, 'enter_result', { p_market: ia.id, p_winner: 'c1', p_share_tenths: 515, p_seats: null, p_source_url: 'https://example.test/ia' })
    await rpc(db, U.jake, 'confirm_settlement', { p_market: ia.id })
    const m = await rpc<{ payouts: { user_id: string; gross_cents: number; eligible: boolean }[] }>(db, U.jake, 'get_market', { p_id: ia.id })
    const by = Object.fromEntries(m.payouts.map((x) => [x.user_id, x]))
    expect(by[U.maya]).toMatchObject({ gross_cents: 1600, eligible: true })
    expect(by[U.dev]).toMatchObject({ gross_cents: 0, eligible: true })
    expect(by[U.priya]).toMatchObject({ gross_cents: 0, eligible: false })
    expect(by[U.jake]).toMatchObject({ gross_cents: 0, eligible: false })
  })

  test('seats: the closest Republican seat count takes the pot; ties split', async () => {
    const sen = await byKind('senate_seats')
    await submit(U.maya, await ballot(520, 47))
    await submit(U.dev, await ballot(520, 49))
    await submit(U.priya, await ballot(520, 52))
    await submit(U.jake, await ballot(520, 48, 205, { [sen.id]: {} })) // skipped: adds $5, can't win even though 48 is exact
    await closePool()
    await expect(rpc(db, U.jake, 'enter_result', { p_market: sen.id, p_winner: null, p_share_tenths: null, p_seats: { r: 101 }, p_source_url: 'https://example.test/s' })).rejects.toThrow(/0 to 100/)
    await rpc(db, U.jake, 'enter_result', { p_market: sen.id, p_winner: null, p_share_tenths: null, p_seats: { r: 48 }, p_source_url: 'https://example.test/s' })
    await rpc(db, U.jake, 'confirm_settlement', { p_market: sen.id })
    const m = await rpc<{ payouts: { user_id: string; gross_cents: number; error_value: number }[]; market: { result_seats: unknown } }>(db, U.jake, 'get_market', { p_id: sen.id })
    expect(m.market.result_seats).toEqual({ r: 48 })
    const by = Object.fromEntries(m.payouts.map((x) => [x.user_id, x]))
    expect([by[U.maya].gross_cents, by[U.dev].gross_cents, by[U.priya].gross_cents, by[U.jake].gross_cents]).toEqual([1000, 1000, 0, 0])
    expect([by[U.maya].error_value, by[U.dev].error_value, by[U.priya].error_value]).toEqual([1, 1, 4])
  })
})

describe('admin controls', () => {
  test('the pool closing time and stakes move together; ballots in owe the new stakes; never reopened', async () => {
    await boardNames('house:NY:17:0', 'Pat Example', 'Lee Sample')
    const side = await rpc<string>(db, U.maya, 'launch_race', { p_race_type: 'house', p_state: 'NY', p_district: '17' })
    await submit(U.maya, await ballot())
    const t = '2026-11-01T22:00:00.000Z'
    await expect(rpc(db, U.maya, 'set_pool_terms', { p_deadline: t, p_race_buy_in_cents: 500, p_seat_buy_in_cents: 500 })).rejects.toThrow(/admin only/i)
    await expect(rpc(db, U.jake, 'set_pool_terms', { p_deadline: '2026-11-03T05:00:01Z', p_race_buy_in_cents: 400, p_seat_buy_in_cents: 500 })).rejects.toThrow(/before Election Day/)
    await rpc(db, U.jake, 'set_pool_terms', { p_deadline: t, p_race_buy_in_cents: 500, p_seat_buy_in_cents: 500 })
    const p = await pool()
    expect(new Date(p.deadline).toISOString()).toBe(t)
    expect([p.ballot_cents, p.pot_cents]).toEqual([6000, 6000])
    const sideNow = (await rpc<{ id: string; entry_deadline: string }[]>(db, U.maya, 'list_markets')).find((m) => m.id === side)!
    expect(new Date(sideNow.entry_deadline).toISOString()).toBe(t) // side bets that closed with the pool follow it
    await closePool()
    await expect(rpc(db, U.jake, 'set_pool_terms', { p_deadline: t, p_race_buy_in_cents: 500, p_seat_buy_in_cents: 500 })).rejects.toThrow(/cannot be reopened/)
  })

  test('a side bet\'s stake and closing time are the admin\'s to change; entrants owe the new stake', async () => {
    await boardNames('house:NY:17:0', 'Pat Example', 'Lee Sample')
    const side = await rpc<string>(db, U.maya, 'launch_race', { p_race_type: 'house', p_state: 'NY', p_district: '17' })
    await rpc(db, U.maya, 'submit_entry', { p_market: side, p_winner: 'c1', p_shares: { c1: 520, c2: 480 } })
    await expect(rpc(db, U.maya, 'set_market_terms', { p_id: side, p_buy_in_cents: 2000, p_deadline: '2026-11-02T00:00:00Z' })).rejects.toThrow(/admin only/i)
    await rpc(db, U.jake, 'set_market_terms', { p_id: side, p_buy_in_cents: 2000, p_deadline: '2026-11-02T00:00:00Z' })
    const led = await rpc<{ totals: { unresolved_cents: number } }>(db, U.maya, 'my_ledger')
    expect(led.totals.unresolved_cents).toBe(2000)
    const ia = await byKind('senate', 'Iowa')
    await expect(rpc(db, U.jake, 'set_market_terms', { p_id: ia.id, p_buy_in_cents: 2000, p_deadline: '2026-11-02T00:00:00Z' })).rejects.toThrow(/pool's stakes/)
  })

  test('payment note: admin sets it, members read it', async () => {
    await expect(rpc(db, U.maya, 'set_pay_note', { p_note: 'x' })).rejects.toThrow(/admin only/i)
    await rpc(db, U.jake, 'set_pay_note', { p_note: '  Venmo @organizer by Oct 30  ' })
    expect((await pool(U.maya)).pay_note).toBe('Venmo @organizer by Oct 30')
    expect((await pool(null)).pay_note).toBeNull()
  })
})

describe('side bets', () => {
  test('open on $5 with a two-candidate vote share; featured races cannot be reopened as side bets', async () => {
    await boardNames('house:AZ:01:0', 'Pat Example', 'Lee Sample')
    const mid = await rpc<string>(db, U.maya, 'launch_race', { p_race_type: 'house', p_state: 'az', p_district: '1' })
    const m = (await rpc<Record<string, any>[]>(db, U.dev, 'list_markets')).find((x) => x.id === mid)!
    expect(m).toMatchObject({ buy_in_cents: 500, has_other: false, featured: false })
    expect(m.rules_note).toMatch(/two-way vote share.*Arizona.*48% to 42% result with 10% for others is 53.3% to 46.7% two-way/)
    await rpc(db, U.maya, 'submit_entry', { p_market: mid, p_winner: 'c2', p_shares: { c1: 470, c2: 530 } })
    await boardNames('senate:IA::0', 'Josh Turek', 'Ashley Hinson')
    await expect(rpc(db, U.maya, 'launch_race', { p_race_type: 'senate', p_state: 'IA' })).rejects.toThrow(/already has a bet/)
  })
})

const boardNames = (key: string, dem: string, rep: string) =>
  db.query(`insert into public.race_polling (race_key, race_type, state, district, is_special, dem_name, rep_name, dem_avg, rep_avg, poll_count)
            select $1, split_part($1, ':', 1), split_part($1, ':', 2), nullif(split_part($1, ':', 3), ''), split_part($1, ':', 4) = '1', $2, $3, 47, 45, 3`, [key, dem, rep])

test('visitors cannot read the forecasts table directly', async () => {
  await expect(select(db, null, 'select * from public.seat_forecasts')).rejects.toThrow(/permission denied/i)
  await expect(select(db, U.maya, 'select * from public.seat_forecasts')).rejects.toThrow(/permission denied/i)
})

describe('expert ratings', () => {
  test('come only from the server-written table: shown on the ballot races and on every Senate race, never writable by clients', async () => {
    await db.exec(`insert into public.expert_ratings (race_key, ratings) values
      ('senate:AK::0', '[{"source":"Cook Political Report","rating":"Toss Up","as_of":"2026-10-06"}]'),
      ('senate:VA::0', '[{"source":"Cook Political Report","rating":"Solid D","as_of":"2026-10-06"}]')`)
    await db.exec(`insert into public.race_polling (race_key, race_type, state, district, is_special, dem_name, rep_name, dem_avg, rep_avg, poll_count)
                   values ('senate:AK::0', 'senate', 'AK', null, false, 'Mary Peltola', 'Dan Sullivan', 48, 44.5, 2)`)
    const p = await pool(null)
    const ak = p.markets.find((m) => m.title === 'Alaska Senate') as unknown as { polling: { experts: { rating: string }[] } }
    expect(ak.polling.experts[0].rating).toBe('Toss Up')
    // a race with no polling still carries its ratings on the map
    const va = p.senate.find((s) => s.state === 'VA') as unknown as { polling: unknown; experts: { rating: string }[] }
    expect([va.polling, va.experts[0].rating]).toEqual([null, 'Solid D'])
    // no races without ratings invent any
    expect((p.senate.find((s) => s.state === 'WY') as unknown as { experts: unknown }).experts).toBeNull()
    await expect(select(db, U.maya, 'select * from public.expert_ratings')).rejects.toThrow(/permission denied/i)
    await expect(select(db, U.jake, `insert into public.expert_ratings (race_key, ratings) values ('x', '[]')`)).rejects.toThrow(/permission denied/i)
    // the old feed's column is gone
    expect((await db.query(`select 1 from information_schema.columns where table_name = 'race_polling' and column_name = 'experts'`)).rows).toHaveLength(0)
  })
})
