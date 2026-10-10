// Daily job (Vercel Cron, see vercel.json): refresh polling for every proposed/open race so averages move
// day over day and a snapshot exists before each deadline, whether or not anyone opened the page.
// Each race is still limited to one provider request per 6 hours.
import { createClient } from '@supabase/supabase-js'
import type { PollingRef } from '../src/domain/states.js'
import { fetchRace } from '../src/polling/pollingsource.js'
import { refreshAll, type Cand } from '../src/polling/refresh.js'
import { refreshBoard } from '../src/polling/board.js'
import { refreshForecasts } from '../src/polling/forecast.js'
import { boardDeps, forecastDeps } from './_board.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export default {
  async fetch(request: Request): Promise<Response> {
    if (process.env.POLLINGSOURCE_DISABLED === 'true') return json({ status: 'disabled' })
    // Vercel sends "Authorization: Bearer $CRON_SECRET" when CRON_SECRET is set.
    const secret = process.env.CRON_SECRET
    if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'Not allowed' }, 401)

    const url = process.env.VITE_SUPABASE_URL
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !service) return json({ status: 'not-configured' })
    const db = createClient(url, service, { auth: { persistSession: false } })

    // 1) the race board (averages, names, expert ratings), 2) seat forecasts, 3) each open market's snapshot.
    const board = await refreshBoard(boardDeps(db)).catch(() => ({ status: 'failed' }))
    const forecasts = await refreshForecasts(forecastDeps(db)).catch(() => ({ status: 'failed' }))
    const summary = await refreshAll({
      listRaceMarkets: async () => {
        const { data } = await db.from('markets').select('id, entry_deadline')
          .in('status', ['proposed', 'open']).not('polling_ref', 'is', null)
        const now = Date.now()
        return (data ?? []).filter((m) => !m.entry_deadline || new Date(m.entry_deadline).getTime() > now).map((m) => m.id as string)
      },
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
    })
    return json({ status: 'ok', board, forecasts, markets: summary })
  },
}
