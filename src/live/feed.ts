// Turns civicAPI's race JSON into the few numbers the model needs. Server-side only (and the test fixture).
import { STATES } from '../domain/states.js'
import { HOUSE_AGGREGATE_ID, MISSISSIPPI, RACES, SENATE_AGGREGATE_ID, type KeyRace } from './config.js'

type FeedCand = { name: string; party: string; votes: number; winner?: boolean }
type FeedRegion = { name?: string; type: string; percent_reporting?: number; election_id?: number; candidates: FeedCand[] }
export type FeedRace = {
  election_name: string; percent_reporting: number; last_updated: string
  candidates: FeedCand[]; region_results: Record<string, FeedRegion>
}

/** What a race has so far, for its two listed candidates. */
export type Count = {
  a: number; b: number
  /** Everyone else's votes, by name. */
  others: Record<string, number>
  pct: number
  /** Two-way votes left adding up the counties, and side A's share of that if each county keeps its current split. */
  countyLeft: number; countyShareA: number
  updated: string
}

export type SeatCount = {
  state: string; key: string
  /** Best Republican and best non-Republican. Null when that side has no candidate, so the seat can't change party. */
  r: number | null; o: number | null
  pct: number
  /** Feed's winner, only for seats with no votes reported (uncontested). */
  uncontestedR: boolean | null
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
const AREA_TYPES = ['County', 'Parish', 'Borough']

export function toCount(race: FeedRace, nameA: string, nameB: string): Count {
  const find = (cs: FeedCand[], n: string) => cs.find((c) => norm(c.name) === norm(n))
  const ca = find(race.candidates, nameA)
  const cb = find(race.candidates, nameB)
  if (!ca || !cb) throw new Error(`${race.election_name}: can't find ${!ca ? nameA : nameB} in the feed`)
  const regions = Object.values(race.region_results ?? {})
  const type = AREA_TYPES.find((t) => regions.some((r) => r.type === t))
  let left = 0
  let leftA = 0
  for (const r of regions.filter((x) => x.type === type)) {
    const p = r.percent_reporting ?? 0
    const a = find(r.candidates, nameA)?.votes ?? 0
    const b = find(r.candidates, nameB)?.votes ?? 0
    if (p <= 0 || p >= 100 || a + b === 0) continue
    const out = (a + b) * (100 / p - 1)
    left += out
    leftA += (out * a) / (a + b)
  }
  const n = ca.votes + cb.votes
  return {
    a: ca.votes, b: cb.votes,
    others: Object.fromEntries(race.candidates.filter((c) => c !== ca && c !== cb && c.votes > 0).map((c) => [c.name, c.votes])),
    pct: race.percent_reporting,
    countyLeft: left,
    countyShareA: left > 0 ? leftA / left : n ? ca.votes / n : 0.5,
    updated: race.last_updated,
  }
}

// House keys look like "ca-23"; Senate breakdown rows are named for the state ("Alaska").
const stateOf = (key: string, name?: string) => {
  const m = /^([a-z]{2})-/.exec(key)
  if (m) return m[1].toUpperCase()
  const found = STATES.find(([, n]) => norm(n) === norm((name ?? '').replace(/ Special$/, '')))
  if (!found) throw new Error(`Unknown state: ${name ?? key}`)
  return found[0]
}

/** Every seat in a chamber, from the national race's per-state or per-district breakdown. */
export function toSeats(aggregate: FeedRace): SeatCount[] {
  return Object.entries(aggregate.region_results).map(([key, reg]) => {
    const isR = (c: FeedCand) => c.party === 'Republican'
    const reps = reg.candidates.filter(isR)
    const rest = reg.candidates.filter((c) => !isR(c))
    const top = (cs: FeedCand[]) => (cs.length ? Math.max(...cs.map((c) => c.votes)) : null)
    const total = reg.candidates.reduce((a, c) => a + c.votes, 0)
    const winner = reg.candidates.find((c) => c.winner)
    return {
      key, state: stateOf(key, reg.name),
      r: top(reps), o: top(rest), pct: reg.percent_reporting ?? 0,
      uncontestedR: total === 0 ? (winner ? isR(winner) : reps.length > 0 && rest.length === 0) : null,
    }
  })
}

export type RawFeed = { races: Record<number, FeedRace>; fetchedAt: string }

export const FEED_RACE_IDS = [...Object.values(RACES).map((k: KeyRace) => k.raceId), MISSISSIPPI.raceId, SENATE_AGGREGATE_ID, HOUSE_AGGREGATE_ID]

const UA = 'election-town/1.0 (friends prediction pool)'

/** 16 requests, once an hour. A failure on any race stops the run so the last good estimate stays up. */
export async function fetchFeed(get: typeof fetch = fetch): Promise<Record<number, FeedRace>> {
  const out: Record<number, FeedRace> = {}
  for (const id of FEED_RACE_IDS) {
    const r = await get(`https://civicapi.org/api/v2/race/${id}`, { headers: { accept: 'application/json', 'user-agent': UA } })
    if (!r.ok) throw new Error(`civicAPI responded ${r.status} for race ${id}`)
    out[id] = (await r.json()) as FeedRace
  }
  return out
}
