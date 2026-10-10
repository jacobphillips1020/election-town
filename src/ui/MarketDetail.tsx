// One pick's page: a main-ballot race or seat count, or a side bet.
// Side bets are entered here (winner + two-way vote share); main-ballot picks are entered on the ballot.
import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAccount, useAdminName, useApp, useRpc } from '../data/context'
import { lastName } from '../domain/board'
import { formatET, plural, usd } from '../domain/format'
import { checkPick, draftFromBallot, isSeat, raceLinks, sideOf, type PickDraft } from '../domain/pool'
import type { Entry, Market, MarketDetail, Payout, PollSnapshot, Run } from '../domain/types'
import { refreshMarket } from '../polling/client'
import { Err, Loading, PhasePill, StripPlot, partyVar } from './common'
import { Links, RacePick } from './Pick'

export function MarketPage() {
  const { id } = useParams()
  const { backend } = useApp()
  const isNew = new URLSearchParams(useLocation().search).get('new') === '1'
  const { data, error, loading, reload } = useRpc<MarketDetail>('get_market', { p_id: id })
  // Ask the server to refresh this race's polling (it caches for 6 hours).
  useEffect(() => {
    if (id) refreshMarket(backend, id).then((r) => r?.status === 'refreshed' && reload())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, backend])
  if (loading && !data) return <Loading />
  if (!data) return <main className="page" id="main"><Err>{error ?? 'Not found.'}</Err><Link to="/">Back to the pool</Link></main>
  const m = data.market
  const phase = m.phase
  const back = m.featured ? { to: '/', label: 'The pool' } : { to: '/side', label: 'Side bets' }

  return (
    <main className="page" id="main">
      <p className="small"><Link to={back.to}>← {back.label}</Link></p>
      <div className="reveal-head">
        <h1 style={{ margin: 0 }}>{m.kind === 'senate_seats' ? 'Senate: Republican seats' : m.kind === 'house_seats' ? 'House: Republican seats' : m.title}</h1>
        <PhasePill phase={phase} />
      </div>
      <p className="muted" style={{ marginTop: 6 }}>
        {m.featured ? 'On the main ballot' : `Side bet${m.proposed_by_name ? ` opened by ${m.proposed_by_name}` : ''}`}
        {' · '}{usd(m.buy_in_cents ?? 0)} a pick · {plural(m.entrants, 'pick')} · <b>{usd(m.pool_cents)}</b> pot
        {' · '}{phase === 'open' ? `closes ${formatET(m.entry_deadline)}` : phase === 'canceled' ? 'canceled' : `closed ${formatET(m.entry_deadline)}`}
      </p>
      <Err>{error}</Err>

      {isNew && phase === 'open' && !data.my_entry && (
        <p className="callout" role="status"><strong>Side bet open.</strong> Make your pick below, then invite friends with the link.</p>
      )}
      {phase === 'canceled' && <p className="callout">Canceled{m.cancel_reason ? `: ${m.cancel_reason}` : ''}. Everyone&rsquo;s stake was returned.</p>}
      {phase === 'open' && (m.featured ? <OnBallot d={data} /> : <SideEntry d={data} reload={reload} />)}
      {phase === 'open' && !m.featured && <Invite m={m} />}
      {(phase === 'closed' || phase === 'settled') && <Reveal d={data} />}

      {!isSeat(m) && m.kind !== 'congress' && <PollingBlock snap={data.polling.at_close ?? data.polling.latest} closed={phase !== 'open'} m={m} />}
      <Rules m={m} />
    </main>
  )
}

function OnBallot({ d }: { d: MarketDetail }) {
  const e = d.my_entry
  const m = d.market
  const mine = e ? draftFromBallot({ [m.id]: { winner_id: e.winner_id, shares: e.shares as Record<string, number> | null, seats: e.seats as { r: number } | null } })[m.id] : null
  return (
    <div className="callout">
      This pick is on the main ballot{mine ? <>: you picked <b>{mine.r ? `${mine.r} Republican seats` : `${m.candidates.find((c) => c.id === mine.winner)?.name} ${mine.share}%`}</b>.</> : '.'}
      {' '}<Link to="/ballot">{mine ? 'Change it on your ballot' : 'Fill out your ballot'}</Link>
      <span className="muted"> · Picks are sealed until the pool closes.</span>
    </div>
  )
}

