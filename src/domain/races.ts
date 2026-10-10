// Every 2026 Senate, governor, and House race (identifiers only; no candidates or polling numbers).
// Structure is fixed by the election calendar and apportionment; `polled` marks races PollingSource
// currently publishes an average for. Generated 2026-10-10 and cross-checked against the vendor's list.
import raw from './races-2026.json'
import { stateName, type PollingRef } from './states'

export type RaceKind = 'senate' | 'governor' | 'house'
export type RaceEntry = { kind: RaceKind; state: string; district: string | null; special: boolean; polled: boolean }

const KIND: Record<string, RaceKind> = { s: 'senate', g: 'governor', h: 'house' }

export const RACES: RaceEntry[] = (raw.races as [string, string, string | null, number, number][]).map(
  ([t, state, district, special, polled]) => ({ kind: KIND[t], state, district, special: special === 1, polled: polled === 1 }),
)

const districtWord = (r: RaceEntry) => (r.district === 'AL' ? 'At-large' : `District ${parseInt(r.district ?? '0', 10)}`)

/** "Utah — Senate", "Utah — District 2", "Ohio — Senate (special election)". */
export function raceLabel(r: RaceEntry): string {
  const s = stateName(r.state)
  if (r.kind === 'house') return `${s} — ${districtWord(r)}`
  return `${s} — ${r.kind === 'senate' ? 'Senate' : 'Governor'}${r.special ? ' (special election)' : ''}`
}

/** Short market title. */
export function raceTitle(r: RaceEntry): string {
  if (r.kind === 'house') return r.district === 'AL' ? `${stateName(r.state)} at-large House` : `${r.state}-${r.district} House`
  return `${stateName(r.state)} ${r.kind === 'senate' ? 'Senate' : 'governor'}${r.special ? ' (special)' : ''}`
}

export const raceKey = (r: Pick<RaceEntry, 'kind' | 'state' | 'district' | 'special'>) =>
  `${r.kind}:${r.state}:${r.district ?? ''}:${r.special ? 1 : 0}`

export const toPollingRef = (r: RaceEntry): PollingRef => ({ race_type: r.kind, state: r.state, district: r.district, special: r.special })

export function findRace(ref: { race_type: string; state: string; district: string | null; special: boolean }): RaceEntry | undefined {
  return RACES.find((r) => r.kind === ref.race_type && r.state === ref.state && r.district === ref.district && r.special === ref.special)
}

/** Races whose state/district/type words all match the query ("utah 2", "oh senate", "ak gov"). */
export function searchRaces(query: string, limit = 12): RaceEntry[] {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (tokens.length === 0) return []
  const words = (r: RaceEntry): string[] => {
    const w = [...stateName(r.state).toLowerCase().split(' '), r.state.toLowerCase()]
    if (r.kind === 'senate') w.push('senate', 'senator')
    if (r.kind === 'governor') w.push('governor', 'gov', 'governors')
    if (r.kind === 'house') w.push('house', 'district', 'congress', r.district === 'AL' ? 'at-large' : String(parseInt(r.district ?? '0', 10)), r.district ?? '')
    if (r.special) w.push('special')
    return w
  }
  const hits = RACES.filter((r) => {
    const w = words(r)
    return tokens.every((t) => w.some((x) => (/^\d+$/.test(t) ? x === t || x === t.padStart(2, '0') : x.startsWith(t))))
  })
  return hits.slice(0, limit)
}

/** Mirrors propose_race(): states whose general election can be decided in a later round. */
export function outcomeBasis(state: string): 'single_round' | 'runoff_final' | 'rcv_final' {
  return state === 'AK' || state === 'ME' ? 'rcv_final' : state === 'GA' ? 'runoff_final' : 'single_round'
}

export function basisSentence(state: string): string {
  const b = outcomeBasis(state)
  return b === 'rcv_final'
    ? 'Settles on the final round of ranked-choice tabulation.'
    : b === 'runoff_final'
      ? 'Settles on the decisive runoff, or on the general election if no runoff is needed.'
      : 'Settles on the certified general-election result.'
}
