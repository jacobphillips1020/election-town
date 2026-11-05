// Results: where the count stands and what it means for the money. Every number comes from one set of simulated finishes
// (src/live/model.ts). Each mark here carries something a bettor needs: the needle is the one race still in doubt, the bars
// are how far each person's money can still move, the strips show why a guess is ahead.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp, useRpc } from '../data/context'
import { inkFor, leanColor } from '../domain/pool'
import type { Side } from '../domain/senate'
import type { Bettor, MemberBet, MembersLive, PublicBet, PublicLive } from '../live/model'
import { shortName } from '../live/names'
import { Err, Loading } from './common'

type Payload = { live: PublicLive; members: MembersLive | null; previous: { fetched_at: string; bets: { id: string; pA: number | null }[] } | null }

const lastName = (n: string) => n.trim().split(/\s+/).pop() as string
const partyColor = (p?: string) => (p === 'R' ? '#b42318' : p === 'I' ? '#8a6a14' : '#1d4f9f')
const chance = (p: number) => (p > 0.99 && p < 1 ? '>99%' : p >= 1 ? '100%' : p > 0 && p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`)
const dollars = (cents: number) => `${cents < 0 ? '−' : cents > 0 ? '+' : ''}$${Math.abs(Math.round(cents / 100)).toLocaleString('en-US')}`
const namesText = (names: string[]) => (names.length < 3 ? names.join(' & ') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`)
const roughly = (n: number) => (n >= 10000 ? Math.round(n / 1000) * 1000 : Math.round(n / 100) * 100).toLocaleString('en-US')
const etTime = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d).replace(':00', '').replace(' AM', ' a.m.').replace(' PM', ' p.m.')
const etStamp = (d: Date) => `${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(d)}, ${etTime(d)} ET`

/** The job runs at these UTC hours (vercel.json); Vercel starts it some time within that hour. */
const RUN_HOURS = [1, 7, 13, 19]
function nextRun(after: Date) {
  for (let i = 0; i < 48; i++) {
    const t = new Date(Math.ceil(after.getTime() / 3600e3 + i) * 3600e3)
    if (RUN_HOURS.includes(t.getUTCHours()) && t.getTime() > after.getTime() + 30 * 60e3) return t
  }
  return new Date(after.getTime() + 6 * 3600e3)
}

export function ResultsPage() {
  const { data, error, loading } = useRpc<Payload | null>('get_live')
  if (loading && !data) return <Loading />
  if (error) return <main className="page" id="main"><Err>{error}</Err></main>
  if (!data) return <main className="page" id="main"><h1 className="lv-h1">Results</h1><p className="muted">The first estimate hasn’t run yet.</p></main>
  return <Results data={data} />
}

