// Supabase wiring for the race board (shared by api/polling.ts and api/polling-cron.ts).
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchNames, type BoardDeps } from '../src/polling/board.js'
import { fetchPolymarketEvent, type ForecastDeps } from '../src/polling/forecast.js'

export function boardDeps(db: SupabaseClient): BoardDeps {
  return {
    lastBoardFetch: async () => {
      const { data } = await db.from('race_polling').select('fetched_at').order('fetched_at', { ascending: false }).limit(1)
      return data?.[0] ? new Date(data[0].fetched_at).getTime() : null
    },
    fetchList: async (t) => {
      const r = await fetch(`https://pollingsource.com/api/v1/races?race_type=${t}`, { headers: { accept: 'application/json' } })
      if (!r.ok) throw new Error(`PollingSource responded ${r.status}`)
      return r.json()
    },
    existingNames: async () => {
      const { data } = await db.from('race_polling').select('race_key, dem_name, rep_name, names_fetched_at, experts')
      return new Map((data ?? []).map((x) => [x.race_key as string, x]))
    },
    fetchNames,
    upsert: async (rows) => {
      const { error } = await db.from('race_polling').upsert(rows, { onConflict: 'race_key' })
      if (error) throw new Error('store failed')
    },
  }
}

export function forecastDeps(db: SupabaseClient): ForecastDeps {
  return {
    lastFetch: async () => {
      const { data } = await db.from('seat_forecasts').select('fetched_at').order('fetched_at', { ascending: true }).limit(1)
      return data?.[0] ? new Date(data[0].fetched_at).getTime() : null
    },
    fetchEvent: (slug) => fetchPolymarketEvent(slug),
    upsert: async (rows) => {
      const { error } = await db.from('seat_forecasts').upsert(rows, { onConflict: 'chamber' })
      if (error) throw new Error('store failed')
    },
  }
}
