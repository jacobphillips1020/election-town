import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAdminName, useApp, useRpc } from '../data/context'
import { formatET, pct, plural, usd } from '../domain/format'
import { allocate, groupForecast, type Draft } from '../domain/race'
import { HOUSE_TOTAL, SENATE_TOTAL, meanSeats, remainder } from '../domain/seats'
import type { Candidate, Entry, Market, MarketDetail, Payout, PollSnapshot, Run, Seats } from '../domain/types'
import { Err, Loading, PartyTag, PhasePill, ShareBar, ShareButton, StripPlot, candColor, partyVar } from './common'

export function MarketPage() {
  const { id } = useParams()
  const { data, error, loading, reload } = useRpc<MarketDetail>('get_market', { p_id: id })
  if (loading && !data) return <Loading />
  if (!data) return <main className="page" id="main"><Err>{error ?? 'Market not found.'}</Err><Link to="/">Back to markets</Link></main>
  const m = data.market
  const phase = m.phase
  const settled = phase === 'settled'

  return (
    <main className="page" id="main">
      <p className="small"><Link to="/">← Markets</Link></p>
      <div className="reveal-head">
        <h1 style={{ margin: 0 }}>{m.title}</h1>
        <PhasePill phase={phase} />
      </div>
      <p className="muted" style={{ marginTop: 6 }}>
        {m.jurisdiction && <>{m.jurisdiction} · </>}
        {phase === 'proposed' ? `Proposed by ${m.proposed_by_name ?? 'a member'}` : (
          <>
            {phase === 'open' ? `Entries close ${formatET(m.entry_deadline)}` : phase === 'canceled' ? 'Canceled' : `Entries closed ${formatET(m.entry_deadline)}`}
            {' · '}{usd(m.buy_in_cents ?? 0)} buy-in
            {' · '}{plural(m.entrants, 'entry', 'entries')} · {usd(m.pool_cents)} committed
          </>
        )}
      </p>
      <div style={{ marginBottom: 8 }}><ShareButton path={`/m/${m.id}`} title={m.title} /></div>
      <BasisBanner m={m} />
      <Err>{error}</Err>

      {phase === 'proposed' && <ProposedNote m={m} />}
      {phase === 'canceled' && <CanceledNote m={m} runs={data.runs} />}
      {phase === 'open' && <EntrySection d={data} reload={reload} />}
      {(phase === 'closed' || settled) && <Reveal d={data} />}

      <PollingBlock d={data} />
      <Rules m={m} />
    </main>
  )
}

function BasisBanner({ m }: { m: Market }) {
  if (m.kind === 'congress' || m.outcome_basis === 'single_round') return null
  return (
    <p className="callout warn">
      <strong>Outcome basis: {m.outcome_basis === 'runoff_final' ? 'runoff' : 'ranked-choice final round'}.</strong>{' '}
      This market settles on the eventual winner and their share of all valid votes in the decisive final round. It stays
      awaiting results until that round is final.
    </p>
  )
}

function ProposedNote({ m }: { m: Market }) {
  const { me } = useApp()
  const admin = useAdminName()
  return (
    <section className="section">
      <p>This race is waiting for {admin} to approve it and set the buy-in and entry deadline. Entries open after approval.</p>
      <Candidates cands={m.candidates} hasOther={m.has_other} />
      {me?.is_admin && <p><Link className="btn" to="/admin">Review in Admin</Link></p>}
    </section>
  )
}

function CanceledNote({ m, runs }: { m: Market; runs: Run[] }) {
  const last = runs[runs.length - 1]
  return (
    <section className="section">
      <p className="callout warn">
        <strong>Canceled.</strong> {m.cancel_reason ?? last?.reason ?? ''} All commitments are returned and appear as refunds in My entries.
      </p>
    </section>
  )
}

function Candidates({ cands, hasOther }: { cands: Candidate[]; hasOther: boolean }) {
  return (
    <ul className="mlist" style={{ marginBottom: 8 }}>
      {cands.map((c) => (
        <li key={c.id} className="mrow-top" style={{ padding: '8px 4px' }}>
          <span>{c.name}</span><PartyTag party={c.party} />
        </li>
      ))}
      {hasOther && <li className="muted" style={{ padding: '8px 4px' }}>Other candidates (remainder)</li>}
    </ul>
  )
}

