// Expert race ratings (Cook Political Report, Inside Elections, Sabato's Crystal Ball) for the Senate.
//
// Source: the "Predictions" table on Wikipedia's "2026 United States Senate elections" page, read through the
// official MediaWiki API (free, CC BY-SA, refreshed by editors with each forecaster's own dates). Server-side only.
//
// Why not the forecasters' own sites: Cook's terms prohibit automated access and copying ("any robot, spider, or
// other automatic device") and offer paid licensing instead; their sites also block automated requests. PollingSource's
// "expert_ratings" field was tried first and was stale (it still had Cook at "Solid R" for Alaska).
import { STATES } from '../domain/states.js'

export const RATINGS_MS = 12 * 3600e3
const PAGE = '2026_United_States_Senate_elections'
const UA = 'ElectionTownPool/1.0 (private friends pool; https://github.com/jacobphillips1020/election-town)'

const SOURCE_NAMES: Record<string, string> = { Cook: 'Cook Political Report', IE: 'Inside Elections', Sabato: 'Sabato’s Crystal Ball' }

export type Rating = { source: string; rating: string; as_of: string | null }
export type RatingRow = { race_key: string; ratings: Rating[]; fetched_at: string }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const NAME_TO_CODE = new Map(STATES.map(([code, name]) => [name.toLowerCase(), code]))

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}
const text = (html: string) =>
  decode(html.replace(/<sup[\s\S]*?<\/sup>/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/[\s ]+/g, ' ').trim()
const cells = (row: string, tag: 'th' | 'td') =>
  [...row.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1])

/** "Oct 6, 2026" -> "2026-10-06" */
function isoDate(s: string): string | null {
  const m = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})/)
  const mo = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1
  return m && mo >= 0 ? `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null
}

/** Label as shown on the chips: "Tossup" -> "Toss Up", and the "(flip)" note dropped. */
export function cleanRating(raw: string): string | null {
  const s = raw.replace(/\(flip\)/gi, '').replace(/\s+/g, ' ').trim()
  if (!s || /^[-–—?]+$/.test(s)) return null
  if (/^toss-?\s?up$/i.test(s)) return 'Toss Up'
  return s
}

/** Parses the Predictions table into one row per Senate race, keyed like race_polling ("senate:AK::0"). */
export function parseSenateRatings(html: string, nowIso: string): RatingRow[] {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/g) ?? []
  const headerAt = rows.findIndex((r) => /^State\b/i.test(text(cells(r, 'th')[0] ?? '')))
  if (headerAt < 0) throw new Error('Ratings table not found')
  const head = cells(rows[headerAt], 'th')
  const cols: { at: number; source: string; as_of: string | null }[] = []
  head.forEach((h, j) => {
    const label = text(h)
    const m = label.match(/^(Cook|IE|Sabato)\b\s*(.*)$/)
    if (m && j >= 1) cols.push({ at: j - 1, source: SOURCE_NAMES[m[1]], as_of: isoDate(m[2]) })
  })
  if (!cols.length) throw new Error('Expected forecaster columns are missing')

  const out: RatingRow[] = []
  for (const r of rows.slice(headerAt + 1)) {
    const th = cells(r, 'th')
    if (th.length !== 1) continue
    const label = text(th[0])
    if (/^overall$/i.test(label)) continue
    const special = /\(special\)/i.test(label)
    const code = NAME_TO_CODE.get(label.replace(/\(special\)/i, '').trim().toLowerCase())
    if (!code) continue
    const tds = cells(r, 'td').map(text)
    const ratings = cols.flatMap((c) => {
      const rating = cleanRating(tds[c.at] ?? '')
      return rating ? [{ source: c.source, rating, as_of: c.as_of }] : []
    })
    if (ratings.length) out.push({ race_key: `senate:${code}::${special ? 1 : 0}`, ratings, fetched_at: nowIso })
  }
  return out
}

export type RatingsDeps = {
  lastFetch(): Promise<number | null>
  fetchTable(): Promise<string>
  upsert(rows: RatingRow[]): Promise<void>
  now?: () => number
}

/** Refreshes the ratings (at most every 12 hours). A table that doesn't look right is refused, never half-stored. */
export async function refreshRatings(d: RatingsDeps, opts: { force?: boolean } = {}) {
  const now = d.now?.() ?? Date.now()
  const last = await d.lastFetch()
  if (!opts.force && last !== null && now - last < RATINGS_MS) return { status: 'fresh' as const, races: 0 }
  const rows = parseSenateRatings(await d.fetchTable(), new Date(now).toISOString())
  if (rows.length < 30) throw new Error(`Only ${rows.length} races parsed; not storing`)
  await d.upsert(rows)
  return { status: 'refreshed' as const, races: rows.length }
}

/** The Predictions table's HTML, found by section title (section numbers shift when editors add sections). */
export async function fetchPredictionsTable(fetchImpl: typeof fetch = fetch): Promise<string> {
  const api = (q: string) => `https://en.wikipedia.org/w/api.php?action=parse&page=${PAGE}&format=json&formatversion=2&${q}`
  const get = async (q: string) => {
    const r = await fetchImpl(api(q), { headers: { accept: 'application/json', 'user-agent': UA } })
    if (!r.ok) throw new Error(`Wikipedia responded ${r.status}`)
    return r.json() as Promise<{ parse?: { sections?: { index: string; line: string; level: string }[]; text?: string } }>
  }
  const sections = (await get('prop=sections')).parse?.sections ?? []
  const s = sections.find((x) => x.line.replace(/<[^>]+>/g, '').trim() === 'Predictions' && x.level === '2')
  if (!s) throw new Error('Predictions section not found')
  const html = (await get(`prop=text&section=${s.index}`)).parse?.text
  if (typeof html !== 'string') throw new Error('Unexpected response shape')
  return html
}
