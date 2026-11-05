// Results: where each final number could land, and which guess wins if it lands there. Every figure comes from one set of
// simulated finishes (src/live/model.ts). Who wins a race only appears where it changes a bet.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp, useRpc } from '../data/context'
import type { Bettor, Density, MemberBet, MembersLive, PublicBet, PublicLive } from '../live/model'
import { shortName } from '../live/names'
import { closestGuesses, tickKey, zones, type Zone } from '../live/zones'
import { Err, Loading } from './common'

type Payload = { live: PublicLive; members: MembersLive | null; previous: { fetched_at: string; bets: { id: string; p50: number | null }[] } | null }

const lastName = (n: string) => n.trim().split(/\s+/).pop() as string
const partyColor = (p?: string) => (p === 'R' ? '#b42318' : p === 'I' ? '#8a6a14' : '#1d4f9f')
const chance = (p: number) => (p > 0.99 && p < 1 ? '>99%' : p >= 1 ? '100%' : p > 0 && p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`)
const dollars = (cents: number) => `${cents < 0 ? '−' : cents > 0 ? '+' : ''}$${Math.abs(Math.round(cents / 100)).toLocaleString('en-US')}`
const namesText = (names: string[]) => (names.length < 3 ? names.join(' & ') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`)
const roughly = (n: number) => (n >= 10000 ? Math.round(n / 1000) * 1000 : Math.round(n / 100) * 100).toLocaleString('en-US')
const etTime = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d).replace(':00', '').replace(' AM', ' a.m.').replace(' PM', ' p.m.')
const etStamp = (d: Date) => `${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(d)}, ${etTime(d)} ET`

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

/** The job runs at these UTC hours (vercel.json); Vercel starts it some time within that hour. */
const RUN_HOURS = [1, 7, 13, 19]
function nextRun(after: Date) {
  for (let i = 0; i < 48; i++) {
    const t = new Date(Math.ceil(after.getTime() / 3600e3 + i) * 3600e3)
    if (RUN_HOURS.includes(t.getUTCHours()) && t.getTime() > after.getTime() + 30 * 60e3) return t
  }
  return new Date(after.getTime() + 6 * 3600e3)
}

// ---------------------------------------------------------------- fading bars: darkness is the simulated chance of landing there

const INK = '20, 42, 92'
const alpha = (v: number) => Math.round(0.85 * Math.pow(v, 0.7) * 1000) / 1000
function fade(x: Density) {
  const n = x.d.length
  return [{ at: 0, a: 0 }, ...x.d.map((v, i) => ({ at: (i + 0.5) / n, a: alpha(v) })), { at: 1, a: 0 }]
}
const fadeCss = (x: Density) =>
  x.d.length < 2 ? `rgba(${INK}, .85)` : `linear-gradient(to right, ${fade(x).map((s) => `rgba(${INK}, ${s.a}) ${(s.at * 100).toFixed(1)}%`).join(', ')})`
