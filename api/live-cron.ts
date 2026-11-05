// Results page job, hourly (Vercel Cron, see vercel.json: one once-a-day entry per hour, which is what the Hobby plan allows): fetch the counts, estimate, store one snapshot.
// If anything fails, nothing is stored and the page keeps showing the last good estimate.
import { createClient } from '@supabase/supabase-js'
import { ranRecently, refreshLive } from './_live.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export default {
  async fetch(request: Request): Promise<Response> {
    const secret = process.env.CRON_SECRET
    if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'Not allowed' }, 401)
    const url = process.env.VITE_SUPABASE_URL
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !service) return json({ status: 'not-configured' })
    const db = createClient(url, service, { auth: { persistSession: false } })
    if (await ranRecently(db)) return json({ status: 'skipped', reason: 'ran in the last 20 minutes' })
    try {
      return json({ status: 'ok', ...(await refreshLive(db)) })
    } catch (e) {
      return json({ status: 'failed', error: e instanceof Error ? e.message : 'unknown' }, 502)
    }
  },
}
