import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp, useRpc } from '../data/context'
import { formatET, fromETInput, pct, toETInput, usd } from '../domain/format'
import { parseTenths } from '../domain/race'
import { HOUSE_TOTAL, SENATE_TOTAL } from '../domain/seats'
import type { Pool } from '../domain/pool'
import type { Basis, Market, MarketDetail, Seats } from '../domain/types'
import { Err, Loading } from './common'
import { RaceLinkFields, refToDraft, toRef } from './RaceLink'

function useAction() {
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function run(f: () => Promise<string | void>) {
    setBusy(true)
    setError('')
    setNote('')
    try {
      const msg = await f()
      if (msg) setNote(msg)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return { error, note, busy, run }
}

const dollarsToCents = (s: string): number | null => (/^\d+(\.\d{1,2})?$/.test(s.trim()) ? Math.round(parseFloat(s) * 100) : null)
const centsToDollars = (c: number) => (c / 100).toFixed(2).replace(/\.00$/, '')

type TabId = 'pool' | 'markets' | 'results' | 'ledger' | 'group'
const TABS: { id: TabId; label: string }[] = [
  { id: 'pool', label: 'Pool' }, { id: 'markets', label: 'Side bets' },
  { id: 'results', label: 'Results' }, { id: 'ledger', label: 'Ledger' }, { id: 'group', label: 'Group' },
]

export function AdminPage() {
  const { me } = useApp()
  const [tab, setTab] = useState<TabId>('pool')
  const list = useRpc<Market[]>('list_markets')
  if (!me?.is_admin) return <main className="page" id="main"><h1>Admin</h1><p>Admin only.</p></main>
  const markets = list.data ?? []
  const results = markets.filter((m) => m.phase === 'closed').length
  return (
    <main className="page" id="main">
      <h1>Admin</h1>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}{t.id === 'results' && results > 0 ? ` (${results})` : ''}
          </button>
        ))}
      </div>
      <Err>{list.error}</Err>
      {list.loading && !list.data ? <Loading /> : (
        <>
          {tab === 'pool' && <PoolTab />}
          {tab === 'markets' && <OpenMarkets markets={markets.filter((m) => m.phase === 'open' && !m.featured)} reload={list.reload} />}
          {tab === 'results' && <Results markets={markets.filter((m) => m.phase === 'closed' || m.phase === 'settled')} reload={list.reload} />}
          {tab === 'ledger' && <LedgerTab />}
          {tab === 'group' && <GroupTab />}
        </>
      )}
    </main>
  )
}

/* ------------------------------------------------------------ approve / edit */

