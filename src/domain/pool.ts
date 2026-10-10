// The main pool: shapes returned by get_pool(), the ballot draft, colors, and research links.
import type { BoardPolling } from './board'
import { parseTenths } from './race'
import { stateName } from './states'
import type { Candidate, Market } from './types'
import type { Side } from './senate'

export type Expert = { source: string; rating: string }
export type RacePolling = BoardPolling & { experts: Expert[] | null }
export type Tally = {
  /** ballots that made this pick (blank picks excluded) */
  n: number
  blank: number
  picks: Record<string, number>
  mean_shares: Record<string, number>
  r_mean: number | null
  r_median: number | null
  r_min: number | null
  r_max: number | null
}
export type PoolMarket = Market & { polling: RacePolling | null; tally: Tally | null }
export type Forecast = {
  source_name: string
  source_url: string
  r_median: number | null
  d_control_pct: number | null
  buckets: { label: string; lo: number; hi: number; p: number }[]
  fetched_at: string
}
export type SenateRow = { state: string; special: boolean; polling: RacePolling | null; market: { id: string; featured: boolean } | null }
export type BallotEntry = { winner_id: string | null; shares: Record<string, number> | null; seats: { r: number } | null }
export type GridBallot = { you: boolean; picks: Record<string, { w?: string; s?: number; r?: number }> }
export type Pool = {
  deadline: string | null
  closed: boolean
  ballot_cents: number
  ballots: number
  pot_cents: number
  pay_note: string | null
  my_ballot: Record<string, BallotEntry> | null
  my_updated_at: string | null
  markets: PoolMarket[]
  ballots_grid: GridBallot[] | null
  senate: SenateRow[]
  house_polls: { state: string; district: string | null; margin: number }[]
  forecasts: { senate?: Forecast; house?: Forecast }
  polling_fetched_at: string | null
}

export const isSeat = (m: Pick<Market, 'kind'>) => m.kind === 'senate_seats' || m.kind === 'house_seats'
export const seatTotal = (m: Pick<Market, 'kind'>) => (m.kind === 'senate_seats' ? 100 : 435)
export const sideOf = (c: Pick<Candidate, 'party'> | undefined): Side => (c?.party === 'R' ? 'R' : c?.party === 'I' ? 'I' : 'D')

// ---------------------------------------------------------------- the ballot draft

/** What the form holds: a race's winner + share ("51.5"), or a seat count ("48"). Strings while typing. */
export type PickDraft = { winner?: string; share?: string; r?: string; touched?: boolean }
export type Draft = Record<string, PickDraft>

const fmt1 = (tenths: number) => (tenths / 10).toFixed(1)

export function draftFromBallot(b: Record<string, BallotEntry> | null | undefined): Draft {
  const d: Draft = {}
  for (const [id, e] of Object.entries(b ?? {})) {
    if (e.seats) d[id] = { r: String(e.seats.r), touched: true }
    else if (e.winner_id && e.shares) d[id] = { winner: e.winner_id, share: fmt1(e.shares[e.winner_id]) }
  }
  return d
}

export type PickCheck = { ok: true; value: Record<string, unknown> } | { ok: false; reason: string }

/** Turns one drafted pick into what submit_ballot / submit_entry take. Shares are of the two-candidate vote. */
export function checkPick(m: Pick<Market, 'kind' | 'candidates'>, d: PickDraft | undefined): PickCheck {
  if (isSeat(m)) {
    const s = (d?.r ?? '').trim()
    if (!/^\d{1,3}$/.test(s) || +s > seatTotal(m)) return { ok: false, reason: `Enter a whole number from 0 to ${seatTotal(m)}` }
    return { ok: true, value: { seats: { r: +s } } }
  }
  const w = d?.winner
  const other = m.candidates.find((c) => c.id !== w)
  if (!w || !other || !m.candidates.some((c) => c.id === w)) return { ok: false, reason: 'Pick a winner' }
  const t = parseTenths(d?.share ?? '')
  if (t === null) return { ok: false, reason: 'Enter the winner’s share, like 51.5' }
  if (t <= 500) return { ok: false, reason: 'The winner’s share must be over 50%' }
  if (t >= 1000) return { ok: false, reason: 'The winner’s share must be under 100%' }
  return { ok: true, value: { winner_id: w, shares: { [w]: t, [other.id]: 1000 - t } } }
}

/** Nothing entered for this pick: it goes in blank (the stake still counts; it can't win). */
export function isBlank(m: Pick<Market, 'kind'>, d: PickDraft | undefined): boolean {
  return isSeat(m) ? !(d?.r ?? '').trim() : !d?.winner
}

export function buildBallot(markets: PoolMarket[], d: Draft) {
  const picks: Record<string, Record<string, unknown>> = {}
  const problems: { m: PoolMarket; reason: string }[] = []
  const skipped: PoolMarket[] = []
  for (const m of markets.filter((x) => x.phase === 'open')) {
    if (isBlank(m, d[m.id])) { picks[m.id] = {}; skipped.push(m); continue }
    const c = checkPick(m, d[m.id])
    if (c.ok) picks[m.id] = c.value
    else problems.push({ m, reason: c.reason })
  }
  return { picks, problems, skipped }
}

