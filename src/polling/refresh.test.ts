import { describe, expect, test } from 'vitest'
import { RaceMismatch } from './pollingsource'
import { REFRESH_MS, refreshSnapshot, type RefreshDeps, type SnapshotRow } from './refresh'

const ref = { race_type: 'senate', state: 'OH', district: null, special: false } as const
const snap = {
  source_name: 'PollingSource average (pollingsource.com)', source_url: 'https://pollingsource.com/senate/OH', as_of: '2026-10-03',
  data: { candidates: [{ name: 'A', party: 'D', pct: 48 }, { name: 'B', party: 'R', pct: 44 }] },
}

function deps(over: Partial<RefreshDeps> = {}) {
  const rows: SnapshotRow[] = []
  const d: RefreshDeps = {
    getMarket: async () => ({ kind: 'senate', polling_ref: { ...ref } }),
    lastProviderFetch: async () => null,
    fetchRace: async () => snap,
    insert: async (r) => void rows.push(r),
    now: () => Date.parse('2026-10-10T12:00:00Z'),
    ...over,
  }
  return { d, rows }
}

describe('refreshSnapshot', () => {
  test('a newly proposed race gets its polling stored immediately', async () => {
    const { d, rows } = deps()
    expect(await refreshSnapshot(d, 'm1')).toBe('refreshed')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ market_id: 'm1', source_kind: 'provider', as_of: '2026-10-03' })
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
    expect(await refreshSnapshot(deps({ getMarket: async () => ({ kind: 'congress', polling_ref: null }) }).d, 'c')).toBe('no-race-link')
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
