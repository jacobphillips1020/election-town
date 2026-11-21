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
  /** The two candidates' votes in the feed when this was reported. Votes counted since then are evidence for how the rest splits. */
  at?: { a: number; b: number }
  /** A newer count than the feed's (AP's), used until the feed catches up: the two candidates' votes and everyone else's. */
  counts?: { a: number; b: number; others: number }
}

/**
 * Learning from the count. Votes counted since a report are a sample of what was left, though not a random one: later
 * batches can be a different kind of ballot. LATE_TAU is how far the rest can differ from what's been seen (3 points),
 * and a batch that's a small part of the pool counts for less: the allowance grows as sqrt(1 + 10% of the pool / votes seen).
 */
export const LATE_TAU = 0.03
export const SMALL_BATCH = 0.1
/** Until an official result is entered, this share of a reported pool stays uncertain even after it has all been counted. */
export const RESIDUAL = 0.1

export type Transfer = { name: string; toA: [mean: number, sd: number]; toB: [mean: number, sd: number] }

export type KeyRace = {
  raceId: number; state: string; profile: StateProfile; transfers?: Transfer[]; reported?: Reported
  /** Votes the feed doesn't list (write-ins), as a share of all votes. They count toward the 50% line in ranked-choice states. */
  unlisted?: number
  /** House races only: its row in the national breakdown, so the seat isn't counted twice. */
  seatKey?: string
}

