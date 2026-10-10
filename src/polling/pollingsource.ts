// PollingSource adapter (server-side use only; imported by api/polling-refresh.ts).
//
// What the vendor documents (https://pollingsource.com/api/v1/index.php, checked 2026-10-09):
//   GET /api/v1/races?race_type=senate|governor|house
//   GET /api/v1/race?race_type=...&state=XX[&district=N]      JSON
// What it does NOT document: authentication method, the full response schema, rate limits,
// and whether storing/caching the data is permitted. Until those are confirmed in writing,
// this adapter refuses to fetch rather than guess.

export type RaceRef = { race_type: 'senate' | 'governor' | 'house'; state: string; district?: string | null }

export class ProviderNotVerified extends Error {}

export function buildRaceUrl(ref: RaceRef): string {
  const u = new URL('https://pollingsource.com/api/v1/race')
  u.searchParams.set('race_type', ref.race_type)
  u.searchParams.set('state', ref.state.toUpperCase())
  if (ref.race_type === 'house' && ref.district) u.searchParams.set('district', String(ref.district))
  return u.toString()
}

export type Snapshot = {
  source_name: string
  source_url: string
  as_of: string
  data: { candidates: { name: string; party?: string; pct: number }[]; undecided?: number | null; other?: number | null; note?: string }
}

/** Intentionally not implemented: see the header comment. */
export async function fetchRace(_ref: RaceRef, _apiKey: string): Promise<Snapshot> {
  throw new ProviderNotVerified(
    'PollingSource auth method and response schema are not documented. Confirm them with the vendor, then implement this function against a real response.',
  )
}
