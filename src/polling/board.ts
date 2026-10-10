// Race board: averages for every race the vendor publishes, plus candidate names from its polls.
// Server-side only (used by api/polling.ts and api/polling-cron.ts). Gentle on the vendor:
// 3 list requests per refresh (at most every 12 h), and per-race requests only for names that are
// missing or more than 3 days old.
import { STATES, type PollingRef } from '../domain/states.js'
import { PLACEHOLDER_D, PLACEHOLDER_R, buildRaceUrl, normalizeRace } from './pollingsource.js'

export const BOARD_MS = 12 * 3600e3
export const NAMES_MS = 3 * 24 * 3600e3

export type BoardRow = {
  race_key: string
  race_type: 'senate' | 'governor' | 'house'
  state: string
  district: string | null
  is_special: boolean
  dem_avg: number | null
  rep_avg: number | null
  margin_label: string | null
  rating: string | null
  poll_count: number
  last_poll_date: string | null
  page: string | null
  fetched_at: string
  dem_name?: string | null
  rep_name?: string | null
  names_fetched_at?: string | null
  experts?: Expert[] | null
}

/** One forecaster's rating as the vendor publishes it, e.g. { source: 'Cook Political Report', rating: 'Toss Up' }. */
export type Expert = { source: string; rating: string }
type Known = { dem_name: string | null; rep_name: string | null; names_fetched_at: string | null; experts?: Expert[] | null }
type Detail = { dem: string | null; rep: string | null; experts?: Expert[] | null }

export const raceKey = (t: string, s: string, d: string | null, special: boolean) => `${t}:${s}:${d ?? ''}:${special ? 1 : 0}`

const STATE_CODES = new Set(STATES.map(([c]) => c))
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Parses GET /api/v1/races?race_type=... (vendor numbers at-large House seats 0). */
export function parseRaceList(json: unknown, nowIso: string): BoardRow[] {
  const races = (json as { races?: Record<string, unknown>[] })?.races
  if (!Array.isArray(races)) throw new Error('Unexpected race list shape')
  return races.flatMap((r) => {
    const t = r.race_type
    if (t !== 'senate' && t !== 'governor' && t !== 'house') return []
    const state = String(r.state ?? '').toUpperCase()
    if (!STATE_CODES.has(state)) return []
    let district: string | null = null
    if (t === 'house') {
      const d = Number(r.district)
      if (!Number.isInteger(d) || d < 0 || d > 53) return []
      district = d === 0 ? 'AL' : String(d).padStart(2, '0')
    }
    const special = Boolean(r.is_special)
    return [{
      race_key: raceKey(t, state, district, special), race_type: t, state, district, is_special: special,
      dem_avg: num(r.dem_average), rep_avg: num(r.rep_average),
      margin_label: typeof r.margin_label === 'string' ? r.margin_label : null,
      rating: typeof r.rating === 'string' ? r.rating : null,
      poll_count: Number(r.poll_count ?? 0) || 0,
      last_poll_date: typeof r.last_poll_date === 'string' ? r.last_poll_date.slice(0, 10) : null,
      page: typeof r.page === 'string' ? r.page : null,
      fetched_at: nowIso,
    }]
  })
}

export type BoardDeps = {
  lastBoardFetch(): Promise<number | null>
  fetchList(type: 'senate' | 'governor' | 'house'): Promise<unknown>
  existingNames(): Promise<Map<string, Known>>
  fetchNames(ref: PollingRef): Promise<Detail>
  upsert(rows: BoardRow[]): Promise<void>
  now?: () => number
}

export async function refreshBoard(d: BoardDeps, opts: { force?: boolean; concurrency?: number } = {}) {
  const now = d.now?.() ?? Date.now()
  const last = await d.lastBoardFetch()
  if (!opts.force && last !== null && now - last < BOARD_MS) return { status: 'fresh' as const, races: 0, names: 0, failed: 0 }

  const nowIso = new Date(now).toISOString()
  const rows: BoardRow[] = []
  for (const t of ['senate', 'governor', 'house'] as const) rows.push(...parseRaceList(await d.fetchList(t), nowIso))

  const known = await d.existingNames()
  const todo = rows.filter((r) => {
    const k = known.get(r.race_key)
    const keep = { dem_name: k?.dem_name ?? null, rep_name: k?.rep_name ?? null, names_fetched_at: k?.names_fetched_at ?? null, experts: k?.experts ?? null }
    Object.assign(r, keep)
    // Ask again when names are missing or stale, or when this race's detail was never read for expert ratings
    // (null = never read; [] = read, none published).
    return !(k?.dem_name && k.rep_name && k.names_fetched_at && now - Date.parse(k.names_fetched_at) < NAMES_MS && k.experts != null)
  })

  let i = 0
  let names = 0
  let failed = 0
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, todo.length) }, async () => {
    while (i < todo.length) {
      const r = todo[i++]
      try {
        const n = await d.fetchNames({ race_type: r.race_type, state: r.state, district: r.district, special: r.is_special })
        r.dem_name = n.dem ?? r.dem_name ?? null
        r.rep_name = n.rep ?? r.rep_name ?? null
        r.experts = n.experts ?? r.experts ?? null
        r.names_fetched_at = nowIso
        names++
      } catch {
        failed++
      }
    }
  }))
  await d.upsert(rows)
  return { status: 'refreshed' as const, races: rows.length, names, failed }
}

/** Parses the expert ratings in a race detail response (Cook, Inside Elections, Sabato); [] when none are published. */
export function parseExperts(json: unknown): Expert[] {
  const list = (json as { expert_ratings?: unknown })?.expert_ratings
  if (!Array.isArray(list)) return []
  return list.flatMap((e) => {
    const source = typeof e?.source === 'string' ? e.source.trim() : ''
    const rating = typeof e?.rating === 'string' ? e.rating.trim() : ''
    return source && rating ? [{ source: source.slice(0, 60), rating: rating.slice(0, 40) }] : []
  })
}

/** Candidate names (from the vendor's recent polls) and expert ratings for one race; null when not published. */
export async function fetchNames(ref: PollingRef, fetchImpl: typeof fetch = fetch): Promise<Detail> {
  const res = await fetchImpl(buildRaceUrl(ref), { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`PollingSource responded ${res.status}`)
  const json = await res.json()
  const s = normalizeRace(json, ref)
  const [d, r] = s?.data.candidates ?? []
  return {
    dem: d && d.name !== PLACEHOLDER_D ? d.name : null,
    rep: r && r.name !== PLACEHOLDER_R ? r.name : null,
    experts: parseExperts(json),
  }
}