function ApproveForm({ m, onDone, label }: { m: Market; onDone: () => void; label: string }) {
  const { backend, me } = useApp()
  const g = me!.group!
  const [rows, setRows] = useState(m.candidates.map((c) => ({ name: c.name, party: c.party as string })))
  const [hasOther, setHasOther] = useState(m.has_other)
  const [basis, setBasis] = useState<Basis>(m.outcome_basis)
  const [note, setNote] = useState(m.rules_note)
  const [buyIn, setBuyIn] = useState(centsToDollars(m.buy_in_cents ?? g.default_buy_in_cents))
  const [when, setWhen] = useState(toETInput(m.entry_deadline ?? g.default_deadline))
  const [link, setLink] = useState(refToDraft(m.polling_ref))
  const a = useAction()
  const cents = dollarsToCents(buyIn)
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when) ? fromETInput(when) : null
  const congress = m.kind === 'congress'
  const ref = toRef(m.kind, link)

  return (
    <div className="panel">
      {!congress && <RaceLinkFields kind={m.kind} value={link} onChange={setLink} />}
      {!congress && rows.map((r, i) => (
        <div className="row" key={i} style={{ marginBottom: 6 }}>
          <input aria-label={`Candidate ${i + 1}`} value={r.name} style={{ flex: '1 1 12rem' }} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <select aria-label={`Party ${i + 1}`} value={r.party} style={{ width: '9rem' }} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, party: e.target.value } : x)))}>
            <option value="D">Democratic</option><option value="R">Republican</option><option value="I">Independent</option>
            <option value="L">Libertarian</option><option value="G">Green</option><option value="O">Other party</option>
          </select>
          {rows.length > 2 && <button type="button" className="btn ghost small" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}
        </div>
      ))}
      {!congress && rows.length < 8 && <button type="button" className="btn ghost small" onClick={() => setRows([...rows, { name: '', party: 'O' }])}>Add candidate</button>}
      {!congress && (
        <label style={{ fontWeight: 500, margin: '8px 0' }}>
          <input type="checkbox" checked={hasOther} onChange={(e) => setHasOther(e.target.checked)} /> Include &ldquo;Other candidates&rdquo;
        </label>
      )}
      <div className="grid2">
        <div className="field">
          <label htmlFor={`bi-${m.id}`}>Buy-in ($)</label>
          <input id={`bi-${m.id}`} inputMode="decimal" value={buyIn} onChange={(e) => setBuyIn(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`dl-${m.id}`}>Entries close (New York time)</label>
          <input id={`dl-${m.id}`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <p className="hint">{iso ? formatET(iso) : 'Pick a date and time'} · must be before Election Day</p>
        </div>
      </div>
      {!congress && (
        <div className="field">
          <label htmlFor={`bs-${m.id}`}>Outcome basis</label>
          <select id={`bs-${m.id}`} value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
            <option value="single_round">Single election round</option>
            <option value="runoff_final">Runoff: decisive runoff winner and share</option>
            <option value="rcv_final">Ranked-choice: final-round winner and share</option>
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor={`rn-${m.id}`}>Outcome definition and result source</label>
        <textarea id={`rn-${m.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Certified results from the Ohio Secretary of State, share of all valid votes." />
      </div>
      <Err>{a.error}</Err>
      <div className="row">
        <button className="btn" disabled={a.busy || cents === null || !iso || (!congress && !ref)} onClick={() => a.run(async () => {
          await backend.rpc('approve_market', {
            p_id: m.id, p_candidates: rows.map((r) => ({ name: r.name, party: r.party })), p_has_other: hasOther, p_basis: basis,
            p_rules_note: note, p_buy_in_cents: cents, p_deadline: iso, p_polling_ref: congress ? null : ref,
          })
          onDone()
        })}>{label}</button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ open markets */

function PollingForm({ m, onDone }: { m: Market; onDone: () => void }) {
  const { backend } = useApp()
  const [source, setSource] = useState('')
  const [url, setUrl] = useState('')
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10))
  const [vals, setVals] = useState<Record<string, string>>({})
  const [und, setUnd] = useState('')
  const [oth, setOth] = useState('')
  const a = useAction()
  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  return (
    <div className="panel">
      <p className="hint">Enter the figures exactly as the source publishes them. They are stored as a manual snapshot with your source name and date.</p>
      <div className="grid2">
        <div className="field"><label>Source name</label><input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. PollingSource average" /></div>
        <div className="field"><label>Source URL</label><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></div>
        <div className="field"><label>As-of date</label><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
      </div>
      <div className="grid2">
        {m.candidates.map((c) => (
          <div className="field" key={c.id}><label>{c.name} (%)</label>
            <input inputMode="decimal" value={vals[c.id] ?? ''} onChange={(e) => setVals({ ...vals, [c.id]: e.target.value })} /></div>
        ))}
        <div className="field"><label>Undecided (%)</label><input inputMode="decimal" value={und} onChange={(e) => setUnd(e.target.value)} /></div>
        <div className="field"><label>Other (%)</label><input inputMode="decimal" value={oth} onChange={(e) => setOth(e.target.value)} /></div>
      </div>
      <Err>{a.error}</Err>
      {a.note && <p className="ok" role="status">{a.note}</p>}
      <button className="btn" disabled={a.busy || !source.trim()} onClick={() => a.run(async () => {
        const candidates = m.candidates.filter((c) => (vals[c.id] ?? '').trim() !== '').map((c) => ({ name: c.name, party: c.party, pct: Number(vals[c.id]) }))
        await backend.rpc('record_polling', {
          p_market: m.id, p_source_name: source.trim(), p_source_url: url.trim() || null, p_as_of: asOf,
          p_data: { candidates, undecided: num(und), other: num(oth) },
        })
        onDone()
        return 'Saved.'
      })}>Save polling snapshot</button>
    </div>
  )
}

function TermsForm({ m, onDone }: { m: Market; onDone: () => void }) {
  const { backend } = useApp()
  const [buyIn, setBuyIn] = useState(centsToDollars(m.buy_in_cents ?? 500))
  const [when, setWhen] = useState(toETInput(m.entry_deadline!))
  const a = useAction()
  const cents = dollarsToCents(buyIn)
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when) ? fromETInput(when) : null
  return (
    <div className="panel">
      <div className="grid2">
        <div className="field"><label htmlFor={`st-${m.id}`}>Stake ($)</label>
          <input id={`st-${m.id}`} inputMode="decimal" value={buyIn} onChange={(e) => setBuyIn(e.target.value)} />
          <p className="hint">Everyone already in will owe the new stake.</p></div>
        <div className="field"><label htmlFor={`cl-${m.id}`}>Closes (New York time)</label>
          <input id={`cl-${m.id}`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <p className="hint">{iso ? formatET(iso) : 'Pick a date and time'} · before Election Day</p></div>
      </div>
      <Err>{a.error}</Err>
      <button className="btn" disabled={a.busy || cents === null || !iso} onClick={() => a.run(async () => {
        await backend.rpc('set_market_terms', { p_id: m.id, p_buy_in_cents: cents, p_deadline: iso })
        onDone()
      })}>Save stake and closing time</button>
    </div>
  )
}

function OpenMarkets({ markets, reload }: { markets: Market[]; reload: () => void }) {
  const { backend } = useApp()
  const a = useAction()
  const who = useRpc<{ open_entrants: { market_id: string; names: string[] }[] }>('admin_ledger')
  const entered = (id: string) => who.data?.open_entrants.find((x) => x.market_id === id)?.names ?? []
  const [open, setOpen] = useState<string | null>(null)
  if (markets.length === 0) return <p className="muted">No open side bets.</p>
  return (
    <>
      <Err>{a.error}</Err>
      {markets.map((m) => (
        <section key={m.id} className="section">
          <h2><Link to={`/m/${m.id}`}>{m.title}</Link></h2>
          <p className="muted small">
            {formatET(m.entry_deadline)} · {usd(m.buy_in_cents ?? 0)} · {m.entrants} {m.entrants === 1 ? 'entry' : 'entries'}
            {m.entrants > 0 && ' · terms locked'}
          </p>
          {m.entrants > 0 && <p className="small"><strong>Entered:</strong> {entered(m.id).join(', ') || '…'} <span className="muted">(picks stay sealed)</span></p>}
          <div className="row">
            <button className="btn ghost small" onClick={() => setOpen(open === m.id + 't' ? null : m.id + 't')}>Stake & closing time</button>
            {m.entrants === 0 && <button className="btn ghost small" onClick={() => setOpen(open === m.id + 'e' ? null : m.id + 'e')}>Fix candidates</button>}
            {m.kind !== 'congress' && <button className="btn ghost small" onClick={() => setOpen(open === m.id + 'p' ? null : m.id + 'p')}>Record polling</button>}
            <button className="btn ghost small" disabled={a.busy} onClick={() => {
              const reason = prompt(`Cancel "${m.title}" and release every commitment? Reason:`)
              if (!reason) return
              a.run(async () => { await backend.rpc('cancel_market', { p_id: m.id, p_reason: reason }); reload() })
            }}>Cancel market</button>
          </div>
          {open === m.id + 't' && <TermsForm m={m} onDone={() => { setOpen(null); reload() }} />}
          {open === m.id + 'e' && <ApproveForm m={m} onDone={() => { setOpen(null); reload() }} label="Save terms" />}
          {open === m.id + 'p' && <PollingForm m={m} onDone={() => setOpen(null)} />}
          {m.entrants > 0 && <p className="hint">Candidates and rules lock with the first pick. Stake and closing time can still change.</p>}
        </section>
      ))}
    </>
  )
}

/* ------------------------------------------------------------ results */

type Preview = { outcome: string; pool_cents: number; rows: { entry_id: string; display_name: string; eligible: boolean; error_value: number | null; gross_cents: number; refund_cents: number }[] }

function ResultCard({ m, reload }: { m: Market; reload: () => void }) {
  const { backend } = useApp()
  const detail = useRpc<MarketDetail>('get_market', { p_id: m.id })
  const settled = m.phase === 'settled'
  const [winner, setWinner] = useState('')
  const [share, setShare] = useState('')
  const [seats, setSeats] = useState({ hd: '', hr: '', ho: '', sd: '', sr: '', so: '' })
  const [source, setSource] = useState('')
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const a = useAction()
  const congress = m.kind === 'congress'
  const seatKind = m.kind === 'senate_seats' || m.kind === 'house_seats'
  const [rSeats, setRSeats] = useState('')
  const n = (s: string) => (/^\d+$/.test(s.trim()) ? parseInt(s, 10) : NaN)
  const seatObj: Seats = { house: { d: n(seats.hd), r: n(seats.hr), o: n(seats.ho) }, senate: { d: n(seats.sd), r: n(seats.sr), o: n(seats.so) } }
  const tenths = parseTenths(share)
  const args = {
    p_winner: congress || seatKind ? null : winner, p_share_tenths: congress || seatKind ? null : tenths,
    p_seats: congress ? seatObj : seatKind ? { r: n(rSeats) } : null, p_source_url: source.trim(),
  }
  const ready = seatKind ? !Number.isNaN(n(rSeats)) : congress ? Object.values(seatObj.house).concat(Object.values(seatObj.senate)).every((x) => !Number.isNaN(x)) : winner && tenths !== null
  const version = detail.data?.runs.length ?? 0

  async function enter() {
    await backend.rpc('enter_result', { p_market: m.id, ...args })
    setPreview(await backend.rpc<Preview>('preview_settlement', { p_market: m.id }))
  }

  const seatField = (k: keyof typeof seats, label: string) => (
    <div className="field" key={k}><label>{label}</label>
      <input inputMode="numeric" value={seats[k]} onChange={(e) => setSeats({ ...seats, [k]: e.target.value })} /></div>
  )

  return (
    <section className="section">
      <h2><Link to={`/m/${m.id}`}>{m.title}</Link> {settled && <span className="pill pill-settled">Settled</span>}</h2>
      <Err>{detail.error}</Err>
      <p className="muted small">
        {m.entrants} {m.entrants === 1 ? 'entry' : 'entries'} · {usd(m.pool_cents)} pool
        {m.outcome_basis !== 'single_round' && ` · basis: ${m.outcome_basis === 'runoff_final' ? 'runoff' : 'ranked-choice final round'}`}
      </p>
      {m.rules_note && <p className="small"><strong>Source policy:</strong> {m.rules_note}</p>}

      {seatKind ? (
        <div className="field"><label>Certified Republican seats ({m.kind === 'senate_seats' ? 'of 100' : 'of 435'})</label>
          <input inputMode="numeric" value={rSeats} onChange={(e) => setRSeats(e.target.value)} placeholder={m.kind === 'senate_seats' ? 'e.g. 49' : 'e.g. 210'} /></div>
      ) : congress ? (
        <div className="grid2">
          <div><h3>House ({HOUSE_TOTAL})</h3>{seatField('hd', 'Democratic')}{seatField('hr', 'Republican')}{seatField('ho', 'Other')}</div>
          <div><h3>Senate ({SENATE_TOTAL})</h3>{seatField('sd', 'Democratic caucus')}{seatField('sr', 'Republican caucus')}{seatField('so', 'Other')}</div>
        </div>
      ) : (
        <div className="grid2">
          <div className="field"><label>Certified winner</label>
            <select value={winner} onChange={(e) => setWinner(e.target.value)}>
              <option value="">Select…</option>
              {m.candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div className="field"><label>{m.has_other ? 'Certified share of all valid votes (%)' : 'Certified share of the two-way vote (%)'}</label>
            <input inputMode="decimal" value={share} onChange={(e) => setShare(e.target.value)} placeholder="e.g. 52.3" />
            <p className="hint">{m.has_other ? 'Rounded once to one decimal.' : 'Winner’s votes ÷ (votes for the two listed candidates), rounded once to one decimal.'} Settlement uses this figure.</p></div>
        </div>
      )}
      <div className="field"><label>Result source URL</label><input value={source} onChange={(e) => setSource(e.target.value)} placeholder="https://… (certified results)" /></div>
      {settled && (
        <div className="field"><label>Reason for correction</label><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Recount changed the certified total" /></div>
      )}
      <Err>{a.error}</Err>
      {a.note && <p className="ok" role="status">{a.note}</p>}
      {!settled ? (
        <div className="row">
          <button className="btn" disabled={a.busy || !ready || !source.trim()} onClick={() => a.run(enter)}>Review computed outcome</button>
          <button className="btn ghost" disabled={a.busy} onClick={() => {
            const why = prompt('Cancel this market and return every commitment? Reason (e.g. unresolved contest):')
            if (!why) return
            a.run(async () => { await backend.rpc('cancel_market', { p_id: m.id, p_reason: why }); reload() })
          }}>Cancel and refund</button>
        </div>
      ) : (
        <button className="btn danger" disabled={a.busy || !ready || !source.trim() || !reason.trim()} onClick={() => {
          if (!confirm('Recalculate this settlement? Balances update; recorded transfers are kept and the change is logged.')) return
          a.run(async () => {
            await backend.rpc('correct_settlement', { p_market: m.id, p_expected_version: version, ...args, p_reason: reason })
            detail.reload()
            reload()
            return 'Correction recorded. Balances are updated.'
          })
        }}>Record correction</button>
      )}

      {preview && !settled && (
        <div className="panel">
          <h3>Computed outcome</h3>
          <p>
            {preview.outcome === 'settled' && 'Winners split the pool.'}
            {preview.outcome === 'no_winner_refund' && 'Nobody picked the winner: every commitment is returned.'}
            {preview.outcome === 'underfilled_refund' && 'Fewer than two entries: every commitment is returned.'}
            {' '}Pool {usd(preview.pool_cents)}.
          </p>
          <table className="t">
            <thead><tr><th>Name</th><th>Status</th><th className="num">Error</th><th className="num">Gross payout</th></tr></thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.entry_id}>
                  <td>{r.display_name}</td>
                  <td>{congress || seatKind ? 'In' : r.eligible ? 'Picked the winner' : 'Wrong winner'}</td>
                  <td className="num">{r.error_value === null ? '—' : congress || seatKind ? `${r.error_value} seats` : pct(r.error_value)}</td>
                  <td className="num">{r.gross_cents > 0 ? usd(r.gross_cents) : r.refund_cents > 0 ? `Refund ${usd(r.refund_cents)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">Check the result and source above before confirming. Confirming settles the market once; repeating it does nothing.</p>
          <button className="btn" disabled={a.busy} onClick={() => a.run(async () => {
            await backend.rpc('confirm_settlement', { p_market: m.id })
            setPreview(null)
            detail.reload()
            reload()
            return 'Settled.'
          })}>Confirm settlement</button>
        </div>
      )}
    </section>
  )
}

function Results({ markets, reload }: { markets: Market[]; reload: () => void }) {
  const awaiting = markets.filter((m) => m.phase === 'closed')
  const done = markets.filter((m) => m.phase === 'settled')
  return (
    <>
      <h2>Awaiting results</h2>
      {awaiting.length === 0 ? <p className="muted">Nothing is waiting on results.</p> : awaiting.map((m) => <ResultCard key={m.id} m={m} reload={reload} />)}
      <h2 style={{ marginTop: 24 }}>Settled (corrections)</h2>
      {done.length === 0 ? <p className="muted">No settled markets.</p> : done.map((m) => <ResultCard key={m.id} m={m} reload={reload} />)}
    </>
  )
}

/* ------------------------------------------------------------ ledger */

type AdminLedger = {
  people: { user_id: string; display_name: string; committed_cents: number; gross_cents: number; refund_cents: number; collected_cents: number; paid_out_cents: number; remaining_cents: number; unresolved_cents: number; is_admin: boolean }[]
  breakdown: { user_id: string; market_id: string; title: string; outcome: string; commitment_cents: number; gross_cents: number; refund_cents: number; eligible: boolean; error_value: number | null }[]
  transfers: { id: string; member_id: string; display_name: string; direction: 'collected' | 'paid_out'; amount_cents: number; occurred_on: string; note: string; voided_at: string | null }[]
}

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
function download(name: string, rows: (string | number)[][]) {
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
const dollars = (c: number) => (c / 100).toFixed(2)

function TransferForm({ member, suggest, onDone }: { member: string; suggest: { direction: 'collected' | 'paid_out'; cents: number }; onDone: () => void }) {
  const { backend } = useApp()
  const [direction, setDirection] = useState(suggest.direction)
  const [amount, setAmount] = useState(centsToDollars(suggest.cents))
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const a = useAction()
  const cents = dollarsToCents(amount)
  return (
    <div className="panel">
      <div className="grid2">
        <div className="field"><label>Type</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value as 'collected' | 'paid_out')}>
            <option value="collected">Collected: they paid me</option>
            <option value="paid_out">Paid out: I paid them</option>
          </select></div>
        <div className="field"><label>Amount ($)</label><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="field"><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>Note</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Venmo, cash…" /></div>
      </div>
      <Err>{a.error}</Err>
      <button className="btn" disabled={a.busy || cents === null || cents === 0} onClick={() => a.run(async () => {
        await backend.rpc('record_transfer', { p_member: member, p_direction: direction, p_amount_cents: cents, p_occurred_on: date, p_note: note })
        onDone()
      })}>Record</button>
    </div>
  )
}

function LedgerTab() {
  const { backend } = useApp()
  const { data, error, loading, reload } = useRpc<AdminLedger>('admin_ledger')
  const [open, setOpen] = useState<string | null>(null)
  const a = useAction()
  if (loading && !data) return <Loading />
  if (!data) return <Err>{error}</Err>
  const names = new Map(data.people.map((p) => [p.user_id, p.display_name]))
  const total = data.people.filter((p) => !p.is_admin).reduce((s, p) => s + p.remaining_cents, 0)

  return (
    <>
      <Err>{error}</Err>
      <p className="muted small">
        Remaining = committed − gross payouts − refunds − collected + paid out. Positive: they owe you. Negative: you owe them.
        You can see who has entered open markets, but never what they picked until entries close.
      </p>
      {data.people.length === 0 ? <p className="muted">No settled or closed markets yet.</p> : (
        <div className="scroll-x">
          <table className="t">
            <thead>
              <tr><th>Name</th><th className="num">Committed</th><th className="num">Gross payouts</th><th className="num">Refunds</th>
                <th className="num">Collected</th><th className="num">Paid out</th><th className="num">Remaining</th><th className="num">Unsettled</th><th /></tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.user_id}>
                  <td>{p.display_name}{p.is_admin && <span className="muted"> (you)</span>}</td>
                  <td className="num">{usd(p.committed_cents)}</td><td className="num">{usd(p.gross_cents)}</td>
                  <td className="num">{usd(p.refund_cents)}</td><td className="num">{usd(p.collected_cents)}</td>
                  <td className="num">{usd(p.paid_out_cents)}</td>
                  <td className="num">
                    {p.is_admin ? <span className="muted">own books</span> : p.remaining_cents > 0 ? <strong>Owes you {usd(p.remaining_cents)}</strong>
                      : p.remaining_cents < 0 ? <strong>You owe {usd(-p.remaining_cents)}</strong> : 'Square'}
                  </td>
                  <td className="num">{usd(p.unresolved_cents)}</td>
                  <td>{!p.is_admin && <button className="btn ghost small" onClick={() => setOpen(open === p.user_id ? null : p.user_id)}>Record transfer</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <TransferForm key={open} member={open}
          suggest={(() => { const p = data.people.find((x) => x.user_id === open)!; return p.remaining_cents > 0 ? { direction: 'collected' as const, cents: p.remaining_cents } : { direction: 'paid_out' as const, cents: -p.remaining_cents } })()}
          onDone={() => { setOpen(null); reload() }} />
      )}
      <p className="small">Net owed to you across members: <strong>{usd(total)}</strong> (negative means you owe in total).</p>
      <div className="row" style={{ margin: '8px 0 16px' }}>
        <button className="btn ghost" onClick={() => download('election-town-balances.csv', [
          ['name', 'committed', 'gross_payouts', 'refunds', 'collected', 'paid_out', 'remaining_owed_to_admin', 'awaiting_results'],
          ...data.people.map((p) => [p.display_name, dollars(p.committed_cents), dollars(p.gross_cents), dollars(p.refund_cents), dollars(p.collected_cents), dollars(p.paid_out_cents), p.is_admin ? '' : dollars(p.remaining_cents), dollars(p.unresolved_cents)]),
        ])}>Export balances (CSV)</button>
        <button className="btn ghost" onClick={() => download('election-town-by-market.csv', [
          ['name', 'market', 'outcome', 'committed', 'gross_payout', 'refund'],
          ...data.breakdown.map((b) => [names.get(b.user_id) ?? '', b.title, b.outcome, dollars(b.commitment_cents), dollars(b.gross_cents), dollars(b.refund_cents)]),
        ])}>Export per-market detail (CSV)</button>
      </div>

      <h2>Recorded transfers</h2>
      <Err>{a.error}</Err>
      {data.transfers.length === 0 ? <p className="muted">None yet.</p> : (
        <table className="t">
          <thead><tr><th>Date</th><th>Name</th><th>Type</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>
            {data.transfers.map((t) => (
              <tr key={t.id} style={t.voided_at ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                <td>{t.occurred_on}</td><td>{t.display_name}</td>
                <td>{t.direction === 'collected' ? 'Collected' : 'Paid out'}{t.note && <span className="muted"> · {t.note}</span>}</td>
                <td className="num">{usd(t.amount_cents)}</td>
                <td>{!t.voided_at && <button className="btn ghost small" disabled={a.busy}
                  onClick={() => confirm('Void this transfer? It stays in the history, marked void.') && a.run(async () => { await backend.rpc('void_transfer', { p_id: t.id }); reload() })}>Void</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

/* ------------------------------------------------------------ the main pool */

function PoolTab() {
  const { backend } = useApp()
  const pool = useRpc<Pool>('get_pool')
  const who = useRpc<{ open_entrants: { market_id: string; names: string[] }[] }>('admin_ledger')
  const p = pool.data
  const race = p?.markets.find((m) => m.kind === 'senate')
  const seat = p?.markets.find((m) => m.kind === 'senate_seats')
  const [when, setWhen] = useState('')
  const [raceStake, setRaceStake] = useState('')
  const [seatStake, setSeatStake] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const a = useAction()
  const b = useAction()
  if (!p) return pool.error ? <Err>{pool.error}</Err> : <Loading />
  const whenV = when || (p.deadline ? toETInput(p.deadline) : '')
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(whenV) ? fromETInput(whenV) : null
  const rc = dollarsToCents(raceStake || centsToDollars(race?.buy_in_cents ?? 400))
  const sc = dollarsToCents(seatStake || centsToDollars(seat?.buy_in_cents ?? 500))
  const races = p.markets.filter((m) => m.kind === 'senate').length
  const seats = p.markets.length - races
  const names = who.data?.open_entrants.find((x) => x.market_id === race?.id)?.names ?? []
  return (
    <>
      <section>
        <h2>Closing time and stakes</h2>
        <p className="muted small">
          {p.ballots} {p.ballots === 1 ? 'ballot' : 'ballots'} in · {usd(p.pot_cents)} pot.
          {names.length > 0 && <> Submitted: {names.join(', ')} <span className="muted">(picks stay sealed, even from you)</span>.</>}
        </p>
        {p.closed ? <p className="callout">The pool closed {formatET(p.deadline)}. Enter results on the Results tab.</p> : (
          <>
            <div className="grid2">
              <div className="field"><label htmlFor="pool-close">Pool closes (New York time)</label>
                <input id="pool-close" type="datetime-local" value={whenV} onChange={(e) => setWhen(e.target.value)} />
                <p className="hint">{iso ? formatET(iso) : 'Pick a date and time'} · side bets closing at the same time move with it</p></div>
              <div className="field"><label htmlFor="stake-race">Stake per Senate race ($)</label>
                <input id="stake-race" inputMode="decimal" value={raceStake || centsToDollars(race?.buy_in_cents ?? 400)} onChange={(e) => setRaceStake(e.target.value)} />
                <label htmlFor="stake-seat" style={{ marginTop: 8 }}>Stake per seat pick ($)</label>
                <input id="stake-seat" inputMode="decimal" value={seatStake || centsToDollars(seat?.buy_in_cents ?? 500)} onChange={(e) => setSeatStake(e.target.value)} />
                <p className="hint">Ballot = {races} × race + {seats} × seats = {rc !== null && sc !== null ? usd(races * rc + seats * sc) : '…'}. Ballots already in owe the new total.</p></div>
            </div>
            <Err>{a.error}</Err>
            {a.note && <p className="ok" role="status">{a.note}</p>}
            <button className="btn" disabled={a.busy || !iso || rc === null || sc === null} onClick={() => a.run(async () => {
              await backend.rpc('set_pool_terms', { p_deadline: iso, p_race_buy_in_cents: rc, p_seat_buy_in_cents: sc })
              pool.reload()
              return 'Saved.'
            })}>Save</button>
          </>
        )}
      </section>
      <section className="section">
        <h2>Payment instructions</h2>
        <p className="muted small">Shown to members right after they submit a ballot. For example: &ldquo;Venmo @your-handle $50 by Oct 30.&rdquo;</p>
        <textarea value={note ?? p.pay_note ?? ''} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        <Err>{b.error}</Err>
        {b.note && <p className="ok" role="status">{b.note}</p>}
        <button className="btn" style={{ marginTop: 8 }} disabled={b.busy || note === null} onClick={() => b.run(async () => {
          await backend.rpc('set_pay_note', { p_note: note })
          pool.reload()
          return 'Saved.'
        })}>Save</button>
      </section>
    </>
  )
}

/* ------------------------------------------------------------ group */

function OpenSignup() {
  const { backend, me, refreshMe } = useApp()
  const a = useAction()
  const open = (me?.group as { open_signup?: boolean } | null)?.open_signup ?? true
  return (
    <section className="section">
      <h2>Who can join</h2>
      <label style={{ fontWeight: 500 }}>
        <input type="checkbox" checked={open} disabled={a.busy}
          onChange={(e) => a.run(async () => { await backend.rpc('set_open_signup', { p_open: e.target.checked }); refreshMe() })} />
        {' '}Anyone who signs up joins the group
      </label>
      <p className="hint">Turn this off to make the group invite-only: new accounts then need an invitation link. Anyone can browse either way.</p>
      <Err>{a.error}</Err>
    </section>
  )
}

type Member = { user_id: string; display_name: string; phone: string | null; joined_at: string; is_admin: boolean }

function Roster() {
  const { data, error } = useRpc<Member[]>('admin_members')
  const [copied, setCopied] = useState('')
  if (!data) return <Err>{error}</Err>
  const pretty = (p: string | null) => (p && /^\+1\d{10}$/.test(p) ? `(${p.slice(2, 5)}) ${p.slice(5, 8)}-${p.slice(8)}` : p ?? 'No number')
  const numbers = data.filter((m) => m.phone && !m.is_admin).map((m) => m.phone!)
  return (
    <section className="section">
      <h2>Members and phone numbers</h2>
      <p className="muted small">Only you can see these. Use them to text people about deadlines and payments.</p>
      <div className="scroll-x">
        <table className="t">
          <thead><tr><th>Name</th><th>Phone</th><th>Joined</th></tr></thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.user_id}>
                <td>{m.display_name}{m.is_admin && <span className="muted"> (you)</span>}</td>
                <td>{m.phone ? <a href={`sms:${m.phone}`}>{pretty(m.phone)}</a> : <span className="wrong">No number</span>}</td>
                <td>{m.joined_at.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn ghost" disabled={numbers.length === 0} onClick={async () => {
          try { await navigator.clipboard.writeText(numbers.join(', ')); setCopied(`Copied ${numbers.length} numbers. Paste them into a new Messages group.`) } catch { setCopied(numbers.join(', ')) }
        }}>Copy all numbers</button>
        <button className="btn ghost" onClick={() => download('election-town-members.csv', [
          ['name', 'phone', 'joined'], ...data.map((m) => [m.display_name, m.phone ?? '', m.joined_at.slice(0, 10)]),
        ])}>Export CSV</button>
      </div>
      {copied && <p className="small ok" role="status">{copied}</p>}
      <p className="hint">Forgot-password requests come to you by text: run <code>supabase/seed/reset_member_password.sql</code> in the Supabase SQL editor with their number and a temporary password.</p>
    </section>
  )
}

function GroupTab() {
  const { backend } = useApp()
  const invites = useRpc<{ token: string; created_at: string; revoked_at: string | null }[]>('list_invites')
  const b = useAction()
  const link = (t: string) => `${window.location.origin}/join/${t}`
  return (
    <>
      <OpenSignup />
      <Roster />

      <section className="section">
        <h2>Invitation links</h2>
        <p className="muted small">Anyone with a live link who signs in can join the group. Revoke a link to stop it working.</p>
        <Err>{b.error}</Err>
        <button className="btn" disabled={b.busy} onClick={() => b.run(async () => { await backend.rpc('create_invite'); invites.reload() })}>Create invitation link</button>
        <ul className="mlist" style={{ marginTop: 12 }}>
          {(invites.data ?? []).map((i) => (
            <li key={i.token} style={{ padding: '10px 4px' }}>
              <div className="small" style={{ wordBreak: 'break-all', opacity: i.revoked_at ? 0.5 : 1 }}>{link(i.token)}</div>
              <div className="row" style={{ marginTop: 6 }}>
                {i.revoked_at ? <span className="muted small">Revoked</span> : (
                  <>
                    <button className="btn ghost small" onClick={() => navigator.clipboard?.writeText(link(i.token))}>Copy link</button>
                    <button className="btn ghost small" onClick={() => b.run(async () => { await backend.rpc('revoke_invite', { p_token: i.token }); invites.reload() })}>Revoke</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
