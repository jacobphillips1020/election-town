// Results: where each final number could land, and which guess wins if it lands there. Every figure comes from one set of
// simulated finishes (src/live/model.ts). Who wins a race only appears where it changes a bet.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp, useRpc } from '../data/context'
import { TIER_LINES, tierOf } from '../live/config'
import type { Bettor, Density, MemberBet, MembersLive, PublicBet, PublicLive } from '../live/model'
import { shortName } from '../live/names'
import { tickKey, zones, type Zone } from '../live/zones'
import { Err, Loading } from './common'

type Payload = { live: PublicLive; members: MembersLive | null; previous: { fetched_at: string; bets: { id: string; p50: number | null }[] } | null }

const lastName = (n: string) => n.trim().split(/\s+/).pop() as string
const partyColor = (p?: string) => (p === 'R' ? '#b42318' : p === 'I' ? '#8a6a14' : '#1d4f9f')
const chance = (p: number) => (p > 0.99 ? '>99%' : p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`)
const dollars = (cents: number) => `${cents < 0 ? '−' : cents > 0 ? '+' : ''}$${Math.abs(Math.round(cents / 100)).toLocaleString('en-US')}`
const biasText = (b: number) => (Math.abs(b) < 0.05 ? 'even' : `${b > 0 ? 'D' : 'R'}+${Math.abs(b).toFixed(1)}`)
const biasColor = (b: number) => (Math.abs(b) < 0.05 ? undefined : b > 0 ? '#1d4f9f' : '#b42318')
const namesText = (names: string[]) => (names.length < 3 ? names.join(' & ') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`)
const roughly = (n: number) => (n >= 10000 ? Math.round(n / 1000) * 1000 : Math.round(n / 100) * 100).toLocaleString('en-US')
const etTime = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d).replace(':00', '').replace(' AM', ' a.m.').replace(' PM', ' p.m.')
const etStamp = (d: Date) => `${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(d)}, ${etTime(d)} ET`

const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const daysOld = (iso: string) => Math.floor((Date.now() - new Date(`${iso}T12:00:00Z`).getTime()) / 86400e3)

/** Side A's two-way share -> "Peltola +0.8". A ballot's 52.0–48.0 is a +4.0 margin. */
function marginText(bet: PublicBet, shareA: number) {
  const m = 2 * shareA - 100
  if (Math.abs(m) < 0.05) return 'Tied'
  return `${lastName(bet.candidates[m > 0 ? 0 : 1].name)} +${Math.abs(m).toFixed(1)}`
}
/** "Jackson +5.2 to +7.2", or "Peltola +5.1 to Sullivan +1.7" when the range crosses zero. */
function marginRange(bet: PublicBet, a: number, b: number) {
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  if ((hi - 50) * (lo - 50) > 0) {
    const onA = hi > 50
    const near = Math.abs(2 * (onA ? lo : hi) - 100).toFixed(1)
    const far = Math.abs(2 * (onA ? hi : lo) - 100).toFixed(1)
    return `${lastName(bet.candidates[onA ? 0 : 1].name)} +${near} to +${far}`
  }
  return `${marginText(bet, hi)} to ${marginText(bet, lo)}`
}
const middle = (b: PublicBet) => (b.seatsMid != null ? `Republicans ${Math.round(b.seatsMid)}` : marginText(b, b.share!.p50))

// ---------------------------------------------------------------- fading bars: darkness is the simulated chance of landing there

const INK = '20, 42, 92'
const alpha = (v: number) => Math.round(0.85 * Math.pow(v, 0.7) * 1000) / 1000
function fade(x: Density) {
  const n = x.d.length
  return [{ at: 0, a: 0 }, ...x.d.map((v, i) => ({ at: (i + 0.5) / n, a: alpha(v) })), { at: 1, a: 0 }]
}
const fadeCss = (x: Density) =>
  x.d.length < 2 ? `rgba(${INK}, .85)` : `linear-gradient(to right, ${fade(x).map((s) => `rgba(${INK}, ${s.a}) ${(s.at * 100).toFixed(1)}%`).join(', ')})`