/* -------------------------------------------------------------- polling */

function snapshotSource(s: PollSnapshot) {
  if (s.source_kind === 'fixture') return 'Demo fixture (invented numbers, not real polling)'
  if (s.source_kind === 'manual') return `Entered manually · ${s.source_name}`
  return s.source_name
}

function Snapshot({ s, markStale }: { s: PollSnapshot; markStale: boolean }) {
  const ageDays = (Date.now() - new Date(s.as_of + 'T12:00:00Z').getTime()) / 86400e3
  const stale = markStale && ageDays > 14
  return (
    <div className="panel">
      <p className="small muted" style={{ margin: 0 }}>
        {snapshotSource(s)} · as of {s.as_of}
        {stale && <strong style={{ color: 'var(--warn)' }}> · stale</strong>}
      </p>
      <table className="t">
        <tbody>
          {s.data.candidates.map((c) => (
            <tr key={c.name}>
              <td>{c.name} {c.party && <PartyTag party={c.party} />}</td>
              <td className="num">{c.pct.toFixed(1)}%</td>
            </tr>
          ))}
          {s.data.undecided != null && <tr><td className="muted">Undecided</td><td className="num">{s.data.undecided.toFixed(1)}%</td></tr>}
          {s.data.other != null && <tr><td className="muted">Other</td><td className="num">{s.data.other.toFixed(1)}%</td></tr>}
        </tbody>
      </table>
      <p className="hint" style={{ margin: 0 }}>
        Shown as published; not adjusted to total 100% and not a prediction of the final vote.
        {s.data.note && <> {s.data.note}</>}
        {s.source_url && <> <a href={s.source_url} target="_blank" rel="noreferrer">Source</a></>}
      </p>
    </div>
  )
}

function PollingBlock({ d }: { d: MarketDetail }) {
  const m = d.market
  const { latest, at_close } = d.polling
  if (m.kind === 'congress') {
    return <section className="section"><h2>Polling context</h2><p className="muted">No seat projection connected.</p></section>
  }
  if (m.phase === 'open' || m.phase === 'proposed') {
    return (
      <section className="section">
        <h2>Polling context</h2>
        {latest ? <Snapshot s={latest} markStale /> : <p className="muted">No polling average available.</p>}
      </section>
    )
  }
  const newer = latest && (!at_close || latest.id !== at_close.id) ? latest : null
  return (
    <section className="section">
      <h2>Polling at close</h2>
      {at_close ? <Snapshot s={at_close} markStale={false} /> : <p className="muted">The polling snapshot at close wasn&rsquo;t captured.</p>}
      {newer && (<><h3>Newer polling (after close)</h3><Snapshot s={newer} markStale={false} /></>)}
    </section>
  )
}

/* -------------------------------------------------------------- rules */

function Rules({ m }: { m: Market }) {
  const admin = useAdminName()
  const race = m.kind !== 'congress'
  return (
    <section className="section">
      <h2>Rules</h2>
      <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
        <li>Entries close {formatET(m.entry_deadline)}. Your pick stays hidden until entries close; then everyone&rsquo;s picks are revealed.</li>
        <li>Fixed buy-in of {usd(m.buy_in_cents ?? 0)}. No odds, no variable stakes, no payments in the app: {admin} records transfers by hand.</li>
        {race ? (
          <>
            <li>Predict the winner and the winner&rsquo;s percentage of <em>all valid candidate votes</em> (not two-party share, not a win probability).</li>
            <li>Only entries that picked the certified winner can win. Among those, the closest winner share takes the whole pool. Exact ties split it.</li>
            <li>Settlement uses the certified winner and their certified vote share, rounded once to one decimal place. Election-night calls don&rsquo;t settle anything.</li>
            <li>If nobody picked the winner, or fewer than two people enter, every commitment is returned.</li>
          </>
        ) : (
          <>
            <li>Predict final seats for the House (435) and Senate (100) in three categories each.</li>
            <li>Score = half the sum of the absolute differences across all six counts. Off by 3 seats in the House and 1 in the Senate = 4 seats of error. Lowest error wins; ties split the pool.</li>
          </>
        )}
        <li>Split pots are paid in whole cents. Leftover cents go to the earliest entries by ID, so tied winners can differ by one cent.</li>
        {m.rules_note && <li><strong>Resolution:</strong> {m.rules_note}</li>}
      </ul>
    </section>
  )
}

