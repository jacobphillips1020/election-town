import type { Chamber, Entry, Seats } from './types'

export const HOUSE_TOTAL = 435
export const SENATE_TOTAL = 100

export function remainder(total: number, d: number, r: number): number {
  return total - d - r
}

export function chamberValid(c: Chamber, total: number): boolean {
  return [c.d, c.r, c.o].every((n) => Number.isInteger(n) && n >= 0) && c.d + c.r + c.o === total
}

export function seatsValid(s: Seats): boolean {
  return chamberValid(s.house, HOUSE_TOTAL) && chamberValid(s.senate, SENATE_TOTAL)
}

/** Half the sum of absolute differences across all six counts. */
export function seatError(pred: Seats, actual: Seats): number {
  const diff = (a: Chamber, b: Chamber) => Math.abs(a.d - b.d) + Math.abs(a.r - b.r) + Math.abs(a.o - b.o)
  return (diff(pred.house, actual.house) + diff(pred.senate, actual.senate)) / 2
}

export function meanSeats(entries: Pick<Entry, 'seats'>[]): Seats | null {
  const rows = entries.filter((e) => e.seats).map((e) => e.seats!)
  if (!rows.length) return null
  const avg = (get: (s: Seats) => number) => rows.reduce((t, s) => t + get(s), 0) / rows.length
  return {
    house: { d: avg((s) => s.house.d), r: avg((s) => s.house.r), o: avg((s) => s.house.o) },
    senate: { d: avg((s) => s.senate.d), r: avg((s) => s.senate.r), o: avg((s) => s.senate.o) },
  }
}