function SideEntry({ d, reload }: { d: MarketDetail; reload: () => void }) {
  const { backend } = useApp()
  const { signedIn, isMember, signupPath } = useAccount()
  const loc = useLocation()
  const m = d.market
  const e = d.my_entry
  const [value, setValue] = useState<PickDraft | undefined>(
    e?.winner_id && e.shares ? { winner: e.winner_id, share: ((e.shares as Record<string, number>)[e.winner_id] / 10).toFixed(1) } : undefined)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const check = checkPick(m, value)
  const board = useRpc<{ race_type: string; state: string; district: string | null; special: boolean; polling: null | { dem_avg: number | null; rep_avg: number | null } & Record<string, unknown> }[]>('race_board')
  const ref = m.polling_ref
  const row = ref ? board.data?.find((r) => r.race_type === ref.race_type && r.state === ref.state && (r.district ?? null) === (ref.district ?? null) && r.special === ref.special) : undefined

  async function save() {
    if (!check.ok) return setErr(check.reason)
    setBusy(true); setErr('')
    try {
      await backend.rpc('submit_entry', { p_market: m.id, p_winner: check.value.winner_id, p_shares: check.value.shares })
      setSaved(true)
      reload()
    } catch (x) { setErr(x instanceof Error ? x.message : 'Could not save.') } finally { setBusy(false) }
  }
  async function withdraw() {
    if (!confirm('Withdraw your pick? You can make a new one until it closes.')) return
    setBusy(true)
    try { await backend.rpc('withdraw_entry', { p_market: m.id }); setValue(undefined); reload() } catch (x) { setErr(x instanceof Error ? x.message : 'Could not withdraw.') } finally { setBusy(false) }
  }

  return (
    <section className="section">
      <h2>{e ? 'Your pick' : 'Make your pick'}</h2>
      <RacePick m={m} polling={(row?.polling as never) ?? null} value={value} onChange={(v) => { setSaved(false); setValue(v) }} />
      <Err>{err}</Err>
      {saved && <p className="ok" role="status">Saved. You can change it until {formatET(m.entry_deadline)}.</p>}
      <div className="row" style={{ marginTop: 10 }}>
        {!signedIn ? <Link className="btn" to={signupPath(loc.pathname)}>Sign up to make a pick</Link>
          : !isMember ? <p className="callout warn">The group is invite-only right now. Ask the organizer for the invitation link.</p>
          : <button className="btn" disabled={busy || !check.ok} onClick={save}>{e ? 'Save changes' : `Make pick · ${usd(m.buy_in_cents ?? 0)}`}</button>}
        {e && <button className="btn ghost" disabled={busy} onClick={withdraw}>Withdraw</button>}
      </div>
      <p className="hint">Picks are sealed until this bet closes. You can change or withdraw yours until then.</p>
    </section>
  )
}

function Invite({ m }: { m: Market }) {
  const admin = useAdminName()
  const [msg, setMsg] = useState('')
  const url = `${window.location.origin}/m/${m.id}`
  const text = `Side bet on ${m.title}: ${usd(m.buy_in_cents ?? 0)}, pick the winner and their vote share. Closes ${formatET(m.entry_deadline)}. Want in?`
  async function go() {
    try {
      if (navigator.share) { await navigator.share({ title: m.title, text, url }); return }
      await navigator.clipboard.writeText(`${text} ${url}`)
      setMsg('Invite copied. Paste it into a text.')
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setMsg(url)
    }
  }
  return (
    <section className="section">
      <h2>Invite friends</h2>
      <p className="small">Send the link to whoever you want in. Anyone in the group can join.</p>
      <div className="row">
        <button type="button" className="btn ghost" onClick={go}>Share invite</button>
        <a className="btn ghost" href={`sms:?&body=${encodeURIComponent(`${text} ${url}`)}`}>Text it</a>
      </div>
      {msg && <p className="small ok" role="status">{msg}</p>}
      <p className="hint">Want a different stake than {usd(m.buy_in_cents ?? 0)}? Ask {admin}; they can change it.</p>
    </section>
  )
}

