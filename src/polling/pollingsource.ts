// PollingSource adapter (server-side only; imported by api/polling.ts).
//
// Verified 2026-10-09 against the live documented endpoint (one race, no credential sent):
//   GET https://pollingsource.com/api/v1/race?race_type=senate|governor|house&state=XX[&district=N]
//   -> { race: { race_type, state, district, is_special, dem_average, rep_average, poll_count,
//                last_poll_date, page, ... }, recent_polls: { polls: [{ dem_candidate, rep_candidate, ... }] }, attribution }
// The averages are Democratic and Republican only. Averages are null when a race has no polls yet.
// Not established with the vendor: whether automated use / caching is permitted. Hence the
// POLLINGSOURCE_ENABLED switch in api/polling.ts, which ships OFF.

import type { PollingRef } from '../domain/states'

export class RaceMismatch extends Error {}

export function buildRaceUrl(ref: PollingRef): string {
  const u = new URL('https://pollingsource.com/api/v1/race')
  u.searchParams.set('race_type', ref.race_type)
  u.searchParams.set('state', ref.state.toUpperCase())
  if (ref.race_type === 'house' && ref.district) u.searchParams.set('district', ref.district === 'AL' ? 'AL' : String(parseInt(ref.district, 10)))
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
    String(r.district ?? '').toUpperCase() === (ref.district === 'AL' ? 'AL' : String(parseInt(ref.district ?? '', 10)))
  if (r.race_type !== ref.race_type || String(r.state).toUpperCase() !== ref.state.toUpperCase() || !sameDistrict ||
      Boolean(r.is_special) !== Boolean(ref.special)) {
    throw new RaceMismatch('The polling source returned a different race than the one requested')
  }
  if (typeof r.dem_average !== 'number' || typeof r.rep_average !== 'number') return null
  const first = (json as Raw).recent_polls?.polls?.[0]
  const count = Number(r.poll_count ?? 0)
  return {
    source_name: (json as Raw).attribution?.cite_as ?? 'PollingSource average (pollingsource.com)',
    source_url: String(r.page ?? ''),
    as_of: String(r.last_poll_date ?? '').slice(0, 10),
    data: {
      candidates: [
        { name: first?.dem_candidate || 'Democratic candidate', party: 'D', pct: r.dem_average },
        { name: first?.rep_candidate || 'Republican candidate', party: 'R', pct: r.rep_average },
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
