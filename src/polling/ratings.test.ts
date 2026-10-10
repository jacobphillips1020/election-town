import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { RATINGS_MS, cleanRating, fetchPredictionsTable, parseSenateRatings, refreshRatings, type RatingRow } from './ratings'

// The real table as fetched on 2026-10-10 (Cook Oct 6, Inside Elections Oct 1, Sabato Oct 6).
const HTML = readFileSync('tests/fixtures/wikipedia-senate-predictions-2026-10-10.html', 'utf8')
const NOW = Date.parse('2026-10-10T12:00:00Z')
const rows = parseSenateRatings(HTML, new Date(NOW).toISOString())
const by = (k: string) => Object.fromEntries(rows.find((r) => r.race_key === k)!.ratings.map((x) => [x.source.split(' ')[0].replace('’s', ''), x]))

describe('parseSenateRatings', () => {
  test('one row per Senate race, specials keyed separately', () => {
    expect(rows).toHaveLength(35)
    expect(rows.find((r) => r.race_key === 'senate:OH::1')).toBeTruthy()
    expect(rows.find((r) => r.race_key === 'senate:FL::1')).toBeTruthy()
    expect(rows.find((r) => r.race_key === 'senate:OH::0')).toBeUndefined()
  })

  test('Alaska is a Toss Up at Cook (the case the old feed got wrong: Solid R)', () => {
    expect(by('senate:AK::0').Cook).toEqual({ source: 'Cook Political Report', rating: 'Toss Up', as_of: '2026-10-06' })
  })

  test('matches Cook\'s own page on Oct 6 for every ballot race, and keeps each forecaster\'s date', () => {
    const cook = Object.fromEntries(rows.map((r) => [r.race_key, r.ratings.find((x) => x.source === 'Cook Political Report')!.rating]))
    expect(cook).toMatchObject({
      'senate:AK::0': 'Toss Up', 'senate:GA::0': 'Likely D', 'senate:IA::0': 'Toss Up', 'senate:ME::0': 'Toss Up',
      'senate:MI::0': 'Toss Up', 'senate:NE::0': 'Likely R', 'senate:NH::0': 'Lean D', 'senate:NC::0': 'Likely D',
      'senate:OH::1': 'Toss Up', 'senate:TX::0': 'Toss Up', 'senate:KS::0': 'Toss Up', 'senate:SC::0': 'Likely R',
      'senate:MN::0': 'Likely D',
    })
    const ia = by('senate:IA::0')
    expect([ia['Inside'].rating, ia['Inside'].as_of, ia['Sabato'].rating, ia['Sabato'].as_of]).toEqual(['Tilt R', '2026-10-01', 'Toss Up', '2026-10-06'])
  })

  test('the "(flip)" note is dropped from labels', () => {
    expect(by('senate:NC::0').Sabato.rating).toBe('Lean D')
    expect(cleanRating('Lean D (flip)')).toBe('Lean D')
    expect(cleanRating('Tossup')).toBe('Toss Up')
    expect(cleanRating('—')).toBeNull()
  })

  test('refuses a page that is not the table', () => {
    expect(() => parseSenateRatings('<p>nothing</p>', 'now')).toThrow(/not found/)
  })
})

describe('refreshRatings', () => {
  const mk = (over: Partial<Parameters<typeof refreshRatings>[0]> = {}) => {
    const stored: RatingRow[][] = []
    return { stored, d: { lastFetch: async () => null, fetchTable: async () => HTML, upsert: async (r: RatingRow[]) => void stored.push(r), now: () => NOW, ...over } }
  }
  test('stores all races; skips within 12 hours unless forced', async () => {
    const { d, stored } = mk({ lastFetch: async () => NOW - RATINGS_MS + 60e3 })
    expect((await refreshRatings(d)).status).toBe('fresh')
    expect(stored).toHaveLength(0)
    expect(await refreshRatings(d, { force: true })).toEqual({ status: 'refreshed', races: 35 })
    expect(stored[0]).toHaveLength(35)
  })
  test('a mangled table is refused, never half-stored', async () => {
    const { d, stored } = mk({ fetchTable: async () => HTML.split('<tr').slice(0, 6).join('<tr') })
    await expect(refreshRatings(d)).rejects.toThrow(/not storing/)
    expect(stored).toHaveLength(0)
  })
})

describe('fetchPredictionsTable', () => {
  test('finds the Predictions section by title and sends a descriptive user agent', async () => {
    const calls: { url: string; ua: string }[] = []
    const fake = (async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, ua: init.headers['user-agent'] })
      const body = url.includes('prop=sections')
        ? { parse: { sections: [{ index: '2', line: 'Summary results', level: '2' }, { index: '14', line: 'Predictions', level: '2' }] } }
        : { parse: { text: '<table></table>' } }
      return { ok: true, status: 200, json: async () => body }
    }) as unknown as typeof fetch
    expect(await fetchPredictionsTable(fake)).toBe('<table></table>')
    expect(calls[1].url).toContain('section=14')
    expect(calls.every((c) => /ElectionTownPool/.test(c.ua))).toBe(true)
  })
})
