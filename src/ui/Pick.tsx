// The two kinds of pick, shared by the ballot and side bets:
//   a race: tap the winner, then set their share of the two-candidate vote;
//   a seat count: Republican seats, with a slider and a number box.
import type { BoardPolling } from '../domain/board'
import { lastName, ratingTone } from '../domain/board'
import { expertShort, sideOf, twoWay, winsBy, type Expert, type PickDraft } from '../domain/pool'
import type { Market } from '../domain/types'

export function RatingChip({ rating, prefix }: { rating: string; prefix?: string }) {
  const t = ratingTone(rating)
  return <span className={`rate ${t.side ? `rate-${t.side.toLowerCase()}${t.level}` : 'rate-toss'}`}>{prefix && <b>{prefix} </b>}{rating}</span>
}

export function Experts({ experts }: { experts: Expert[] | null | undefined }) {
  if (!experts?.length) return null
  return (
    <span className="experts">
      {experts.map((e) => <RatingChip key={e.source} rating={e.rating} prefix={expertShort(e.source)} />)}
    </span>
  )
}

export function Links({ links }: { links: { label: string; href: string }[] }) {
  if (!links.length) return null
  return (
    <span className="links">
      {links.map((l) => <a key={l.label} href={l.href} target="_blank" rel="noreferrer">{l.label} ↗</a>)}
    </span>
  )
}

const step = (s: string | undefined, by: number) => {
  const n = Math.round(((parseFloat(s ?? '') || 50) + by) * 10) / 10
  return Math.min(99.9, Math.max(50.1, n)).toFixed(1)
}

export function RacePick({ m, polling, value, onChange, disabled }: {
  m: Pick<Market, 'id' | 'candidates'>
  polling: BoardPolling | null
  value: PickDraft | undefined
  onChange: (d: PickDraft) => void
  disabled?: boolean
}) {
  const polls = twoWay(m, polling)
  const w = m.candidates.find((c) => c.id === value?.winner)
  const share = parseFloat(value?.share ?? '')
  const choose = (id: string) => {
    if (disabled) return
    const p = polls?.[id]
    onChange({ winner: id, share: value?.winner === id ? value.share : (p && p > 50 ? p : 50.5).toFixed(1) })
  }
  return (
    <div className="pick">
      <div className="pick-cands" role="radiogroup" aria-label="Winner">
        {m.candidates.map((c) => {
          const s = sideOf(c)
          const on = value?.winner === c.id
          return (
            <button key={c.id} type="button" role="radio" aria-checked={on} disabled={disabled}
              className={`cand cand-${s.toLowerCase()}${on ? ' on' : ''}`} onClick={() => choose(c.id)}>
              <span className="cand-name">{c.name}</span>
              <span className="cand-meta">{s === 'I' ? 'Independent' : s === 'D' ? 'Democrat' : 'Republican'}{polls && ` · polls ${polls[c.id].toFixed(1)}%`}</span>
            </button>
          )
        })}
      </div>
      {w && (
        <div className="share">
          <label htmlFor={`share-${m.id}`}>{lastName(w.name, w.name)}&rsquo;s share of the two-way vote</label>
          <div className="share-row">
            <button type="button" className="btn ghost step" disabled={disabled} aria-label="Lower by 0.5" onClick={() => onChange({ ...value, share: step(value?.share, -0.5) })}>−</button>
            <span className="share-box">
              <input id={`share-${m.id}`} inputMode="decimal" value={value?.share ?? ''} disabled={disabled}
                onChange={(e) => onChange({ ...value, share: e.target.value })} />
              <span>%</span>
            </span>
            <button type="button" className="btn ghost step" disabled={disabled} aria-label="Raise by 0.5" onClick={() => onChange({ ...value, share: step(value?.share, 0.5) })}>+</button>
            <span className="share-note">
              {Number.isFinite(share) && share > 50 && share < 100 ? <>{lastName(w.name, w.name)} {winsBy(share)}</> : 'over 50%'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export function SeatPick({ id, total, value, onChange, min, max, disabled }: {
  id: string; total: number; value: string | undefined; onChange: (r: string) => void; min: number; max: number; disabled?: boolean
}) {
  const n = /^\d{1,3}$/.test(value ?? '') ? +value! : null
  return (
    <div className="seatpick">
      <div className="seat-nums">
        <span className="seat-other"><b>{n === null ? '–' : total - n}</b> Dem + Ind</span>
        <span className="seat-r">
          <label htmlFor={`seats-${id}`} className="sr-only">Republican seats</label>
          <input id={`seats-${id}`} inputMode="numeric" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 3))} />
          <span>Rep</span>
        </span>
      </div>
      <input type="range" min={min} max={max} step={1} value={n ?? Math.round((min + max) / 2)} disabled={disabled}
        aria-label="Republican seats" className="seat-range" onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