// ---------------------------------------------------------------- page

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
  // A bet is open while no single outcome of the bet is over 99%. Without ballots to look at, while its range is still wide.
  const width = (b: PublicBet) => (b.share ? 2 * (b.share.p95 - b.share.p5) : (b.seatsHi as number) - (b.seatsLo as number))
  const certainty = (b: PublicBet) => {
    const m = memberOf.get(b.id)
    return m ? Math.max(m.rows[0]?.p ?? 0, m.refund) : 1 - width(b) / 100
  }
  const isOpen = (b: PublicBet) => !b.settled && !(b.called ?? (memberOf.has(b.id) ? certainty(b) > 0.99 : width(b) < 1))
  const openBets = live.bets.filter(isOpen)
  const openPot = openBets.reduce((a, b) => a + b.pot_cents, 0)
  const inOrder = [...live.bets].sort((a, b) => Number(a.side) - Number(b.side) || a.sort_order - b.sort_order)
  const undecided = inOrder.filter(isOpen)
  const called = inOrder.filter((b) => !isOpen(b))
  const before = (b: PublicBet) => previous?.bets.find((x) => x.id === b.id)?.p50 ?? null
  const fetched = new Date(live.fetched_at)
  const stale = Date.now() - fetched.getTime() > 3 * 3600e3

  return (
    <main className="page lv" id="main">
      <header className="lv-head">
        <h1 className="lv-h1">Results are still coming in</h1>
        {<p className="lv-stat"><b>{openBets.length} of {live.bets.length}</b> bets undecided, <b>${Math.round(openPot / 100)}</b> of ${Math.round(live.pot_cents / 100)} still in play</p>}
        <p className="small muted">
          Updated {etStamp(fetched)}. {stale ? <strong className="lv-stale">This is older than it should be.</strong> : <>Refreshes about every hour.</>}
        </p>
      </header>

      {members ? <BettorTable bettors={members.bettors} me={myName} /> : (
        <section className="lv-card">
          <h2 className="lv-h2">Scoreboard</h2>
          <p className="small muted">Who’s up and who’s down is for people in the pool. <Link to="/auth?next=/results">Sign in</Link> to see it.</p>
        </section>
      )}

      {undecided.length > 0 && (
        <section className="lv-group">
          <h2 className="lv-group-title">Undecided</h2>
          <p className="small muted lv-key">
            The curved bar is where the final number could land: the darker, the likelier. The needle is the middle estimate. White lines mark where one guess takes over from the next, so the shading inside a slice is that guess’s chance.
            A +4.0 margin is a 52.0–48.0 split on your ballot.
          </p>
          <div className="lv-open">{undecided.map((b) => <BetCard key={b.id} bet={b} m={memberOf.get(b.id)} me={myName} before={before(b)} />)}</div>
        </section>
      )}

      {called.length > 0 && (
        <section className="lv-group lv-called-section">
          <h2 className="lv-group-title">Called</h2>
          <p className="small muted lv-key">Over 99% to win the bet by this estimate. A TV call or a full count doesn’t decide it. Tap one to see how close it stands.</p>
          <div className="lv-called">
            {called.map((b) => <CalledRow key={b.id} bet={b} m={memberOf.get(b.id)} me={myName} before={before(b)} />)}
          </div>
        </section>
      )}
      {live.unmodeled.length > 0 && <p className="small muted">Not included, no vote source yet: {live.unmodeled.join(', ')}.</p>}

      <details className="lv-method">
        <summary>How this is worked out</summary>
        <ol>
          <li>Votes come from <a href="https://civicapi.org" target="_blank" rel="noreferrer">civicAPI</a>, by county, about once an hour.</li>
          <li>For each race: how many votes are left (from AP’s estimate or state officials, credited on each card, less anything counted since) and how they’ll split. The split starts from the best read available and then updates on how newly counted votes actually go. We’re unsure of both, and that uncertainty is what the shading shows.</li>
          <li>Alaska adds the ranked-choice step: if nobody reaches 50%, the last-place candidates’ ballots move to their next choice, or drop out if there isn’t one.</li>
          <li>The computer plays out {live.draws.toLocaleString('en-US')} possible finishes. Each one scores every bet the way the real payout does: right winner, closest vote share to a tenth of a point, ties split.</li>
          <li>Chances, projected money and bets won all count those same finishes, so they always add up. Projected money sums to $0. A split counts as a share of a bet won.</li>
        </ol>
        <p className="small muted">The estimates of late votes are judgment calls, mostly from past elections. Treat them as a good guess, not a fact. Nothing here pays out: the admin still enters each official result.</p>
      </details>
    </main>
  )
}

