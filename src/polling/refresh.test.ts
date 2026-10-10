import { describe, expect, test } from 'vitest'
import { RaceMismatch } from './pollingsource'
import { REFRESH_MS, refreshAll, refreshSnapshot, type RefreshDeps, type SnapshotRow } from './refresh'

const ref = { race_type: 'senate', state: 'OH', district: null, special: false } as const
const snap = {
  source_name: 'PollingSource average (pollingsource.com)', source_url: 'https://pollingsource.com/senate/OH', as_of: '2026-10-03',
  data: { candidates: [{ name: 'A', party: 'D', pct: 48 }, { name: 'B', party: 'R', pct: 44 }] },
}

const PLACEHOLDERS = [
  { id: 'c1', name: 'Democratic nominee (to be confirmed)', party: 'D' },
  { id: 'c2', name: 'Republican nominee (to be confirmed)', party: 'R' },
]

function deps(over: Partial<RefreshDeps> = {}) {
  const rows: SnapshotRow[] = []
  const set: { id: string; name: string; party: string }[][] = []
  const d: RefreshDeps = {
    getMarket: async () => ({ kind: 'senate', status: 'proposed', candidates: PLACEHOLDERS, polling_ref: { ...ref } }),
    setCandidates: async (_id, c) => void set.push(c),
    lastProviderFetch: async () => null,
    fetchRace: async () => snap,
    insert: async (r) => void rows.push(r),
    now: () => Date.parse('2026-10-10T12:00:00Z'),
    ...over,
  }
  return { d, rows, set }
}

describe('refreshSnapshot', () => {
  test('a newly proposed race gets its polling stored immediately', async () => {
    const { d, rows } = deps()
    expect(await refreshSnapshot(d, 'm1')).toBe('refreshed')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ market_id: 'm1', source_kind: 'provider', as_of: '2026-10-03' })
  })

  test('candidate names load from the polling data into a still-proposed race', async () => {
    const { d, set } = deps()
    await refreshSnapshot(d, 'm1')
    expect(set).toEqual([[{ id: 'c1', name: 'A', party: 'D' }, { id: 'c2', name: 'B', party: 'R' }]])
  })

  test('never rewrites candidates of an open race or when the source has no real names', async () => {
    const open = deps({ getMarket: async () => ({ kind: 'senate', status: 'open', candidates: PLACEHOLDERS, polling_ref: { ...ref } }) })
    await refreshSnapshot(open.d, 'm1')
    const unnamed = deps({ fetchRace: async () => ({ ...snap, data: { candidates: [{ name: 'Democratic nominee (to be confirmed)', party: 'D', pct: 48 }, { name: 'B', party: 'R', pct: 44 }] } }) })
    await refreshSnapshot(unnamed.d, 'm1')
    expect(open.set.length + unnamed.set.length).toBe(0)
  })

  test('does not call the provider again within 6 hours', async () => {
    let calls = 0
    const now = Date.parse('2026-10-10T12:00:00Z')
    const { d, rows } = deps({ lastProviderFetch: async () => now - REFRESH_MS + 1000, fetchRace: async () => (calls++, snap) })
    expect(await refreshSnapshot(d, 'm1')).toBe('fresh')
    expect([calls, rows.length]).toEqual([0, 0])
    const later = deps({ lastProviderFetch: async () => now - REFRESH_MS - 1000 })
    expect(await refreshSnapshot(later.d, 'm1')).toBe('refreshed')
  })

  test('a race with no average yet is recorded as such, so it is not re-polled on every view', async () => {
    const { d, rows } = deps({ fetchRace: async () => null })
    expect(await refreshSnapshot(d, 'm1')).toBe('no-average')
    expect(rows[0].data.candidates).toEqual([])
    expect(rows[0].as_of).toBe('2026-10-10')
    expect(rows[0].source_url).toBe('https://pollingsource.com/senate/OH')
  })

  test('markets without a race link (and the Congress market) are skipped', async () => {
    expect(await refreshSnapshot(deps({ getMarket: async () => ({ kind: 'congress', status: 'open', candidates: [], polling_ref: null }) }).d, 'c')).toBe('no-race-link')
    expect(await refreshSnapshot(deps({ getMarket: async () => null }).d, 'x')).toBe('no-race-link')
  })

  test('provider failures and mismatched races store nothing', async () => {
    const boom = deps({ fetchRace: async () => { throw new Error('503') } })
    await expect(refreshSnapshot(boom.d, 'm1')).rejects.toThrow('503')
    const wrong = deps({ fetchRace: async () => { throw new RaceMismatch('different race') } })
    await expect(refreshSnapshot(wrong.d, 'm1')).rejects.toBeInstanceOf(RaceMismatch)
    expect(boom.rows.length + wrong.rows.length).toBe(0)
  })
})

describe('refreshAll (daily job)', () => {
  test('refreshes every race and keeps going when one fails', async () => {
    const { d } = deps()
    let n = 0
    const all = {
      ...d,
      listRaceMarkets: async () => ['a', 'b', 'c', 'd'],
      fetchRace: async () => { if (++n === 2) throw new Error('503'); return snap },
    }
    const r = await refreshAll(all, 1)
    expect(r).toMatchObject({ total: 4, refreshed: 3, failed: 1 })
  })
})
