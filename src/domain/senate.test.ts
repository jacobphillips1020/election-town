import { describe, expect, test } from 'vitest'
import { HELD_BY, SENATE_NOW_R, impliedSenateR, senateR, type Side } from './senate'

const races = Object.keys(HELD_BY).map((k) => ({ state: k.replace('*', ''), special: k.endsWith('*'), polling: null }))
const BALLOT: [string, Side][] = [['AK', 'R'], ['GA', 'D'], ['IA', 'R'], ['ME', 'R'], ['MI', 'D'], ['NE', 'R'], ['NH', 'D'], ['NC', 'R'], ['OH*', 'R'], ['TX', 'R']]
const all = (side: Side) => Object.fromEntries(BALLOT.map(([k]) => [k, side]))

describe('what a ballot adds up to', () => {
  test('35 races, and no picks is today\'s Senate', () => {
    expect(races).toHaveLength(35)
    expect(impliedSenateR(races)).toBe(SENATE_NOW_R)
  })
  test('the current party holding all 10 ballot races is also today\'s Senate', () => {
    expect(impliedSenateR(races, Object.fromEntries(BALLOT))).toBe(53)
  })
  test('46 + your Republican picks', () => {
    expect(impliedSenateR(races, all('D'))).toBe(46)
    expect(impliedSenateR(races, all('R'))).toBe(56)
  })
  test('six flips means 47 (the case that came out 45 when off-ballot races followed the polls)', () => {
    expect(impliedSenateR(races, { ...Object.fromEntries(BALLOT), AK: 'D', IA: 'D', ME: 'D', NC: 'D', 'OH*': 'D', TX: 'D' })).toBe(47)
  })
  test('an independent win is not a Republican seat; a blank race stays with its holder', () => {
    expect(impliedSenateR(races, { NE: 'I' })).toBe(52)
    expect(impliedSenateR(races, { GA: 'R' })).toBe(54)
  })
  test('polls don\'t move it: a poll lead in an unpicked race changes the Polls bar, not this', () => {
    const polled = races.map((r) => (r.state === 'SC' ? { ...r, polling: { dem_avg: 45, rep_avg: 44.7, margin_label: 'D+0.3', rating: null } } : r))
    expect(impliedSenateR(polled)).toBe(53)
    expect(senateR(polled)).toBe(52)
  })
})
