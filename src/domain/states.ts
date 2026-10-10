export const STATES: [string, string][] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'],
  ['CT', 'Connecticut'], ['DE', 'Delaware'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'],
  ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
  ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'],
  ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'],
  ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
]
export const stateName = (code: string) => STATES.find(([c]) => c === code)?.[1] ?? code

export type PollingRef = { race_type: 'senate' | 'house' | 'governor'; state: string; district: string | null; special: boolean }

/** The race's own page on PollingSource (patterns taken from their site; special elections link to the state page). */
export function pollingPageUrl(ref: PollingRef): string {
  const base = 'https://pollingsource.com'
  if (ref.special) return `${base}/state.php?state=${ref.state}`
  if (ref.race_type === 'senate') return `${base}/senate/${ref.state}`
  if (ref.race_type === 'governor') return `${base}/governors/${ref.state}`
  return `${base}/house/${ref.state}-${ref.district ?? ''}`
}

/** "Ohio Senate", "Arizona governor", "AZ-01 House". */
export function suggestTitle(kind: string, state: string, district: string): string {
  if (kind === 'house') return `${state}-${district.padStart(2, '0')} House`
  return `${stateName(state)} ${kind === 'senate' ? 'Senate' : 'governor'}`
}
