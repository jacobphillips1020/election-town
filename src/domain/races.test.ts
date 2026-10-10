import { describe, expect, test } from 'vitest'
import { RACES, findRace, outcomeBasis, raceLabel, raceTitle, searchRaces } from './races'

const count = (k: string) => RACES.filter((r) => r.kind === k).length

describe('2026 race catalog', () => {
  test('has the right shape of the ballot', () => {
    expect(count('senate')).toBe(35) // 33 regular + Ohio and Florida specials
    expect(count('governor')).toBe(36)
    expect(count('house')).toBe(435)
    expect(RACES.filter((r) => r.special).map((r) => r.state).sort()).toEqual(['FL', 'OH'])
  })

  test('every house district is numbered 1..n per state; single-seat states are at-large', () => {
    const byState = new Map<string, string[]>()
    for (const r of RACES.filter((x) => x.kind === 'house')) byState.set(r.state, [...(byState.get(r.state) ?? []), r.district!])
    expect(byState.size).toBe(50)
    expect(byState.get('UT')!.sort()).toEqual(['01', '02', '03', '04'])
    for (const s of ['AK', 'DE', 'ND', 'SD', 'VT', 'WY']) expect(byState.get(s)).toEqual(['AL'])
    expect(byState.get('CA')).toHaveLength(52)
  })

  test('Utah has House seats but no Senate or governor race in 2026', () => {
    expect(findRace({ race_type: 'senate', state: 'UT', district: null, special: false })).toBeUndefined()
    expect(findRace({ race_type: 'governor', state: 'UT', district: null, special: false })).toBeUndefined()
    expect(findRace({ race_type: 'house', state: 'UT', district: '02', special: false })).toBeDefined()
  })

  test('polling coverage flags match the vendor list at generation time', () => {
    expect(RACES.filter((r) => r.kind === 'senate' && r.polled)).toHaveLength(27)
    expect(RACES.filter((r) => r.kind === 'governor' && r.polled)).toHaveLength(29)
    expect(RACES.filter((r) => r.kind === 'house' && r.polled)).toHaveLength(80)
  })
})

describe('search and labels', () => {
  const labels = (q: string) => searchRaces(q, 50).map(raceLabel)
  test('state + district number', () => {
    expect(labels('utah 2')).toEqual(['Utah — District 2'])
    expect(labels('UT-2')).toEqual(['Utah — District 2'])
  })
  test('senate and governor by state; Ohio and Florida have only the special in 2026', () => {
    expect(labels('ohio senate')).toEqual(['Ohio — Senate (special election)'])
    expect(labels('arizona gov')).toEqual(['Arizona — Governor'])
    expect(labels('utah senate')).toEqual([])
  })
  test('titles', () => {
    expect(raceTitle(searchRaces('utah 2')[0])).toBe('UT-02 House')
    expect(raceTitle(searchRaces('alaska house')[0])).toBe('Alaska at-large House')
    expect(raceLabel(searchRaces('alaska house')[0])).toBe('Alaska — At-large')
  })
})

test('outcome basis rule', () => {
  expect(['AK', 'ME', 'GA', 'OH'].map(outcomeBasis)).toEqual(['rcv_final', 'rcv_final', 'runoff_final', 'single_round'])
})