/** Two-way polling share for each listed candidate (first listed = the Democratic/independent slot). */
export function twoWay(m: Pick<Market, 'candidates'>, p: BoardPolling | null): Record<string, number> | null {
  if (p?.dem_avg == null || p.rep_avg == null || p.dem_avg + p.rep_avg <= 0) return null
  const [a, b] = m.candidates
  if (!a || !b) return null
  const left = (p.dem_avg / (p.dem_avg + p.rep_avg)) * 100
  return { [a.id]: Math.round(left * 10) / 10, [b.id]: Math.round((100 - left) * 10) / 10 }
}

/** "Wins by 3.0" for a two-way share. */
export const winsBy = (sharePct: number) => `wins by ${(2 * sharePct - 100).toFixed(1)}`

// ---------------------------------------------------------------- colors (solid / likely / lean / toss-up)

export const PALETTE: Record<Side, [string, string, string]> = {
  D: ['#a9c0ea', '#5f88cf', '#1d4f9f'],
  R: ['#eeb0a8', '#d66b5e', '#b42318'],
  I: ['#ecd9a0', '#cfa944', '#8a6a14'],
}
export const TOSSUP = '#d8cdaa'
export const NO_RACE = '#ebe6d9'

/** level 0 = toss-up, 1 lean, 2 likely, 3 solid */
export function tone(side: Side | null, level: number): string {
  if (!side || level <= 0) return TOSSUP
  return PALETTE[side][Math.min(level, 3) - 1]
}
/** Text that reads on a tile of that color. */
export const inkOn = (fill: string) => (['#1d4f9f', '#b42318', '#8a6a14', '#5f88cf', '#d66b5e'].includes(fill) ? '#fff' : '#16181d')

/** Poll margin (points) -> level. Under 3 is a toss-up, like the polling source's own ratings. */
export const levelFromMargin = (m: number) => (Math.abs(m) < 3 ? 0 : Math.abs(m) < 6 ? 1 : Math.abs(m) < 10 ? 2 : 3)
/** A personal pick always has a side: lean / likely / solid by the margin picked. */
export const levelFromPick = (sharePct: number) => { const m = 2 * sharePct - 100; return m < 5 ? 1 : m < 10 ? 2 : 3 }
/** Group consensus (share of ballots picking the leader) -> level, like the 2024 composite map. */
export const levelFromConsensus = (p: number) => (p >= 0.9 ? 3 : p >= 0.75 ? 2 : p >= 0.6 ? 1 : 0)

// ---------------------------------------------------------------- research links

const wiki = (s: string) => `https://en.wikipedia.org/wiki/${s.replace(/ /g, '_')}`

export function raceLinks(m: Pick<Market, 'polling_ref'>, pollingPage?: string | null): { label: string; href: string }[] {
  const r = m.polling_ref
  if (!r) return []
  const name = stateName(r.state)
  const out: { label: string; href: string }[] = []
  if (pollingPage) out.push({ label: 'Polls', href: pollingPage })
  if (r.race_type === 'senate') {
    const kind = r.special ? 'special election' : 'election'
    out.push({ label: 'Wikipedia', href: wiki(`2026 United States Senate ${kind} in ${name}`) })
    out.push({ label: 'Ballotpedia', href: `https://ballotpedia.org/${`United States Senate ${kind} in ${name}, 2026`.replace(/ /g, '_')}` })
  } else if (r.race_type === 'governor') {
    out.push({ label: 'Wikipedia', href: wiki(`2026 ${name} gubernatorial election`) })
    out.push({ label: 'Ballotpedia', href: `https://ballotpedia.org/${`${name} gubernatorial election, 2026`.replace(/ /g, '_')}` })
  } else {
    out.push({ label: 'Wikipedia', href: wiki(`2026 United States House of Representatives elections in ${name}`) })
  }
  return out
}

export const RATINGS_LINKS = {
  senate: [
    { label: 'Cook', href: 'https://www.cookpolitical.com/ratings/senate-race-ratings' },
    { label: 'Sabato', href: 'https://centerforpolitics.org/crystalball/2026-senate/' },
    { label: 'Inside Elections', href: 'https://insideelections.com/ratings/senate' },
  ],
  house: [
    { label: 'Cook', href: 'https://www.cookpolitical.com/ratings/house-race-ratings' },
    { label: 'Sabato', href: 'https://centerforpolitics.org/crystalball/2026-house/' },
    { label: 'Inside Elections', href: 'https://insideelections.com/ratings/house' },
  ],
}

/** "Cook Political Report" -> "Cook", "Sabato's Crystal Ball" -> "Sabato", "Inside Elections" -> "Inside". */
export const expertShort = (s: string) => (/cook/i.test(s) ? 'Cook' : /sabato/i.test(s) ? 'Sabato' : /inside/i.test(s) ? 'Inside' : s.split(' ')[0])
