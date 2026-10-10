// Vercel function. Server-side only; signed-in group members only. ON by default; set
// POLLINGSOURCE_DISABLED=true to switch it off.
//   { action: "lookup",  race: {race_type,state,district,special} }  -> current average (preview on the propose form)
//   { action: "refresh", market_id }                                 -> stores a snapshot, at most every 6 hours per race
//   { action: "board" }                                             -> refreshes the race board, at most every 12 hours
// A refresh writes one snapshot row that every member reads, so the vendor sees a handful of requests a day.
// Storing needs SUPABASE_SERVICE_ROLE_KEY (server env only, never a VITE_ variable).
import { createClient } from '@supabase/supabase-js'
import type { PollingRef } from '../src/domain/states.js'
import { RaceMismatch, fetchRace } from '../src/polling/pollingsource.js'
import { REFRESH_MS, refreshSnapshot, type Cand } from '../src/polling/refresh.js'
import { refreshBoard } from '../src/polling/board.js'
import { boardDeps } from './_board.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const lookupCache = new Map<string, { at: number; value: unknown }>()

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405)
    if (process.env.POLLINGSOURCE_DISABLED === 'true') return json({ status: 'disabled' })

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

      if (body.action === 'board') {
        const service = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!service) return json({ status: 'not-configured' })
        const db = createClient(url, service, { auth: { persistSession: false } })
        return json(await refreshBoard(boardDeps(db)))
      }

      if (body.action === 'refresh' && body.market_id) {
        const service = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!service) return json({ status: 'not-configured' })
        const db = createClient(url, service, { auth: { persistSession: false } })
        const status = await refreshSnapshot({
          getMarket: async (id) => {
            const { data } = await db.from('markets').select('kind, status, candidates, polling_ref').eq('id', id).single()
            return data as { kind: string; status: string; candidates: Cand[]; polling_ref: PollingRef | null } | null
          },
          setCandidates: async (id, candidates) => {
            await db.from('markets').update({ candidates }).eq('id', id).eq('status', 'proposed')
          },
          lastProviderFetch: async (id) => {
            const { data } = await db.from('polling_snapshots').select('fetched_at').eq('market_id', id)
              .eq('source_kind', 'provider').order('fetched_at', { ascending: false }).limit(1)
            return data?.[0] ? new Date(data[0].fetched_at).getTime() : null
          },
          fetchRace,
          insert: async (row) => {
            const { error } = await db.from('polling_snapshots').insert(row)
            if (error) throw new Error('store failed')
          },
        }, body.market_id)
        return json({ status })
      }
      return json({ error: 'Unknown action' }, 400)
    } catch (e) {
      // Keep serving the last good snapshot. Nothing sensitive is logged or returned.
      return json({ status: e instanceof RaceMismatch ? 'mismatch' : 'unavailable' })
    }
  },
}
