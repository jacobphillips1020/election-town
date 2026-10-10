// The pool's home page: the Senate map, the balance of power, and the 12 picks, before and after the close.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp, useRpc } from '../data/context'
import { lastName } from '../domain/board'
import { formatET, plural, usd } from '../domain/format'
import {
  RATINGS_LINKS, draftFromBallot, levelFromConsensus, levelFromMargin, levelFromPick, raceLinks, sideOf, tone,
  type Draft, type Pool, type PoolMarket, type SenateRow,
} from '../domain/pool'
import { HELD_BY, HOUSE_2024_R, HOUSE_MAJORITY, SENATE_NOW_R, leftSide, pollLeader, senateKey, senateR, type Side } from '../domain/senate'
import { stateName } from '../domain/states'
import type { Market } from '../domain/types'
import { refreshBoardApi } from '../polling/client'
import { Balance } from './Balance'
import { currentDraft, pickedSides } from './Ballot'
import { Err, Loading } from './common'
import { Experts, Links, RatingChip } from './Pick'
import { MapLegend, TileMap, type Tile } from './TileMap'

type Mode = 'polls' | 'mine' | 'group'

export function HomePage() {
  const { backend, me } = useApp()
  const { data, error, loading, reload } = useRpc<Pool>('get_pool')
  // Members keep the polling fresh for everyone (the server refreshes at most every 12 hours).
  useEffect(() => {
    if (backend.mode === 'live' && me?.is_member) refreshBoardApi(backend).then((r) => r?.status === 'refreshed' && reload())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, me?.is_member])
  if (loading && !data) return <Loading />
  if (!data) return <main className="page" id="main"><Err>{error ?? 'Could not load the pool.'}</Err></main>
  return <Dashboard pool={data} />
}