/* -------------------------------------------------------------- after the close */

function Reveal({ d }: { d: MarketDetail }) {
  const { isMember, signedIn, signupPath } = useAccount()
  const loc = useLocation()
  const m = d.market
  const settled = m.phase === 'settled'
  const run = d.runs[d.runs.length - 1]
  if (!isMember) {
    return (
      <section className="section">
        <h2>Picks revealed</h2>
        <p className="callout">
          {plural(m.entrants, 'pick')} {m.entrants === 1 ? 'is' : 'are'} in; the group sees who picked what.
          {!signedIn && <> <Link to={signupPath(loc.pathname)}>Sign up</Link> to see them.</>}
        </p>
      </section>
    )
  }
  const entries = d.entries ?? []
  const pay = new Map(d.payouts.map((p) => [p.entry_id, p]))
  return (
    <section className="section">
      <div className="reveal-head"><h2 style={{ margin: 0 }}>Picks revealed</h2>{!settled && <span className="muted small">awaiting final results</span>}</div>
      {settled && run && <ResultSummary m={m} run={run} runs={d.runs} />}
      {isSeat(m) ? <SeatReveal m={m} entries={entries} pay={pay} settled={settled} run={run} /> : <RaceReveal m={m} entries={entries} pay={pay} settled={settled} run={run} />}
      {settled && <p className="hint">Payouts include each winner&rsquo;s own stake. Split pots are paid in whole cents.</p>}
    </section>
  )
}

function ResultSummary({ m, run, runs }: { m: Market; run: Run; runs: Run[] }) {
  const r = run.result
  const w = m.candidates.find((c) => c.id === r.winner_id)
  const seats = r.seats as { r?: number } | undefined
  return (
    <div className="callout">
      {isSeat(m) ? <p style={{ margin: 0 }}><strong>Republicans won {seats?.r} seats.</strong></p>
        : <p style={{ margin: 0 }}><strong>{w?.name} won with {((r.winner_share_tenths ?? 0) / 10).toFixed(1)}%</strong> of the two-way vote (certified).</p>}
      {run.outcome === 'no_winner_refund' && <p style={{ margin: '4px 0 0' }}>Nobody picked the winner, so everyone got their stake back.</p>}
      {r.source_url && <p className="small" style={{ margin: '4px 0 0' }}><a href={r.source_url} target="_blank" rel="noreferrer">Result source</a></p>}
      {runs.length > 1 && <p className="small" style={{ margin: '4px 0 0' }}>Corrected {runs.length - 1}×. Latest reason: {run.reason}</p>}
    </div>
  )
}

function payCell(p: Payout | undefined, run: Run | undefined, race: boolean) {
  if (!p || !run) return '—'
  if (p.gross_cents > 0) return <span className="win">{usd(p.gross_cents)}</span>
  if (p.refund_cents > 0) return <span>Refunded {usd(p.refund_cents)}</span>
  if (race && !p.eligible) return <span className="wrong">Wrong winner</span>
  return <span className="wrong">—</span>
}

