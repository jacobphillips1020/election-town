// The projection. One set of simulated finishes drives every number on the Results page, so they can't disagree:
// each draw picks a final count for every race, scores all 12 bets with the pool's real payout rule, and adds up
// each person's money. Chances are shares of draws; error bars are percentiles of the same draws.
import { DRAWS, MISSISSIPPI, NATIONAL_SHARE, RACES, leanLabel, seatProfile, type KeyRace, type LeanLabel, type StateProfile } from './config.js'
import type { Count, SeatCount } from './feed.js'
import { closestShares, payouts, type RaceOutcome, type ScoreEntry, type SeatOutcome } from './scoring.js'

// ---------------------------------------------------------------- random numbers (seeded: same inputs, same page)

export function rng(seed: number) {
  let s = seed >>> 0
  const uniform = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let spare: number | null = null
  const normal = () => {
    if (spare != null) { const x = spare; spare = null; return x }
    const u = 1 - uniform()
    const v = uniform()
    const m = Math.sqrt(-2 * Math.log(u))
    spare = m * Math.sin(2 * Math.PI * v)
    return m * Math.cos(2 * Math.PI * v)
  }
  /** Student-t with 5 degrees of freedom, scaled to variance 1: mostly normal, with room for a real surprise. */
  const fat = () => {
    const z = normal()
    let chi = 0
    for (let i = 0; i < 5; i++) { const x = normal(); chi += x * x }
    return (z / Math.sqrt(chi / 5)) * Math.sqrt(3 / 5)
  }
  return { uniform, normal, fat }
}
type Rng = ReturnType<typeof rng>
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

// ---------------------------------------------------------------- one race, one draw

/** Best guess at two-way votes left: the feed's statewide figure and its county figures, weighted by how much we trust each. */
export function expectedLeft(c: Count, p: Pick<StateProfile, 'floor' | 'trust'>) {
  const n = c.a + c.b
  const statewide = c.pct > 0 ? n * (100 / c.pct - 1) : 0
  const counties = Math.max(c.countyLeft, p.floor * n)
  return p.trust * Math.max(statewide, p.floor * n) + (1 - p.trust) * counties
}

/** Side A's share of what's left, before the lean: counties still out vote as they have so far; the rest matches the state. */
export function shareOfLeft(c: Count, left: number) {
  const n = c.a + c.b
  const known = Math.min(c.countyLeft, left)
  const state = n ? c.a / n : 0.5
  return left > 0 ? (known * c.countyShareA + (left - known) * state) / left : state
}

export type DrawnRace = { final: number; left: number }

/** Side A's final two-way share in this draw. Ranked-choice states move eliminated ballots if nobody reached 50%. */
export function drawRace(c: Count, k: KeyRace, r: Rng, national: number): DrawnRace {
  const p = k.profile
  const n = c.a + c.b
  const mean = expectedLeft(c, p)
  const left = mean * Math.exp(p.spread * r.normal() - (p.spread * p.spread) / 2)
  const base = shareOfLeft(c, mean)
  const lean = p.lean + p.sd * (Math.sqrt(1 - NATIONAL_SHARE) * r.fat() + Math.sqrt(NATIONAL_SHARE) * national)
  const inLeft = clamp(base + lean, 0, 1)
  // Official canvasses move totals a hair even when "everything" is in.
  const canvass = 0.0002 * r.normal()
  let share = clamp((c.a + left * inLeft) / (n + left) + canvass, 0, 1)
  if (k.transfers?.length) {
    const othersNow = Object.values(c.others).reduce((a, b) => a + b, 0)
    const twoWay = n + left
    const total = twoWay * (1 + othersNow / Math.max(n, 1))
    const A = share * twoWay
    const B = (1 - share) * twoWay
    if (A / total < 0.5 && B / total < 0.5) {
      let a2 = A
      let b2 = B
      for (const t of k.transfers) {
        const votes = ((c.others[t.name] ?? 0) / Math.max(n, 1)) * twoWay
        const toA = clamp(t.toA[0] + t.toA[1] * r.normal(), 0, 1)
        const toB = clamp(t.toB[0] + t.toB[1] * r.normal(), 0, 1 - toA)
        a2 += votes * toA
        b2 += votes * toB
      }
      share = a2 / (a2 + b2)
    }
  }
  return { final: share, left }
}

