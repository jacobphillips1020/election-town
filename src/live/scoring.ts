// The pool's payout rule, in TypeScript, so the projection scores simulated results exactly as settlement will.
// Must match app.compute_outcome in the database. tests/live.test.ts runs both on random results and requires identical cents.

export type ScoreEntry = {
  id: string
  cents: number
  winner: string | null
  /** Vote share guess in tenths of a percent, per candidate id. */
  shares: Record<string, number> | null
  /** Republican seats guess (seat bets). */
  r: number | null
}
export type RaceOutcome = { winner: string; share: number }
export type SeatOutcome = { r: number }
export type Payout = { gross: number; refund: number }

/** Payout per entry, same order as `entries`. All amounts are whole cents. */
export function payouts(entries: ScoreEntry[], outcome: RaceOutcome | SeatOutcome): Payout[] {
  const seat = 'r' in outcome
  const rows = entries.map((e) => {
    const eligible = seat ? e.r != null : e.winner === (outcome as RaceOutcome).winner
    const err = !eligible ? null : seat
      ? Math.abs((e.r as number) - (outcome as SeatOutcome).r)
      : Math.abs((e.shares?.[(outcome as RaceOutcome).winner] as number) - (outcome as RaceOutcome).share)
    return { id: e.id, cents: e.cents, eligible, err }
  })
  const out: Payout[] = entries.map(() => ({ gross: 0, refund: 0 }))
  // One layer per stake level: everyone is in the first layer, only bigger stakes are in the next.
  const levels = [...new Set(rows.map((r) => r.cents))].sort((a, b) => a - b)
  let prev = 0
  for (const lvl of levels) {
    const part = rows.map((r) => Math.min(r.cents, lvl) - Math.min(r.cents, prev))
    const pool = part.reduce((a, b) => a + b, 0)
    const inLayer = rows.map((r) => r.cents >= lvl)
    const n = inLayer.filter(Boolean).length
    const ne = rows.filter((r, i) => inLayer[i] && r.eligible).length
    if (n < 2 || ne === 0) {
      part.forEach((p, i) => { out[i].refund += p })
    } else {
      const best = Math.min(...rows.filter((r, i) => inLayer[i] && r.eligible).map((r) => r.err as number))
      const winners = rows.map((r, i) => ({ r, i })).filter(({ r, i }) => inLayer[i] && r.eligible && r.err === best)
        .sort((a, b) => (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0))
      const each = Math.floor(pool / winners.length)
      const left = pool % winners.length
      winners.forEach(({ i }, rank) => { out[i].gross += each + (rank < left ? 1 : 0) })
    }
    prev = lvl
  }
  return out
}