// ---------------------------------------------------------------- the money

const TROPHY = 'M7 3h10v2h4v2.5c0 2.8-2.1 5-4.8 5.4A5.1 5.1 0 0 1 13 15.8V18h3a1 1 0 0 1 1 1v2H7v-2a1 1 0 0 1 1-1h3v-2.200a5.100 5.100 0 0 1-3.200-2.900C5.100 12.500 3 10.300 3 7.500V5h4V3Zm0 4H5v.5c0 1.500.8 2.800 2 3.400V7Zm10 0v3.900c1.200-.6 2-1.900 2-3.400V7h-2Z'

type AwardKind = 'cup' | 'money' | 'last'
const AWARDS: Record<AwardKind, { title: string; reason: string; keep: string; photo?: { src: string; alt: string; line: string } }> = {
  money: { title: 'Money Winner', reason: 'Most money won', keep: 'to keep it' },
  cup: { title: 'The Nate Silver Cup', reason: 'Lowest average error', keep: 'to keep it', photo: { src: '/nate-silver-cup.png', alt: 'Nate Silver', line: 'GOAT' } },
  last: { title: 'The G. Elliott Morris Participation Trophy', reason: 'Highest average error', keep: 'stuck with it', photo: { src: '/participation-trophy.jpg', alt: 'G. Elliott Morris', line: 'Better luck next time!' } },
}

/** The awards. Hover, tap or tab to one. */
function Award({ kind, chance: keep }: { kind: AwardKind; chance: number | null | undefined }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', onKey) }
  }, [open])
  const a = AWARDS[kind]
  return (
    <span className="lv-cup" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className={`lv-cup-btn lv-cup-btn-${kind}`} aria-label={a.title} aria-expanded={open}
        onClick={() => setOpen(true)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onPointerDown={(e) => e.stopPropagation()}>
        {kind !== 'money' ? (
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d={TROPHY} /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="12" cy="12" r="10" /><text x="12" y="17" textAnchor="middle" className="lv-coin-mark">$</text></svg>
        )}
      </button>
      {open && (
        <span className="lv-cup-pop" role="status">
          {a.photo && (
            <span className="lv-cup-photo">
              <img src={a.photo.src} alt={a.photo.alt} />
              <b className={`lv-cup-goat${kind === 'last' ? ' lv-cup-burn' : ''}`}>{a.photo.line}</b>
            </span>
          )}
          <b className="lv-cup-title">{a.title}</b>
          <small>{a.reason}{keep != null ? `. ${chance(keep)} ${a.keep}.` : '.'}</small>
        </span>
      )}
    </span>
  )
}