function Results({ data }: { data: Payload }) {
  const { me } = useApp()
  const { live, members, previous } = data
  const memberOf = useMemo(() => new Map((members?.bets ?? []).map((b) => [b.id, b])), [members])
  const myName = me?.display_name ? shortName(me.display_name) : null
  const leadOf = (b: PublicBet) => {
    const m = memberOf.get(b.id)
    if (m) return Math.max(m.rows[0]?.p ?? 0, m.refund)
    return b.pA != null ? Math.max(b.pA, 1 - b.pA) : Math.max(...(b.hist ?? []).map((h) => h.p), 0)
  }
  const isOpen = (b: PublicBet) => !b.settled && leadOf(b) <= 0.99
  const main = live.bets.filter((b) => !b.side)
  const side = live.bets.filter((b) => b.side)
  const openBets = live.bets.filter(isOpen)
  const openCount = openBets.length
  const openPot = openBets.reduce((a, b) => a + b.pot_cents, 0)
  const needle = live.bets.find((b) => b.id === live.needle)
  const fetched = new Date(live.fetched_at)
  const stale = Date.now() - fetched.getTime() > 8 * 3600e3

  return (
    <main className="page lv" id="main">
      <header className="lv-head">
        <h1 className="lv-h1">Results are still coming in</h1>
        <p className="lv-stat"><b>{openCount} of {live.bets.length}</b> bets undecided, <b>${Math.round(openPot / 100)}</b> of ${Math.round(live.pot_cents / 100)} still in play</p>
        <p className="small muted">
          Updated {etStamp(fetched)}. {stale ? <strong className="lv-stale">This is older than it should be.</strong> : <>Next around {etTime(nextRun(fetched))}</>}
        </p>
      </header>

      {needle && <Needle bet={needle} before={previous?.bets.find((b) => b.id === needle.id)?.pA ?? null} members={memberOf.get(needle.id)} />}

      {members ? <BettorTable bettors={members.bettors} me={myName} /> : (
        <section className="lv-card">
          <h2 className="lv-h2">The money</h2>
          <p className="small muted">Who’s up and who’s down is for people in the pool. <Link to="/auth?next=/results">Sign in</Link> to see it.</p>
        </section>
      )}

      <p className="small muted lv-key">
        On each strip, the gray bar is where the final number should land, 9 times in 10. Dots are guesses, colored by who they picked.
        The label says how safe the leading guess is. “Called” means it’s over 99% to win the bet by this estimate. A TV call or a full count doesn’t decide it.
      </p>

      <BetGroup title="Main ballot" bets={main} memberOf={memberOf} isOpen={isOpen} leadOf={leadOf} me={myName} />
      {side.length > 0 && <BetGroup title="Side bets" bets={side} memberOf={memberOf} isOpen={isOpen} leadOf={leadOf} me={myName} />}
      {live.unmodeled.length > 0 && <p className="small muted">Not included, no vote source yet: {live.unmodeled.join(', ')}.</p>}

      <details className="lv-method">
        <summary>How this is worked out</summary>
        <ol>
          <li>Votes come from <a href="https://civicapi.org" target="_blank" rel="noreferrer">civicAPI</a>, by county, four times a day.</li>
          <li>For each race: how many votes are left (what the feed reports, plus late ballots it can’t see) and how they’ll split (each county’s split so far, plus how that state’s late vote usually runs). We’re unsure of both, and that uncertainty is in the ranges.</li>
          <li>Alaska adds the ranked-choice step: if nobody reaches 50%, the last-place candidates’ ballots move to their next choice, or drop out if there isn’t one.</li>
          <li>The computer plays out {live.draws.toLocaleString('en-US')} possible finishes. Each one scores every bet the way the real payout does: right winner, closest vote share to a tenth of a point, ties split.</li>
          <li>Chances, projected money and bets won all count those same finishes, so they always add up. Projected money sums to $0. A split counts as a share of a bet won.</li>
        </ol>
        <p className="small muted">The estimates of late votes are judgment calls, mostly from past elections. Treat them as a good guess, not a fact. Nothing here pays out: the admin still enters each official result.</p>
      </details>
    </main>
  )
}

// ---------------------------------------------------------------- the needle

// The dial is just a chance scale for the candidates: darker means surer. Lean words are only ever about a bettor.
const STEPS = Array.from({ length: 24 }, (_, i) => [i / 24, (i + 1) / 24] as const)
const SCALE: [number, string][] = [[0.1, '90%'], [0.25, '75%'], [0.75, '75%'], [0.9, '90%']]
const CX = 160
const CY = 150
const polar = (t: number, r: number) => { const a = Math.PI * (1 - t); return [CX + r * Math.cos(a), CY - r * Math.sin(a)] }
function arc(t0: number, t1: number, r0: number, r1: number) {
  const [x0, y0] = polar(t0, r1)
  const [x1, y1] = polar(t1, r1)
  const [x2, y2] = polar(t1, r0)
  const [x3, y3] = polar(t0, r0)
  return `M${x0} ${y0}A${r1} ${r1} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 0 0 ${x3} ${y3}Z`
}

