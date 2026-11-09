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

/**
 * What reporting says is left, when it's better than the feed's "% reporting". Dated and credited on the page.
 * As new votes show up in the feed, they're taken off `left` automatically, so the estimate doesn't go stale on its own.
 */
export type Reported = {
  asOf: string; source: string; url: string
  /** Ballots still to count (all candidates), and the feed's total votes when that was reported. */
  left: number; countedAt: number
  /** Uncertainty in `left` on a log scale (0.3 is roughly ±30%). */
  spread: number
  /** How the rest should split: like the counties still out ('county'), or like the state so far ('state'), plus the profile's lean. */
  mix: 'county' | 'state'
  /** Side A's two-way share of what's left, when reporting gives a direct read (Alaska's early and absentee ballots). Replaces mix and lean. */
  shareA?: number
}

export type Transfer = { name: string; toA: [mean: number, sd: number]; toB: [mean: number, sd: number] }

export type KeyRace = {
  raceId: number; state: string; profile: StateProfile; transfers?: Transfer[]; reported?: Reported
  /** House races only: its row in the national breakdown, so the seat isn't counted twice. */
  seatKey?: string
}

// Votes left come from reporting (AP's expected vote, published by NBC, and state officials), dated in each `reported`.
// The feed's own "% reporting" jumps around, so it's only a fallback. Refresh these figures when reporting moves.
export const KEY_RACES: Record<string, KeyRace> = {
  'Alaska Senate': {
    raceId: 86916, state: 'AK',
    profile: {
      floor: 0.01, trust: 1, lean: 0, sd: 0.035, spread: 0.15,
      note: 'Nothing new has been counted since election night. Still out: roughly 51,000 early and absentee ballots in hand, plus late mail and questioned ballots. The early and absentee ballots counted so far went about 58% Peltola head to head. If nobody reaches 50%, second choices count, and the state’s ballot data shows the other Dan Sullivan’s voters leaning Peltola while Heikes voters lean Sullivan.',
      done: 'Absentee counts expected Nov. 10 and 13. Ranked-choice count Nov. 18.',
    },
    // Ballots left: Newsweek counts about 51,000 early and absentee ballots in hand plus up to 10,528 more mail; AP expects about
    // 75,000. The middle of those, about 63,000, with room for either. Counted so far in the feed: 214,246.
    reported: {
      asOf: '2026-11-09', source: 'Newsweek and AP', url: 'https://www.yahoo.com/news/politics/articles/ranked-choice-twist-other-dan-234138123.html',
      left: 63000, countedAt: 214246, spread: 0.15, mix: 'state',
      // Early and absentee ballots counted so far: about 56.5% of first choices, 58% after ranked choice, so about 58% head to
      // head. Late mail can run differently: a fat-tailed 3.5-point uncertainty. Cross-check, Nov. 9: Polymarket's first-round
      // margin market centers on Peltola +3 to +6, which implies about 58-60%.
      shareA: 0.58,
    },
    // From the state's cast-vote records (204,530 scanned ballots), as tallied by Newsweek on Nov. 8. The other Dan Sullivan's
    // voters: 29% Peltola, 16% Sullivan, 18% Heikes (whose voters then split like his own), 37% no one. Heikes's: 17.5% Peltola,
    // 43% Sullivan, 39% no one. Folded together here.
    transfers: [
      { name: 'Gerald L. Heikes', toA: [0.175, 0.03], toB: [0.433, 0.04] },
      { name: 'Daniel J. Jr. Sullivan', toA: [0.32, 0.04], toB: [0.24, 0.04] },
    ],
  },
  'Georgia Senate': {
    raceId: 87087, state: 'GA',
    profile: { floor: 0.004, trust: 0.05, lean: 0.02, sd: 0.06, spread: 0.5, note: 'Nearly every county is in. Left: provisional and overseas ballots, plus a feed figure (89%) that doesn’t match its own county counts, so we allow for more than we expect.', done: 'Provisional and overseas ballots through Nov. 6.' },
    reported: { asOf: '2026-11-09', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/georgia-senate-results', left: 6500, countedAt: 4181853, spread: 0.3, mix: 'state' },
  },
  'Iowa Senate': {
    raceId: 87151, state: 'IA',
    profile: { floor: 0.003, trust: 0.25, lean: 0, sd: 0.05, spread: 0.5, note: 'Mail ballots had to arrive by Election Day, so only provisional ballots and a little reporting lag are left.', done: 'County canvass the week after the election.' },
    reported: { asOf: '2026-11-09', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/iowa-senate-results', left: 13889, countedAt: 1360839, spread: 0.3, mix: 'state' },
  },
  'Maine Senate': {
    raceId: 87188, state: 'ME',
    profile: { floor: 0.001, trust: 0.5, lean: 0, sd: 0.03, spread: 0.3, note: 'About 20,000 votes are still out, mostly from small towns in Washington, Franklin, Aroostook and Somerset counties, which lean Collins.', done: 'Towns usually finish within days.' },
    reported: { asOf: '2026-11-09', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/maine-senate-results', left: 20315, countedAt: 709755, spread: 0.3, mix: 'county' },
  },
  'Michigan Senate': {
    raceId: 87214, state: 'MI',
    profile: { floor: 0.002, trust: 0.5, lean: 0.01, sd: 0.03, spread: 0.4, note: 'Wayne and Genesee counties are still finishing. Overseas ballots can arrive for six more days.', done: 'County canvass within two weeks.' },
    reported: { asOf: '2026-11-09', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/michigan-senate-results', left: 105319, countedAt: 4778672, spread: 0.3, mix: 'county' },
  },
  'Nebraska Senate': {
    raceId: 87254, state: 'NE',
    profile: { floor: 0.003, trust: 1, lean: 0, sd: 0.05, spread: 0.5, note: 'Every county has reported. Only provisional ballots are left.', done: 'County canvass the week after the election.' },
    reported: { asOf: '2026-11-09', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/nebraska-senate-results', left: 23063, countedAt: 754367, spread: 0.3, mix: 'state' },
  },
  'New Hampshire Senate': {
    raceId: 87283, state: 'NH',
    profile: { floor: 0.001, trust: 0.4, lean: 0, sd: 0.03, spread: 0.4, note: 'Hand-count towns are still trickling in, mostly in Cheshire and Coos counties. New Hampshire has same-day registration, so few provisional ballots.', done: 'Towns usually finish within days.' },
    reported: { asOf: '2026-11-09', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/new-hampshire-senate-results', left: 5765, countedAt: 637324, spread: 0.3, mix: 'county' },
  },
  'North Carolina Senate': {
    raceId: 87346, state: 'NC',
    profile: { floor: 0.008, trust: 1, lean: 0.01, sd: 0.05, spread: 0.4, note: 'All counties have reported. Left: provisional ballots and overseas mail, reviewed before the county canvass.', done: 'County canvass Nov. 13.' },
    reported: { asOf: '2026-11-09', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/north-carolina-senate-results', left: 38000, countedAt: 4203168, spread: 0.3, mix: 'state' },
  },
  'Ohio Senate (special)': {
    raceId: 87527, state: 'OH',
    profile: { floor: 0.025, trust: 0.25, lean: 0.05, sd: 0.05, spread: 0.4, note: 'About 107,000 votes are still out, mostly provisional ballots, which are cast more in cities and usually lean Democratic. Nothing new gets added until the official canvass.', done: 'Official canvass must finish by Nov. 24.' },
    reported: { asOf: '2026-11-09', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-special-elections/ohio-senate-results', left: 106646, countedAt: 4601925, spread: 0.25, mix: 'state' },
  },
  'Texas Senate': {
    raceId: 87438, state: 'TX',
    profile: { floor: 0.003, trust: 0.7, lean: 0, sd: 0.04, spread: 0.5, note: 'Big counties show 99% but rounding hides what’s left. Late mail and overseas ballots have a few more days.', done: 'County canvass within two weeks.' },
    reported: { asOf: '2026-11-09', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/texas-senate-results', left: 42457, countedAt: 9897599, spread: 0.3, mix: 'state' },
  },
}

/** Side bets, by market title. A side bet with no entry here is left out of the math, and the page says so. */
export const SIDE_RACES: Record<string, KeyRace> = {
  'Kansas Senate': {
    raceId: 87162, state: 'KS',
    profile: { floor: 0.012, trust: 1, lean: 0.02, sd: 0.06, spread: 0.4, note: 'About 1% of the vote is still out, mostly provisional ballots that counties add at their canvasses. Provisional ballots are cast more in cities and lean a little Democratic.', done: 'County canvasses finish by Nov. 16.' },
    reported: { asOf: '2026-11-09', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/kansas-senate-results', left: 13000, countedAt: 1099896, spread: 0.4, mix: 'state' },
  },
  'New York governor': {
    raceId: 87329, state: 'NY',
    profile: { floor: 0.03, trust: 0.6, lean: 0.02, sd: 0.04, spread: 0.4, note: 'New York counts early and Election Day votes first. Mail ballots postmarked on time can arrive through Nov. 10, and affidavit ballots come after that.' },
    reported: { asOf: '2026-11-09', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/new-york-governor-results', left: 500102, countedAt: 6041435, spread: 0.3, mix: 'county' },
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
  profile: { floor: 0.015, trust: 0.5, lean: 0, sd: 0.06, spread: 0.5, note: 'About 26,000 votes are still out: roughly 7% of Democratic Hinds County (due Wednesday), the slower Republican-leaning Coast counties, and affidavit ballots statewide.' },
  // AP expects about 26,000 more; the Secretary of State says 75 of 82 counties are in and about 2,700 mail ballots are out.
  // Mississippi Today, Nov. 9: Hinds County still had about 7% of its vote out.
  reported: { asOf: '2026-11-09', source: 'AP via NBC and the Mississippi Secretary of State', url: 'https://www.wlbt.com/2026/11/09/colom-leads-hyde-smith-by-more-than-2500-votes-mississippi-awaits-final-senate-result/', left: 25851, countedAt: 953463, spread: 0.35, mix: 'county',
    // Where it is: about 7% of Hinds County (Jackson, strongly Colom), due Wednesday; the slower Coast counties (Hyde-Smith);
    // and affidavit ballots around the state, which lean Democratic. Blended, a little better than even for Colom.
    shareA: 0.53 },
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