function Awards({ bettors }: { bettors: Bettor[] }) {
  const rich = bettors[0]
  const ranked = [...bettors].filter((b) => b.avgError != null).sort((a, b) => (a.avgError as number) - (b.avgError as number))
  const sharp = ranked[0]
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null
  return (
    <div className="lv-awards">
      {rich && (
        <div className="lv-award">
          <Award kind="money" chance={rich.moneyChance} />
          <span><small>Money Winner</small><b>{rich.name}</b> {dollars(rich.net)}{rich.moneyChance != null && <em>{chance(rich.moneyChance)} to keep it</em>}</span>
        </div>
      )}
      {sharp && (
        <div className="lv-award">
          <Award kind="cup" chance={sharp.cupChance} />
          <span><small>The Nate Silver Cup</small><b>{sharp.name}</b> off by {(sharp.avgError as number).toFixed(1)}{sharp.cupChance != null && <em>{chance(sharp.cupChance)} to keep it</em>}</span>
        </div>
      )}
      {worst && (
        <div className="lv-award lv-award-last">
          <Award kind="last" chance={worst.lastChance} />
          <span><small>G. Elliott Morris Participation Trophy</small><b>{worst.name}</b> off by {(worst.avgError as number).toFixed(1)}{worst.lastChance != null && <em>{chance(worst.lastChance)} stuck with it</em>}</span>
        </div>
      )}
    </div>
  )
}

const TierTag = ({ tier }: { tier: string }) => <span className={`lv-tier lv-tier-${tier.toLowerCase()}`}>{tier}</span>