function Needle({ bet, before, members }: { bet: PublicBet; before: number | null; members?: MemberBet }) {
  const [a, b] = bet.candidates
  const pA = bet.pA as number
  const t = 1 - pA
  const [shown, setShown] = useState(0.5)
  useEffect(() => { const id = requestAnimationFrame(() => setShown(t)); return () => cancelAnimationFrame(id) }, [t])
  const leader = pA >= 0.5 ? a : b
  const lead = Math.max(pA, 1 - pA)
  const moved = before != null && Math.abs(before - pA) >= 0.01
  const left = (a.party === 'R' ? 'D' : a.party) as Side
  const dialColor = (x: number) => leanColor((x - 0.5) * 2, left)
  const share = bet.share!
  const leaderShare = (x: number) => (leader === a ? x : 100 - x)
  const lo = Math.min(leaderShare(share.p5), leaderShare(share.p95))
  const hi = Math.max(leaderShare(share.p5), leaderShare(share.p95))
  return (
    <section className="lv-card lv-needle" aria-label={`${bet.title}: ${leader.name} ${chance(lead)} to win`}>
      <h2 className="lv-h2">{bet.title}: the race still in doubt</h2>
      <svg viewBox="0 0 320 172" role="img" aria-hidden="true">
        {STEPS.map(([t0, t1]) => (
          <path key={t0} d={arc(t0, t1, 96, 132)} fill={dialColor((t0 + t1) / 2)} stroke={dialColor((t0 + t1) / 2)} strokeWidth=".5" />
        ))}
        {SCALE.map(([x, s]) => {
          const [px, py] = polar(x, 114)
          return <text key={x} x={px} y={py + 3.5} textAnchor="middle" className="lv-dial-label" fill={inkFor(dialColor(x))}>{s}</text>
        })}
        {(() => { const [x0, y0] = polar(0.5, 96); const [x1, y1] = polar(0.5, 132); return <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--paper)" strokeWidth="2" /> })()}
        {moved && (() => { const [gx, gy] = polar(1 - (before as number), 92); return <line x1={CX} y1={CY} x2={gx} y2={gy} className="lv-ghost" /> })()}
        <g className="lv-pointer" style={{ transform: `rotate(${(shown - 0.5) * 180}deg)`, transformOrigin: `${CX}px ${CY}px` }}>
          <line x1={CX} y1={CY} x2={CX} y2={CY - 93} className="lv-pointer-line" />
        </g>
        <circle cx={CX} cy={CY} r="7" fill="var(--ink)" />
        <text x="4" y="168" className="lv-dial-end">{lastName(a.name)}</text>
        <text x="316" y="168" textAnchor="end" className="lv-dial-end">{lastName(b.name)}</text>
      </svg>
      <p className="lv-needle-big"><span style={{ color: partyColor(leader.party) }}>{lastName(leader.name)}</span> {chance(lead)} <span className="lv-needle-unit">to win</span></p>
      {moved && <p className="small muted lv-center">Was {chance(pA >= 0.5 ? (before as number) : 1 - (before as number))} at the last update (thin line).</p>}
      <p className="small lv-center">
        {lastName(leader.name)}’s final share: <b>{leaderShare(share.p50).toFixed(1)}%</b>, likely {lo.toFixed(1)}–{hi.toFixed(1)}. {Math.round(bet.pct as number)}% counted, about {roughly(bet.left!.mid)} votes left.
      </p>
      {members && members.refund > 0.005 && <p className="small muted lv-center">Nobody in the pool picked {lastName((members.ticks.some((x) => x.side === a.id) ? b : a).name)}.</p>}
      <p className="small muted">{bet.note} {bet.done}</p>
    </section>
  )
}

// ---------------------------------------------------------------- the money

function BettorTable({ bettors, me }: { bettors: Bettor[]; me: string | null }) {
  const min = Math.min(0, ...bettors.map((b) => b.lo))
  const max = Math.max(0, ...bettors.map((b) => b.hi))
  const pad = (max - min) * 0.04 || 100
  const lo = min - pad
  const hi = max + pad
  const at = (c: number) => `${((c - lo) / (hi - lo)) * 100}%`
  const step = hi - lo > 20000 ? 10000 : 5000
  const ticks: number[] = []
  for (let c = Math.ceil(lo / step) * step; c <= hi; c += step) ticks.push(c)
  return (
    <section className="lv-card">
      <h2 className="lv-h2">The money</h2>
      <p className="small muted lv-sub">Projected win or loss on every bet, side bets included. Each bar is the range of 9 in 10 finishes.</p>
      <table className="lv-money">
        <thead>
          <tr><th scope="col">Name</th><th scope="col" className="lv-axis-cell"><span className="lv-vh">Range</span>
            <div className="lv-axis" aria-hidden="true">{ticks.map((c) => <span key={c} style={{ left: at(c) }}>{c === 0 ? '$0' : dollars(c)}</span>)}</div>
          </th><th scope="col" className="num">Money</th><th scope="col" className="num">Bets won</th></tr>
        </thead>
        <tbody>
          {bettors.map((b) => (
            <tr key={b.name} className={b.name === me ? 'me' : undefined}>
              <th scope="row">{b.name}</th>
              <td className="lv-range-cell">
                <div className="lv-range" role="img" aria-label={`${dollars(b.lo)} to ${dollars(b.hi)}`}>
                  <i className="lv-zero" style={{ left: at(0) }} />
                  <i className="lv-bar" style={{ left: at(b.lo), width: `calc(${at(b.hi)} - ${at(b.lo)})` }} />
                  <i className="lv-mid" style={{ left: at(b.net) }} />
                </div>
              </td>
              <td className="num"><b>{b.dollars === 0 ? '$0' : dollars(b.dollars * 100)}</b><small>{Math.abs(b.hi - b.lo) < 50 ? 'locked in' : `${dollars(b.lo)} to ${dollars(b.hi)}`}</small></td>
              <td className="num"><b>{b.bets.toFixed(1)}</b><small>of {b.of}</small></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// ---------------------------------------------------------------- the bets

type GroupProps = { title: string; bets: PublicBet[]; memberOf: Map<string, MemberBet>; isOpen: (b: PublicBet) => boolean; leadOf: (b: PublicBet) => number; me: string | null }

function BetGroup({ title, bets, memberOf, isOpen, leadOf, me }: GroupProps) {
  const open = bets.filter(isOpen).sort((a, b) => leadOf(a) - leadOf(b))
  const done = bets.filter((b) => !isOpen(b))
  return (
    <section className="lv-group">
      <h2 className="lv-group-title">{title}</h2>
      {open.length > 0 && <div className="lv-open">{open.map((b) => <BetCard key={b.id} bet={b} m={memberOf.get(b.id)} me={me} />)}</div>}
      {done.length > 0 && (
        <div className="lv-called">
          {done.map((b) => {
            const m = memberOf.get(b.id)
            return (
              <details key={b.id}>
                <summary>
                  <span className="lv-called-race"><b>{shortTitle(b)}</b><small>{standing(b)}</small></span>
                  {m?.refundLeads ? <span className="lv-called-who">Money back</span> : m?.rows[0] ? <span className={`lv-called-who${m.rows[0].names.includes(me ?? '') ? ' me' : ''}`}>{namesText(m.rows[0].names)}{m.rows[0].names.length > 1 ? ' split' : ''}</span> : <span />}
                  {m ? <LeanChip label={m.lean} /> : <b className="lv-p">{chance(leadOf(b))}</b>}
                </summary>
                <div className="lv-called-more">
                  {m && <Strip bet={b} m={m} />}
                  {b.note && <p className="small muted">{b.note} {b.done}</p>}
                  {!m && <p className="small muted">{details(b)}</p>}
                </div>
              </details>
            )
          })}
        </div>
      )}
    </section>
  )
}

const shortTitle = (b: PublicBet) => (b.kind === 'senate_seats' ? 'Senate seats' : b.kind === 'house_seats' ? 'House seats' : b.title.replace(' Senate (special)', '').replace(' Senate', '').replace(' House', ''))
function standing(b: PublicBet) {
  if (b.seatsMid != null) return `Republicans ${Math.round(b.seatsMid)}`
  const share = b.share!
  const aHead = share.p50 >= 50
  const c = aHead ? b.candidates[0] : b.candidates[1]
  return `${lastName(c.name)} ${(aHead ? share.p50 : 100 - share.p50).toFixed(1)}%`
}
function details(b: PublicBet) {
  if (b.seatsMid != null) return `Likely ${Math.round(b.seatsLo as number)}–${Math.round(b.seatsHi as number)} Republican seats.`
  return `${Math.round(b.pct as number)}% counted, about ${roughly(b.left!.mid)} votes left.`
}

function LeanChip({ label, who }: { label: string; who?: string }) {
  return <span className={`lv-chip lv-chip-${label.toLowerCase().replace(' ', '-')}`}>{label}{who ? ` ${who}` : ''}</span>
}

function BetCard({ bet, m, me }: { bet: PublicBet; m?: MemberBet; me: string | null }) {
  const race = bet.share != null
  const pA = bet.pA
  const head = race ? (pA as number) >= 0.5 ? bet.candidates[0] : bet.candidates[1] : null
  const raceLead = pA != null ? Math.max(pA, 1 - pA) : 1
  const headShare = (x: number) => (head === bet.candidates[0] ? x : 100 - x)
  const s = bet.share
  const shown = (m?.rows ?? []).filter((r) => r.p >= 0.005)
  const nobody = race && m ? bet.candidates.find((c) => !m.ticks.some((t) => t.side === c.id)) : null
  return (
    <article className="lv-card lv-bet">
      <header className="lv-bet-head">
        <h3>{shortTitle(bet)}{bet.pot_cents ? <small>${Math.round(bet.pot_cents / 100)}</small> : null}</h3>
        {m?.rows[0] && <LeanChip label={m.lean} who={m.refundLeads ? 'money back' : namesText(m.rows[0].names)} />}
      </header>
      {race && s && head ? (
        <p className="small lv-bet-line">
          <b style={{ color: partyColor(head.party) }}>{lastName(head.name)} {headShare(s.p50).toFixed(1)}%</b>, likely {Math.min(headShare(s.p5), headShare(s.p95)).toFixed(1)}–{Math.max(headShare(s.p5), headShare(s.p95)).toFixed(1)}.
          {raceLead < 0.99 && <> {chance(raceLead)} to win.</>} {Math.round(bet.pct as number)}% counted, about {roughly(bet.left!.mid)} left.
        </p>
      ) : (
        <p className="small lv-bet-line">
          Republicans: {bet.hist!.filter((h) => h.p >= 0.005).length <= 4
            ? bet.hist!.filter((h) => h.p >= 0.005).map((h, i) => <span key={h.r}>{i ? ' · ' : ''}<b>{h.r}</b> {chance(h.p)}</span>)
            : <>likely <b>{Math.round(bet.seatsLo as number)}–{Math.round(bet.seatsHi as number)}</b>.</>}
          {bet.open && bet.open.length > 0 && <span className="muted"> Depends on {bet.open.map((o) => `${o.title} (${lastName(o.leader)} ${chance(o.p)})`).join(' and ')}.</span>}
        </p>
      )}
      {m && <Strip bet={bet} m={m} />}
      {m && (
        <ol className="lv-board">
          {shown.map((r, i) => (
            <li key={r.names.join()} className={r.names.includes(me ?? '') ? 'me' : undefined}>
              <span className="lv-rank">{i + 1}</span>
              <span className="lv-who">{namesText(r.names)}{r.names.length > 1 && <small> split</small>}<small className="lv-guess">{guessText(bet, r.guess, r.side)}</small></span>
              <span className="lv-pbar" aria-hidden="true"><i style={{ width: `${Math.max(r.p * 100, 1)}%` }} /></span>
              <b className="lv-p">{chance(r.p)}</b>
            </li>
          ))}
          {m.refund >= 0.005 && nobody && (
            <li className="lv-refund"><span className="lv-rank">↩</span><span className="lv-who">If {lastName(nobody.name)} wins, nobody does.<small className="lv-guess">Money back</small></span><span className="lv-pbar" aria-hidden="true"><i style={{ width: `${m.refund * 100}%` }} /></span><b className="lv-p">{chance(m.refund)}</b></li>
          )}
        </ol>
      )}
      {bet.note && <p className="small muted lv-bet-note">{bet.note} {bet.done}</p>}
    </article>
  )
}

const guessText = (bet: PublicBet, guess: number, side: string | null) => {
  if (bet.share == null) return `guessed ${guess}`
  const c = bet.candidates.find((x) => x.id === side)
  if (!c) return ''
  return `guessed ${lastName(c.name)} ${(c === bet.candidates[0] ? guess : 100 - guess).toFixed(1)}`
}

/** One line per bet: where the final number should land, against everyone's guess. Democrats left, Republicans right, like the needle. */
function Strip({ bet, m }: { bet: PublicBet; m: MemberBet }) {
  const race = bet.share != null
  const xs = [...new Map(m.ticks.map((t) => [t.x + (t.side ?? ''), t])).values()]
  const lo0 = race ? (bet.share as NonNullable<PublicBet['share']>).p5 : (bet.seatsLo as number)
  const hi0 = race ? (bet.share as NonNullable<PublicBet['share']>).p95 : (bet.seatsHi as number)
  const mid = race ? (bet.share as NonNullable<PublicBet['share']>).p50 : (bet.seatsMid as number)
  const pad = race ? 0.3 : 1
  const lo = Math.min(lo0, ...xs.map((t) => t.x)) - pad
  const hi = Math.max(hi0, ...xs.map((t) => t.x)) + pad
  const L = 12
  const R = 308
  const px = (v: number) => (race ? L + ((hi - v) / (hi - lo)) * (R - L) : L + ((v - lo) / (hi - lo)) * (R - L))
  const AXIS = 46
  // Numbered dots sit in two lanes so close guesses stay readable.
  const lanes = [-1e9, -1e9]
  const ranked = xs.filter((t) => t.rank != null).sort((a, b) => px(a.x) - px(b.x)).map((t) => {
    const x = px(t.x)
    const lane = x - lanes[0] >= 18 ? 0 : 1
    lanes[lane] = x
    return { t, x, y: lane === 0 ? 28 : 10 }
  })
  const sideOf = (id: string | null) => bet.candidates.find((c) => c.id === id)?.party
  const endA = race ? `${hi.toFixed(1)}%` : String(Math.round(lo))
  const endB = race ? `${lo.toFixed(1)}%` : String(Math.round(hi))
  const flip = race && lo < 50 && hi > 50
  const flipLabel = flip && px(50) > L + 76 && px(50) < R - 34
  return (
    <svg className="lv-strip" viewBox="0 0 320 70" role="img" aria-label={race ? `${bet.candidates[0].name}'s share: likely ${lo0.toFixed(1)} to ${hi0.toFixed(1)} percent` : `Republican seats: likely ${Math.round(lo0)} to ${Math.round(hi0)}`}>
      <line x1={L} x2={R} y1={AXIS} y2={AXIS} className="lv-strip-axis" />
      {flip && <line x1={px(50)} x2={px(50)} y1={AXIS - 9} y2={AXIS + 9} className="lv-strip-flip" />}
      <rect x={Math.min(px(lo0), px(hi0)) - 1} width={Math.abs(px(hi0) - px(lo0)) + 2} y={AXIS - 5} height="10" rx="4" className="lv-strip-band" />
      <line x1={px(mid)} x2={px(mid)} y1={AXIS - 8} y2={AXIS + 8} className="lv-strip-mid" />
      {xs.filter((t) => t.rank == null).map((t, i) => <circle key={i} cx={px(t.x)} cy={AXIS} r="3.5" fill={race ? partyColor(sideOf(t.side)) : '#16181d'} stroke="var(--paper)" strokeWidth="1" />)}
      {ranked.map(({ t, x, y }) => (
        <g key={t.x + (t.side ?? '')}>
          <line x1={x} x2={x} y1={y} y2={AXIS} stroke={race ? partyColor(sideOf(t.side)) : '#16181d'} strokeWidth="1.25" />
          <circle cx={x} cy={y} r="8" fill={race ? partyColor(sideOf(t.side)) : '#16181d'} stroke="var(--paper)" strokeWidth="1.5" />
          <text x={x} y={y + 3.5} textAnchor="middle" className="lv-strip-num">{t.rank}</text>
        </g>
      ))}
      <text x={L} y="66" className="lv-strip-end">{race ? `${lastName(bet.candidates[0].name)} ${endA}` : endA}</text>
      {flipLabel && <text x={px(50)} y="66" textAnchor="middle" className="lv-strip-end">50%</text>}
      <text x={R} y="66" textAnchor="end" className="lv-strip-end">{endB}</text>
    </svg>
  )
}