function alphaAt(x: Density, v: number) {
  if (x.d.length < 2) return 0.85
  const pos = ((v - x.lo) / (x.hi - x.lo)) * x.d.length - 0.5
  if (pos < -0.5 || pos > x.d.length - 0.5) return 0
  const i = Math.max(0, Math.min(x.d.length - 1, Math.floor(pos)))
  const j = Math.min(x.d.length - 1, i + 1)
  const f = Math.max(0, Math.min(1, pos - i))
  return alpha(x.d[i] * (1 - f) + x.d[j] * f)
}

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
  const isOpen = (b: PublicBet) => !b.settled && (memberOf.has(b.id) ? certainty(b) <= 0.99 : width(b) >= 1)
  const openBets = live.bets.filter(isOpen)
  const openPot = openBets.reduce((a, b) => a + b.pot_cents, 0)
  // The headline: the race bet furthest from decided.
  const hero = openBets.filter((b) => b.share).sort((a, b) => certainty(a) - certainty(b))[0]
  const rest = live.bets.filter((b) => b !== hero)
  const fetched = new Date(live.fetched_at)
  const stale = Date.now() - fetched.getTime() > 8 * 3600e3

  return (
    <main className="page lv" id="main">
      <header className="lv-head">
        <h1 className="lv-h1">Results are still coming in</h1>
        {members && <p className="lv-stat"><b>{openBets.length} of {live.bets.length}</b> bets undecided, <b>${Math.round(openPot / 100)}</b> of ${Math.round(live.pot_cents / 100)} still in play</p>}
        <p className="small muted">
          Updated {etStamp(fetched)}. {stale ? <strong className="lv-stale">This is older than it should be.</strong> : <>Next around {etTime(nextRun(fetched))}</>}
        </p>
      </header>

      {hero && <BetCard bet={hero} m={memberOf.get(hero.id)} me={myName} before={previous?.bets.find((b) => b.id === hero.id)?.p50 ?? null} hero />}

      {members ? <BettorTable bettors={members.bettors} me={myName} /> : (
        <section className="lv-card">
          <h2 className="lv-h2">The money</h2>
          <p className="small muted">Who’s up and who’s down is for people in the pool. <Link to="/auth?next=/results">Sign in</Link> to see it.</p>
        </section>
      )}

      <p className="small muted lv-key">
        The shaded bar is where the final margin could land: the darker, the likelier. Black tick: the middle estimate. Lines across the bar mark where one guess takes over from the next, so the shading inside a slice is that guess’s chance.
        On decided bets, the black line is the final, and each dot is how close a guess came. A +4.0 margin is a 52.0–48.0 split on your ballot. “Called” means a guess is over 99% to win its bet by this estimate. A TV call or a full count doesn’t decide it.
      </p>

      <BetGroup title="Main ballot" bets={rest.filter((b) => !b.side)} memberOf={memberOf} isOpen={isOpen} certainty={certainty} me={myName} />
      {rest.some((b) => b.side) && <BetGroup title="Side bets" bets={rest.filter((b) => b.side)} memberOf={memberOf} isOpen={isOpen} certainty={certainty} me={myName} />}
      {live.unmodeled.length > 0 && <p className="small muted">Not included, no vote source yet: {live.unmodeled.join(', ')}.</p>}

      <details className="lv-method">
        <summary>How this is worked out</summary>
        <ol>
          <li>Votes come from <a href="https://civicapi.org" target="_blank" rel="noreferrer">civicAPI</a>, by county, four times a day.</li>
          <li>For each race: how many votes are left (what the feed reports, plus late ballots it can’t see) and how they’ll split (each county’s split so far, plus how that state’s late vote usually runs). We’re unsure of both, and that uncertainty is what the shading shows.</li>
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

function BettorTable({ bettors, me }: { bettors: Bettor[]; me: string | null }) {
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
      <h2 className="lv-h2">The money</h2>
      <p className="small muted lv-sub">Projected win or loss on every bet, side bets included. The darker the bar, the likelier that finish. The black tick is the projection, and the numbers show where 9 in 10 finishes land.</p>
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
                  <i className="lv-bar" style={{ left: at(b.density.lo), width: `calc(${at(b.density.hi)} - ${at(b.density.lo)})`, background: fadeCss(b.density) }} />
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

type GroupProps = { title: string; bets: PublicBet[]; memberOf: Map<string, MemberBet>; isOpen: (b: PublicBet) => boolean; certainty: (b: PublicBet) => number; me: string | null }

function BetGroup({ title, bets, memberOf, isOpen, certainty, me }: GroupProps) {
  const open = bets.filter(isOpen).sort((a, b) => certainty(a) - certainty(b))
  const done = bets.filter((b) => !isOpen(b))
  return (
    <section className="lv-group">
      <h2 className="lv-group-title">{title}</h2>
      {open.length > 0 && <div className="lv-open">{open.map((b) => <BetCard key={b.id} bet={b} m={memberOf.get(b.id)} me={me} />)}</div>}
      {done.length > 0 && (
        <div className="lv-done-list">
          {done.map((b) => <CalledCard key={b.id} bet={b} m={memberOf.get(b.id)} me={me} />)}
        </div>
      )}
    </section>
  )
}

const shortTitle = (b: PublicBet) => (b.kind === 'senate_seats' ? 'Senate seats' : b.kind === 'house_seats' ? 'House seats' : b.title.replace(' Senate (special)', '').replace(' Senate', '').replace(' House', ''))

function rangeLine(b: PublicBet) {
  if (b.share) return `9 in 10: ${marginRange(b, b.share.p5, b.share.p95)}. ${Math.round(b.pct as number)}% counted, about ${roughly(b.left!.mid)} votes left.`
  return `9 in 10: ${Math.round(b.seatsLo as number)}–${Math.round(b.seatsHi as number)} Republican seats.`
}

/** A decided bet: the final as a line, the three closest guesses against it. The gap is the miss. */
function CalledCard({ bet, m, me }: { bet: PublicBet; m?: MemberBet; me: string | null }) {
  const race = bet.share != null
  const final = race ? bet.share!.p50 : (bet.seatsMid as number)
  const top = m ? closestGuesses(bet, m) : []
  const shape = bet.density
  const edges = [final, shape?.lo ?? final, shape?.hi ?? final, ...top.map((g) => g.x)]
  const span = Math.max(...edges) - Math.min(...edges) || 1
  const lo = Math.min(...edges) - span * 0.06
  const hi = Math.max(...edges) + span * 0.06
  const at = (v: number) => (race ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo)) * 100
  const left = Math.min(at(shape?.lo ?? final), at(shape?.hi ?? final))
  const right = Math.max(at(shape?.lo ?? final), at(shape?.hi ?? final))
  const color = (id: string | null) => (race ? partyColor(bet.candidates.find((c) => c.id === id)?.party) : '#16181d')
  return (
    <article className="lv-done">
      <header className="lv-bet-head">
        <h3>{shortTitle(bet)} <span className="lv-done-final">{middle(bet)}</span></h3>
        {m && <LeanChip label={m.lean} who={m.refundLeads ? 'money back' : undefined} />}
      </header>
      {top.length > 0 && (
        <table className="lv-miss">
          <thead className="lv-vh"><tr><th scope="col">Guess</th><th scope="col">Against the final</th><th scope="col">Off by</th></tr></thead>
          <tbody>
            {top.map((g, i) => (
              <tr key={g.x + (g.side ?? '')} className={g.names.includes(me ?? '') ? 'me' : undefined}>
                <th scope="row" className={i === 0 && !m?.refundLeads ? 'lead' : undefined}>{namesText(g.names)}</th>
                <td>
                  <div className="lv-miss-track" role="img" aria-label={`Guessed ${race ? marginText(bet, g.x) : g.x}`}>
                    {shape && shape.d.length > 1 && <i className="lv-miss-band" style={{ left: `${left}%`, width: `${right - left}%`, background: race ? fadeCss({ ...shape, d: [...shape.d].reverse() }) : fadeCss(shape) }} />}
                    <i className="lv-miss-gap" style={{ left: `${Math.min(at(g.x), at(final))}%`, width: `${Math.abs(at(g.x) - at(final))}%`, background: color(g.side) }} />
                    <i className="lv-miss-final" style={{ left: `${at(final)}%` }} />
                    <i className="lv-miss-dot" style={{ left: `${at(g.x)}%`, background: color(g.side) }} />
                  </div>
                </td>
                <td className="num"><small>{race ? (g.x * 2 - 100 === 0 ? 'Tied' : marginText(bet, g.x)) : g.x}</small><b>{g.right ? `off ${(race ? g.miss * 2 : g.miss).toFixed(race ? 1 : 0)}` : 'wrong side'}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details className="lv-done-more">
        <summary>What’s left to count</summary>
        <p className="small muted">{rangeLine(bet)} {bet.note} {bet.done}</p>
      </details>
    </article>
  )
}

function LeanChip({ label, who }: { label: string; who?: string }) {
  return <span className={`lv-chip lv-chip-${label.toLowerCase().replace(' ', '-')}`}>{label}{who ? ` ${who}` : ''}</span>
}

function BetCard({ bet, m, me, before = null, hero = false }: { bet: PublicBet; m?: MemberBet; me: string | null; before?: number | null; hero?: boolean }) {
  const shown = (m?.rows ?? []).filter((r) => r.p >= 0.005)
  const nobody = bet.share && m ? bet.candidates.find((c) => !m.ticks.some((t) => t.side === c.id)) : null
  const seatRows = bet.hist?.filter((h) => h.p >= 0.005) ?? []
  const moved = before != null && bet.share && Math.abs(before - bet.share.p50) >= 0.1
  return (
    <article className={`lv-card lv-bet${hero ? ' lv-hero' : ''}`}>
      <header className="lv-bet-head">
        <h3>{shortTitle(bet)}{bet.pot_cents ? <small>${Math.round(bet.pot_cents / 100)}</small> : null}</h3>
        {m?.rows[0] && <LeanChip label={m.lean} who={m.refundLeads ? 'money back' : namesText(m.rows[0].names)} />}
      </header>
      {hero && bet.share ? (
        <>
          <Dial bet={bet} m={m} before={before} />
          <p className="lv-needle-big">{marginText(bet, bet.share.p50)}</p>
          {moved && <p className="small muted lv-center">Was {marginText(bet, before as number)} at the last update (thin line).</p>}
          <p className="small lv-center">{rangeLine(bet)}</p>
        </>
      ) : (
        <>
          {bet.share ? (
            <p className="small lv-bet-line"><b>{marginText(bet, bet.share.p50)}</b>. {rangeLine(bet)}</p>
          ) : (
            <p className="small lv-bet-line">
              Republicans: {seatRows.length <= 4 ? seatRows.map((h, i) => <span key={h.r}>{i ? ' · ' : ''}<b>{h.r}</b> {chance(h.p)}</span>) : <b>{Math.round(bet.seatsLo as number)}–{Math.round(bet.seatsHi as number)}</b>}.
              {bet.open && bet.open.length > 0 && <span className="muted"> Depends on {bet.open.map((o) => o.title).join(' and ')}.</span>}
            </p>
          )}
          <Strip bet={bet} m={m} />
        </>
      )}
      {m && (
        <ol className="lv-board">
          {shown.map((r, i) => (
            <li key={r.names.join()} className={r.names.includes(me ?? '') ? 'me' : undefined}>
              <span className="lv-rank">{i + 1}</span>
              <span className="lv-who">{namesText(r.names)}{r.names.length > 1 && <small> split</small>}<small className="lv-guess">{guessText(bet, r.guess)}</small></span>
              <span className="lv-pbar" aria-hidden="true"><i style={{ width: `${Math.max(r.p * 100, 1)}%` }} /></span>
              <b className="lv-p">{chance(r.p)}</b>
            </li>
          ))}
          {m.refund >= 0.005 && nobody && (
            <li className="lv-refund"><span className="lv-rank">↩</span><span className="lv-who">Money back<small className="lv-guess">nobody picked {lastName(nobody.name)}</small></span><span className="lv-pbar" aria-hidden="true"><i style={{ width: `${m.refund * 100}%` }} /></span><b className="lv-p">{chance(m.refund)}</b></li>
          )}
        </ol>
      )}
      {bet.note && <p className="small muted lv-bet-note">{bet.note} {bet.done}</p>}
    </article>
  )
}

const guessText = (bet: PublicBet, guess: number) => (bet.share == null ? `guessed ${guess}` : `guessed ${marginText(bet, guess)}`)

// ---------------------------------------------------------------- the shared picture: a range, sliced by who it pays

type Scene = { lo: number; hi: number; flip: boolean; mid: number; shape?: Density; zs: Zone[]; xs: { x: number; side: string | null; rank: number | null }[]; pos: (v: number) => number; sideOf: (id: string | null) => string | undefined; race: boolean }

/** The domain, in side A's share for races (A's side on the left, like the rest of the site) or Republican seats (Republicans right). pos() is 0 to 1, left to right. */
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
    flip: race && lo < 50 && hi > 50,
    mid: race ? bet.share!.p50 : (bet.seatsMid as number),
    sideOf: (id) => bet.candidates.find((c) => c.id === id)?.party,
  }
}
const edgeLabel = (bet: PublicBet, s: Scene, v: number) => (s.race ? marginText(bet, v) : String(Math.round(v)))

function Strip({ bet, m }: { bet: PublicBet; m?: MemberBet }) {
  const s = scene(bet, m)
  const L = 12
  const R = 308
  const X = (v: number) => L + s.pos(v) * (R - L)
  const AXIS = 46
  const lanes = [-1e9, -1e9]
  const ranked = s.xs.filter((t) => t.rank != null).sort((a, b) => X(a.x) - X(b.x)).map((t) => {
    const x = X(t.x)
    const lane = x - lanes[0] >= 18 ? 0 : 1
    lanes[lane] = x
    return { t, x, y: lane === 0 ? 26 : 9 }
  })
  const color = (id: string | null) => (s.race ? partyColor(s.sideOf(id)) : '#16181d')
  const refund = s.zs.find((z) => z.owner === null)
  const refundW = refund ? Math.abs(X(refund.to) - X(refund.from)) : 0
  return (
    <svg className="lv-strip" viewBox="0 0 320 72" role="img" aria-label={`${bet.title}: the middle estimate is ${middle(bet)}. ${rangeLine(bet)}`}>
      {refund && <rect x={Math.min(X(refund.from), X(refund.to))} width={refundW} y={AXIS - 7} height="14" className="lv-zone-refund" />}
      <line x1={L} x2={R} y1={AXIS} y2={AXIS} className="lv-strip-axis" />
      {s.shape && s.shape.d.length > 1 ? (
        <>
          <defs>
            <linearGradient id={`fade-${bet.id}`} gradientUnits="userSpaceOnUse" x1={X(s.shape.lo)} x2={X(s.shape.hi)} y1="0" y2="0">
              {fade(s.shape).map((f) => <stop key={f.at} offset={f.at} stopColor={`rgb(${INK})`} stopOpacity={f.a} />)}
            </linearGradient>
          </defs>
          <rect x={Math.min(X(s.shape.lo), X(s.shape.hi))} width={Math.abs(X(s.shape.hi) - X(s.shape.lo))} y={AXIS - 7} height="14" fill={`url(#fade-${bet.id})`} />
        </>
      ) : <rect x={X(s.mid) - 2} width="4" y={AXIS - 7} height="14" fill={`rgb(${INK})`} />}
      {s.zs.slice(1).map((z, i) => <line key={i} x1={X(z.from)} x2={X(z.from)} y1={AXIS - 10} y2={AXIS + 10} className={Math.abs(z.from - 50) < 0.02 && s.race ? 'lv-tied' : 'lv-divide'} />)}
      <line x1={X(s.mid)} x2={X(s.mid)} y1={AXIS - 9} y2={AXIS + 9} className="lv-strip-mid" />
      {s.xs.filter((t) => t.rank == null).map((t, i) => <circle key={i} cx={X(t.x)} cy={AXIS} r="3" fill={color(t.side)} stroke="var(--paper)" strokeWidth="1" />)}
      {ranked.map(({ t, x, y }) => (
        <g key={tickKey(t)}>
          <line x1={x} x2={x} y1={y} y2={AXIS} stroke={color(t.side)} strokeWidth="1.25" />
          <circle cx={x} cy={y} r="8" fill={color(t.side)} stroke="var(--paper)" strokeWidth="1.5" />
          <text x={x} y={y + 3.5} textAnchor="middle" className="lv-strip-num">{t.rank}</text>
        </g>
      ))}
      <text x={L} y="68" className="lv-strip-end">{edgeLabel(bet, s, s.race ? s.hi : s.lo)}</text>
      {refund && refundW > 58 && <text x={(X(refund.from) + X(refund.to)) / 2} y="68" textAnchor="middle" className="lv-strip-end">money back</text>}
      <text x={R} y="68" textAnchor="end" className="lv-strip-end">{edgeLabel(bet, s, s.race ? s.lo : s.hi)}</text>
    </svg>
  )
}

/** The headline race as a needle: same scale and same slices as a strip, bent into a dial. The needle is the projected margin, not anyone's chance of winning. */
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

function Dial({ bet, m, before }: { bet: PublicBet; m?: MemberBet; before: number | null }) {
  const s = scene(bet, m)
  const t = s.pos(s.mid)
  const [shown, setShown] = useState(0.5)
  useEffect(() => { const id = requestAnimationFrame(() => setShown(t)); return () => cancelAnimationFrame(id) }, [t])
  const R0 = 92
  const R1 = 126
  const steps = 90
  const valueAt = (p: number) => (s.hi - p * (s.hi - s.lo))
  const lanes = [-1e9, -1e9]
  const ranked = s.xs.filter((x) => x.rank != null).map((x) => ({ x, p: s.pos(x.x) })).sort((a, b) => a.p - b.p).map(({ x, p }) => {
    const lane = (p - lanes[0]) * Math.PI * 140 >= 18 ? 0 : 1
    lanes[lane] = p
    return { x, p, r: lane === 0 ? 139 : 155 }
  })
  const ghost = before != null && Math.abs(before - s.mid) >= 0.1 && before > s.lo && before < s.hi
  return (
    <svg className="lv-dial" viewBox="0 0 320 196" role="img" aria-label={`${bet.title}: the middle estimate is ${marginText(bet, s.mid)}. ${rangeLine(bet)}`}>
      <path d={arc(0, 1, R0, R1)} fill="#f2eee3" />
      {s.zs.filter((z) => z.owner === null).map((z, i) => {
        const a = Math.min(s.pos(z.from), s.pos(z.to))
        const b = Math.max(s.pos(z.from), s.pos(z.to))
        return <path key={i} d={arc(a, b, R0, R1)} className="lv-zone-refund" />
      })}
      {s.shape && Array.from({ length: steps }, (_, i) => {
        const a = alphaAt(s.shape as Density, valueAt((i + 0.5) / steps))
        return a > 0.005 ? <path key={i} d={arc(i / steps, (i + 1) / steps, R0, R1)} fill={`rgba(${INK}, ${a})`} /> : null
      })}
      {s.zs.slice(1).map((z, i) => {
        const p = s.pos(z.from)
        const [x0, y0] = polar(p, R0 - 3)
        const [x1, y1] = polar(p, R1 + 3)
        return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} className={Math.abs(z.from - 50) < 0.02 ? 'lv-tied' : 'lv-divide'} />
      })}
      {s.xs.filter((x) => x.rank == null).map((x, i) => {
        const [px, py] = polar(s.pos(x.x), R1 + 6)
        return <circle key={i} cx={px} cy={py} r="3" fill={partyColor(s.sideOf(x.side))} stroke="var(--paper)" strokeWidth="1" />
      })}
      {ranked.map(({ x, p, r }) => {
        const [x0, y0] = polar(p, R1)
        const [x1, y1] = polar(p, r)
        return (
          <g key={tickKey(x)}>
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={partyColor(s.sideOf(x.side))} strokeWidth="1.25" />
            <circle cx={x1} cy={y1} r="8" fill={partyColor(s.sideOf(x.side))} stroke="var(--paper)" strokeWidth="1.5" />
            <text x={x1} y={y1 + 3.5} textAnchor="middle" className="lv-strip-num">{x.rank}</text>
          </g>
        )
      })}
      {ghost && (() => { const [gx, gy] = polar(s.pos(before as number), R0 - 4); return <line x1={CX} y1={CY} x2={gx} y2={gy} className="lv-ghost" /> })()}
      <g className="lv-pointer" style={{ transform: `rotate(${(shown - 0.5) * 180}deg)`, transformOrigin: `${CX}px ${CY}px` }}>
        <line x1={CX} y1={CY} x2={CX} y2={CY - (R0 - 2)} className="lv-pointer-line" />
      </g>
      <circle cx={CX} cy={CY} r="7" fill="var(--ink)" />
      <text x="24" y="192" className="lv-dial-end">{edgeLabel(bet, s, s.hi)}</text>
      <text x="296" y="192" textAnchor="end" className="lv-dial-end">{edgeLabel(bet, s, s.lo)}</text>
    </svg>
  )
}
