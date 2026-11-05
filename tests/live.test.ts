// The Results page's math. The payout port must equal the database to the cent, and every total must reconcile.
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, test } from 'vitest'
import { AUTH_STUB, MIGRATIONS } from '../src/data/migrations'
import { rpc } from '../src/data/pgliteRpc'
import counts from '../src/demo/live-counts.json'
import { KEY_RACES, MISSISSIPPI, RACES, leanLabel, type KeyRace } from '../src/live/config'
import { toCount, toSeats, type Count, type FeedRace, type SeatCount } from '../src/live/feed'
import { drawRace, project, rng, roundToTotal, toOutcome, type LiveEntry, type LiveMarket } from '../src/live/model'
import { shortName } from '../src/live/names'
import { payouts, type ScoreEntry } from '../src/live/scoring'

const fixed = counts as unknown as { counts: Record<string, Count>; mississippi: Count; senateSeats: SeatCount[]; houseSeats: SeatCount[] }
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function seededRandom(seed: number) { const r = rng(seed); return (n: number) => Math.floor(r.uniform() * n) }

describe('payouts match app.compute_outcome', () => {
  let db: PGlite
  let raceId: string
  let seatId: string
  const users = Array.from({ length: 12 }, (_, i) => uuid(i + 1))
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(AUTH_STUB)
    for (const m of MIGRATIONS) await db.exec(m)
    for (const u of users) await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{"display_name":"X"}')`, [u, `${u}@example.test`])
    raceId = (await db.query<{ id: string }>(`select id from public.markets where featured and kind = 'senate' limit 1`)).rows[0].id
    seatId = (await db.query<{ id: string }>(`select id from public.markets where kind = 'senate_seats' limit 1`)).rows[0].id
    await db.exec(`set session_replication_role = replica`)
  })

  async function check(market: string, entries: ScoreEntry[], outcome: Parameters<typeof payouts>[1]) {
    await db.query(`delete from public.entries where market_id = $1`, [market])
    for (const e of entries) {
      await db.query(`insert into public.entries (id, market_id, user_id, winner_id, shares, seats, commitment_cents, tier) values ($1, $2, $3, $4, $5, $6, $7, 'full')`,
        [e.id, market, users[entries.indexOf(e)], e.winner, e.shares ? JSON.stringify(e.shares) : null, e.r != null ? JSON.stringify({ r: e.r }) : null, e.cents])
    }
    const seat = 'r' in outcome
    const got = (await db.query<{ entry_id: string; gross_cents: number; refund_cents: number }>(
      `select entry_id, gross_cents, refund_cents from app.compute_outcome($1, $2, $3, $4)`,
      [market, seat ? null : outcome.winner, seat ? null : outcome.share, seat ? JSON.stringify({ r: outcome.r }) : null])).rows
    const mine = payouts(entries, outcome)
    for (const [i, e] of entries.entries()) {
      const row = got.find((g) => g.entry_id === e.id)!
      expect({ gross: row.gross_cents, refund: row.refund_cents }).toEqual(mine[i])
    }
  }

  test('random races: picks, ties, blanks, two stake levels, odd cents', async () => {
    const pick = seededRandom(11)
    for (let t = 0; t < 120; t++) {
      const n = 1 + pick(9)
      const entries: ScoreEntry[] = Array.from({ length: n }, (_, i) => {
        const blank = pick(8) === 0
        const w = pick(2) ? 'c1' : 'c2'
        const share = 500 + pick(6) // narrow, to force ties
        return { id: uuid(1000 + pick(90000) * 12 + i), cents: pick(3) === 0 ? 133 : 400, winner: blank ? null : w, shares: blank ? null : { [w]: share, [w === 'c1' ? 'c2' : 'c1']: 1000 - share }, r: null }
      })
      await check(raceId, entries, { winner: pick(2) ? 'c1' : 'c2', share: 500 + pick(6) })
    }
  }, 120000)

  test('random seat counts', async () => {
    const pick = seededRandom(23)
    for (let t = 0; t < 60; t++) {
      const n = 1 + pick(9)
      const entries: ScoreEntry[] = Array.from({ length: n }, (_, i) => ({ id: uuid(100000 + pick(90000) * 12 + i), cents: pick(2) ? 500 : 250, winner: null, shares: null, r: pick(6) === 0 ? null : 44 + pick(5) }))
      await check(seatId, entries, { r: 44 + pick(5) })
    }
  }, 120000)
})

