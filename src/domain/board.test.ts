import { describe, expect, test } from 'vitest'
import { lastName, marginOf, marginText, ratingTone, viewRaces, type BoardRace } from './board'

const race = (state: string, kind: BoardRace['race_type'], d: number | null, r: number | null, district: string | null = null): BoardRace => ({
  race_type: kind, state, district, special: false, market: null,
  polling: d === null ? null : { dem_name: 'A Dem', rep_name: 'B Rep', dem_avg: d, rep_avg: r, margin_label: null, rating: null, poll_count: 3, last_poll_date: null, page: null, fetched_at: '' },
})

describe('race board helpers', () => {
  test('last names', () => {
    expect(lastName('Karrin Taylor Robson', 'R')).toBe('Robson')
    expect(lastName('Raphael Warnock Jr.', 'D')).toBe('Warnock')
    expect(lastName(null, 'Democrat')).toBe('Democrat')
  })
  test('rating tones', () => {
    expect(ratingTone('Safe R')).toEqual({ side: 'R', level: 3 })
    expect(ratingTone('Likely D')).toEqual({ side: 'D', level: 2 })
    expect(ratingTone('Lean D')).toEqual({ side: 'D', level: 1 })
    expect(ratingTone('Toss-up')).toEqual({ side: null, level: 0 })
  })
  test('default view: polled races only, closest margin first', () => {
    const all = [race('TX', 'senate', 40, 52), race('MI', 'senate', 47, 46.5), race('UT', 'house', null, null, '02'), race('AZ', 'governor', 45, 47)]
    expect(viewRaces(all, { query: '', kind: 'all', sort: 'closest' }).map((r) => r.state)).toEqual(['MI', 'AZ', 'TX'])
    expect(marginOf(all[0])).toBe(-12)
  })
  test('well-polled races rank above single-poll ones; margins read naturally', () => {
    const one = race('FL', 'house', 41, 41, '09'); one.polling!.poll_count = 1
    const many = race('MI', 'senate', 47, 45)
    expect(viewRaces([one, many], { query: '', kind: 'all', sort: 'closest' }).map((r) => r.state)).toEqual(['MI', 'FL'])
    expect([marginText(one), marginText(many), marginText(race('TX', 'senate', 40, 53))]).toEqual(['Tied', 'D+2.0', 'R+13.0'])
  })
  test('search includes races without polling; filters by type', () => {
    const all = [race('UT', 'house', null, null, '02'), race('UT', 'house', 40, 50, '01'), race('AZ', 'governor', 45, 47)]
    expect(viewRaces(all, { query: 'utah', kind: 'all', sort: 'closest' }).map((r) => r.district)).toEqual(['01', '02'])
    expect(viewRaces(all, { query: '', kind: 'governor', sort: 'az' }).map((r) => r.state)).toEqual(['AZ'])
  })
})
