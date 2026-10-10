// Seat forecasts from prediction markets (Polymarket's public data feed: no key, read-only).
// Server-side only (api/polling-cron.ts and api/polling.ts). Two requests per chamber, at most every 6 hours.
//
// Verified 2026-10-10:
//   GET https://gamma-api.polymarket.com/events?slug=<slug>
//   -> [{ title, markets: [{ groupItemTitle: '≤47' | '48' | '57+' | 'Below 190' | '190-194' | '230+',
//                            outcomePrices: '["0.385","0.615"]', bestBid, bestAsk, lastTradePrice, active, closed }] }]
// The seat events ask "Republican seats after the 2026 midterm elections?" — the same question as the ballot's seat picks.

export const FORECAST_MS = 6 * 3600e3

export const FORECAST_EVENTS = {
  senate: {
    seats: 'republican-senate-seats-after-the-2026-midterm-elections-927',
    control: 'which-party-will-win-the-senate-in-2026',
    total: 100,
  },
  house: {
    seats: 'republican-house-seats-after-the-2026-midterm-elections',
    control: 'which-party-will-win-the-house-in-2026',
    total: 435,
  },
} as const

export type Chamber = keyof typeof FORECAST_EVENTS
export type Bucket = { label: string; lo: number; hi: number; p: number }
export type ForecastRow = {
  chamber: Chamber
  source_name: string
  source_url: string
  r_median: number | null
  d_control_pct: number | null
  buckets: Bucket[]
  fetched_at: string
}

type RawMarket = {
  groupItemTitle?: string; question?: string; outcomePrices?: string
  bestBid?: number; bestAsk?: number; lastTradePrice?: number; active?: boolean; closed?: boolean
}
type RawEvent = { slug?: string; markets?: RawMarket[] }

/** "≤47" -> 0..47, "48" -> 48..48, "57+" -> 57..total, "Below 190" -> 0..189, "190-194" -> 190..194. */
export function parseRange(label: string, total: number): { lo: number; hi: number } | null {
  const s = label.replace(/\s+/g, ' ').trim()
  let m: RegExpMatchArray | null
  if ((m = s.match(/^(?:≤|<=|at most |up to )(\d+)$/i))) return { lo: 0, hi: +m[1] }
  if ((m = s.match(/^(?:below|under|fewer than|less than|<) ?(\d+)$/i))) return { lo: 0, hi: +m[1] - 1 }
  if ((m = s.match(/^(\d+) ?(?:\+|or more)$/i)) || (m = s.match(/^(?:≥|>=|at least )(\d+)$/i))) return { lo: +m[1], hi: total }
  if ((m = s.match(/^(\d+) ?[-–] ?(\d+)$/))) return { lo: +m[1], hi: +m[2] }
  if ((m = s.match(/^(\d+)$/))) return { lo: +m[1], hi: +m[1] }
  return null
}

/** A market's "Yes" probability: the bid/ask midpoint when both exist, else the listed price, else the last trade. */
export function priceOf(m: RawMarket): number | null {
  if (typeof m.bestBid === 'number' && typeof m.bestAsk === 'number' && m.bestAsk > 0 && m.bestAsk >= m.bestBid) {
    return (m.bestBid + m.bestAsk) / 2
  }
  try {
    const p = Number(JSON.parse(m.outcomePrices ?? '[]')[0])
    if (Number.isFinite(p)) return p
  } catch {
    /* fall through */
  }
  return typeof m.lastTradePrice === 'number' ? m.lastTradePrice : null
}

/** Seat buckets with probabilities normalized to sum to 1, lowest seats first. */
export function parseSeatEvent(json: unknown, total: number): Bucket[] {
  const ev = (Array.isArray(json) ? json[0] : json) as RawEvent | undefined
  if (!ev?.markets?.length) throw new Error('Unexpected event shape')
  const rows = ev.markets.flatMap((m) => {
    if (m.closed || m.active === false) return []
    const label = (m.groupItemTitle ?? '').trim()
    const range = parseRange(label, total)
    const p = priceOf(m)
    return range && p !== null && p >= 0 ? [{ label, ...range, p }] : []
  })
  const sum = rows.reduce((t, r) => t + r.p, 0)
  if (rows.length < 3 || sum <= 0) throw new Error('Not enough priced seat ranges')
  return rows.map((r) => ({ ...r, p: Math.round((r.p / sum) * 10000) / 10000 })).sort((a, b) => a.lo - b.lo)
}

/**
 * Median Republican seats, spreading each range's probability evenly over its seats. Open-ended ranges
 * ("≤47", "230+") are treated as 5 seats wide at their edge, which only matters if the median falls inside one.
 */
export function medianSeats(buckets: Bucket[]): number | null {
  let cum = 0
  for (const b of buckets) {
    const first = b.lo === 0 && b.hi > 5 ? b.hi - 4 : b.lo
    const last = b.hi - b.lo > 20 && b.lo > 0 ? b.lo + 4 : b.hi
    if (cum + b.p >= 0.5) {
      const width = last - first + 1
      const frac = b.p > 0 ? (0.5 - cum) / b.p : 0
      return Math.round((first + frac * width - 0.5) * 10) / 10
    }
    cum += b.p
  }
  return null
}

/** Chance (0-100) that Democrats win the chamber, from the party-control event. */
export function parseControl(json: unknown): number | null {
  const ev = (Array.isArray(json) ? json[0] : json) as RawEvent | undefined
  const find = (re: RegExp) => ev?.markets?.find((m) => re.test(m.groupItemTitle ?? m.question ?? '') && m.active !== false && !m.closed)
  const d = find(/democrat/i)
  const r = find(/republican/i)
  const pd = d ? priceOf(d) : null
  const pr = r ? priceOf(r) : null
  if (pd === null) return null
  return Math.round((pr !== null && pd + pr > 0 ? pd / (pd + pr) : pd) * 1000) / 10
}

export type ForecastDeps = {
  lastFetch(): Promise<number | null>
  fetchEvent(slug: string): Promise<unknown>
  upsert(rows: ForecastRow[]): Promise<void>
  now?: () => number
}

/** Refreshes both chambers (at most every 6 hours). A chamber whose feed fails keeps its last stored row. */
export async function refreshForecasts(d: ForecastDeps, opts: { force?: boolean } = {}) {
  const now = d.now?.() ?? Date.now()
  const last = await d.lastFetch()
  if (!opts.force && last !== null && now - last < FORECAST_MS) return { status: 'fresh' as const, stored: 0, failed: 0 }
  const rows: ForecastRow[] = []
  let failed = 0
  for (const chamber of ['senate', 'house'] as const) {
    const e = FORECAST_EVENTS[chamber]
    try {
      const buckets = parseSeatEvent(await d.fetchEvent(e.seats), e.total)
      const control = await d.fetchEvent(e.control).then(parseControl).catch(() => null)
      rows.push({
        chamber, source_name: 'Polymarket', source_url: `https://polymarket.com/event/${e.seats}`,
        r_median: medianSeats(buckets), d_control_pct: control, buckets, fetched_at: new Date(now).toISOString(),
      })
    } catch {
      failed++
    }
  }
  if (rows.length) await d.upsert(rows)
  return { status: 'refreshed' as const, stored: rows.length, failed }
}

export async function fetchPolymarketEvent(slug: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const r = await fetchImpl(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`, { headers: { accept: 'application/json' } })
  if (!r.ok) throw new Error(`Polymarket responded ${r.status}`)
  return r.json()
}