/* -------------------------------------------------------------- entry */

function EntrySection({ d, reload }: { d: MarketDetail; reload: () => void }) {
  const [editing, setEditing] = useState(false)
  const m = d.market
  const e = d.my_entry
  if (e && !editing) return <Receipt m={m} e={e} onEdit={() => setEditing(true)} reload={reload} />
  return (
    <section className="section">
      <h2>{e ? 'Edit your pick' : 'Your pick'}</h2>
      <p className="muted">Your pick stays hidden until entries close.</p>
      {m.kind === 'congress'
        ? <SeatForm m={m} existing={e} onSaved={() => { setEditing(false); reload() }} onCancel={e ? () => setEditing(false) : undefined} />
        : <RaceForm m={m} existing={e} onSaved={() => { setEditing(false); reload() }} onCancel={e ? () => setEditing(false) : undefined} />}
    </section>
  )
}

function sentence(m: Market, e: Entry) {
  if (m.kind === 'congress' || !e.shares || !e.winner_id) {
    const s = e.seats!
    return `House ${s.house.d} D · ${s.house.r} R · ${s.house.o} Other. Senate ${s.senate.d} D · ${s.senate.r} R · ${s.senate.o} Other.`
  }
  const w = m.candidates.find((c) => c.id === e.winner_id)
  return `You picked ${w?.name} with ${pct(e.shares[e.winner_id])} of the vote.`
}

