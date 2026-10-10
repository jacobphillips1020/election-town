// Vercel function. Server-side only; members only; ships OFF (POLLINGSOURCE_ENABLED must be "true").
//   { action: "lookup",  race: {race_type,state,district,special} }  -> current average for a race (preview on the propose form)
//   { action: "refresh", market_id }                                 -> stores a provider snapshot if the last one is >6h old
// Results are cached for everyone: a refresh writes one snapshot row that all members read.
import { createClient } from '@supabase/supabase-js'
import type { PollingRef } from '../src/domain/states'
import { RaceMismatch, fetchRace } from '../src/polling/pollingsource'

const REFRESH_MS = 6 * 3600e3
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const lookupCache = new Map<string, { at: number; value: unknown }>()

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405)
    if (process.env.POLLINGSOURCE_ENABLED !== 'true') return json({ status: 'disabled' })

    const url = process.env.VITE_SUPABASE_URL
    const anon = process.env.VITE_SUPABASE_ANON_KEY
    if (!url || !anon) return json({ status: 'disabled' })

    // Only signed-in group members may use this.
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /i, '')
    const asUser = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const me = await asUser.rpc('get_me')
    if (me.error || !me.data?.is_member) return json({ error: 'Members only' }, 403)

    const body = (await request.json().catch(() => ({}))) as { action?: string; race?: PollingRef; market_id?: string }

    try {
      if (body.action === 'lookup' && body.race) {
        const key = JSON.stringify(body.race)
        const hit = lookupCache.get(key)
        if (hit && Date.now() - hit.at < REFRESH_MS) return json({ status: 'ok', snapshot: hit.value })
        const snapshot = await fetchRace(body.race)
        lookupCache.set(key, { at: Date.now(), value: snapshot })
        return json({ status: snapshot ? 'ok' : 'no-average', snapshot })
      }

      if (body.action === 'refresh' && body.market_id) {
        const service = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!service) return json({ status: 'disabled' })
        const db = createClient(url, service, { auth: { persistSession: false } })
        const { data: market } = await db.from('markets').select('id, kind, polling_ref').eq('id', body.market_id).single()
        if (!market?.polling_ref || market.kind === 'congress') return json({ status: 'no-race-link' })
        const { data: last } = await db.from('polling_snapshots').select('fetched_at')
          .eq('market_id', body.market_id).eq('source_kind', 'provider').order('fetched_at', { ascending: false }).limit(1)
        if (last?.[0] && Date.now() - new Date(last[0].fetched_at).getTime() < REFRESH_MS) return json({ status: 'fresh' })
        const snap = await fetchRace(market.polling_ref as PollingRef)
        if (!snap) return json({ status: 'no-average' })
        await db.from('polling_snapshots').insert({
          market_id: body.market_id, source_kind: 'provider', source_name: snap.source_name,
          source_url: snap.source_url, as_of: snap.as_of, data: snap.data,
        })
        return json({ status: 'refreshed' })
      }
      return json({ error: 'Unknown action' }, 400)
    } catch (e) {
      // Keep serving the last good snapshot. Nothing sensitive is logged.
      return json({ status: e instanceof RaceMismatch ? 'mismatch' : 'unavailable' })
    }
  },
}
