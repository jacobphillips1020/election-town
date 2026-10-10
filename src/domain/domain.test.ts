import { describe, expect, test } from 'vitest'
import { fromETInput, formatET, pct, toETInput, usd } from './format'
import { allocate, groupForecast, parseTenths } from './race'
import { meanSeats, seatError, seatsValid } from './seats'
import type { Candidate } from './types'

const C: Candidate[] = [
  { id: 'c1', name: 'Garcia', party: 'D' },
  { id: 'c2', name: 'Whitfield', party: 'R' },
  { id: 'c3', name: 'Lee', party: 'L' },
]

describe('allocate', () => {
  test('remainder goes to the principal opponent by default', () => {
    const a = allocate(C, true, { winnerId: 'c1', winnerPct: '51.8', opponentId: null, adjust: {} })
    expect(a.errors).toEqual([])
    expect(a.shares).toEqual({ c1: 518, c2: 482, c3: 0, other: 0 })
    expect(a.lines.find((l) => l.auto)?.id).toBe('c2')
  })

  test('adjusting other candidates reduces the principal opponent', () => {
    const a = allocate(C, true, { winnerId: 'c1', winnerPct: '50.0', opponentId: null, adjust: { c3: '3.5', other: '1.5' } })
    expect(a.shares).toEqual({ c1: 500, c2: 450, c3: 35, other: 15 }) // c2 = 100 - 50 - 3.5 - 1.5
    expect(Object.values(a.shares!).reduce((s, n) => s + n, 0)).toBe(1000)
  })

  test('plurality winner below 50% is accepted', () => {
    const a = allocate(C, true, { winnerId: 'c1', winnerPct: '40', opponentId: 'c2', adjust: { c3: '25', other: '5' } })
    expect(a.errors).toEqual([])
    expect(a.shares).toMatchObject({ c1: 400, c2: 300, c3: 250, other: 50 })
  })

  test('winner must be strictly largest; sums must not exceed 100', () => {
    expect(allocate(C, true, { winnerId: 'c1', winnerPct: '50', opponentId: null, adjust: {} }).errors.join()).toMatch(/larger share/)
    expect(allocate(C, true, { winnerId: 'c1', winnerPct: '49', opponentId: null, adjust: {} }).shares).toBeNull()
    expect(allocate(C, true, { winnerId: 'c1', winnerPct: '60', opponentId: null, adjust: { c3: '30', other: '20' } }).errors.join()).toMatch(/more than 100/)
  })

  test('input parsing', () => {
    expect(parseTenths('51.8')).toBe(518)
    expect(parseTenths('51')).toBe(510)
    expect(parseTenths('51.85')).toBeNull()
    expect(parseTenths('-1')).toBeNull()
    expect(parseTenths('100.1')).toBeNull()
    expect(parseTenths('')).toBeNull()
  })
})

describe('groupForecast', () => {
  test('averages full distributions, not winner shares', () => {
    const f = groupForecast(C.slice(0, 2), true, [
      { shares: { c1: 600, c2: 400, other: 0 } },
      { shares: { c1: 300, c2: 600, other: 100 } },
    ])
    expect(f.means).toEqual({ c1: 450, c2: 500, other: 50 })
    expect(f.leaderId).toBe('c2') // the mean leader differs from one entrant's pick
    expect(f.marginTenths).toBe(50)
  })
  test('empty', () => {
    expect(groupForecast(C, false, []).leaderId).toBeNull()
  })
})

describe('seats', () => {
  const act = { house: { d: 220, r: 215, o: 0 }, senate: { d: 49, r: 50, o: 1 } }
  test('error is half the summed differences: off 3 House + 1 Senate = 4', () => {
    expect(seatError({ house: { d: 223, r: 212, o: 0 }, senate: { d: 48, r: 51, o: 1 } }, act)).toBe(4)
    expect(seatError({ house: { d: 219, r: 216, o: 0 }, senate: act.senate }, act)).toBe(1) // one seat moved
  })
  test('validity and mean', () => {
    expect(seatsValid(act)).toBe(true)
    expect(seatsValid({ ...act, senate: { d: 49, r: 50, o: 2 } })).toBe(false)
    expect(meanSeats([{ seats: act }, { seats: { house: { d: 200, r: 235, o: 0 }, senate: act.senate } }])!.house.d).toBe(210)
  })
})

describe('format', () => {
  test('money and percent', () => {
    expect(usd(1000)).toBe('$10')
    expect(usd(1334)).toBe('$13.34')
    expect(usd(-2000)).toBe('-$20')
    expect(pct(518)).toBe('51.8%')
  })
  test('deadline is shown in New York time with the zone named', () => {
    expect(formatET('2026-11-03T01:00:00Z')).toBe('Nov 2 at 8:00 p.m. ET')
  })
  test('ET input round trip (after the Nov 1 DST change)', () => {
    expect(toETInput('2026-11-03T01:00:00Z')).toBe('2026-11-02T20:00')
    expect(fromETInput('2026-11-02T20:00')).toBe('2026-11-03T01:00:00.000Z')
    expect(fromETInput('2026-10-20T20:00')).toBe('2026-10-21T00:00:00.000Z') // EDT
  })
})
