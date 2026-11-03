// The Senate math behind the map and the seat pick: who holds what, and what a set of picks adds up to.
// The 120th Congress Senate = 65 seats not up in 2026 + 35 races (33 regular + Ohio and Florida specials).

export type Side = 'D' | 'R' | 'I'

/** Seats not up in 2026. "D" includes the two independents who caucus with Democrats (King, Sanders). */
export const NOT_UP = { D: 34, R: 31 } as const
/** Today's Senate (119th Congress): 53 Republicans, 45 Democrats + 2 independents. */
export const SENATE_NOW_R = 53
/** Republicans keep control at 50 (Vice President Vance breaks ties); Democrats need 51. */
export const SENATE_CONTROL_R = 50
/** Elected in 2024 (the House's starting point for the 2026 cycle). */
export const HOUSE_2024_R = 220
export const HOUSE_MAJORITY = 218

/** Senate race key: state code, "*" marks the special elections (Ohio, Florida). */
export const senateKey = (state: string, special: boolean) => (special ? `${state}*` : state)

const R_HELD = 'AL AK AR FL* ID IA KS KY LA ME MS MT NE NC OH* OK SC SD TN TX WV WY'.split(' ')
const D_HELD = 'CO DE GA IL MA MI MN NH NJ NM OR RI VA'.split(' ')
/** Which party holds each seat that's up (before the election). */
export const HELD_BY: Record<string, 'D' | 'R'> = Object.fromEntries([
  ...R_HELD.map((k) => [k, 'R'] as const), ...D_HELD.map((k) => [k, 'D'] as const),
])

export type SenatePolling = { dem_avg: number | null; rep_avg: number | null; margin_label: string | null; rating: string | null }
export type SenateRace = { state: string; special: boolean; polling: SenatePolling | null }

/** The non-Republican side of a race: Nebraska's is an independent (Osborn); everywhere else a Democrat. */
export const leftSide = (state: string): Side => (state === 'NE' ? 'I' : 'D')

/** Who leads the polls (ties go to the party holding the seat); the holder when there's no average. */
export function pollLeader(r: SenateRace): Side {
  const p = r.polling
  const held = HELD_BY[senateKey(r.state, r.special)] ?? 'R'
  if (p?.dem_avg == null || p.rep_avg == null || p.dem_avg === p.rep_avg) return held === 'D' ? leftSide(r.state) : 'R'
  return p.dem_avg > p.rep_avg ? leftSide(r.state) : 'R'
}

/**
 * Republican Senate seats if each race goes as given. `picks` maps a race key to the side picked;
 * races without a pick follow the polls (or the holder when unpolled).
 */
export function senateR(races: SenateRace[], picks: Record<string, Side | undefined> = {}): number {
  return races.reduce<number>((n, r) => n + ((picks[senateKey(r.state, r.special)] ?? pollLeader(r)) === 'R' ? 1 : 0), NOT_UP.R)
}

/**
 * What a ballot adds up to: Republican seats if each picked race goes as picked and every other race (blank, or not
 * on the ballot) stays with the party holding it. Picking the current party everywhere gives today's 53. Deliberately
 * not poll-based, so a thin poll lead in a race nobody picked can't move the number.
 */
export function impliedSenateR(races: Pick<SenateRace, 'state' | 'special'>[], picks: Record<string, Side | undefined> = {}): number {
  return races.reduce<number>((n, r) => {
    const k = senateKey(r.state, r.special)
    return n + ((picks[k] ?? HELD_BY[k]) === 'R' ? 1 : 0)
  }, NOT_UP.R)
}

/** "R 47 · D 53" style split for a Republican seat count. */
export function seatSplit(r: number, total: number) {
  return { r, other: total - r }
}

export function senateControl(r: number): 'R' | 'D' {
  return r >= SENATE_CONTROL_R ? 'R' : 'D'
}
