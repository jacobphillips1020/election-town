// Which guess would win the bet if the final number landed at each point. This is the payout rule drawn as a line:
// right side first, then closest guess. tests/live.test.ts checks it against the real payout.
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
