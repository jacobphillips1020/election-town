// The polling refresh decision logic, separated from Supabase/Vercel so it can be tested.
import { pollingPageUrl, type PollingRef } from '../domain/states.js'
import type { Snapshot } from './pollingsource.js'

export const REFRESH_MS = 6 * 3600e3

export type SnapshotRow = {
  market_id: string
  source_kind: 'provider'
  source_name: string
  source_url: string
  as_of: string
  data: Snapshot['data']
}

export type RefreshDeps = {
  getMarket(id: string): Promise<{ kind: string; polling_ref: PollingRef | null } | null>
  lastProviderFetch(id: string): Promise<number | null>
  fetchRace(ref: PollingRef): Promise<Snapshot | null>
  insert(row: SnapshotRow): Promise<void>
  now?: () => number
}

export type RefreshResult = 'no-race-link' | 'fresh' | 'refreshed' | 'no-average'

/**
 * Called right after a race is proposed (and again, at most every 6 hours, whenever someone opens it).
 * A race with no published average is recorded as an explicit "none yet" snapshot, so the 6-hour
 * limit still applies and the provider isn't asked again on every page view.
 */
export async function refreshSnapshot(d: RefreshDeps, marketId: string): Promise<RefreshResult> {
  const now = d.now?.() ?? Date.now()
  const m = await d.getMarket(marketId)
  if (!m?.polling_ref || m.kind === 'congress') return 'no-race-link'

  const last = await d.lastProviderFetch(marketId)
  if (last !== null && now - last < REFRESH_MS) return 'fresh'

  const snap = await d.fetchRace(m.polling_ref)
  if (!snap) {
    await d.insert({
      market_id: marketId, source_kind: 'provider', source_name: 'PollingSource average (pollingsource.com)',
      source_url: pollingPageUrl(m.polling_ref), as_of: new Date(now).toISOString().slice(0, 10),
      data: { candidates: [], note: 'No polling average has been published for this race yet.' },
    })
    return 'no-average'
  }
  await d.insert({
    market_id: marketId, source_kind: 'provider', source_name: snap.source_name, source_url: snap.source_url,
    as_of: snap.as_of || new Date(now).toISOString().slice(0, 10), data: snap.data,
  })
  return 'refreshed'
}