// ---------------------------------------------------------------- a seat, for the seat-count bets

/** How many sds a seat's lead has to be for this model to ever flip it: past this it's fixed, which keeps the run fast. */
const SAFE = 7

function seatSim(s: SeatCount) {
  if (s.uncontestedR != null) return { fixedR: s.uncontestedR }
  if (s.r == null) return { fixedR: false }
  if (s.o == null) return { fixedR: true }
  const n = s.r + s.o
  if (n === 0) return { fixedR: s.r >= s.o }
  const p = seatProfile(s.state)
  const statewide = s.pct > 0 ? n * (100 / s.pct - 1) : n
  const mean = Math.max(statewide, p.floor * n)
  const shareO = s.o / n
  // Biggest swing plausible: all that's left, at 2x the expected size, breaking well past the lean.
  const reach = (2.5 * mean * (Math.abs(p.lean) + SAFE * p.sd + 0.02)) / (n + 2.5 * mean)
  const expected = (s.o + mean * clamp(shareO + p.lean, 0, 1)) / (n + mean)
  if (Math.abs(expected - 0.5) > reach) return { fixedR: expected < 0.5 }
  return { fixedR: null as boolean | null, n, oVotes: s.o, mean, shareO, p }
}

// ---------------------------------------------------------------- inputs and outputs

export type LiveMarket = {
  id: string; title: string; kind: string; sort_order: number; featured: boolean
  candidates: { id: string; name: string; party: string }[]
  /** An entered result: bet is settled at this outcome. */
  official?: { winner: string | null; share: number | null; r: number | null } | null
}
export type LiveEntry = ScoreEntry & { user: string; name: string; market: string }
export type LiveInputs = {
  markets: LiveMarket[]
  entries: LiveEntry[]
  counts: Record<string, Count>
  mississippi: Count
  senateSeats: SeatCount[]
  houseSeats: SeatCount[]
  fetchedAt: string
  /** Side bets with money on them that we have no results source for. */
  unmodeled?: string[]
}

/** How likely each stretch of a range is: d[i] is the relative chance of bin i (the likeliest bin is 1), spread evenly from lo to hi. */
export type Density = { lo: number; hi: number; d: number[] }

export type PublicBet = {
  id: string; title: string; kind: string; sort_order: number; state?: string
  side: boolean; pot_cents: number
  candidates: { id: string; name: string; party: string }[]
  pct?: number; votes?: number
  left?: { mid: number; lo: number; hi: number }
  /** Side A's two-way share: the count now, and where it ends up (percent). */
  now?: number
  share?: { p5: number; p10: number; p50: number; p90: number; p95: number }
  /** The simulated final number: side A's share, or Republican seats. Drawn as the fading bar. */
  density?: Density
  /** Chance side A wins the race. */
  pA?: number
  /** Seat bets: chance of each Republican total. */
  hist?: { r: number; p: number }[]
  seatsLo?: number; seatsMid?: number; seatsHi?: number
  /** Senate seats: the races that can still change it. */
  open?: { title: string; leader: string; p: number }[]
  note?: string; done?: string
  settled?: boolean
}
export type PublicLive = {
  version: 1; fetched_at: string; updated_at: string; draws: number
  bets: PublicBet[]
  pot_cents: number; people: number
  unmodeled: string[]
}
export type BoardRow = { names: string[]; guess: number; side: string | null; p: number }
export type MemberBet = {
  id: string
  rows: BoardRow[]
  /** Chance nobody wins and everyone gets their money back. */
  refund: number
  /** Share of this bet's money that goes back to bettors on average. Differs from `refund` only with mixed ballot sizes. */
  moneyBack: number
  lean: LeanLabel
  /** True when "nobody wins, money back" is more likely than any one guess. The label is then about that. */
  refundLeads: boolean
  /** Everyone's guess, in the same units as the strip. */
  ticks: { name: string; x: number; side: string | null; rank: number | null }[]
}
export type Bettor = { name: string; paid: number; net: number; lo: number; hi: number; bets: number; of: number; dollars: number; density: Density }
export type MembersLive = { bets: MemberBet[]; bettors: Bettor[] }

