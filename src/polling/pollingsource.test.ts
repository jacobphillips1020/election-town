import { describe, expect, test } from 'vitest'
import { RaceMismatch, buildRaceUrl, fetchRace, normalizeRace } from './pollingsource'

// Synthetic response in the documented shape (invented numbers and names).
const sample = {
  race: { race_type: 'senate', state: 'OH', district: null, is_special: false, dem_average: 48.5, rep_average: 44, poll_count: 3,
          last_poll_date: '2026-10-03', page: 'https://pollingsource.com/senate/OH' },
  recent_polls: { polls: [{ dem_candidate: 'Alex Example', rep_candidate: 'Sam Sample' }] },
  attribution: { cite_as: 'PollingSource average (pollingsource.com)' },
}
const ref = { race_type: 'senate', state: 'OH', district: null, special: false } as const

describe('PollingSource adapter', () => {
  test('request URL follows the documented endpoint', () => {
    expect(buildRaceUrl(ref)).toBe('https://pollingsource.com/api/v1/race?race_type=senate&state=OH')
    expect(buildRaceUrl({ race_type: 'house', state: 'az', district: '01', special: false })).toContain('district=1')
  })

  test('normalizes as published, with no rescaling and an honest note', () => {
    const s = normalizeRace(sample, ref)!
    expect(s.data.candidates).toEqual([
      { name: 'Alex Example', party: 'D', pct: 48.5 },
      { name: 'Sam Sample', party: 'R', pct: 44 },
    ])
    expect(s.data.undecided).toBeUndefined()
    expect(s.as_of).toBe('2026-10-03')
    expect(s.data.note).toMatch(/Democratic and Republican only/)
  })

  test('no polls yet means no average, not zeros', () => {
    const none = { ...sample, race: { ...sample.race, dem_average: null, rep_average: null, poll_count: 0, last_poll_date: null } }
    expect(normalizeRace(none, ref)).toBeNull()
  })

  test('refuses a response for a different race or a special election mismatch', () => {
    expect(() => normalizeRace({ ...sample, race: { ...sample.race, state: 'PA' } }, ref)).toThrow(RaceMismatch)
    expect(() => normalizeRace(sample, { ...ref, special: true })).toThrow(RaceMismatch)
    expect(() => normalizeRace({ race: { ...sample.race, race_type: 'house', district: 1 } }, { race_type: 'house', state: 'OH', district: '02', special: false })).toThrow(RaceMismatch)
  })

  test('fetch uses the documented URL and surfaces HTTP errors', async () => {
    let seen = ''
    const ok = (async (u: string) => ((seen = u), new Response(JSON.stringify(sample)))) as unknown as typeof fetch
    expect((await fetchRace(ref, ok))?.source_url).toBe('https://pollingsource.com/senate/OH')
    expect(seen).toContain('/api/v1/race?')
    const bad = (async () => new Response('x', { status: 503 })) as unknown as typeof fetch
    await expect(fetchRace(ref, bad)).rejects.toThrow(/503/)
  })
})
