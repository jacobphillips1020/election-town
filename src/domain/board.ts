// Pure helpers for the race board (sorting, labels, rating tones).
import { matchesQuery, raceLabel, type RaceEntry } from './races'

export type BoardPolling = {
  dem_name: string | null
  rep_name: string | null
  dem_avg: number | null
  rep_avg: number | null
  margin_label: string | null
  rating: string | null
  poll_count: number
  last_poll_date: string | null
  page: string | null
  fetched_at: string
}

export type BoardRace = {
  race_type: 'senate' | 'governor' | 'house'
  state: string
  district: string | null
  special: boolean
  polling: BoardPolling | null
  market: { id: string; title: string; phase: string; featured?: boolean } | null
}

export const toEntry = (r: BoardRace): RaceEntry => ({ kind: r.race_type, state: r.state, district: r.district, special: r.special, polled: !!r.polling })
export const boardLabel = (r: BoardRace) => raceLabel(toEntry(r))
export const boardKey = (r: BoardRace) => `${r.race_type}:${r.state}:${r.district ?? ''}:${r.special ? 1 : 0}`
export const hasAverage = (r: BoardRace) => r.polling?.dem_avg != null && r.polling?.rep_avg != null

const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv)$/i
/** "Karrin Taylor Robson" -> "Robson"; "Raphael Warnock Jr." -> "Warnock". */
export function lastName(full: string | null | undefined, fallback: string): string {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean)
  while (parts.length > 1 && SUFFIX.test(parts[parts.length - 1].replace(/,$/, ''))) parts.pop()
  return parts.length ? parts[parts.length - 1].replace(/,$/, '') : fallback
}

/** Democratic lead in points (negative = Republican lead); null without an average. */
export const marginOf = (r: BoardRace) => (hasAverage(r) ? r.polling!.dem_avg! - r.polling!.rep_avg! : null)

export type Tone = { side: 'D' | 'R' | null; level: 0 | 1 | 2 | 3 }
/** "Safe R" -> R3, "Likely D" -> D2, "Lean D"/"Tilt D" -> D1, "Toss-up" -> neutral. */
export function ratingTone(rating: string | null | undefined): Tone {
  const s = (rating ?? '').toLowerCase()
  if (!s || s.includes('toss')) return { side: null, level: 0 }
  const side = /\bd\b|dem/.test(s) ? 'D' : /\br\b|rep/.test(s) ? 'R' : null
  const level = /safe|solid/.test(s) ? 3 : /likely/.test(s) ? 2 : /lean|tilt/.test(s) ? 1 : 0
  return { side, level: side ? (level as Tone['level']) : 0 }
}

export type BoardView = { query: string; kind: 'all' | BoardRace['race_type']; sort: 'closest' | 'az' }

/** "D+2.5", "R+13.0", "Tied", from the published averages. */
export function marginText(r: BoardRace): string | null {
  const m = marginOf(r)
  if (m === null) return null
  const a = Math.round(Math.abs(m) * 10) / 10
  return a === 0 ? 'Tied' : `${m > 0 ? 'D' : 'R'}+${a.toFixed(1)}`
}

/**
 * Default view: races with a polling average, closest first. Races backed by at least two polls come
 * before single-poll races, so a lone old poll doesn't outrank a well-polled close race.
 * A search also shows races without polling.
 */
export function viewRaces(all: BoardRace[], v: BoardView): BoardRace[] {
  const searching = v.query.trim() !== ''
  const rows = all.filter((r) => (v.kind === 'all' || r.race_type === v.kind) && (searching ? matchesQuery(toEntry(r), v.query) : hasAverage(r)))
  const az = (a: BoardRace, b: BoardRace) => boardLabel(a).localeCompare(boardLabel(b))
  return rows.sort((a, b) => {
    if (v.sort === 'az') return az(a, b)
    const ma = marginOf(a), mb = marginOf(b)
    if (ma === null || mb === null) return ma === null && mb === null ? az(a, b) : ma === null ? 1 : -1
    const ta = a.polling!.poll_count >= 2 ? 0 : 1, tb = b.polling!.poll_count >= 2 ? 0 : 1
    return ta - tb || Math.abs(ma) - Math.abs(mb) || (b.polling!.poll_count - a.polling!.poll_count) || az(a, b)
  })
}