function quantile(sorted: ArrayLike<number>, q: number) {
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

/**
 * The real shape of a simulated result, from sorted draws. Continuous values get a lightly smoothed histogram; `discrete`
 * values (seat counts) get one bin per whole number. The extreme 0.4% of draws is trimmed so one freak draw can't stretch a bar.
 */
export function density(sorted: ArrayLike<number>, opts: { bins?: number; discrete?: boolean; soften?: number } = {}): Density {
  const a = quantile(sorted, 0.002)
  const b = quantile(sorted, 0.998)
  const lo = opts.discrete ? Math.round(a) - 0.5 : a
  const hi = opts.discrete ? Math.round(b) + 0.5 : b
  const bins = opts.discrete ? Math.round(hi - lo) : opts.bins ?? 40
  if (!(hi > lo)) return { lo, hi, d: [1] }
  const raw = new Array<number>(bins).fill(0)
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i]
    if (v < lo || v > hi) continue
    raw[Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo)) * bins))] += 1
  }
  // Money comes in fixed payouts, so its draws land on a few exact amounts. `soften` blends neighbors so a bar reads as a
  // range of outcomes instead of a row of spikes; separate clusters stay separate.
  const reach = opts.soften ?? 1
  const smooth = opts.discrete ? raw : raw.map((_, i) => {
    let sum = 0
    for (let j = -reach * 2; j <= reach * 2; j++) sum += (raw[i + j] ?? 0) * Math.exp(-(j * j) / (2 * reach * reach))
    return sum
  })
  const top = Math.max(...smooth, 1)
  return { lo, hi, d: smooth.map((v) => Math.round((v / top) * 1000) / 1000) }
}

const hashSeed = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }

/** The winner's share in tenths of a percent, as settlement stores it. */
export const toOutcome = (shareA: number, a: string, b: string): RaceOutcome => {
  const aWins = shareA > 0.5
  return { winner: aWins ? a : b, share: Math.round((aWins ? shareA : 1 - shareA) * 1000) }
}

/** Dollars that add up exactly to the total, however individual amounts round. */
export function roundToTotal(cents: number[]): number[] {
  const dollars = cents.map((c) => c / 100)
  const floors = dollars.map(Math.floor)
  const short = Math.round(dollars.reduce((a, b) => a + b, 0) - floors.reduce((a, b) => a + b, 0))
  const order = dollars.map((d, i) => ({ i, f: d - floors[i] })).sort((x, y) => y.f - x.f)
  for (let k = 0; k < short; k++) floors[order[k].i] += 1
  return floors
}

// ---------------------------------------------------------------- the run