function Receipt({ m, e, onEdit, reload }: { m: Market; e: Entry; onEdit: () => void; reload: () => void }) {
  const { backend } = useApp()
  const [error, setError] = useState('')
  async function withdraw() {
    if (!confirm('Withdraw your entry? You can enter again before entries close.')) return
    try {
      await backend.rpc('withdraw_entry', { p_market: m.id })
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not withdraw.')
      reload()
    }
  }
  const dist = e.shares && m.kind !== 'congress'
    ? [...m.candidates.map((c) => ({ id: c.id, name: c.name, t: e.shares![c.id], c: candColor(c) })), ...(m.has_other ? [{ id: 'other', name: 'Other candidates', t: e.shares.other ?? 0, c: 'var(--oth)' }] : [])]
    : null
  return (
    <section className="section">
      <div className="receipt reveal-in">
        <h2 style={{ margin: '0 0 4px' }}>Your pick is in</h2>
        <p style={{ margin: 0 }}><strong>{sentence(m, e)}</strong> Entry: {usd(e.commitment_cents)}.</p>
        {dist && (
          <>
            <p className="small muted" style={{ margin: '8px 0 4px' }}>Your full prediction</p>
            <ShareBar label="Your predicted vote shares" parts={dist.map((x) => ({ id: x.id, tenths: x.t, color: x.c, name: x.name }))} />
            <p className="small">{dist.map((x) => `${x.name} ${pct(x.t)}`).join(' · ')}</p>
          </>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>
          Entries close {formatET(m.entry_deadline)}. Your pick stays hidden until then. You can change or withdraw it before that time.
        </p>
      </div>
      <Err>{error}</Err>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn ghost" onClick={onEdit}>Edit pick</button>
        <button className="btn ghost" onClick={withdraw}>Withdraw</button>
      </div>
    </section>
  )
}

function draftFrom(m: Market, e: Entry | null): Draft & { open: boolean } {
  if (!e?.shares || !e.winner_id) return { winnerId: null, winnerPct: '', opponentId: null, adjust: {}, open: false }
  const others = m.candidates.filter((c) => c.id !== e.winner_id).sort((a, b) => (e.shares![b.id] ?? 0) - (e.shares![a.id] ?? 0))
  const opp = others[0]?.id ?? null
  const adjust: Record<string, string> = {}
  for (const k of [...m.candidates.map((c) => c.id), ...(m.has_other ? ['other'] : [])]) {
    if (k !== e.winner_id && k !== opp && (e.shares[k] ?? 0) > 0) adjust[k] = ((e.shares[k] ?? 0) / 10).toFixed(1)
  }
  return { winnerId: e.winner_id, winnerPct: (e.shares[e.winner_id] / 10).toFixed(1), opponentId: opp, adjust, open: Object.keys(adjust).length > 0 }
}

function RaceForm({ m, existing, onSaved, onCancel }: { m: Market; existing: Entry | null; onSaved: () => void; onCancel?: () => void }) {
  const { backend } = useApp()
  const init = useMemo(() => draftFrom(m, existing), [m, existing])
  const [draft, setDraft] = useState<Draft>(init)
  const [adjustOpen, setAdjustOpen] = useState(init.open)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const a = allocate(m.candidates, m.has_other, draft)
  const winner = m.candidates.find((c) => c.id === draft.winnerId)
  const first = a.opponentId
  const adjustKeys = [...m.candidates.map((c) => c.id), ...(m.has_other ? ['other'] : [])].filter((k) => k !== draft.winnerId && k !== first)

  async function submit() {
    if (!a.shares) return
    setBusy(true)
    setError('')
    try {
      await backend.rpc('submit_entry', { p_market: m.id, p_winner: draft.winnerId, p_shares: a.shares })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your pick.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 650 }}>Who wins?</legend>
        <div className="seg">
          {m.candidates.map((c) => (
            <label key={c.id} className="opt" style={{ marginBottom: 0 }}>
              <input type="radio" name="winner" checked={draft.winnerId === c.id} onChange={() => setDraft({ ...draft, winnerId: c.id, opponentId: null })} />
              <span style={{ flex: 1 }}>{c.name}</span>
              <PartyTag party={c.party} />
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="wpct">{winner ? `${winner.name}'s` : 'Winner’s'} share of all valid votes (%)</label>
        <input id="wpct" inputMode="decimal" value={draft.winnerPct} placeholder="e.g. 51.8"
          onChange={(e) => setDraft({ ...draft, winnerPct: e.target.value })} aria-describedby="wpct-h" />
        <p className="hint" id="wpct-h">Share of all valid candidate votes, one decimal place. Plurality wins are fine; the winner doesn&rsquo;t need 50%. Settlement uses the certified result rounded once to one decimal place.</p>
      </div>

      {draft.winnerId && (
        <div className="panel">
          <p className="small muted" style={{ margin: '0 0 6px' }}>How the full 100% is allocated</p>
          <table className="t">
            <tbody>
              {a.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.label}{l.auto && <span className="muted small"> · remainder</span>}</td>
                  <td className="num">{l.tenths === null ? '—' : pct(l.tenths)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {a.shares && (
            <ShareBar label="Predicted vote shares" parts={a.lines.map((l) => ({
              id: l.id, tenths: l.tenths ?? 0, name: l.label,
              color: l.id === 'other' ? 'var(--oth)' : candColor(m.candidates.find((c) => c.id === l.id)),
            }))} />
          )}
          <button type="button" className="btn ghost small" style={{ marginTop: 8 }} onClick={() => setAdjustOpen(!adjustOpen)} aria-expanded={adjustOpen}>
            {adjustOpen ? 'Hide adjustments' : 'Adjust other candidates'}
          </button>
          {adjustOpen && (
            <div style={{ marginTop: 8 }}>
              <div className="field">
                <label htmlFor="opp">Principal opponent (gets the remainder)</label>
                <select id="opp" value={a.opponentId ?? ''} onChange={(e) => setDraft({ ...draft, opponentId: e.target.value, adjust: {} })}>
                  {m.candidates.filter((c) => c.id !== draft.winnerId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {adjustKeys.map((k) => (
                <div className="field" key={k}>
                  <label htmlFor={`adj-${k}`}>{k === 'other' ? 'Other candidates' : m.candidates.find((c) => c.id === k)!.name} (%)</label>
                  <input id={`adj-${k}`} inputMode="decimal" value={draft.adjust[k] ?? ''} placeholder="0.0"
                    onChange={(e) => setDraft({ ...draft, adjust: { ...draft.adjust, [k]: e.target.value } })} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {a.errors.length > 0 && (draft.winnerId || draft.winnerPct) && <Err>{a.errors.join(' ')}</Err>}
      {a.shares && winner && (
        <p className="callout">
          You picked <strong>{winner.name}</strong> with <strong>{pct(a.shares[winner.id])}</strong> of the vote. Entry: {usd(m.buy_in_cents ?? 0)}.
        </p>
      )}
      <Err>{error}</Err>
      <div className="row">
        <button className="btn" disabled={!a.shares || busy} onClick={submit}>
          {existing ? 'Save changes' : `Enter for ${usd(m.buy_in_cents ?? 0)}`}
        </button>
        {onCancel && <button className="btn ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  )
}

function SeatBars({ s }: { s: Seats }) {
  const bar = (label: string, c: { d: number; r: number; o: number }) => (
    <div style={{ marginBottom: 8 }}>
      <div className="small" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>{label}</strong><span className="muted">D {c.d} · R {c.r} · Other {c.o}</span>
      </div>
      <ShareBar label={`${label} seats`} parts={[
        { id: 'd', tenths: Math.max(c.d, 0), color: 'var(--dem)', name: 'Democratic' },
        { id: 'o', tenths: Math.max(c.o, 0), color: 'var(--oth)', name: 'Other' },
        { id: 'r', tenths: Math.max(c.r, 0), color: 'var(--rep)', name: 'Republican' },
      ]} />
    </div>
  )
  return <>{bar('House', s.house)}{bar('Senate', s.senate)}</>
}

function SeatForm({ m, existing, onSaved, onCancel }: { m: Market; existing: Entry | null; onSaved: () => void; onCancel?: () => void }) {
  const { backend } = useApp()
  const s0 = existing?.seats
  const [v, setV] = useState({
    hd: s0 ? String(s0.house.d) : '', hr: s0 ? String(s0.house.r) : '',
    sd: s0 ? String(s0.senate.d) : '', sr: s0 ? String(s0.senate.r) : '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const n = (x: string) => (/^\d+$/.test(x.trim()) ? parseInt(x, 10) : null)
  const hd = n(v.hd), hr = n(v.hr), sd = n(v.sd), sr = n(v.sr)
  const ho = hd !== null && hr !== null ? remainder(HOUSE_TOTAL, hd, hr) : null
  const so = sd !== null && sr !== null ? remainder(SENATE_TOTAL, sd, sr) : null
  const ok = ho !== null && so !== null && ho >= 0 && so >= 0
  const seats: Seats | null = ok ? { house: { d: hd!, r: hr!, o: ho! }, senate: { d: sd!, r: sr!, o: so! } } : null

  async function submit() {
    if (!seats) return
    setBusy(true)
    setError('')
    try {
      await backend.rpc('submit_entry', { p_market: m.id, p_seats: seats })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your pick.')
    } finally {
      setBusy(false)
    }
  }
  const input = (id: keyof typeof v, label: string) => (
    <div className="field" key={id}>
      <label htmlFor={`s-${id}`}>{label}</label>
      <input id={`s-${id}`} inputMode="numeric" value={v[id]} onChange={(e) => setV({ ...v, [id]: e.target.value })} />
    </div>
  )
  return (
    <div>
      <div className="grid2">
        <div>
          <h3>House · {HOUSE_TOTAL} seats</h3>
          {input('hd', 'Democratic')}{input('hr', 'Republican')}
          <p className="small">Other (independents): <strong>{ho ?? '—'}</strong>{ho !== null && ho < 0 && <span className="err"> Too many seats.</span>}</p>
        </div>
        <div>
          <h3>Senate · {SENATE_TOTAL} seats</h3>
          {input('sd', 'Democratic caucus')}{input('sr', 'Republican caucus')}
          <p className="small">Other: <strong>{so ?? '—'}</strong>{so !== null && so < 0 && <span className="err"> Too many seats.</span>}</p>
        </div>
      </div>
      {seats && <SeatBars s={seats} />}
      <p className="hint">Senate totals include seats not up this year. Off by 3 seats in the House and 1 in the Senate = 4 seats of error.</p>
      {seats && <p className="callout">Your seat prediction is ready. Entry: {usd(m.buy_in_cents ?? 0)}.</p>}
      <Err>{error}</Err>
      <div className="row">
        <button className="btn" disabled={!seats || busy} onClick={submit}>{existing ? 'Save changes' : `Enter for ${usd(m.buy_in_cents ?? 0)}`}</button>
        {onCancel && <button className="btn ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- reveal + results */

function Reveal({ d }: { d: MarketDetail }) {
  const m = d.market
  const entries = d.entries ?? []
  const settled = m.phase === 'settled'
  const run = d.runs[d.runs.length - 1]
  const pay = new Map(d.payouts.map((p) => [p.entry_id, p]))

  return (
    <section className="section">
      <div className="reveal-head">
        <h2 style={{ margin: 0 }}>Picks revealed</h2>
        <span className="muted small">{!settled && 'Awaiting final results'}</span>
      </div>
      {settled && run && <ResultSummary m={m} run={run} runs={d.runs} />}
      {m.kind === 'congress' ? <SeatReveal entries={entries} pay={pay} settled={settled} run={run} /> : (
        <RaceReveal m={m} entries={entries} pay={pay} settled={settled} run={run} />
      )}
      {settled && <p className="hint">Gross payouts include each winner&rsquo;s original stake. Split pots are paid in whole cents; leftover cents go to the earliest entry IDs.</p>}
    </section>
  )
}

function ResultSummary({ m, run, runs }: { m: Market; run: Run; runs: Run[] }) {
  const w = m.candidates.find((c) => c.id === run.result.winner_id)
  const r = run.result
  return (
    <div className="callout">
      {m.kind === 'congress' && r.seats ? (
        <p style={{ margin: 0 }}><strong>Final seats.</strong> House {r.seats.house.d} D · {r.seats.house.r} R · {r.seats.house.o} Other. Senate {r.seats.senate.d} D · {r.seats.senate.r} R · {r.seats.senate.o} Other.</p>
      ) : (
        <p style={{ margin: 0 }}><strong>{w?.name} won with {pct(r.winner_share_tenths ?? 0)}</strong> of all valid votes (certified, rounded to one decimal).</p>
      )}
      {run.outcome === 'no_winner_refund' && <p style={{ margin: '4px 0 0' }}>Nobody picked the winner, so every commitment was returned.</p>}
      {r.source_url && <p className="small" style={{ margin: '4px 0 0' }}><a href={r.source_url} target="_blank" rel="noreferrer">Result source</a></p>}
      {runs.length > 1 && (
        <p className="small" style={{ margin: '4px 0 0' }}>
          Corrected {runs.length - 1} {runs.length === 2 ? 'time' : 'times'}. Latest reason: {run.reason}
        </p>
      )}
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
  const f = groupForecast(m.candidates, m.has_other, entries)
  const name = (id: string | null) => (id === 'other' ? 'Other candidates' : m.candidates.find((c) => c.id === id)?.name ?? '')
  const leader = m.candidates.find((c) => c.id === f.leaderId)
  const runner = m.candidates.find((c) => c.id === f.runnerUpId)
  const keys = [...m.candidates.map((c) => c.id), ...(m.has_other ? ['other'] : [])]

  return (
    <>
      <h3 style={{ marginTop: 14 }}>Group forecast</h3>
      {f.n === 0 ? <p className="muted">No entries.</p> : (
        <div className="reveal-in">
          {leader && f.marginTenths !== null && (
            <p style={{ marginBottom: 6 }}>
              <strong>{leader.name}</strong> leads the group average at {pct(f.means[leader.id])}
              {runner && <>, {f.marginTenths === 0 ? 'tied with' : `${(f.marginTenths / 10).toFixed(1)} points ahead of`} {runner.name}</>}.
            </p>
          )}
          <ShareBar label="Group forecast vote shares" parts={keys.map((k) => ({
            id: k, tenths: f.means[k], name: name(k), color: k === 'other' ? 'var(--oth)' : candColor(m.candidates.find((c) => c.id === k)),
          }))} />
          <p className="small" style={{ marginTop: 6 }}>{keys.map((k) => `${name(k)} ${pct(f.means[k])}`).join(' · ')}</p>
          <p className="hint">Equal-weight average of everyone&rsquo;s full predicted vote shares. It is not a probability of winning and not a polling average.</p>

          <h3>Spread of predictions</h3>
          {m.candidates.map((c) => (
            <div key={c.id} style={{ marginBottom: 6 }}>
              <div className="small"><span style={{ color: partyVar(c.party), fontWeight: 700 }}>{c.name}</span> <span className="muted">· average {pct(f.means[c.id])}</span></div>
              <StripPlot values={entries.filter((e) => e.shares).map((e) => (e.shares![c.id] ?? 0) / 10)} mean={f.means[c.id] / 10}
                color={partyVar(c.party)} label={`Predicted share for ${c.name}`} />
            </div>
          ))}
          <p className="hint">Each dot is one entrant; the dark line is the group average. The scale is zoomed to the range of predictions.</p>
        </div>
      )}

      <h3>Everyone&rsquo;s picks</h3>
      <div className="scroll-x">
        <table className="t">
          <thead>
            <tr><th>Name</th><th>Picked</th><th className="num">Winner share</th>{settled && <th className="num">Error</th>}{settled && <th>Payout</th>}</tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const p = pay.get(e.id)
              return (
                <tr key={e.id} className="reveal-in" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                  <td>{e.display_name}{e.user_id === uid && <span className="muted"> (you)</span>}</td>
                  <td>{name(e.winner_id)}</td>
                  <td className="num">{e.shares && e.winner_id ? pct(e.shares[e.winner_id]) : '—'}</td>
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

function SeatReveal({ entries, pay, settled, run }: { entries: Entry[]; pay: Map<string, Payout>; settled: boolean; run: Run | undefined }) {
  const { uid } = useApp()
  const mean = meanSeats(entries)
  const f = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
  return (
    <>
      <h3 style={{ marginTop: 14 }}>Group forecast</h3>
      {mean ? (
        <div className="reveal-in">
          <SeatBars s={mean} />
          <p className="small">
            Average predicted seats. House {f(mean.house.d)} D · {f(mean.house.r)} R · {f(mean.house.o)} Other. Senate {f(mean.senate.d)} D · {f(mean.senate.r)} R · {f(mean.senate.o)} Other.
          </p>
          <p className="hint">Equal-weight average of everyone&rsquo;s seat predictions. It is not a probability of control.</p>
        </div>
      ) : <p className="muted">No entries.</p>}
      <h3>Everyone&rsquo;s picks</h3>
      <div className="scroll-x">
        <table className="t">
          <thead><tr><th>Name</th><th>House D / R / O</th><th>Senate D / R / O</th>{settled && <th className="num">Error</th>}{settled && <th>Payout</th>}</tr></thead>
          <tbody>
            {entries.map((e, i) => {
              const p = pay.get(e.id)
              const s = e.seats!
              return (
                <tr key={e.id} className="reveal-in" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                  <td>{e.display_name}{e.user_id === uid && <span className="muted"> (you)</span>}</td>
                  <td>{s.house.d} / {s.house.r} / {s.house.o}</td>
                  <td>{s.senate.d} / {s.senate.r} / {s.senate.o}</td>
                  {settled && <td className="num">{p?.error_value ?? '—'} {p?.error_value === 1 ? 'seat' : 'seats'}</td>}
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
