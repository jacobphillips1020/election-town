// What we know about how each state's remaining vote arrives. These are judgment calls from each state's rules and past
// late-count shifts. They are the assumptions behind the projection, so they live in one place and are shown on the page.
//
// floor: late ballots no reporting figure includes (provisional, military/overseas, late mail), as a share of votes counted.
// trust: how far to believe the feed's statewide "% reporting" (0-1) versus adding up its county figures.
// lean:  how much better side 1 (D/I) does in what's left than the same counties have so far, as a share (0.01 = 1 point).
// sd:    our uncertainty about that lean. Fat-tailed in the simulation.
// spread: uncertainty in how many votes are left (log scale; 0.4 is roughly ±40%).

export type StateProfile = {
  floor: number; trust: number; lean: number; sd: number; spread: number
  /** Plain-language note shown on the page. */
  note: string
  /** When the count should really be finished (shown to explain why a bet is still open). */
  done?: string
}

export type Transfer = { name: string; toA: [mean: number, sd: number]; toB: [mean: number, sd: number] }

export type KeyRace = {
  raceId: number; state: string; profile: StateProfile; transfers?: Transfer[]
  /** House races only: its row in the national breakdown, so the seat isn't counted twice. */
  seatKey?: string
}

export const KEY_RACES: Record<string, KeyRace> = {
  'Alaska Senate': {
    raceId: 86916, state: 'AK',
    // 2024 House race: Peltola's margin improved 8.5 points across the late vote; about 6 of that is where the vote is, already
    // in the county math, and the rest is the extra lean. Same race: John Howe's voters went 37% Begich, 21% Peltola, 42% no second choice.
    profile: {
      floor: 0.01, trust: 1, lean: 0.01, sd: 0.03, spread: 0.25,
      note: 'About a quarter of the vote is out: absentees, early votes and rural precincts, which usually help Democrats. If nobody hits 50%, ballots from the last-place candidates move to their next choice, and those voters lean Sullivan.',
      done: 'Absentees can arrive through Nov. 13, overseas through Nov. 18. Ranked-choice count Nov. 18.',
    },
    transfers: [
      { name: 'Gerald L. Heikes', toA: [0.12, 0.05], toB: [0.6, 0.12] },
      { name: 'Daniel J. Jr. Sullivan', toA: [0.2, 0.08], toB: [0.45, 0.15] },
    ],
  },
  'Georgia Senate': {
    raceId: 87087, state: 'GA',
    profile: { floor: 0.004, trust: 0.05, lean: 0.02, sd: 0.06, spread: 0.5, note: 'Nearly every county is in. Left: provisional and overseas ballots, plus a feed figure (89%) that doesn’t match its own county counts, so we allow for more than we expect.', done: 'Provisional and overseas ballots through Nov. 6.' },
  },
  'Iowa Senate': {
    raceId: 87151, state: 'IA',
    profile: { floor: 0.003, trust: 0.25, lean: 0, sd: 0.05, spread: 0.5, note: 'Mail ballots had to arrive by Election Day, so only provisional ballots and a little reporting lag are left.', done: 'County canvass the week after the election.' },
  },
  'Maine Senate': {
    raceId: 87188, state: 'ME',
    profile: { floor: 0.001, trust: 0.5, lean: 0, sd: 0.03, spread: 0.3, note: 'Towns report on their own schedule, so about 9% is out, spread across most counties. If nobody reaches 50%, it goes to a ranked-choice count.', done: 'Towns usually finish within days.' },
  },
  'Michigan Senate': {
    raceId: 87214, state: 'MI',
    profile: { floor: 0.002, trust: 0.5, lean: 0.01, sd: 0.03, spread: 0.4, note: 'Wayne and Genesee counties are still finishing. Overseas ballots can arrive for six more days.', done: 'County canvass within two weeks.' },
  },
  'Nebraska Senate': {
    raceId: 87254, state: 'NE',
    profile: { floor: 0.003, trust: 1, lean: 0, sd: 0.05, spread: 0.5, note: 'Every county has reported. Only provisional ballots are left.', done: 'County canvass the week after the election.' },
  },
  'New Hampshire Senate': {
    raceId: 87283, state: 'NH',
    profile: { floor: 0.001, trust: 0.4, lean: 0, sd: 0.03, spread: 0.4, note: 'Hand-count towns are still trickling in, mostly in Cheshire and Coos counties. New Hampshire has same-day registration, so few provisional ballots.', done: 'Towns usually finish within days.' },
  },
  'North Carolina Senate': {
    raceId: 87346, state: 'NC',
    profile: { floor: 0.008, trust: 1, lean: 0.01, sd: 0.05, spread: 0.4, note: 'All counties have reported. Left: provisional ballots and overseas mail, reviewed before the county canvass.', done: 'County canvass Nov. 13.' },
  },
  'Ohio Senate (special)': {
    raceId: 87527, state: 'OH',
    profile: { floor: 0.025, trust: 0.25, lean: 0.04, sd: 0.05, spread: 0.4, note: 'Ohio has a lot of provisional ballots, and late-counted ballots there usually lean Democratic. They aren’t added until the official canvass.', done: 'Official canvass Nov. 14–24.' },
  },
  'Texas Senate': {
    raceId: 87438, state: 'TX',
    profile: { floor: 0.003, trust: 0.7, lean: 0, sd: 0.04, spread: 0.5, note: 'Big counties show 99% but rounding hides what’s left. Late mail and overseas ballots have a few more days.', done: 'County canvass within two weeks.' },
  },
}