export function project(input: LiveInputs, draws = DRAWS): { pub: PublicLive; members: MembersLive } {
  const { markets, entries, counts } = input
  const r = rng(hashSeed(JSON.stringify(counts) + JSON.stringify(input.mississippi)))
  const races = markets.filter((m) => !['senate_seats', 'house_seats'].includes(m.kind))
  const seatBets = markets.filter((m) => ['senate_seats', 'house_seats'].includes(m.kind))
  const people = [...new Set(entries.map((e) => e.user))]
  const nameOf = new Map(entries.map((e) => [e.user, e.name]))
  const personIndex = new Map(people.map((u, i) => [u, i]))
  const byMarket = new Map(markets.map((m) => [m.id, entries.filter((e) => e.market === m.id)]))

  // Scoring results repeat a lot across draws, so each distinct outcome is scored once.
  type Scored = { pay: { gross: number; refund: number }[]; closest: number[] }
  const scoreCache = new Map<string, Scored>()
  const scored = (m: LiveMarket, o: RaceOutcome | SeatOutcome) => {
    const key = m.id + ('r' in o ? `r${o.r}` : `${o.winner}${o.share}`)
    let v = scoreCache.get(key)
    if (!v) { const es = byMarket.get(m.id)!; v = { pay: payouts(es, o), closest: closestShares(es, o) }; scoreCache.set(key, v) }
    return v
  }

  const finals = new Map<string, Float32Array>(races.map((m) => [m.id, new Float32Array(draws)]))
  const lefts = new Map<string, Float32Array>(races.map((m) => [m.id, new Float32Array(draws)]))
  const senateTotals = new Int16Array(draws)
  const houseTotals = new Int16Array(draws)
  const net = people.map(() => new Int32Array(draws))
  const betsWon = new Float64Array(people.length)
  const gained = new Map(markets.map((m) => [m.id, new Float64Array(byMarket.get(m.id)!.length)]))
  const moneyBack = new Map(markets.map((m) => [m.id, 0]))
  const nobody = new Map(markets.map((m) => [m.id, 0]))
  const potOf = new Map(markets.map((m) => [m.id, byMarket.get(m.id)!.reduce((a, e) => a + e.cents, 0)]))
  const paid = people.map((u) => entries.filter((e) => e.user === u).reduce((a, e) => a + e.cents, 0))
  const pAWins = new Map(races.map((m) => [m.id, 0]))
  const msWins = { d: 0 }

  // Seats: fixed ones get counted once; only live ones are drawn.
  const prep = (list: SeatCount[]) => list.map((s) => ({ s, sim: seatSim(s) }))
  const keyStates = new Map<string, string>()
  const houseKeys = new Set<string>()
  for (const m of races) {
    const k = RACES[m.title]
    if (m.kind === 'senate') keyStates.set(k.state, m.id)
    if (m.kind === 'house' && k.seatKey) houseKeys.add(k.seatKey)
  }
  const senate = prep(input.senateSeats.filter((s) => !keyStates.has(s.state) && s.state !== 'MS'))
  const house = prep(input.houseSeats.filter((s) => !houseKeys.has(s.key)))
  const baseOf = (l: typeof house) => l.reduce((a, x) => a + (x.sim.fixedR === true ? 1 : 0), 0)
  const senateBase = baseOf(senate) + 31 // 31 Republican senators weren't up in 2026.
  const houseBase = baseOf(house)
  const senateLive = senate.filter((x) => x.sim.fixedR == null)
  const houseLive = house.filter((x) => x.sim.fixedR == null)
  const openSenate = new Map(senateLive.map((x) => [x.s.key, 0]))

  const drawSeat = (x: (typeof house)[number], national: number) => {
    const sim = x.sim as { n: number; oVotes: number; mean: number; shareO: number; p: Pick<StateProfile, 'lean' | 'sd' | 'spread'> }
    const left = sim.mean * Math.exp(sim.p.spread * r.normal() - (sim.p.spread * sim.p.spread) / 2)
    const lean = sim.p.lean + sim.p.sd * (Math.sqrt(1 - NATIONAL_SHARE) * r.normal() + Math.sqrt(NATIONAL_SHARE) * national)
    return (sim.oVotes + left * clamp(sim.shareO + lean, 0, 1)) / (sim.n + left) < 0.5
  }

  for (let d = 0; d < draws; d++) {
    const national = r.normal()
    let rSenate = senateBase
    let rHouse = houseBase
    for (const m of races) {
      const k = RACES[m.title]
      const [a, b] = m.candidates
      let shareA: number
      if (m.official?.winner) {
        const w = (m.official.share as number) / 1000
        shareA = m.official.winner === a.id ? w : 1 - w
        lefts.get(m.id)![d] = 0
      } else {
        const got = drawRace(counts[m.id], k, r, national)
        shareA = got.final
        lefts.get(m.id)![d] = got.left
      }
      finals.get(m.id)![d] = shareA
      if (shareA > 0.5) pAWins.set(m.id, pAWins.get(m.id)! + 1)
      const rWon = a.party !== 'R' ? shareA <= 0.5 : shareA > 0.5
      if (rWon && m.kind === 'senate') rSenate += 1
      if (rWon && m.kind === 'house') rHouse += 1
      const pay = scored(m, toOutcome(shareA, a.id, b.id))
      apply(m, pay, d)
    }
    const ms = drawRace(input.mississippi, MISSISSIPPI, r, national).final
    if (ms > 0.5) msWins.d += 1
    else rSenate += 1
    for (const x of senateLive) { if (drawSeat(x, national)) { rSenate += 1; openSenate.set(x.s.key, openSenate.get(x.s.key)! + 1) } }
    for (const x of houseLive) if (drawSeat(x, national)) rHouse += 1
    senateTotals[d] = rSenate
    houseTotals[d] = rHouse
    for (const m of seatBets) {
      const off = m.official?.r
      const total = off ?? (m.kind === 'senate_seats' ? rSenate : rHouse)
      apply(m, scored(m, { r: total }), d)
    }
    for (let p = 0; p < people.length; p++) net[p][d] -= paid[p]
  }

  function apply(m: LiveMarket, { pay, closest }: Scored, d: number) {
    const es = byMarket.get(m.id)!
    const g = gained.get(m.id)!
    const pot = potOf.get(m.id)!
    for (let i = 0; i < es.length; i++) {
      const pi = personIndex.get(es[i].user)!
      net[pi][d] += pay[i].gross + pay[i].refund
      g[i] += closest[i]
      moneyBack.set(m.id, moneyBack.get(m.id)! + pay[i].refund)
      if (pot > 0) betsWon[pi] += pay[i].gross / pot
    }
    if (closest.every((c) => c === 0)) nobody.set(m.id, nobody.get(m.id)! + 1)
  }

  // ------------------------------------------------------------ summaries
  const toPublic = (m: LiveMarket): PublicBet => {
    const pub: PublicBet = { id: m.id, title: m.title, kind: m.kind, sort_order: m.sort_order, side: !m.featured, pot_cents: potOf.get(m.id)!, candidates: m.candidates, settled: !!(m.official?.winner || m.official?.r != null) }
    if (m.kind === 'senate_seats' || m.kind === 'house_seats') {
      const totals = m.kind === 'senate_seats' ? senateTotals : houseTotals
      const sorted = Int16Array.from(totals).sort()
      const counts2 = new Map<number, number>()
      for (const t of totals) counts2.set(t, (counts2.get(t) ?? 0) + 1)
      pub.hist = [...counts2].sort((a, b) => a[0] - b[0]).map(([x, n]) => ({ r: x, p: n / draws }))
      pub.seatsLo = quantile(sorted, 0.05)
      pub.seatsMid = quantile(sorted, 0.5)
      pub.seatsHi = quantile(sorted, 0.95)
      pub.density = density(sorted, { discrete: true })
      if (m.kind === 'senate_seats') {
        const open: { title: string; leader: string; p: number }[] = []
        for (const b of races.filter((x) => x.kind === 'senate')) {
          const pA = pAWins.get(b.id)! / draws
          if (pA > 0.01 && pA < 0.99) open.push({ title: b.title.replace(' Senate', ''), leader: pA > 0.5 ? b.candidates[0].name : b.candidates[1].name, p: Math.max(pA, 1 - pA) })
        }
        const msD = msWins.d / draws
        if (msD > 0.01 && msD < 0.99) open.push({ title: 'Mississippi', leader: msD > 0.5 ? 'Scott Colom' : 'Cindy Hyde-Smith', p: Math.max(msD, 1 - msD) })
        pub.open = open
      }
      return pub
    }
    const k = RACES[m.title]
    const c = counts[m.id]
    const sorted = Float32Array.from(finals.get(m.id)!).sort()
    const lf = Float32Array.from(lefts.get(m.id)!).sort()
    pub.state = k.state
    pub.pct = c.pct
    pub.votes = c.a + c.b
    pub.left = { mid: Math.round(quantile(lf, 0.5)), lo: Math.round(quantile(lf, 0.1)), hi: Math.round(quantile(lf, 0.9)) }
    pub.now = (100 * c.a) / Math.max(c.a + c.b, 1)
    pub.share = { p5: 100 * quantile(sorted, 0.05), p10: 100 * quantile(sorted, 0.1), p50: 100 * quantile(sorted, 0.5), p90: 100 * quantile(sorted, 0.9), p95: 100 * quantile(sorted, 0.95) }
    pub.density = density(Float64Array.from(sorted, (x) => x * 100))
    pub.pA = pAWins.get(m.id)! / draws
    pub.note = k.profile.note
    pub.done = k.profile.done
    return pub
  }

  const toMember = (m: LiveMarket): MemberBet => {
    const es = byMarket.get(m.id)!
    const g = gained.get(m.id)!
    const pot = potOf.get(m.id)!
    const seat = m.kind === 'senate_seats' || m.kind === 'house_seats'
    // Identical guesses always win together, so they share a row.
    const groups = new Map<string, BoardRow>()
    es.forEach((e, i) => {
      if (seat ? e.r == null : !e.winner) return
      const guess = seat ? (e.r as number) : (e.shares?.[m.candidates[0].id] ?? 0) / 10
      const key = `${e.winner ?? ''}|${guess}`
      const row = groups.get(key) ?? { names: [], guess, side: e.winner, p: 0 }
      row.names.push(e.name)
      row.p += g[i] / draws
      groups.set(key, row)
    })
    const rows = [...groups.values()].sort((x, y) => y.p - x.p || x.guess - y.guess)
    const top = rows.slice(0, 3)
    const rank = new Map(top.filter((row) => row.p >= 0.005).map((row, i) => [row, i + 1]))
    const refund = nobody.get(m.id)! / draws
    const ticks = rows.flatMap((row) => row.names.map((name) => ({ name, x: row.guess, side: row.side, rank: rank.get(row) ?? null })))
    const refundLeads = refund > (top[0]?.p ?? 0)
    return { id: m.id, rows: top, refund, moneyBack: pot ? moneyBack.get(m.id)! / draws / pot : 0, lean: leanLabel(Math.max(top[0]?.p ?? 0, refund)), refundLeads, ticks }
  }

  // Projected money: dollars that sum to exactly zero across the table.
  const means = net.map((n) => n.reduce((a, b) => a + b, 0) / draws)
  const dollars = roundToTotal(means)
  const bettors: Bettor[] = people.map((u, i) => {
    const sorted = Int32Array.from(net[i]).sort()
    return { name: nameOf.get(u)!, paid: paid[i], net: means[i], lo: quantile(sorted, 0.05), hi: quantile(sorted, 0.95), bets: betsWon[i] / draws, of: entries.filter((e) => e.user === u).length, dollars: dollars[i], density: density(sorted, { soften: 3 }) }
  }).sort((x, y) => y.net - x.net)

  const bets = markets.map(toPublic).sort((a, b) => a.sort_order - b.sort_order)
  const updated = Object.values(counts).map((c) => c.updated).sort().pop() ?? input.fetchedAt
  return {
    pub: { version: 1, fetched_at: input.fetchedAt, updated_at: updated, draws, bets, pot_cents: entries.reduce((a, e) => a + e.cents, 0), people: people.length, unmodeled: input.unmodeled ?? [] },
    members: { bets: markets.map(toMember), bettors },
  }
}
