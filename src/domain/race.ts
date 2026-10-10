import type { Candidate, Entry, Shares } from './types'

/** "51.8" -> 518. Rejects blanks, negatives, more than one decimal place, and anything over 100. */
export function parseTenths(input: string): number | null {
  const s = input.trim()
  if (!/^\d{1,3}(\.\d?)?$/.test(s)) return null
  const n = Math.round(parseFloat(s) * 10)
  return n >= 0 && n <= 1000 ? n : null
}

export type Draft = {
  winnerId: string | null
  winnerPct: string
  opponentId: string | null
  /** Percent strings for every key that is neither the winner nor the principal opponent (including "other"). */
  adjust: Record<string, string>
}

export type Allocation = {
  shares: Shares | null
  errors: string[]
  opponentId: string | null
  lines: { id: string; label: string; tenths: number | null; auto: boolean }[]
}

/**
 * Turns the simple form (winner + share, remainder to the principal opponent, optional adjustments)
 * into a complete distribution that totals exactly 100.0%.
 */
export function allocate(candidates: Candidate[], hasOther: boolean, d: Draft): Allocation {
  const errors: string[] = []
  const keys = [...candidates.map((c) => c.id), ...(hasOther ? ['other'] : [])]
  const label = (k: string) => (k === 'other' ? 'Other candidates' : candidates.find((c) => c.id === k)!.name)
  const winner = d.winnerId && keys.includes(d.winnerId) ? d.winnerId : null
  if (!winner) errors.push('Pick a winner.')
  const opponent =
    (d.opponentId && d.opponentId !== winner && candidates.some((c) => c.id === d.opponentId) ? d.opponentId : null) ??
    candidates.find((c) => c.id !== winner)?.id ??
    null
  const winnerT = parseTenths(d.winnerPct)
  if (winner && (winnerT === null || winnerT < 1)) errors.push("Enter the winner's share, like 51.8.")

  const lines: Allocation['lines'] = []
  let used = winnerT ?? 0
  const shares: Shares = {}
  for (const k of keys) {
    if (k === winner) {
      lines.push({ id: k, label: label(k), tenths: winnerT, auto: false })
      shares[k] = winnerT ?? 0
    } else if (k !== opponent) {
      const raw = d.adjust[k] ?? ''
      const t = raw.trim() === '' ? 0 : parseTenths(raw)
      if (t === null) errors.push(`${label(k)}: use a number with at most one decimal.`)
      lines.push({ id: k, label: label(k), tenths: t, auto: false })
      shares[k] = t ?? 0
      used += t ?? 0
    }
  }
  const remainder = 1000 - used
  if (opponent) {
    if (remainder < 0 && winnerT !== null) errors.push('Shares add up to more than 100%.')
    lines.push({ id: opponent, label: label(opponent), tenths: remainder, auto: true })
    shares[opponent] = remainder
  }
  lines.sort((a, b) => keys.indexOf(a.id) - keys.indexOf(b.id))

  if (winner && winnerT !== null) {
    for (const c of candidates) {
      if (c.id !== winner && (shares[c.id] ?? 0) >= winnerT) {
        errors.push(`${label(winner)} must have a larger share than ${c.name}.`)
        break
      }
    }
  }
  return { shares: errors.length ? null : shares, errors, opponentId: opponent, lines }
}

export type Forecast = {
  n: number
  means: Record<string, number> // mean tenths per key
  leaderId: string | null
  runnerUpId: string | null
  marginTenths: number | null
}

/** Equal-weight mean of every entrant's full distribution (not the mean of each pick's winner share). */
export function groupForecast(candidates: Candidate[], hasOther: boolean, entries: Pick<Entry, 'shares'>[]): Forecast {
  const keys = [...candidates.map((c) => c.id), ...(hasOther ? ['other'] : [])]
  const rows = entries.filter((e) => e.shares)
  const means: Record<string, number> = {}
  for (const k of keys) means[k] = rows.length ? rows.reduce((s, e) => s + (e.shares![k] ?? 0), 0) / rows.length : 0
  const named = [...candidates].sort((a, b) => means[b.id] - means[a.id])
  const leader = rows.length ? named[0] : undefined
  const runner = rows.length ? named[1] : undefined
  return {
    n: rows.length,
    means,
    leaderId: leader?.id ?? null,
    runnerUpId: runner?.id ?? null,
    marginTenths: leader && runner ? means[leader.id] - means[runner.id] : null,
  }
}
