import { describe, expect, test } from 'vitest'
import { BOARD_MS, parseRaceList, refreshBoard, type BoardDeps, type BoardRow } from './board'

const list = (t: string, races: Record<string, unknown>[]) => ({ dataset: 'x', year: 2026, count: races.length, races: races.map((r) => ({ race_type: t, ...r })) })
const NOW = Date.parse('2026-10-10T12:00:00Z')

describe('parseRaceList', () => {
  test('maps the vendor shape, numbering at-large House seats AL', () => {
    const rows = parseRaceList(list('house', [
      { state: 'ak', district: 0, is_special: false, dem_average: 32, rep_average: 46, margin_label: 'R+14.0', rating: 'Safe R', poll_count: 2, last_poll_date: '2026-10-01', page: 'p' },
      { state: 'UT', district: 2, is_special: false, dem_average: null, rep_average: null, poll_count: 0 },
      { state: 'XX', district: 1 }, { state: 'UT', district: 99 },
    ]), 'now')
    expect(rows.map((r) => [r.race_key, r.dem_avg, r.rep_avg])).toEqual([['house:AK:AL:0', 32, 46], ['house:UT:02:0', null, null]])
  })
  test('rejects an unexpected shape', () => {
    expect(() => parseRaceList({ nope: 1 }, 'now')).toThrow()
  })
})

function deps(over: Partial<BoardDeps> = {}) {
  const upserts: BoardRow[][] = []
  const nameCalls: string[] = []
  const d: BoardDeps = {
    lastBoardFetch: async () => null,
    fetchList: async (t) => list(t, t === 'senate'
      ? [{ state: 'AK', district: null, is_special: false, dem_average: 48, rep_average: 44.5, rating: 'Lean D', poll_count: 3 },
         { state: 'OH', district: null, is_special: true, dem_average: 45, rep_average: 47, rating: 'Toss-up', poll_count: 5 }]
      : []),
    existingNames: async () => new Map(),
    fetchNames: async (ref) => (nameCalls.push(ref.state), { dem: `${ref.state} Dem`, rep: `${ref.state} Rep` }),
    upsert: async (rows) => void upserts.push(rows),
    now: () => NOW,
    ...over,
  }
  return { d, upserts, nameCalls }
}

describe('refreshBoard', () => {
  test('loads averages and candidate names for every published race', async () => {
    const { d, upserts } = deps()
    expect(await refreshBoard(d)).toMatchObject({ status: 'refreshed', races: 2, names: 2, failed: 0 })
    expect(upserts[0].map((r) => [r.race_key, r.dem_name, r.rep_name])).toEqual([
      ['senate:AK::0', 'AK Dem', 'AK Rep'], ['senate:OH::1', 'OH Dem', 'OH Rep'],
    ])
  })

  test('skips entirely within 12 hours unless forced', async () => {
    const { d, upserts } = deps({ lastBoardFetch: async () => NOW - BOARD_MS + 60e3 })
    expect((await refreshBoard(d)).status).toBe('fresh')
    expect(upserts).toHaveLength(0)
    expect((await refreshBoard(d, { force: true })).status).toBe('refreshed')
  })

  test('re-uses recent names instead of asking the vendor again', async () => {
    const recent = new Date(NOW - 3600e3).toISOString()
    const { d, nameCalls, upserts } = deps({
      existingNames: async () => new Map([['senate:AK::0', { dem_name: 'Kept D', rep_name: 'Kept R', names_fetched_at: recent, experts: [] }]]),
    })
    await refreshBoard(d)
    expect(nameCalls).toEqual(['OH'])
    expect(upserts[0][0]).toMatchObject({ dem_name: 'Kept D', rep_name: 'Kept R' })
  })

  test('a failed name lookup keeps the averages and any older names', async () => {
    const old = new Date(NOW - 10 * 86400e3).toISOString()
    const { d, upserts } = deps({
      existingNames: async () => new Map([['senate:AK::0', { dem_name: 'Old D', rep_name: 'Old R', names_fetched_at: old }]]),
      fetchNames: async () => { throw new Error('503') },
    })
    expect(await refreshBoard(d)).toMatchObject({ races: 2, names: 0, failed: 2 })
    expect(upserts[0][0]).toMatchObject({ dem_avg: 48, dem_name: 'Old D' })
  })
})

describe('expert ratings', () => {
  test('are parsed from the race detail and kept when names are fresh', async () => {
    const { parseExperts } = await import('./board')
    expect(parseExperts({ expert_ratings: [{ source: 'Cook Political Report', rating: 'Toss Up' }, { source: '', rating: 'x' }, { rating: 'y' }] }))
      .toEqual([{ source: 'Cook Political Report', rating: 'Toss Up' }])
    expect(parseExperts({})).toEqual([])
    const recent = new Date(NOW - 3600e3).toISOString()
    const experts = [{ source: 'Inside Elections', rating: 'Tilt Republican' }]
    const { d, upserts } = deps({
      existingNames: async () => new Map([['senate:AK::0', { dem_name: 'D', rep_name: 'R', names_fetched_at: recent, experts }]]),
      fetchNames: async (ref) => ({ dem: `${ref.state} Dem`, rep: `${ref.state} Rep`, experts: [{ source: 'Cook Political Report', rating: 'Lean R' }] }),
    })
    await refreshBoard(d)
    expect(upserts[0].map((r) => r.experts)).toEqual([experts, [{ source: 'Cook Political Report', rating: 'Lean R' }]])
  })
})

test('a race whose detail was never read for expert ratings is read once, even with fresh names', async () => {
  const recent = new Date(NOW - 3600e3).toISOString()
  const { d, nameCalls } = deps({
    existingNames: async () => new Map([
      ['senate:AK::0', { dem_name: 'D', rep_name: 'R', names_fetched_at: recent, experts: null }],
      ['senate:OH::1', { dem_name: 'D', rep_name: 'R', names_fetched_at: recent, experts: [] }],
    ]),
  })
  await refreshBoard(d)
  expect(nameCalls).toEqual(['AK'])
})
