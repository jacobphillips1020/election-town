// Which guess would win the bet if the final number landed at each point. This is the payout rule drawn as a line:
// right side first, then closest guess. tests/live.test.ts checks it against the real payout.
import type { MemberBet, PublicBet } from './model.js'

export type Tick = { x: number; side: string | null }
export type Zone = { from: number; to: number; owner: string | null }

export const tickKey = (t: Tick) => `${t.x}|${t.side ?? ''}`

/** a and b are the candidate ids for a race (x is a's share, so a wins above 50). Seat bets leave them out. */
export function zones(ticks: Tick[], range: { lo: number; hi: number; a?: string; b?: string }): Zone[] {
  const { lo, hi, a, b } = range
  if (!(hi > lo)) return []
  const race = a != null
  const steps = 1200
  const out: Zone[] = []
  for (let i = 0; i < steps; i++) {
    const v = lo + ((i + 0.5) / steps) * (hi - lo)
    const eligible = race ? ticks.filter((t) => t.side === (v > 50 ? a : b)) : ticks
    let best: Tick | null = null
    for (const t of eligible) if (!best || Math.abs(t.x - v) < Math.abs(best.x - v)) best = t
    const owner = best ? tickKey(best) : null
    const from = lo + (i / steps) * (hi - lo)
    const to = lo + ((i + 1) / steps) * (hi - lo)
    const last = out[out.length - 1]
    if (last && last.owner === owner) last.to = to
    else out.push({ from, to, owner })
  }
  return out
}

/** The three guesses closest to the projected final, right side of the race first: the same order the payout uses. */
export function closestGuesses(bet: PublicBet, m: MemberBet) {
  const final = bet.share ? bet.share.p50 : (bet.seatsMid as number)
  const winner = bet.share ? bet.candidates[final > 50 ? 0 : 1].id : null
  const groups = new Map<string, { x: number; side: string | null; names: string[] }>()
  for (const t of m.ticks) {
    const g = groups.get(tickKey(t)) ?? { x: t.x, side: t.side, names: [] }
    g.names.push(t.name)
    groups.set(tickKey(t), g)
  }
  return [...groups.values()].map((g) => ({ ...g, right: winner == null || g.side === winner, miss: Math.abs(g.x - final) }))
    .sort((a, b) => Number(b.right) - Number(a.right) || a.miss - b.miss).slice(0, 3)
}