function Dashboard({ pool }: { pool: Pool }) {
  const mine = useMemo<Draft | null>(() => (pool.my_ballot ? draftFromBallot(pool.my_ballot) : currentDraft()?.draft ?? null), [pool.my_ballot])
  const submitted = !!pool.my_ballot && Object.keys(pool.my_ballot).length > 0
  const [mode, setMode] = useState<Mode>(pool.closed ? 'group' : 'polls')
  const [sel, setSel] = useState<string | null>(null)
  const featured = pool.markets.filter((m) => m.kind === 'senate')
  const byKey = new Map(featured.map((m) => [senateKey(m.polling_ref!.state, m.polling_ref!.special), m]))
  const seatSen = pool.markets.find((m) => m.kind === 'senate_seats')
  const seatHouse = pool.markets.find((m) => m.kind === 'house_seats')
  const myR = (m?: PoolMarket) => (m && pool.my_ballot?.[m.id]?.seats?.r) ?? null

  const tiles: Record<string, Tile> = {}
  for (const r of pool.senate) {
    const k = senateKey(r.state, r.special)
    const m = byKey.get(k)
    tiles[r.state] = tileFor(r, m, mode, mine)
  }
  const selRow = sel ? pool.senate.find((r) => r.state === sel) ?? null : null

  return (
    <main className="page wide" id="main">
      <Hero pool={pool} submitted={submitted} />

      <section className="section" aria-labelledby="senate-h">
        <div className="sec-head">
          <h2 id="senate-h">Senate</h2>
          <div className="seg-toggle" role="group" aria-label="Color the map by">
            <button type="button" aria-pressed={mode === 'polls'} onClick={() => setMode('polls')}>Polls</button>
            {mine && <button type="button" aria-pressed={mode === 'mine'} onClick={() => setMode('mine')}>My picks</button>}
            {pool.closed && <button type="button" aria-pressed={mode === 'group'} onClick={() => setMode('group')}>The group</button>}
          </div>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          {mode === 'polls' && '35 races this year, colored by who leads the polling average. Outlined: the 10 on the ballot. Tap a state.'}
          {mode === 'mine' && 'Your ballot picks, shaded by the margin you picked. Other races follow the polls.'}
          {mode === 'group' && 'What the group picked: shaded by how many ballots agreed (like the 2024 composite map).'}
        </p>
        <div className="map-wrap">
          <TileMap tiles={tiles} selected={sel} onSelect={(s) => setSel(sel === s ? null : s)} label="Senate races by state" />
          <MapLegend group={mode === 'group'} />
        </div>
        {selRow && <RaceDetail row={selRow} m={byKey.get(senateKey(selRow.state, selRow.special))} pool={pool} mine={mine} onClose={() => setSel(null)} />}

        <h3 className="bal-h">Balance of power</h3>
        <Balance total={100} line={50} lineLabel="50 keeps R control" rows={[
          { label: 'Now', r: SENATE_NOW_R },
          { label: 'Polls', r: senateR(pool.senate), note: 'each race to its polling leader' },
          { label: 'Markets', r: pool.forecasts.senate?.r_median ?? null, note: pool.forecasts.senate?.d_control_pct != null ? `Polymarket · Dems ${Math.round(pool.forecasts.senate.d_control_pct)}% to win` : 'Polymarket' },
          { label: 'You', r: myR(seatSen) ?? (mine ? senateR(pool.senate, pickedSides(pool.markets, mine)) : null), strong: true },
          { label: 'Group', r: seatSen?.tally?.r_mean ?? null, note: seatSen?.tally ? `average of ${plural(seatSen.tally.n, 'ballot')}` : undefined, strong: true },
        ]} />
      </section>

      <section className="section" aria-labelledby="house-h">
        <h2 id="house-h">House</h2>
        <Balance total={435} line={HOUSE_MAJORITY} lineLabel="218 for a majority" rows={[
          { label: '2024', r: HOUSE_2024_R },
          { label: 'Markets', r: pool.forecasts.house?.r_median ?? null, note: pool.forecasts.house?.d_control_pct != null ? `Polymarket · Dems ${Math.round(pool.forecasts.house.d_control_pct)}% to win` : 'Polymarket' },
          { label: 'You', r: myR(seatHouse), strong: true },
          { label: 'Group', r: seatHouse?.tally?.r_mean ?? null, note: seatHouse?.tally ? `average of ${plural(seatHouse.tally.n, 'ballot')}` : undefined, strong: true },
        ]} />
        <HouseStrip polls={pool.house_polls} />
      </section>

      <section className="section" aria-labelledby="picks-h">
        <div className="sec-head">
          <h2 id="picks-h">The {pool.markets.length} picks</h2>
          <Link to="/ballot" className="small">{submitted ? 'Edit my ballot →' : 'Fill out the ballot →'}</Link>
        </div>
        <ul className="plist">
          {pool.markets.map((m) => <PickRow key={m.id} m={m} pool={pool} onPick={() => m.polling_ref && (setSel(m.polling_ref.state), document.getElementById('senate-h')?.scrollIntoView({ behavior: 'smooth' }))} />)}
        </ul>
      </section>

      {pool.closed && <GroupGrid pool={pool} />}

      <p className="research" style={{ marginTop: 20 }}>
        <span>Ratings:</span> Senate <Links links={RATINGS_LINKS.senate} /> · House <Links links={RATINGS_LINKS.house} />
      </p>
      <p className="board-source">
        Polling: PollingSource averages{pool.polling_fetched_at && `, updated ${new Date(pool.polling_fetched_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}.
        Seat forecasts: Polymarket prices (median seats), refreshed daily. “Now” is today’s Senate; the House shows the 2024 result.
      </p>
    </main>
  )
}

function Hero({ pool, submitted }: { pool: Pool; submitted: boolean }) {
  return (
    <section className="hero">
      <div>
        <p className="hero-kicker">The 2026 Midterm Pool</p>
        <h1>{pool.closed ? 'Picks are in. Now we wait.' : 'Call the Senate. Call the House.'}</h1>
        <p className="hero-sub">
          {pool.markets.length} picks · {usd(pool.ballot_cents)} a ballot ·{' '}
          {pool.closed ? `closed ${formatET(pool.deadline)}` : <>closes <strong>{formatET(pool.deadline)}</strong></>}
        </p>
      </div>
      <div className="hero-stats">
        <span><b>{pool.ballots}</b> {pool.ballots === 1 ? 'ballot' : 'ballots'}</span>
        <span><b>{usd(pool.pot_cents)}</b> in the pot</span>
      </div>
      {!pool.closed && (
        <div className="hero-cta">
          <Link className="btn big" to="/ballot">{submitted ? 'Edit my ballot' : 'Fill out my ballot'}</Link>
          {submitted && <Link className="btn ghost big" to="/card">Share my picks</Link>}
        </div>
      )}
      {pool.closed && submitted && <div className="hero-cta"><Link className="btn ghost big" to="/card">My picks card</Link></div>}
    </section>
  )
}

function tileFor(r: SenateRow, m: PoolMarket | undefined, mode: Mode, mine: Draft | null): Tile {
  const name = stateName(r.state)
  const p = r.polling
  const poll = (): Tile => {
    if (p?.dem_avg == null || p.rep_avg == null) {
      const held = HELD_BY[senateKey(r.state, r.special)]
      return { fill: tone(held === 'D' ? 'D' : 'R', 3), title: `${name}: no polls yet; held by ${held === 'D' ? 'Democrats' : 'Republicans'}`, star: !!m?.featured }
    }
    const margin = p.dem_avg - p.rep_avg
    const side: Side = margin >= 0 ? leftSide(r.state) : 'R'
    const lvl = levelFromMargin(margin)
    return {
      fill: tone(lvl ? side : null, lvl), star: !!m?.featured, sub: p.margin_label?.replace(/\.0$/, '') ?? undefined,
      title: `${name}: ${lastName(p.dem_name, 'Dem')} ${p.dem_avg.toFixed(1)}, ${lastName(p.rep_name, 'Rep')} ${p.rep_avg.toFixed(1)}${m?.featured ? ' (on the ballot)' : ''}`,
    }
  }
  if (!m) return poll()
  if (mode === 'mine' && mine) {
    const d = mine[m.id]
    const c = m.candidates.find((x) => x.id === d?.winner)
    const share = parseFloat(d?.share ?? '')
    if (c && share > 50) return { fill: tone(sideOf(c), levelFromPick(share)), star: true, sub: share.toFixed(1), title: `${name}: your pick ${c.name} ${share.toFixed(1)}%` }
  }
  if (mode === 'group' && m.tally && m.tally.n > 0) {
    const [a, b] = m.candidates
    const na = m.tally.picks[a.id] ?? 0
    const nb = m.tally.picks[b.id] ?? 0
    const lead = na >= nb ? a : b
    const frac = Math.max(na, nb) / Math.max(1, na + nb)
    const lvl = na === nb ? 0 : levelFromConsensus(frac)
    return { fill: tone(lvl ? sideOf(lead) : null, lvl), star: true, sub: `${Math.round(frac * 100)}%`, title: `${name}: ${Math.round(frac * 100)}% of ballots picked ${lead.name}` }
  }
  return poll()
}

function Split({ m }: { m: PoolMarket }) {
  const t = m.tally
  if (!t || t.n === 0) return null
  const [a, b] = m.candidates
  const na = t.picks[a.id] ?? 0
  const pa = (na / t.n) * 100
  return (
    <div className="split" aria-label={`${Math.round(pa)}% picked ${a.name}, ${Math.round(100 - pa)}% picked ${b.name}`}>
      <div className="split-bar">
        <span className={`split-a side-${sideOf(a).toLowerCase()}`} style={{ width: `${pa}%` }} />
        <span className={`split-b side-${sideOf(b).toLowerCase()}`} style={{ width: `${100 - pa}%` }} />
      </div>
      <div className="split-legend">
        <span>{lastName(a.name, a.name)} {Math.round(pa)}%{t.mean_shares[a.id] != null && <> · avg {(t.mean_shares[a.id] / 10).toFixed(1)}</>}</span>
        <span>{lastName(b.name, b.name)} {Math.round(100 - pa)}%{t.mean_shares[b.id] != null && <> · avg {(t.mean_shares[b.id] / 10).toFixed(1)}</>}</span>
      </div>
    </div>
  )
}

function YouVsGroup({ m, pool }: { m: PoolMarket; pool: Pool }) {
  const mine = pool.my_ballot?.[m.id]
  if (!mine) return null
  if (mine.seats) {
    const mean = m.tally?.r_mean
    return <p className="small">You: <b>{mine.seats.r}</b> Republican seats{mean != null && <> · group average {mean} ({mine.seats.r - mean > 0 ? '+' : ''}{(mine.seats.r - mean).toFixed(1)})</>}</p>
  }
  const c = m.candidates.find((x) => x.id === mine.winner_id)
  if (!c || !mine.shares) return null
  const share = mine.shares[c.id] / 10
  const t = m.tally
  const agree = t ? (t.picks[c.id] ?? 0) / Math.max(1, t.n) : null
  const avg = t?.mean_shares[c.id] != null ? t.mean_shares[c.id] / 10 : null
  return (
    <p className="small">
      You: <b>{c.name} {share.toFixed(1)}%</b>
      {agree !== null && <> · {Math.round(agree * 100)}% of ballots agree</>}
      {avg !== null && <> · group average for {lastName(c.name, c.name)} {avg.toFixed(1)} ({share - avg >= 0 ? '+' : ''}{(share - avg).toFixed(1)})</>}
    </p>
  )
}

function RaceDetail({ row, m, pool, mine, onClose }: { row: SenateRow; m: PoolMarket | undefined; pool: Pool; mine: Draft | null; onClose: () => void }) {
  const p = row.polling
  const title = `${stateName(row.state)} Senate${row.special ? ' (special)' : ''}`
  const held = HELD_BY[senateKey(row.state, row.special)]
  const lead = pollLeader(row)
  const draftPick = m && !pool.my_ballot && mine?.[m.id]
  return (
    <div className="detail" role="region" aria-label={title}>
      <div className="detail-head">
        <h3>{title}</h3>
        <button type="button" className="btn ghost small" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <p className="small muted" style={{ margin: '0 0 6px' }}>
        Held by {held === 'D' ? 'Democrats' : 'Republicans'}{p?.dem_avg != null && <> · {lead === 'R' ? 'Republican' : lead === 'I' ? 'Independent' : 'Democrat'} leads the polls</>}
        {m?.featured && <> · <b>on the ballot</b></>}
      </p>
      {p?.dem_avg != null && p.rep_avg != null ? (
        <MatchupLine row={row} m={m} />
      ) : <p className="small">No polling average yet.</p>}
      <div className="bi-meta">{p?.rating && <RatingChip rating={p.rating} prefix="Polls" />}<Experts experts={p?.experts} /></div>
      {m && (
        <>
          <p className="small" style={{ margin: '8px 0 4px' }}>
            <b>{plural(m.entrants, 'pick')}</b> · <b>{usd(m.pool_cents)}</b> pot · {usd(m.buy_in_cents ?? 0)} a pick
            {!pool.closed && ' · picks stay sealed until the pool closes'}
          </p>
          {pool.closed && <Split m={m} />}
          <YouVsGroup m={m} pool={pool} />
          {draftPick && draftPick.winner && <p className="small muted">Your unsubmitted pick: {m.candidates.find((c) => c.id === draftPick.winner)?.name} {draftPick.share}%</p>}
        </>
      )}
      <div className="bi-foot">
        <Links links={raceLinks({ polling_ref: { race_type: 'senate', state: row.state, district: null, special: row.special } }, p?.page)} />
        {m ? <Link className="small" to={`/m/${m.id}`}>Details →</Link>
          : row.market ? <Link className="small" to={`/m/${row.market.id}`}>Side bet →</Link>
          : p?.dem_name && p.rep_name ? <Link className="small" to={`/open?q=${encodeURIComponent(`${stateName(row.state)} senate`)}`}>Open a side bet →</Link> : null}
      </div>
    </div>
  )
}

function MatchupLine({ row, m }: { row: SenateRow; m?: Market }) {
  const p = row.polling!
  const d = p.dem_avg!, r = p.rep_avg!
  const left = leftSide(row.state)
  const dName = m?.candidates[0]?.name ?? p.dem_name ?? 'Democrat'
  const rName = m?.candidates[1]?.name ?? p.rep_name ?? 'Republican'
  return (
    <div className="mu">
      <div className="mu-names">
        <span className={`${left === 'I' ? 'mu-i-name' : 'mu-d-name'}${d > r ? ' lead' : ''}`}>{lastName(dName, dName)} <span className="mu-num">{d.toFixed(1)}</span></span>
        <span className={`mu-r-name${r > d ? ' lead' : ''}`}><span className="mu-num">{r.toFixed(1)}</span> {lastName(rName, rName)}</span>
      </div>
      <div className="mu-bar" aria-hidden="true">
        <span className={left === 'I' ? 'mu-d mu-i' : 'mu-d'} style={{ width: `${Math.min(d, 100)}%` }} />
        <span className="mu-r" style={{ width: `${Math.min(r, 100)}%` }} />
        <span className="mu-mid" />
      </div>
      <p className="small muted" style={{ margin: '4px 0 0' }}>{p.margin_label} · {plural(p.poll_count, 'poll')}{p.last_poll_date && `, latest ${new Date(p.last_poll_date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}</p>
    </div>
  )
}

function PickRow({ m, pool, onPick }: { m: PoolMarket; pool: Pool; onPick: () => void }) {
  const seat = m.kind === 'senate_seats' || m.kind === 'house_seats'
  const row = m.polling_ref ? pool.senate.find((r) => r.state === m.polling_ref!.state && r.special === m.polling_ref!.special) : undefined
  return (
    <li className="prow">
      {seat ? (
        <Link to={`/m/${m.id}`} className="prow-hit">
          <span className="prow-top"><span className="prow-title">{m.kind === 'senate_seats' ? 'Senate seats' : 'House seats'}</span>
            <span className="prow-stats">{plural(m.entrants, 'pick')} · {usd(m.pool_cents)}</span></span>
          <span className="small muted">
            {m.tally?.r_mean != null ? <>Group average: <b>{m.tally.r_mean}</b> Republican seats (range {m.tally.r_min}–{m.tally.r_max})</> : 'Republican seats after the election; closest guess takes the pot'}
          </span>
          <YouVsGroup m={m} pool={pool} />
        </Link>
      ) : (
        <button type="button" className="prow-hit" onClick={onPick}>
          <span className="prow-top"><span className="prow-title">{m.title}</span>
            <span className="prow-stats">{plural(m.entrants, 'pick')} · {usd(m.pool_cents)}</span></span>
          {pool.closed && m.tally ? <Split m={m} /> : row?.polling?.dem_avg != null ? <MatchupLine row={row} m={m} /> : <span className="small muted">No polling average yet</span>}
          {pool.closed && <YouVsGroup m={m} pool={pool} />}
        </button>
      )}
    </li>
  )
}

function HouseStrip({ polls }: { polls: Pool['house_polls'] }) {
  if (!polls.length) return null
  const d = polls.filter((x) => x.margin > 0).length
  const r = polls.filter((x) => x.margin < 0).length
  return (
    <div className="hstrip">
      <p className="small" style={{ margin: '10px 0 4px' }}>
        <b>{polls.length}</b> House districts have polling: Democrats lead in <b>{d}</b>, Republicans in <b>{r}</b>.
        <span className="muted"> Most districts are never polled, so this isn&rsquo;t a seat count.</span>
      </p>
      <div className="hstrip-dots" aria-hidden="true">
        {polls.map((x) => (
          <span key={`${x.state}${x.district}`} title={`${x.state}-${x.district}: ${x.margin > 0 ? 'D' : x.margin < 0 ? 'R' : 'Tied'}${x.margin ? `+${Math.abs(x.margin)}` : ''}`}
            style={{ background: tone(x.margin > 0 ? 'D' : x.margin < 0 ? 'R' : null, levelFromMargin(x.margin)) }} />
        ))}
      </div>
    </div>
  )
}

/** After the close: every ballot side by side (anonymized), like the 2024 recap email. */
function GroupGrid({ pool }: { pool: Pool }) {
  const grid = pool.ballots_grid
  const races = pool.markets.filter((m) => m.kind === 'senate')
  const seatSen = pool.markets.find((m) => m.kind === 'senate_seats')
  const seatHouse = pool.markets.find((m) => m.kind === 'house_seats')
  if (!grid) return (
    <section className="section"><h2>How the group voted</h2><p className="muted">Sign in as a member to see every ballot side by side.</p></section>
  )
  if (!grid.length) return null
  const cols = [...grid].sort((a, b) => (a.picks[seatSen?.id ?? '']?.r ?? 0) - (b.picks[seatSen?.id ?? '']?.r ?? 0))
  const unanimous = races.filter((m) => new Set(cols.map((b) => b.picks[m.id]?.w)).size === 1 && cols[0].picks[m.id]?.w)
  return (
    <section className="section" aria-labelledby="grid-h">
      <h2 id="grid-h">How the group voted</h2>
      <p className="hint" style={{ marginTop: 0 }}>Every ballot, anonymized, sorted by Senate seats. Your column is outlined.</p>
      {unanimous.length > 0 && (
        <p className="small">Unanimous: {unanimous.map((m) => `${stateName(m.polling_ref!.state)} (${m.candidates.find((c) => c.id === cols[0].picks[m.id]?.w)?.name})`).join(', ')}.</p>
      )}
      <div className="scroll-x">
        <table className="grid">
          <thead>
            <tr><th>Race</th><th className="num">Dem / Ind</th>{cols.map((b, i) => <th key={i} className={b.you ? 'you' : ''}>{b.you ? 'You' : i + 1}</th>)}</tr>
          </thead>
          <tbody>
            {races.map((m) => {
              const first = m.candidates[0]
              const n = cols.filter((b) => b.picks[m.id]?.w === first.id).length
              return (
                <tr key={m.id}>
                  <th scope="row">{stateName(m.polling_ref!.state)}</th>
                  <td className="num">{Math.round((n / cols.length) * 100)}%</td>
                  {cols.map((b, i) => {
                    const c = m.candidates.find((x) => x.id === b.picks[m.id]?.w)
                    const s = b.picks[m.id]?.s
                    return <td key={i} className={`cell side-${c ? sideOf(c).toLowerCase() : 'none'}${b.you ? ' you' : ''}`} title={c ? `${c.name} ${s != null ? (s / 10).toFixed(1) + '%' : ''}` : ''}>{s != null ? (s / 10).toFixed(0) : ''}</td>
                  })}
                </tr>
              )
            })}
            {[seatSen, seatHouse].filter(Boolean).map((m) => (
              <tr key={m!.id} className="seat-row">
                <th scope="row">{m!.kind === 'senate_seats' ? 'Senate R' : 'House R'}</th>
                <td className="num">{m!.tally?.r_mean ?? ''}</td>
                {cols.map((b, i) => <td key={i} className={b.you ? 'you' : ''}>{b.picks[m!.id]?.r ?? ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