function BettorTable({ bettors, me }: { bettors: Bettor[]; me: string | null }) {
  const lowest = Math.min(...bettors.map((b) => b.avgError ?? Infinity))
  const highest = Math.max(...bettors.map((b) => b.avgError ?? -Infinity))
  const min = Math.min(0, ...bettors.map((b) => Math.min(b.lo, b.density.lo)))
  const max = Math.max(0, ...bettors.map((b) => Math.max(b.hi, b.density.hi)))
  const pad = (max - min) * 0.04 || 100
  const lo = min - pad
  const hi = max + pad
  const at = (c: number) => `${((c - lo) / (hi - lo)) * 100}%`
  const step = hi - lo > 20000 ? 10000 : 5000
  const ticks: number[] = []
  for (let c = Math.ceil(lo / step) * step; c <= hi; c += step) ticks.push(c)
  return (
    <section className="lv-card">
      <h2 className="lv-h2">Scoreboard</h2>
      <Awards bettors={bettors} />
      <p className="small muted lv-sub">Projected win or loss on every bet, side bets included. The black tick is the projection. The bar fades as finishes get less likely, and the numbers show where 9 in 10 land. Avg. error is how many points their race picks miss the projected margins by, and it sets the tier: {TIER_LINES.map(([t, line]) => `${t} under ${line}`).join(', ')}. Bias is the party they guessed too high.</p>
      <table className="lv-money">
        <thead>
          <tr><th scope="col">Name<span className="lv-stats-short">tier · error · bias</span></th><th scope="col" className="lv-axis-cell"><span className="lv-vh">Range</span>
            <div className="lv-axis" aria-hidden="true">{ticks.map((c) => <span key={c} style={{ left: at(c) }}>{c === 0 ? '$0' : dollars(c)}</span>)}</div>
          </th><th scope="col" className="num">Money</th><th scope="col" className="lv-stats-wide lv-tier-col">Tier</th><th scope="col" className="num lv-stats-wide">Avg. error</th><th scope="col" className="num lv-stats-wide">Bias</th><th scope="col" className="num">Bets won</th></tr>
        </thead>
        <tbody>
          {bettors.map((b) => (
            <tr key={b.name} className={b.name === me ? 'me' : undefined}>
              <th scope="row">
                <span className="lv-name">{b.name}{b === bettors[0] && <Award kind="money" chance={b.moneyChance} />}{b.avgError === lowest && <Award kind="cup" chance={b.cupChance} />}{b.avgError === highest && highest > lowest && <Award kind="last" chance={b.lastChance} />}</span>
                {b.avgError != null && b.bias != null && <small className="lv-stats-short"><TierTag tier={tierOf(b.avgError)} /> {b.avgError.toFixed(1)} · <span style={{ color: biasColor(b.bias) }}>{biasText(b.bias)}</span></small>}
              </th>
              <td className="lv-range-cell">
                <div className="lv-range" role="img" aria-label={`${dollars(b.lo)} to ${dollars(b.hi)}`}>
                  <i className="lv-zero" style={{ left: at(0) }} />
                  <i className="lv-bar" style={{ left: at(b.density.lo), width: `calc(${at(b.density.hi)} - ${at(b.density.lo)})`, background: fadeCss(b.density) }} />
                  <i className="lv-mid" style={{ left: at(b.net) }} />
                </div>
              </td>
              <td className="num"><b>{b.dollars === 0 ? '$0' : dollars(b.dollars * 100)}</b><small>{Math.abs(b.hi - b.lo) < 50 ? 'locked in' : `${dollars(b.lo)} to ${dollars(b.hi)}`}</small></td>
              <td className="lv-stats-wide lv-tier-col">{b.avgError != null ? <TierTag tier={tierOf(b.avgError)} /> : '–'}</td>
              <td className="num lv-stats-wide"><b className="lv-stat-num">{b.avgError?.toFixed(1) ?? '–'}</b></td>
              <td className="num lv-stats-wide"><b className="lv-stat-num" style={{ color: b.bias != null ? biasColor(b.bias) : undefined }}>{b.bias != null ? biasText(b.bias) : '–'}</b></td>
              <td className="num"><b>{b.bets.toFixed(1)}</b><small>of {b.of}</small></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// ---------------------------------------------------------------- the bets

const shortTitle = (b: PublicBet) => (b.kind === 'senate_seats' ? 'Senate seats' : b.kind === 'house_seats' ? 'House seats' : b.title.replace(' Senate (special)', '').replace(' Senate', '').replace(' House', ''))

function rangeLine(b: PublicBet) {
  if (b.share) return `9 in 10: ${marginRange(b, b.share.p5, b.share.p95)}. ${Math.round(b.pct as number)}% counted, about ${roughly(b.left!.mid)} votes left.`
  return `9 in 10: ${Math.round(b.seatsLo as number)}–${Math.round(b.seatsHi as number)} Republican seats.`
}

function LeanChip({ label, who }: { label: string; who?: string }) {
  return <span className={`lv-chip lv-chip-${label.toLowerCase().replace(' ', '-')}`}>{label}{who ? ` ${who}` : ''}</span>
}
const Title = ({ bet }: { bet: PublicBet }) => (
  <>{shortTitle(bet)}<small>{bet.side ? 'side bet, ' : ''}${Math.round(bet.pot_cents / 100)}</small></>
)
const winnerText = (m: MemberBet) => (m.refundLeads ? 'Money back' : `${namesText(m.rows[0]?.names ?? [])}${(m.rows[0]?.names.length ?? 0) > 1 ? ' split' : ''}`)

type BetProps = { bet: PublicBet; m?: MemberBet; me: string | null; before: number | null }

function BetCard(props: BetProps) {
  const { bet, m } = props
  return (
    <article className="lv-card lv-bet">
      <header className="lv-bet-head">
        <h3><Title bet={bet} /></h3>
        {m?.rows[0] && <LeanChip label={m.lean} who={m.refundLeads ? 'money back' : namesText(m.rows[0].names)} />}
      </header>
      <BetBody {...props} />
    </article>
  )
}

/** Called: just who won. Open it and it's the same picture as an undecided bet, with far less shading left. */
function CalledRow(props: BetProps) {
  const { bet, m, me } = props
  return (
    <details className="lv-called-row">
      <summary>
        <span className="lv-called-race"><b>{shortTitle(bet)}</b><small>{bet.side ? 'side bet · ' : ''}{middle(bet)}</small></span>
        {m ? <span className={`lv-called-who${m.rows[0]?.names.includes(me ?? '') ? ' me' : ''}`}>{winnerText(m)}</span> : <span />}
        {m && <LeanChip label={m.lean} />}
      </summary>
      <div className="lv-called-more"><BetBody {...props} /></div>
    </details>
  )
}

function BetBody({ bet, m, me, before }: BetProps) {
  const nobody = bet.share && m ? bet.candidates.find((c) => !m.ticks.some((t) => t.side === c.id)) : null
  const seatRows = bet.hist?.filter((h) => h.p >= 0.005) ?? []
  const moved = before != null && bet.share && Math.abs(before - bet.share.p50) >= 0.1
  return (
    <>
      <Dial bet={bet} m={m} before={before} />
      <p className="lv-needle-big">{middle(bet)}</p>
      {moved && <p className="small muted lv-center">Was {marginText(bet, before as number)} at the last update (thin line).</p>}
      <p className="small lv-center lv-range-line">
        {bet.share || seatRows.length > 4 ? rangeLine(bet) : seatRows.map((h, i) => <span key={h.r}>{i ? ' · ' : ''}<b>{h.r}</b> {chance(h.p)}</span>)}
        {bet.open && bet.open.length > 0 && <span className="muted"> Depends on {bet.open.map((o) => o.title).join(' and ')}.</span>}
      </p>
      {bet.firstRound && bet.firstRound.p > 0.01 && bet.firstRound.p < 0.99 && (
        <p className="small muted lv-center">
          In {chance(bet.firstRound.p)} of finishes, {lastName(bet.firstRound.name)} clears 50% of first choices. Then there’s no ranked-choice round, so the margin jumps to {lastName(bet.firstRound.name)} +{bet.firstRound.from.toFixed(1)} or more. That’s why the bar has a gap.
        </p>
      )}
      {m && (
        <ol className="lv-board">
          {m.rows.map((r, i) => (
            <li key={r.names.join()} className={r.names.includes(me ?? '') ? 'me' : undefined}>
              <span className="lv-rank">{i + 1}</span>
              <span className="lv-who">{namesText(r.names)}{r.names.length > 1 && <small> split</small>}<small className="lv-guess">{guessText(bet, r)}</small></span>
              <span className="lv-pbar" aria-hidden="true"><i style={{ width: `${Math.max(r.p * 100, 1)}%` }} /></span>
              <b className="lv-p">{chance(r.p)}</b>
            </li>
          ))}
          {m.refund >= 0.005 && nobody && (
            <li className="lv-refund"><span className="lv-rank">↩</span><span className="lv-who">Money back<small className="lv-guess">nobody picked {lastName(nobody.name)}</small></span><span className="lv-pbar" aria-hidden="true"><i style={{ width: `${m.refund * 100}%` }} /></span><b className="lv-p">{chance(m.refund)}</b></li>
          )}
        </ol>
      )}
      {bet.note && (
        <p className="small muted lv-bet-note">
          {bet.note} {bet.done}
          {bet.reported && <> Votes left: <a href={bet.reported.url} target="_blank" rel="noreferrer">{bet.reported.source}</a>, {shortDate(bet.reported.asOf)}{daysOld(bet.reported.asOf) >= 3 ? ` (${daysOld(bet.reported.asOf)} days old)` : ''}, less anything counted since.</>}
          {bet.since && bet.share && <> Counted since then: {roughly(bet.since.n)} votes, {(bet.since.share >= 50 ? bet.since.share : 100 - bet.since.share).toFixed(1)}% {lastName(bet.candidates[bet.since.share >= 50 ? 0 : 1].name)}.</>}
          {bet.rest && bet.share && <> The rest is figured at {(bet.rest.mean >= 50 ? bet.rest.mean : 100 - bet.rest.mean).toFixed(0)}% {lastName(bet.candidates[bet.rest.mean >= 50 ? 0 : 1].name)}, give or take {Math.round(bet.rest.sd)}.</>}
        </p>
      )}
    </>
  )
}

function guessText(bet: PublicBet, r: { guess: number; side: string | null }) {
  if (!bet.share) return `guessed ${r.guess}, off by ${Math.abs(r.guess - (bet.seatsMid as number)).toFixed(0)}`
  const rightSide = r.side === bet.candidates[bet.share.p50 > 50 ? 0 : 1].id
  return `guessed ${marginText(bet, r.guess)}, ${rightSide ? `off by ${(Math.abs(r.guess - bet.share.p50) * 2).toFixed(1)}` : 'wrong side'}`
}

// ---------------------------------------------------------------- the curved bar: a range, sliced by who it pays

type Scene = { lo: number; hi: number; mid: number; shape?: Density; zs: Zone[]; xs: { x: number; side: string | null; rank: number | null }[]; pos: (v: number) => number; sideOf: (id: string | null) => string | undefined; race: boolean }

/** The scale, in side A's share for races (A's side on the left, like the rest of the site) or Republican seats (Republicans right). pos() is 0 to 1, left to right. It always spans the guesses, so as a count firms up the shading visibly shrinks against them. */
function scene(bet: PublicBet, m?: MemberBet): Scene {
  const race = bet.share != null
  const xs = [...new Map((m?.ticks ?? []).map((t) => [tickKey(t), t])).values()]
  const lo0 = race ? bet.share!.p5 : (bet.seatsLo as number)
  const hi0 = race ? bet.share!.p95 : (bet.seatsHi as number)
  const shape = bet.density
  const pad = race ? 0.3 : 1
  const lo = Math.min(lo0, shape?.lo ?? lo0, ...xs.map((t) => t.x)) - pad
  const hi = Math.max(hi0, shape?.hi ?? hi0, ...xs.map((t) => t.x)) + pad
  const pos = (v: number) => (race ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo))
  const zs = xs.length ? zones(xs, race ? { lo, hi, a: bet.candidates[0].id, b: bet.candidates[1].id } : { lo, hi }) : []
  return {
    lo, hi, shape, zs, xs, pos, race,
    mid: race ? bet.share!.p50 : (bet.seatsMid as number),
    sideOf: (id) => bet.candidates.find((c) => c.id === id)?.party,
  }
}
const edgeLabel = (bet: PublicBet, s: Scene, v: number) => (s.race ? marginText(bet, v) : `${Math.round(v)} seats`)

const CX = 160
const CY = 172
const polar = (t: number, r: number) => { const a = Math.PI * (1 - t); return [CX + r * Math.cos(a), CY - r * Math.sin(a)] }
function arc(t0: number, t1: number, r0: number, r1: number) {
  const [x0, y0] = polar(t0, r1)
  const [x1, y1] = polar(t1, r1)
  const [x2, y2] = polar(t1, r0)
  const [x3, y3] = polar(t0, r0)
  return `M${x0} ${y0}A${r1} ${r1} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 0 0 ${x3} ${y3}Z`
}
/** The shading, one wedge per slice of the simulated range, so even a very tight range stays visible. */
function wedges(s: Scene) {
  const x = s.shape
  if (!x) return []
  const a = s.pos(x.lo)
  const b = s.pos(x.hi)
  const center = (a + b) / 2
  const half = Math.max(Math.abs(b - a) / 2, 0.006)
  const from = center - half * Math.sign(b - a || 1)
  const to = center + half * Math.sign(b - a || 1)
  if (x.d.length < 2) return [{ t0: Math.min(from, to), t1: Math.max(from, to), a: 0.85 }]
  // Several wedges per slice, blending between neighbors, so the shading reads as a smooth gradient.
  const n = x.d.length
  const fine = n * 3
  const out: { t0: number; t1: number; a: number }[] = []
  for (let i = 0; i < fine; i++) {
    const c = ((i + 0.5) / fine) * n - 0.5
    const j = Math.floor(c)
    const f = c - j
    const v = (x.d[j] ?? 0) * (1 - f) + (x.d[j + 1] ?? 0) * f
    const t0 = from + (i / fine) * (to - from)
    const t1 = from + ((i + 1) / fine) * (to - from)
    if (alpha(v) > 0.005) out.push({ t0: Math.min(t0, t1), t1: Math.max(t0, t1), a: alpha(v) })
  }
  return out
}

function Dial({ bet, m, before }: { bet: PublicBet; m?: MemberBet; before: number | null }) {
  const s = scene(bet, m)
  const t = s.pos(s.mid)
  const [shown, setShown] = useState(0.5)
  useEffect(() => { const id = requestAnimationFrame(() => setShown(t)); return () => cancelAnimationFrame(id) }, [t])
  const R0 = 92
  const R1 = 126
  const color = (id: string | null) => (s.race ? partyColor(s.sideOf(id)) : '#16181d')
  const lanes = [-1e9, -1e9]
  const ranked = s.xs.filter((x) => x.rank != null).map((x) => ({ x, p: s.pos(x.x) })).sort((a, b) => a.p - b.p).map(({ x, p }) => {
    const lane = (p - lanes[0]) * Math.PI * 140 >= 18 ? 0 : 1
    lanes[lane] = p
    return { x, p, r: lane === 0 ? 139 : 155 }
  })
  const ghost = before != null && s.race && Math.abs(before - s.mid) >= 0.1 && before > s.lo && before < s.hi
  return (
    <svg className="lv-dial" viewBox="0 0 320 196" role="img" aria-label={`${bet.title}: the middle estimate is ${middle(bet)}. ${rangeLine(bet)}`}>
      <path d={arc(0, 1, R0, R1)} fill="#f2eee3" />
      {s.zs.filter((z) => z.owner === null).map((z, i) => {
        const a = Math.min(s.pos(z.from), s.pos(z.to))
        const b = Math.max(s.pos(z.from), s.pos(z.to))
        return <path key={i} d={arc(a, b, R0, R1)} className="lv-zone-refund" />
      })}
      <g shapeRendering="crispEdges">{wedges(s).map((w) => <path key={w.t0} d={arc(w.t0, w.t1, R0, R1)} fill={`rgb(${INK})`} fillOpacity={w.a} />)}</g>
      {s.zs.slice(1).map((z, i) => {
        const p = s.pos(z.from)
        const [x0, y0] = polar(p, R0 - 3)
        const [x1, y1] = polar(p, R1 + 3)
        return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} className={s.race && Math.abs(z.from - 50) < 0.02 ? 'lv-tied' : 'lv-divide'} />
      })}
      {s.xs.filter((x) => x.rank == null).map((x, i) => {
        const [px, py] = polar(s.pos(x.x), R1 + 6)
        return <circle key={i} cx={px} cy={py} r="3" fill={color(x.side)} stroke="var(--paper)" strokeWidth="1" />
      })}
      {ranked.map(({ x, p, r }) => {
        const [x0, y0] = polar(p, R1)
        const [x1, y1] = polar(p, r)
        return (
          <g key={tickKey(x)}>
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={color(x.side)} strokeWidth="1.25" />
            <circle cx={x1} cy={y1} r="8" fill={color(x.side)} stroke="var(--paper)" strokeWidth="1.5" />
            <text x={x1} y={y1 + 3.5} textAnchor="middle" className="lv-strip-num">{x.rank}</text>
          </g>
        )
      })}
      {ghost && (() => { const [gx, gy] = polar(s.pos(before as number), R0 - 4); return <line x1={CX} y1={CY} x2={gx} y2={gy} className="lv-ghost" /> })()}
      <g className="lv-pointer" style={{ transform: `rotate(${(shown - 0.5) * 180}deg)`, transformOrigin: `${CX}px ${CY}px` }}>
        <line x1={CX} y1={CY} x2={CX} y2={CY - (R0 - 2)} className="lv-pointer-line" />
      </g>
      <circle cx={CX} cy={CY} r="7" fill="var(--ink)" />
      <text x="24" y="192" className="lv-dial-end">{edgeLabel(bet, s, s.race ? s.hi : s.lo)}</text>
      <text x="296" y="192" textAnchor="end" className="lv-dial-end">{edgeLabel(bet, s, s.race ? s.lo : s.hi)}</text>
    </svg>
  )
}
