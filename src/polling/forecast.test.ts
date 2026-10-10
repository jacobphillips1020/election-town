import { describe, expect, test } from 'vitest'
import { FORECAST_MS, medianSeats, parseControl, parseRange, parseSeatEvent, refreshForecasts, type ForecastRow } from './forecast'

const mk = (title: string, bid: number, ask: number, extra: Record<string, unknown> = {}) =>
  ({ groupItemTitle: title, bestBid: bid, bestAsk: ask, outcomePrices: JSON.stringify([String((bid + ask) / 2), '0']), active: true, closed: false, ...extra })

// Shape and prices as published on 2026-10-10 (Senate), trimmed.
const SENATE = [{
  slug: 'republican-senate-seats-after-the-2026-midterm-elections-927',
  markets: [
    mk('≤47', 0.38, 0.39), mk('48', 0.14, 0.16), mk('49', 0.12, 0.14), mk('50', 0.11, 0.12), mk('51', 0.07, 0.09),
    mk('52', 0.052, 0.074), mk('53', 0.041, 0.051), mk('54', 0.015, 0.037), mk('55', 0.008, 0.024), mk('56', 0.004, 0.015),
    mk('57+', 0.007, 0.008), mk('Party A', 0, 1, { active: false }),
  ],
}]
const HOUSE = [{
  markets: [
    mk('Below 190', 0.26, 0.29), mk('190-194', 0.13, 0.15), mk('195-199', 0.12, 0.15), mk('200-204', 0.128, 0.138),
    mk('205-209', 0.111, 0.119), mk('210-214', 0.082, 0.133), mk('215-219', 0.055, 0.076), mk('220-224', 0.029, 0.047),
    mk('225-229', 0.011, 0.036), mk('230+', 0.011, 0.034),
  ],
}]
const CONTROL = [{ markets: [mk('Democratic Party', 0.62, 0.63), mk('Republican Party', 0.37, 0.38), mk('Other', 0, 1, { active: false })] }]

describe('parsing', () => {
  test('seat range labels', () => {
    expect(parseRange('≤47', 100)).toEqual({ lo: 0, hi: 47 })
    expect(parseRange('57+', 100)).toEqual({ lo: 57, hi: 100 })
    expect(parseRange('Below 190', 435)).toEqual({ lo: 0, hi: 189 })
    expect(parseRange('190-194', 435)).toEqual({ lo: 190, hi: 194 })
    expect(parseRange('48', 100)).toEqual({ lo: 48, hi: 48 })
    expect(parseRange('Party A', 100)).toBeNull()
  })

  test('Senate: probabilities normalized, inactive outcomes dropped, median about 48', () => {
    const b = parseSeatEvent(SENATE, 100)
    expect(b).toHaveLength(11)
    expect(b.reduce((t, x) => t + x.p, 0)).toBeCloseTo(1, 3)
    expect(medianSeats(b)).toBeCloseTo(48.4, 1)
  })

  test('House: median inside a five-seat range', () => {
    const m = medianSeats(parseSeatEvent(HOUSE, 435))!
    expect(m).toBeGreaterThan(195)
    expect(m).toBeLessThan(200)
  })

  test('control odds come from the Democratic and Republican outcomes only', () => {
    expect(parseControl(CONTROL)).toBe(62.5)
    expect(parseControl([{ markets: [] }])).toBeNull()
  })

  test('an unexpected shape is an error, not a made-up number', () => {
    expect(() => parseSeatEvent([{ markets: [] }], 100)).toThrow()
    expect(() => parseSeatEvent({ nope: 1 }, 100)).toThrow()
  })
})

describe('refreshForecasts', () => {
  const NOW = Date.parse('2026-10-10T12:00:00Z')
  test('stores both chambers; skips within 6 hours; a failing chamber keeps its old row', async () => {
    const stored: ForecastRow[][] = []
    const feeds: Record<string, unknown> = {
      'republican-senate-seats-after-the-2026-midterm-elections-927': SENATE,
      'which-party-will-win-the-senate-in-2026': CONTROL,
    }
    const deps = (last: number | null) => ({
      lastFetch: async () => last,
      fetchEvent: async (slug: string) => { if (!feeds[slug]) throw new Error('503'); return feeds[slug] },
      upsert: async (rows: ForecastRow[]) => void stored.push(rows),
      now: () => NOW,
    })
    expect(await refreshForecasts(deps(NOW - FORECAST_MS + 60e3))).toMatchObject({ status: 'fresh' })
    expect(await refreshForecasts(deps(null))).toMatchObject({ status: 'refreshed', stored: 1, failed: 1 })
    expect(stored[0][0]).toMatchObject({ chamber: 'senate', source_name: 'Polymarket', d_control_pct: 62.5 })
    expect(stored[0][0].source_url).toMatch(/^https:\/\/polymarket\.com\/event\//)
  })
})
