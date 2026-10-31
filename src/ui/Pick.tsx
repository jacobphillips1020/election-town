// The two kinds of pick, shared by the ballot and side bets:
//   a race: tap the winner, then set their share of the two-candidate vote;
//   a seat count: Republican seats, with a slider and a number box.
import type { BoardPolling } from '../domain/board'
import { lastName, ratingTone } from '../domain/board'
import type { CSSProperties } from 'react'
import { expertShort, inkFor, leanColor, seatLean, shareLean, sideOf, twoWay, winsBy, type Expert, type PickDraft } from '../domain/pool'
import type { Market } from '../domain/types'

export function RatingChip({ rating, prefix, title }: { rating: string; prefix?: string; title?: string }) {
  const t = ratingTone(rating)
  return <span className={`rate ${t.side ? `rate-${t.side.toLowerCase()}${t.level}` : 'rate-toss'}`} title={title}>{prefix && <b>{prefix} </b>}{rating}</span>
}

const fmtDate = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export function Experts({ experts }: { experts: Expert[] | null | undefined }) {
  if (!experts?.length) return null
  return (
    <span className="experts">
      {experts.map((e) => (
        <RatingChip key={e.source} rating={e.rating} prefix={expertShort(e.source)}
          title={`${e.source}: ${e.rating}${e.as_of ? `, as of ${fmtDate(e.as_of)}` : ''}`} />
      ))}
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
  // The share box takes the winner's color, deeper the bigger the win (pale near 50%).
  const ws = w ? sideOf(w) : null
  // Plain white for a coin-flip call (so it doesn't look disabled); tinted once the margin is a point or more.
  const boxBg = ws && Number.isFinite(share) && share >= 50.5 ? leanColor((ws === 'R' ? 1 : -1) * (0.34 + 0.66 * shareLean(share)), ws === 'I' ? 'I' : 'D') : null
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
          <label htmlFor={`share-${m.id}`}>{lastName(w.name, w.name)}&rsquo;s two-way vote share</label>
          <div className="share-row">
            <button type="button" className="btn ghost step" disabled={disabled} aria-label="Lower by 0.5" onClick={() => onChange({ ...value, share: step(value?.share, -0.5) })}>−</button>
            <span className="share-box">
              <input id={`share-${m.id}`} inputMode="decimal" value={value?.share ?? ''} disabled={disabled}
                style={boxBg ? { background: boxBg, color: inkFor(boxBg), borderColor: boxBg } : undefined}
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

const CHAMBER = {
  senate: { total: 100, control: 50, full: 8 },
  house: { total: 435, control: 218, full: 30 },
} as const

/**
 * Republican seats as a tug-of-war: the track runs from deep blue through a neutral tan at the control line to
 * deep red, and the handle takes the color of wherever you land. No words; the color is the read-out.
 */
export function SeatPick({ id, chamber, value, onChange, min, max, disabled }: {
  id: string; chamber: keyof typeof CHAMBER; value: string | undefined; onChange: (r: string) => void; min: number; max: number; disabled?: boolean
}) {
  const c = CHAMBER[chamber]
  const n = /^\d{1,3}$/.test(value ?? '') && +value! <= c.total ? +value! : null
  const at = (v: number) => leanColor(seatLean(v, c.control, c.full))
  const track = `linear-gradient(90deg, ${Array.from({ length: 13 }, (_, i) => {
    const v = min + ((max - min) * i) / 12
    return `${at(v)} ${((i / 12) * 100).toFixed(1)}%`
  }).join(', ')})`
  const lean = n === null ? '#9a937f' : at(n)
  const linePct = ((c.control - 0.5 - min) / (max - min)) * 100
  const style = { '--track': track, '--lean': lean } as CSSProperties
  return (
    <div className="seatpick" style={style}>
      <div className="seat-nums">
        <span className="seat-other"><b>{n === null ? '–' : c.total - n}</b> Dem + Ind</span>
        <span className="seat-r">
          <label htmlFor={`seats-${id}`} className="sr-only">Republican seats</label>
          <input id={`seats-${id}`} inputMode="numeric" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 3))} />
          <span>Rep</span>
        </span>
      </div>
      <div className="seat-track">
        <input type="range" min={min} max={max} step={1} value={n ?? Math.round(c.control - 0.5)} disabled={disabled}
          aria-label="Republican seats" aria-valuetext={n === null ? 'Not set' : `${n} Republican seats`}
          className={`seat-range${n === null ? ' unset' : ''}`} onChange={(e) => onChange(e.target.value)} />
        <span className="seat-line" style={{ left: `calc(15px + (100% - 30px) * ${(linePct / 100).toFixed(4)})` }} aria-hidden="true" />
      </div>
    </div>
  )
}
