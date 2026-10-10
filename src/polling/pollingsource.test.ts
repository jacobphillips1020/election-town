import { expect, test } from 'vitest'
import { ProviderNotVerified, buildRaceUrl, fetchRace } from './pollingsource'

test('request URL follows the documented /race endpoint', () => {
  expect(buildRaceUrl({ race_type: 'senate', state: 'nc' })).toBe('https://pollingsource.com/api/v1/race?race_type=senate&state=NC')
  expect(buildRaceUrl({ race_type: 'house', state: 'oh', district: '9' })).toContain('district=9')
})

test('fetching refuses until the vendor contract is verified', async () => {
  await expect(fetchRace({ race_type: 'senate', state: 'NC' }, 'x')).rejects.toBeInstanceOf(ProviderNotVerified)
})