describe('get_live', () => {
  test('counts are public, names and money are members-only', async () => {
    const db = new PGlite()
    await db.exec(AUTH_STUB)
    for (const m of MIGRATIONS) await db.exec(m)
    expect(await rpc(db, null, 'get_live')).toBeNull()
    await db.query(`insert into public.live_snapshots (fetched_at, public, members) values (now() - interval '6 hours', '{"bets":[{"id":"a","pA":0.4}]}', '{"bettors":[{"name":"First"}]}'), (now(), '{"bets":[{"id":"a","pA":0.7}]}', '{"bettors":[{"name":"Second"}]}')`)
    const anon = await rpc<{ live: unknown; members: unknown; previous: { bets: { pA: number }[] } }>(db, null, 'get_live')
    expect(anon.live).toEqual({ bets: [{ id: 'a', pA: 0.7 }] })
    expect(anon.members).toBeNull()
    expect(anon.previous.bets[0].pA).toBe(0.4)
    const member = uuid(77)
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'm@example.test', '{"display_name":"M"}')`, [member])
    await db.query(`insert into public.members (user_id) values ($1) on conflict do nothing`, [member])
    expect((await rpc<{ members: { bettors: { name: string }[] } }>(db, member, 'get_live')).members.bettors[0].name).toBe('Second')
    await expect(db.query(`set role anon; select * from public.live_snapshots`)).rejects.toThrow()
    await db.exec('reset role')
  }, 60000)
})

// ---------------------------------------------------------------- the projection, on real public counts and made-up ballots

const TITLES = Object.keys(RACES)
const names: Record<string, [string, string]> = {}
const races: LiveMarket[] = TITLES.map((t, i) => ({ id: `m${i}`, title: t, kind: t.includes('governor') ? 'governor' : t.includes('House') ? 'house' : 'senate', sort_order: i, featured: t in KEY_RACES, candidates: [{ id: 'c1', name: names[t]?.[0] ?? `A ${t}`, party: 'D' }, { id: 'c2', name: `B ${t}`, party: 'R' }] }))
const seatBets: LiveMarket[] = [{ id: 's', title: 'Senate seats', kind: 'senate_seats', sort_order: 50, featured: true, candidates: [] }, { id: 'h', title: 'House seats', kind: 'house_seats', sort_order: 51, featured: true, candidates: [] }]
const markets = [...races, ...seatBets]
function ballots(seed: number): LiveEntry[] {
  const pick = seededRandom(seed)
  const people = ['Ann Lee', 'Bo', 'Cy Ng', 'Di Ro', 'Ed', 'Fay']
  return markets.flatMap((m) => people.map((p, i) => {
    const seat = m.kind.endsWith('_seats')
    const w = pick(5) === 0 ? 'c2' : 'c1'
    const share = 500 + pick(90)
    const half = i === 5 // one half-size ballot
    return { id: uuid(pick(1e9)), user: p, name: shortName(p), market: m.id, cents: (seat ? 500 : 400) / (half ? 2 : 1), winner: seat ? null : w, shares: seat ? null : { [w]: share, [w === 'c1' ? 'c2' : 'c1']: 1000 - share }, r: seat ? (m.kind === 'senate_seats' ? 44 + pick(5) : 170 + pick(40)) : null }
  }))
}
const inputs = (seed = 3) => ({ markets, entries: ballots(seed), counts: Object.fromEntries(races.map((m) => [m.id, fixed.counts[m.title]])), mississippi: fixed.mississippi, senateSeats: fixed.senateSeats, houseSeats: fixed.houseSeats, fetchedAt: '2026-11-05T02:00:00Z' })

describe('project', () => {
  const run = project(inputs(), 4000)

  test('money nets to zero and the table rounds to exactly zero', () => {
    expect(run.members.bettors.reduce((a, b) => a + b.net, 0)).toBeCloseTo(0, 6)
    expect(run.members.bettors.reduce((a, b) => a + b.dollars, 0)).toBe(0)
  })

  test('pot shares, refunds and bets won all reconcile', () => {
    const pots = new Map(run.pub.bets.map((b) => [b.id, b.pot_cents]))
    const total = run.members.bets.reduce((a, b) => a + b.refund, 0) + run.members.bettors.reduce((a, b) => a + b.bets, 0)
    expect(total).toBeCloseTo(markets.length, 6)
    for (const b of run.members.bets) expect(pots.get(b.id)).toBeGreaterThan(0)
  })

  test('every error bar holds its estimate, and nobody can lose more than they paid', () => {
    for (const b of run.members.bettors) {
      expect(b.lo).toBeLessThanOrEqual(b.net + 1)
      expect(b.hi).toBeGreaterThanOrEqual(b.net - 1)
      expect(b.lo).toBeGreaterThanOrEqual(-b.paid)
    }
  })

  test('same counts give the same page', () => {
    expect(project(inputs(), 2000).members).toEqual(project(inputs(), 2000).members)
  })

  test('seat totals stay in the possible range', () => {
    const sen = run.pub.bets.find((b) => b.kind === 'senate_seats')!
    expect(sen.hist!.reduce((a, h) => a + h.p, 0)).toBeCloseTo(1, 6)
    expect(Math.min(...sen.hist!.map((h) => h.r))).toBeGreaterThanOrEqual(31)
    expect(Math.max(...sen.hist!.map((h) => h.r))).toBeLessThanOrEqual(66)
  })

  test('when nobody picked the likely winner, the label is about the refund', () => {
    const inp = inputs()
    inp.entries = inp.entries.map((e) => (e.market === 'm9' ? { ...e, winner: 'c2', shares: { c1: 480, c2: 520 } } : e)) // Texas: all on the trailing side
    const m = project(inp, 1000).members.bets.find((b) => b.id === 'm9')!
    expect(m.refundLeads).toBe(true)
    expect(m.refund).toBeGreaterThan(0.99)
    expect(m.lean).toBe('Called')
  })

  test('an entered official result settles the bet', () => {
    const inp = inputs()
    inp.markets = inp.markets.map((m) => (m.id === 'm0' ? { ...m, official: { winner: 'c2', share: 512, r: null } } : m))
    const out = project(inp, 500)
    expect(out.pub.bets.find((b) => b.id === 'm0')!.pA).toBe(0)
    expect(out.pub.bets.find((b) => b.id === 'm0')!.settled).toBe(true)
  })
})

describe('called is a function of confidence only', () => {
  const k: KeyRace = { raceId: 0, state: 'XX', profile: { floor: 0.01, trust: 1, lean: 0, sd: 0.05, spread: 0.4, note: '' } }
  const chanceA = (c: Count) => {
    const r = rng(9)
    let wins = 0
    for (let i = 0; i < 4000; i++) if (drawRace(c, k, r, r.normal()).final > 0.5) wins += 1
    return wins / 4000
  }
  const count = (a: number, b: number, pct: number): Count => ({ a, b, others: {}, pct, countyLeft: 0, countyShareA: a / (a + b), updated: '' })

  test('a full count with a hair-thin lead is not called', () => {
    expect(chanceA(count(100200, 100000, 100))).toBeLessThan(0.99)
  })
  test('a big lead with a lot left can be', () => {
    expect(chanceA(count(700000, 300000, 60))).toBeGreaterThan(0.99)
  })
  test('the labels', () => {
    expect([0.55, 0.6, 0.8, 0.95, 0.99, 0.991].map(leanLabel)).toEqual(['Tilt', 'Leans', 'Likely', 'Very likely', 'Very likely', 'Called'])
  })
})

describe('ranked choice', () => {
  const others = { 'Gerald L. Heikes': 3000, 'Daniel J. Jr. Sullivan': 2000 }
  const base: Count = { a: 48000, b: 47000, others, pct: 100, countyLeft: 0, countyShareA: 0.5, updated: '' }
  const k = KEY_RACES['Alaska Senate']
  const still: KeyRace = { ...k, profile: { ...k.profile, floor: 0, sd: 0, lean: 0, spread: 0 } }
  test('transfers move the two-way share when nobody reaches 50%', () => {
    const r = rng(1)
    const finals = Array.from({ length: 500 }, () => drawRace(base, still, r, 0).final)
    expect(finals.reduce((a, b) => a + b, 0) / finals.length).toBeLessThan(48000 / 95000)
  })
  test('a first-round majority skips them', () => {
    const big: Count = { ...base, a: 52000, b: 43000 }
    const r = rng(1)
    expect(drawRace(big, still, r, 0).final).toBeCloseTo(52000 / 95000, 2)
  })
})

describe('feed', () => {
  const race: FeedRace = {
    election_name: 'Test', percent_reporting: 80, last_updated: 'now',
    candidates: [{ name: 'Dan  Sullivan', party: 'Republican', votes: 60 }, { name: 'Daniel J. Jr. Sullivan', party: 'Nonpartisan', votes: 5 }, { name: 'Mary Peltola', party: 'Democratic', votes: 40 }],
    region_results: {
      x: { type: 'Borough', percent_reporting: 50, candidates: [{ name: 'Mary Peltola', party: 'D', votes: 30 }, { name: 'Dan Sullivan', party: 'R', votes: 10 }] },
      y: { type: 'House District', percent_reporting: 10, candidates: [{ name: 'Mary Peltola', party: 'D', votes: 500 }, { name: 'Dan Sullivan', party: 'R', votes: 500 }] },
    },
  }
  test('matches candidates exactly and adds up one kind of area', () => {
    const c = toCount(race, 'Mary Peltola', 'Dan Sullivan')
    expect([c.a, c.b]).toEqual([40, 60])
    expect(c.others).toEqual({ 'Daniel J. Jr. Sullivan': 5 })
    expect(c.countyLeft).toBeCloseTo(40)
    expect(c.countyShareA).toBeCloseTo(0.75)
  })
  test('a missing candidate stops the run', () => {
    expect(() => toCount(race, 'Someone Else', 'Dan Sullivan')).toThrow(/can't find/)
  })
  test('seats: House keys and Senate state names both resolve', () => {
    const seats = toSeats({ ...race, region_results: {
      'ca-23': { type: 'Congressional District', percent_reporting: 100, candidates: [{ name: 'R', party: 'Republican', votes: 5 }, { name: 'D', party: 'Democratic', votes: 4 }] },
      alaska: { name: 'Alaska', type: 'State', percent_reporting: 70, candidates: [{ name: 'R', party: 'Republican', votes: 5 }] },
    } })
    expect(seats.map((s) => s.state)).toEqual(['CA', 'AK'])
    expect(seats[1].o).toBeNull()
  })
})

test('helpers', () => {
  expect(['Pat Rivera', 'Sam K', 'Lee', 'Robin van Dyke'].map(shortName)).toEqual(['Pat R.', 'Sam K.', 'Lee', 'Robin D.'])
  expect(roundToTotal([150, 150, -300])).toEqual([2, 1, -3])
  expect(toOutcome(0.5333, 'c1', 'c2')).toEqual({ winner: 'c1', share: 533 })
  expect(toOutcome(0.4, 'c1', 'c2')).toEqual({ winner: 'c2', share: 600 })
  expect(MISSISSIPPI.raceId).toBeGreaterThan(0)
})