/** Side bets, by market title. A side bet with no entry here is left out of the math, and the page says so. */
export const SIDE_RACES: Record<string, KeyRace> = {
  'Kansas Senate': {
    raceId: 87162, state: 'KS',
    profile: { floor: 0.012, trust: 1, lean: 0.01, sd: 0.05, spread: 0.5, note: 'All counties have reported. Kansas now requires mail ballots by Election Day, so what’s left is provisional ballots, which counties review before their canvass.', done: 'County canvasses Nov. 9–16.' },
  },
  'New York governor': {
    raceId: 87329, state: 'NY',
    profile: { floor: 0.03, trust: 0.6, lean: 0.02, sd: 0.04, spread: 0.4, note: 'New York counts early and Election Day votes first. Mail ballots postmarked on time can arrive through Nov. 10, and affidavit ballots come after that.' },
  },
  'NY-17 House': {
    raceId: 87319, state: 'NY', seatKey: 'ny-17',
    profile: { floor: 0.03, trust: 0.6, lean: 0.02, sd: 0.04, spread: 0.4, note: 'About a tenth of the district is out. Mail ballots postmarked on time can arrive through Nov. 10, and affidavit ballots come after that.' },
  },
}

/** Everything the projection can estimate, by market title. */
export const RACES: Record<string, KeyRace> = { ...KEY_RACES, ...SIDE_RACES }

/** Not on the ballot, but it moves the Senate seats bet. */
export const MISSISSIPPI: KeyRace = {
  raceId: 81004, state: 'MS',
  // The campaigns say thousands remain: Democratic Hinds County and the Republican Coast, plus affidavit ballots and mail
  // arriving up to five business days late. Mississippi has no recount law, so a court fight could change what counts.
  profile: { floor: 0.015, trust: 0.5, lean: 0.03, sd: 0.07, spread: 0.5, note: 'Mail ballots can arrive through Nov. 10, and affidavit ballots still have to be reviewed.' },
}

export const SENATE_AGGREGATE_ID = 87528
export const HOUSE_AGGREGATE_ID = 87524

const SLOW: Record<string, Pick<StateProfile, 'floor' | 'lean' | 'sd' | 'spread'>> = {
  // California reports "100%" of precincts long before its mail is counted; much of the vote can still be out.
  CA: { floor: 0.35, lean: 0.03, sd: 0.04, spread: 0.4 },
  WA: { floor: 0.2, lean: 0.02, sd: 0.04, spread: 0.4 },
  OR: { floor: 0.12, lean: 0.01, sd: 0.04, spread: 0.4 },
  AZ: { floor: 0.1, lean: -0.01, sd: 0.04, spread: 0.4 },
  UT: { floor: 0.1, lean: 0, sd: 0.04, spread: 0.4 },
  CO: { floor: 0.05, lean: 0, sd: 0.04, spread: 0.4 },
  NV: { floor: 0.05, lean: 0.01, sd: 0.04, spread: 0.4 },
  HI: { floor: 0.05, lean: 0, sd: 0.04, spread: 0.4 },
  MT: { floor: 0.03, lean: 0, sd: 0.04, spread: 0.4 },
  AK: { floor: 0.05, lean: 0.03, sd: 0.04, spread: 0.3 },
  MS: { floor: 0.015, lean: 0.03, sd: 0.07, spread: 0.5 },
}
/** Every other seat: small and simple. Late ballots elsewhere are about 1% of the vote. */
export const seatProfile = (state: string) => SLOW[state] ?? { floor: 0.01, lean: 0, sd: 0.05, spread: 0.5 }

/** Votes for every race move together a little: if late ballots run bluer than we assumed in one state, likely elsewhere too. */
export const NATIONAL_SHARE = 0.2

export const DRAWS = 40000

export type LeanLabel = 'Tilt' | 'Leans' | 'Likely' | 'Very likely' | 'Called'
/** "Called" is purely this: more than 99% by our estimate. A news-desk call or a 100% count doesn't decide it. */
export function leanLabel(p: number): LeanLabel {
  if (p > 0.99) return 'Called'
  if (p >= 0.95) return 'Very likely'
  if (p >= 0.8) return 'Likely'
  if (p >= 0.6) return 'Leans'
  return 'Tilt'
}

export type Tier = 'Elite' | 'Great' | 'Good' | 'Mid'
/**
 * Forecaster tiers, by average miss on the projected margins in points. Fixed lines, not a curve, so everyone can be Elite
 * or nobody can. For scale, final Senate polling averages usually miss by about 5.
 */
export const TIER_LINES: [Tier, number][] = [['Elite', 3.5], ['Great', 4.5], ['Good', 5.5]]
export const tierOf = (avgError: number): Tier => TIER_LINES.find(([, line]) => avgError < line)?.[0] ?? 'Mid'
