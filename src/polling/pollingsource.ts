// PollingSource adapter (server-side only; imported by api/polling.ts).
//
// Verified 2026-10-09 against the live documented endpoint (one race, no credential sent):
//   GET https://pollingsource.com/api/v1/race?race_type=senate|governor|house&state=XX[&district=N]
//   -> { race: { race_type, state, district, is_special, dem_average, rep_average, poll_count,
//                last_poll_date, page, ... }, recent_polls: { polls: [{ dem_candidate, rep_candidate, ... }] }, attribution }
// The averages are Democratic and Republican only. Averages are null when a race has no polls yet.
// Not established with the vendor in writing: whether automated use / caching is permitted. Usage is kept
// small (one request per race per 6 hours, cached for everyone) and api/polling.ts has a kill switch.

import type { PollingRef } from '../domain/states.js'

export class RaceMismatch extends Error {}

/** Used when the source gives an average but no candidate names. The organizer must replace these before a race opens. */
export const PLACEHOLDER_D = 'Democratic nominee (to be confirmed)'
export const PLACEHOLDER_R = 'Republican nominee (to be confirmed)'

export function buildRaceUrl(ref: PollingRef): string {
  const u = new URL('https://pollingsource.com/api/v1/race')
  u.searchParams.set('race_type', ref.race_type)
  u.searchParams.set('state', ref.state.toUpperCase())
  // The vendor numbers at-large seats 0.
  if (ref.race_type === 'house' && ref.district) u.searchParams.set('district', ref.district === 'AL' ? '0' : String(parseInt(ref.district, 10)))
  return u.toString()
}

export type Snapshot = {
  source_name: string
  source_url: string
  as_of: string
  data: { candidates: { name: string; party?: string; pct: number }[]; undecided?: number | null; other?: number | null; note?: string }
}

type Raw = {
  race?: Record<string, unknown>
  recent_polls?: { polls?: { dem_candidate?: string; rep_candidate?: string }[] }
  attribution?: { cite_as?: string }
}

/** Returns null when the race has no average yet. Throws RaceMismatch if the response isn't the race we asked for. */
export function normalizeRace(json: unknown, ref: PollingRef): Snapshot | null {
  const r = (json as Raw)?.race
  if (!r) throw new RaceMismatch('Unexpected response shape')
  const sameDistrict =
    ref.race_type !== 'house' ||
    String(r.district ?? '') === (ref.district === 'AL' ? '0' : String(parseInt(ref.district ?? '', 10)))
  if (r.race_type !== ref.race_type || String(r.state).toUpperCase() !== ref.state.toUpperCase() || !sameDistrict ||
      Boolean(r.is_special) !== Boolean(ref.special)) {
    throw new RaceMismatch('The polling source returned a different race than the one requested')
  }
  if (typeof r.dem_average !== 'number' || typeof r.rep_average !== 'number') return null
  // Candidate names: the most common Democratic/Republican pair across the recent polls.
  const tally = (key: 'dem_candidate' | 'rep_candidate') => {
    const c = new Map<string, number>()
    for (const p of (json as Raw).recent_polls?.polls ?? []) {
      const n = (p[key] ?? '').trim()
      if (n) c.set(n, (c.get(n) ?? 0) + 1)
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  }
  const demName = tally('dem_candidate')
  const repName = tally('rep_candidate')
  const count = Number(r.poll_count ?? 0)
  return {
    source_name: (json as Raw).attribution?.cite_as ?? 'PollingSource average (pollingsource.com)',
    source_url: String(r.page ?? ''),
    as_of: String(r.last_poll_date ?? '').slice(0, 10),
    data: {
      candidates: [
        { name: demName || PLACEHOLDER_D, party: 'D', pct: r.dem_average },
        { name: repName || PLACEHOLDER_R, party: 'R', pct: r.rep_average },
      ],
      note: `Unweighted mean of the newest week of polls (${count} poll${count === 1 ? '' : 's'}). Democratic and Republican only; other candidates and undecided aren't published.`,
    },
  }
}

export async function fetchRace(ref: PollingRef, fetchImpl: typeof fetch = fetch): Promise<Snapshot | null> {
  const res = await fetchImpl(buildRaceUrl(ref), { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`PollingSource responded ${res.status}`)
  return normalizeRace(await res.json(), ref)
}