function RaceReveal({ m, entries, pay, settled, run }: { m: Market; entries: Entry[]; pay: Map<string, Payout>; settled: boolean; run: Run | undefined }) {
  const { uid } = useApp()
  const n = entries.length
  const name = (id: string | null) => m.candidates.find((c) => c.id === id)?.name ?? ''
  const sharesOf = (e: Entry) => e.shares as Record<string, number> | null
  return (
    <>
      {n === 0 ? <p className="muted">No picks.</p> : (
        <div className="reveal-in">
          {m.candidates.map((c) => {
            const k = entries.filter((e) => e.winner_id === c.id).length
            const vals = entries.filter((e) => sharesOf(e)).map((e) => (sharesOf(e)![c.id] ?? 0) / 10)
            const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length)
            return (
              <div key={c.id} style={{ marginBottom: 8 }}>
                <div className="small"><span style={{ color: partyVar(c.party), fontWeight: 800 }}>{c.name}</span>{' '}
                  <span className="muted">· picked by {k} of {n} ({Math.round((k / n) * 100)}%) · average predicted share {mean.toFixed(1)}%</span></div>
                {vals.length > 0 && <StripPlot values={vals} mean={mean} color={partyVar(c.party)} label={`Predicted share for ${c.name}`} />}
              </div>
            )
          })}
          <p className="hint">Each dot is one pick; the dark line is the group average.</p>
        </div>
      )}
      <h3>Everyone&rsquo;s picks</h3>
      <div className="scroll-x">
        <table className="t">
          <thead><tr><th>Name</th><th>Picked</th><th className="num">Share</th>{settled && <th className="num">Off by</th>}{settled && <th>Payout</th>}</tr></thead>
          <tbody>
            {entries.map((e) => {
              const p = pay.get(e.id)
              const s = sharesOf(e)
              return (
                <tr key={e.id}>
                  <td>{e.display_name}{e.user_id === uid && <span className="muted"> (you)</span>}</td>
                  <td>{lastName(name(e.winner_id), name(e.winner_id))}</td>
                  <td className="num">{s && e.winner_id ? `${(s[e.winner_id] / 10).toFixed(1)}%` : '—'}</td>
                  {settled && <td className="num">{p?.eligible && p.error_value !== null ? `${(p.error_value / 10).toFixed(1)} pts` : '—'}</td>}
                  {settled && <td>{payCell(p, run, true)}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function SeatReveal({ m, entries, pay, settled, run }: { m: Market; entries: Entry[]; pay: Map<string, Payout>; settled: boolean; run: Run | undefined }) {
  const { uid } = useApp()
  const vals = entries.map((e) => (e.seats as { r?: number } | null)?.r).filter((x): x is number => typeof x === 'number')
  const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length)
  const rows = [...entries].sort((a, b) => ((a.seats as { r: number }).r - (b.seats as { r: number }).r))
  return (
    <>
      {vals.length > 0 && (
        <div className="reveal-in">
          <p className="small">Group average: <b>{mean.toFixed(1)}</b> Republican seats ({m.kind === 'senate_seats' ? 'of 100' : 'of 435'}).</p>
          <StripPlot values={vals} mean={mean} color="var(--rep)" label="Republican seat guesses" />
        </div>
      )}
      <h3>Everyone&rsquo;s guesses</h3>
      <div className="scroll-x">
        <table className="t">
          <thead><tr><th>Name</th><th className="num">Republican seats</th>{settled && <th className="num">Off by</th>}{settled && <th>Payout</th>}</tr></thead>
          <tbody>
            {rows.map((e) => {
              const p = pay.get(e.id)
              return (
                <tr key={e.id}>
                  <td>{e.display_name}{e.user_id === uid && <span className="muted"> (you)</span>}</td>
                  <td className="num">{(e.seats as { r: number }).r}</td>
                  {settled && <td className="num">{p?.error_value ?? '—'}</td>}
                  {settled && <td>{payCell(p, run, false)}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* -------------------------------------------------------------- polling + rules */

function PollingBlock({ snap, closed, m }: { snap: PollSnapshot | null; closed: boolean; m: Market }) {
  const c = snap?.data.candidates ?? []
  return (
    <section className="section">
      <h2>{closed ? 'Polling at the close' : 'Polling'}</h2>
      {c.length === 0 ? <p className="muted">No polling average yet.</p> : (
        <>
          <ul className="board-cands">
            {c.map((x, i) => (
              <li key={i}><span>{x.name}</span><span style={{ color: partyVar(x.party ?? sideOf(m.candidates[i])), fontWeight: 800 }}>{x.party ?? ''}</span><span className="mu-num">{x.pct.toFixed(1)}%</span></li>
            ))}
          </ul>
          <p className="hint">{snap!.source_name}, as of {snap!.as_of}. {snap!.data.note}</p>
        </>
      )}
      <Links links={raceLinks(m, snap?.source_url)} />
    </section>
  )
}

function Rules({ m }: { m: Market }) {
  return (
    <section className="section">
      <h2>Rules</h2>
      <p className="small">{m.rules_note}</p>
      <p className="small muted">
        {usd(m.buy_in_cents ?? 0)} a pick. Change or withdraw until {formatET(m.entry_deadline)}; picks are sealed until then.
        Fewer than two picks at the close: everyone is refunded. No money moves through this site.
      </p>
    </section>
  )
}
