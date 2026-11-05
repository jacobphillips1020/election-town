// Supabase wiring for the Results page: read the closed ballots, fetch the counts, run the projection, store it.
import type { SupabaseClient } from '@supabase/supabase-js'
import { HOUSE_AGGREGATE_ID, MISSISSIPPI, RACES, SENATE_AGGREGATE_ID } from '../src/live/config.js'
import { fetchFeed, toCount, toSeats, type Count, type FeedRace } from '../src/live/feed.js'
import { shortName } from '../src/live/names.js'
import { project, type LiveEntry, type LiveInputs, type LiveMarket } from '../src/live/model.js'

type Row = Record<string, unknown>

const isSeat = (m: LiveMarket) => m.kind === 'senate_seats' || m.kind === 'house_seats'

export function buildInputs(allMarkets: LiveMarket[], allEntries: Row[], feed: Record<number, FeedRace>, fetchedAt: string): LiveInputs {
  const withMoney = allMarkets.filter((m) => allEntries.some((e) => e.market_id === m.id))
  // A main-ballot race without a source is a bug, so stop. A side bet without one is left out, and the page says so.
  const missing = withMoney.filter((m) => !isSeat(m) && !RACES[m.title])
  const broken = missing.find((m) => m.featured)
  if (broken) throw new Error(`No results source for ${broken.title}`)
  const markets = withMoney.filter((m) => !missing.includes(m))
  const rawEntries = allEntries.filter((e) => markets.some((m) => m.id === e.market_id))
  const counts: Record<string, Count> = {}
  for (const m of markets) {
    if (isSeat(m)) continue
    counts[m.id] = toCount(feed[RACES[m.title].raceId], m.candidates[0].name, m.candidates[1].name)
  }
  const entries: LiveEntry[] = rawEntries.map((e) => ({
    id: e.id as string, user: e.user_id as string, name: shortName(e.display_name as string), market: e.market_id as string,
    cents: e.commitment_cents as number, winner: (e.winner_id as string | null) ?? null,
    shares: (e.shares as Record<string, number> | null) ?? null, r: (e.seats as { r?: number } | null)?.r ?? null,
  }))
  return {
    markets, entries, counts,
    mississippi: toCount(feed[MISSISSIPPI.raceId], 'Scott Colom', 'Cindy Hyde-Smith'),
    senateSeats: toSeats(feed[SENATE_AGGREGATE_ID]),
    houseSeats: toSeats(feed[HOUSE_AGGREGATE_ID]),
    fetchedAt,
    unmodeled: missing.map((m) => m.title),
  }
}

/** Fetch, estimate, store. Throws without storing anything if the feed or the ballots can't be read. */
export async function refreshLive(db: SupabaseClient, now = new Date()) {
  const feed = await fetchFeed()
  const { data: ms, error: me } = await db.from('markets')
    .select('id, title, kind, sort_order, featured, candidates, status, result_winner_id, result_winner_share_tenths, result_seats')
    .not('status', 'in', '(rejected,canceled,proposed)').order('sort_order')
  if (me || !ms?.length) throw new Error('Could not read the bets')
  const markets: LiveMarket[] = ms.map((m) => ({
    id: m.id, title: m.title, kind: m.kind, sort_order: m.sort_order, featured: m.featured, candidates: m.candidates,
    official: m.result_winner_id || m.result_seats
      ? { winner: m.result_winner_id, share: m.result_winner_share_tenths, r: (m.result_seats as { r?: number } | null)?.r ?? null } : null,
  }))
  const { data: es, error: ee } = await db.from('entries').select('id, user_id, market_id, commitment_cents, winner_id, shares, seats').in('market_id', markets.map((m) => m.id))
  if (ee || !es) throw new Error('Could not read the ballots')
  const { data: ps, error: pe } = await db.from('profiles').select('user_id, display_name').in('user_id', [...new Set(es.map((e) => e.user_id))])
  if (pe || !ps) throw new Error('Could not read names')
  const names = new Map(ps.map((p) => [p.user_id, p.display_name]))
  const fetchedAt = now.toISOString()
  const { pub, members } = project(buildInputs(markets, es.map((e) => ({ ...e, display_name: names.get(e.user_id) ?? 'Someone' })), feed, fetchedAt))
  const { error } = await db.from('live_snapshots').insert({ fetched_at: fetchedAt, public: pub, members })
  if (error) throw new Error('Could not store the estimate')
  return { people: pub.people, needle: pub.needle }
}

export const MIN_GAP_MS = 20 * 60e3
export async function ranRecently(db: SupabaseClient, now = Date.now()) {
  const { data } = await db.from('live_snapshots').select('fetched_at').order('fetched_at', { ascending: false }).limit(1)
  return !!data?.[0] && now - new Date(data[0].fetched_at).getTime() < MIN_GAP_MS
}
