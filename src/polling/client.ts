import type { Backend } from '../data/backend'
import type { PollingRef } from '../domain/states'
import type { Snapshot } from './pollingsource'

async function post<T>(backend: Backend, body: unknown): Promise<T | null> {
  if (backend.mode !== 'live') return null
  const token = await backend.accessToken()
  if (!token) return null
  try {
    const r = await fetch('/api/polling', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    return r.ok ? ((await r.json()) as T) : null
  } catch {
    return null
  }
}

export type Lookup = { status: 'ok' | 'no-average' | 'disabled' | 'mismatch' | 'unavailable'; snapshot?: Snapshot | null }

export const lookupRace = (b: Backend, race: PollingRef) => post<Lookup>(b, { action: 'lookup', race })
export const refreshMarket = (b: Backend, market_id: string) => post<{ status: string }>(b, { action: 'refresh', market_id })
export const refreshBoardApi = (b: Backend) => post<{ status: string }>(b, { action: 'board' })
