// Vercel function: refreshes cached polling for one race, at most every 6 hours, for everyone.
// The provider key and the service-role key live only in server environment variables.
// STATUS: wired but disabled until the provider is verified (see PROJECT_STATUS.md).
import { createClient } from '@supabase/supabase-js'
import { ProviderNotVerified, fetchRace, type RaceRef } from '../src/polling/pollingsource'

const REFRESH_MS = 6 * 3600e3
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405)

    const providerKey = process.env.POLLINGSOURCE_API_KEY
    const url = process.env.VITE_SUPABASE_URL
    const anon = process.env.VITE_SUPABASE_ANON_KEY
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!providerKey || !url || !anon || !service) return json({ status: 'disabled' })

    // Only signed-in group members may trigger a refresh.
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /i, '')
    const asUser = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const me = await asUser.rpc('get_me')
    if (me.error || !me.data?.is_member) return json({ error: 'Members only' }, 403)

    const { market_id } = (await request.json().catch(() => ({}))) as { market_id?: string }
    if (!market_id) return json({ error: 'market_id required' }, 400)

    const db = createClient(url, service, { auth: { persistSession: false } })
    const { data: market } = await db.from('markets').select('id, kind, polling_ref').eq('id', market_id).single()
    if (!market?.polling_ref || market.kind === 'congress') return json({ status: 'no-provider-ref' })

    const { data: last } = await db.from('polling_snapshots').select('fetched_at')
      .eq('market_id', market_id).eq('source_kind', 'provider').order('fetched_at', { ascending: false }).limit(1)
    if (last?.[0] && Date.now() - new Date(last[0].fetched_at).getTime() < REFRESH_MS) return json({ status: 'fresh' })

    try {
      const snap = await fetchRace(market.polling_ref as RaceRef, providerKey)
      await db.from('polling_snapshots').insert({
        market_id, source_kind: 'provider', source_name: snap.source_name, source_url: snap.source_url,
        as_of: snap.as_of, data: snap.data,
      })
      return json({ status: 'refreshed' })
    } catch (e) {
      // Keep serving the last good snapshot; never log the key or raw provider responses.
      return json({ status: e instanceof ProviderNotVerified ? 'not-verified' : 'stale' })
    }
  },
}