// Votes left come from reporting (AP's expected vote, published by NBC, and state officials), dated in each `reported`.
// The feed's own "% reporting" jumps around, so it's only a fallback. Refresh these figures when reporting moves (last: Nov. 20).
export const KEY_RACES: Record<string, KeyRace> = {
  'Alaska Senate': {
    raceId: 86916, state: 'AK',
    profile: {
      floor: 0.01, trust: 1, lean: 0, sd: 0.035, spread: 0.2,
      note: 'The count is essentially done: AP has fewer than 500 votes left and has projected Peltola. She finished with just over 50% of first choices, so there is no ranked-choice round; this scores her head-to-head share of the first round.',
      done: 'State certification is still to come.',
    },
    // Ballots left, Nov. 14: AP expects about 12,000 more on its count of 277,368, which is 855 ahead of the feed's.
    reported: {
      asOf: '2026-11-20', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/alaska-senate-results',
      // Nov. 20: AP has fewer than 500 votes left and has projected Peltola, with 50.13% of first choices counting write-ins.
      left: 500, countedAt: 287321, spread: 0.5, mix: 'state', at: { a: 144486, b: 131965 }, shareA: 0.58,
    },
    // Write-ins: the state's count has Peltola at 49.8% of first choices on Nov. 13 (ADN); the feed, which leaves write-ins out,
    // implies 49.99%. About 0.35% of votes are write-ins the feed doesn't show. Small, but it decides the 50% line.
    unlisted: 0.0035,
    // From the state's cast-vote records. The other Dan Sullivan's voters (ADN, Nov. 11: 3,896 ballots): 29% Peltola, 16%
    // Sullivan, 18% Heikes (whose voters then split like his own), 36% no one. Heikes's own: 17.5% Peltola, 41% Sullivan.
    // Check: the Beacon's Nov. 10 tabulation has Sullivan gaining 3,066 and Peltola 2,160; these rates give 3,074 and 2,160.
    transfers: [
      { name: 'Gerald L. Heikes', toA: [0.175, 0.03], toB: [0.41, 0.04] },
      { name: 'Daniel J. Jr. Sullivan', toA: [0.32, 0.04], toB: [0.24, 0.04] },
    ],
  },
  'Georgia Senate': {
    raceId: 87087, state: 'GA',
    profile: { floor: 0.004, trust: 0.05, lean: 0.02, sd: 0.06, spread: 0.5, note: 'Nearly every county is in. Left: provisional and overseas ballots, plus a feed figure (89%) that doesn’t match its own county counts, so we allow for more than we expect.', done: 'Provisional and overseas ballots through Nov. 6.' },
    reported: { asOf: '2026-11-09', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/georgia-senate-results', left: 5705, countedAt: 4182648, spread: 0.3, mix: 'state', at: { a: 2468990, b: 1713658 } },
  },
  'Iowa Senate': {
    raceId: 87151, state: 'IA',
    profile: { floor: 0.003, trust: 0.25, lean: 0, sd: 0.05, spread: 0.5, note: 'Mail ballots had to arrive by Election Day, so only provisional ballots and a little reporting lag are left.', done: 'County canvass the week after the election.' },
    reported: { asOf: '2026-11-09', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/iowa-senate-results', left: 13889, countedAt: 1360839, spread: 0.3, mix: 'state', at: { a: 686486, b: 630615 } },
  },
  'Maine Senate': {
    raceId: 87188, state: 'ME',
    profile: { floor: 0.001, trust: 0.5, lean: 0, sd: 0.035, spread: 0.3, note: 'AP now has Jackson at 53.1%, just above 52.95%, the line between the two leading guesses. AP still lists 20,000 votes out, but that estimate hasn’t changed since Nov. 9, Maine towns must report within two days, and only about 1,000 votes have been added since Nov. 13. If many more come in, they’re from towns that lean Collins; if not, Jackson stays above the line.', done: 'Official results due to the governor by Nov. 25.' },
    reported: { asOf: '2026-11-20', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/maine-senate-results',
      // AP's count is about 600 votes ahead of the feed's. AP still lists 20,000 left, an estimate unchanged since Nov. 9, though
      // Maine towns must report to the state within two days and AP has added only about 1,000 votes since Nov. 13 (89% Jackson).
      // So the real number is probably smaller: centered on 8,000, anywhere from about 2,000 to the full 20,000.
      left: 8000, countedAt: 710361, spread: 0.8, mix: 'county', counts: { a: 376955, b: 332918, others: 488 }, at: { a: 376955, b: 332918 },
      // How what's left should split: the feed's partly reported towns add up to 45.5% Jackson, and the 34,000 votes added Nov. 5-6
      // went 44%.
      shareA: 0.455 },
  },

  'Michigan Senate': {
    raceId: 87214, state: 'MI',
    profile: { floor: 0.002, trust: 0.5, lean: 0.01, sd: 0.03, spread: 0.4, note: 'Wayne and Genesee counties are still finishing. Overseas ballots can arrive for six more days.', done: 'County canvass within two weeks.' },
    reported: { asOf: '2026-11-09', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/michigan-senate-results', left: 105270, countedAt: 4778721, spread: 0.3, mix: 'county', at: { a: 2506990, b: 2172474 } },
  },
  'Nebraska Senate': {
    raceId: 87254, state: 'NE',
    profile: { floor: 0.003, trust: 1, lean: 0, sd: 0.07, spread: 0.35, note: 'AP expects about 4,700 more votes, mostly from Douglas County (Omaha), where Osborn runs about 61%. Late batches have run about 64% Osborn. The second-place guess needs Osborn to finish at 47.2% or more, which would take about 85% of what’s left.', done: 'Counties finish their canvasses this month.' },
    // Nov. 14: AP expects about 12,000 more. How they split, two reads that disagree: the feed's slow counties add up to 35%
    // Osborn; provisional ballots skew to Omaha and Lincoln (61%). An even split, with a wide 7-point uncertainty.
    reported: { asOf: '2026-11-20', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/nebraska-senate-results',
      // AP expects about 4,700 more on its count of 766,701; the feed is 500 ahead of that. Douglas County (Omaha, 61% Osborn) is
      // the one big county AP still has below 99%. The ~3,800 votes added since Nov. 14 ran 64% Osborn.
      left: 4200, countedAt: 767201, spread: 0.5, mix: 'state', at: { a: 338740, b: 382400 }, shareA: 0.6 },
  },

  'New Hampshire Senate': {
    raceId: 87283, state: 'NH',
    profile: { floor: 0.001, trust: 0.4, lean: 0, sd: 0.03, spread: 0.4, note: 'Hand-count towns are still trickling in, mostly in Cheshire and Coos counties. New Hampshire has same-day registration, so few provisional ballots.', done: 'Towns usually finish within days.' },
    reported: { asOf: '2026-11-09', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/new-hampshire-senate-results', left: 5765, countedAt: 637324, spread: 0.3, mix: 'county', at: { a: 355898, b: 268559 } },
  },
  'North Carolina Senate': {
    raceId: 87346, state: 'NC',
    profile: { floor: 0.008, trust: 1, lean: 0.01, sd: 0.05, spread: 0.4, note: 'All counties have reported. Left: provisional ballots and overseas mail, reviewed before the county canvass.', done: 'County canvass Nov. 13.' },
    reported: { asOf: '2026-11-09', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/north-carolina-senate-results', left: 18399, countedAt: 4222769, spread: 0.3, mix: 'state', at: { a: 2481017, b: 1648945 } },
  },
  'Ohio Senate (special)': {
    raceId: 87527, state: 'OH',
    profile: { floor: 0.025, trust: 0.25, lean: 0.05, sd: 0.05, spread: 0.4, note: 'About 58,000 votes are still out, per AP, mostly provisional ballots added at the official canvass. The ones counted so far have run about 63% Brown.', done: 'Official canvass must finish by Nov. 24.' },
    reported: { asOf: '2026-11-20', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-special-elections/ohio-senate-results',
      // AP is about 36,000 votes ahead of the feed (63.5% Brown head to head since Nov. 9) and expects about 58,000 more.
      left: 58000, countedAt: 4637683, spread: 0.3, mix: 'state', counts: { a: 2323001, b: 2090390, others: 224292 }, at: { a: 2323001, b: 2090390 } },
  },
  'Texas Senate': {
    raceId: 87438, state: 'TX',
    profile: { floor: 0.003, trust: 0.7, lean: 0, sd: 0.04, spread: 0.5, note: 'Big counties show 99% but rounding hides what’s left. Late mail and overseas ballots have a few more days.', done: 'County canvass within two weeks.' },
    reported: { asOf: '2026-11-09', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/texas-senate-results', left: 38797, countedAt: 9901259, spread: 0.3, mix: 'state', at: { a: 5449424, b: 4251750 } },
  },
}

/** Side bets, by market title. A side bet with no entry here is left out of the math, and the page says so. */
export const SIDE_RACES: Record<string, KeyRace> = {
  'Kansas Senate': {
    raceId: 87162, state: 'KS',
    profile: { floor: 0.012, trust: 1, lean: 0.02, sd: 0.06, spread: 0.4, note: 'The big counties’ provisional ballots are in, using AP’s count because the feed hasn’t caught up: about 14,800 votes at 65% Hamilton. AP expects about 1,100 more.', done: 'The state certifies by Dec. 1.' },
    reported: { asOf: '2026-11-20', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/kansas-senate-results',
      // Nov. 20: AP has Sedgwick County's provisionals in (+2,612 Hamilton, +1,561 Marshall) and about 1,100 votes left.
      left: 1100, countedAt: 1116781, spread: 0.5, mix: 'state', counts: { a: 571573, b: 511360, others: 33848 }, at: { a: 571573, b: 511360 }, shareA: 0.57 },
  },
  'New York governor': {
    raceId: 87329, state: 'NY',
    profile: { floor: 0.03, trust: 0.6, lean: 0.02, sd: 0.04, spread: 0.4, note: 'AP expects about 240,000 more votes, mostly in New York City. Counties must certify by Nov. 28, and many report in a few big batches.' },
    reported: { asOf: '2026-11-20', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/new-york-governor-results',
      // AP is about 64,000 votes ahead of the feed and expects about 240,000 more, mostly in New York City. In 2022 New York's late
      // count ran about 13 points more Democratic than the earlier tally; geography alone (the city counting late) gives 66%.
      left: 240000, countedAt: 6141704, spread: 0.35, mix: 'state', counts: { a: 3670764, b: 2457976, others: 12964 }, at: { a: 3670764, b: 2457976 }, shareA: 0.69 },
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
  profile: { floor: 0.015, trust: 0.5, lean: 0, sd: 0.06, spread: 0.5, note: 'Nearly done: AP expects about 1,300 more votes. NBC has projected Colom.' },
  reported: { asOf: '2026-11-14', source: 'AP via NBC', url: 'https://www.nbcnews.com/politics/2026-elections/mississippi-senate-results', left: 1300, countedAt: 971660, spread: 0.35, mix: 'county', at: { a: 479404, b: 471817 }, shareA: 0.5 },
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

/** Dates worth coming back for, shown while that bet is undecided. `bet` is the market title. */
export const WHATS_NEXT: { date: string; bet: string; text: string }[] = [
  { date: '2026-11-16', bet: 'Kansas Senate', text: 'Kansas: Sedgwick County certifies its provisional ballots' },
  { date: '2026-12-01', bet: 'Kansas Senate', text: 'Kansas: state certifies the results' },
  { date: '2026-11-18', bet: 'Alaska Senate', text: 'Alaska: last overseas ballots due, then the ranked-choice count if nobody has 50%' },
  { date: '2026-11-25', bet: 'Maine Senate', text: 'Maine: official results due to the governor' },
  { date: '2026-11-28', bet: 'New York governor', text: 'New York: counties must certify' },
]
