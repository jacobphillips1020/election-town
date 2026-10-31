import { Link } from 'react-router-dom'
import { useAdminName, useRpc } from '../data/context'
import { formatET, usd } from '../domain/format'
import type { Pool } from '../domain/pool'
import { Err, Loading } from './common'

type Ledger = {
  is_admin: boolean
  totals: Record<'committed_cents' | 'gross_cents' | 'refund_cents' | 'collected_cents' | 'paid_out_cents' | 'remaining_cents' | 'unresolved_cents', number>
  resolved: { market_id: string; title: string; kind: string; status: string; commitment_cents: number; gross_cents: number; refund_cents: number; eligible: boolean; error_value: number | null; outcome: string }[]
  unresolved: { market_id: string; title: string; commitment_cents: number; entry_deadline: string; phase: 'open' | 'closed' }[]
  transfers: { id: string; direction: 'collected' | 'paid_out'; amount_cents: number; occurred_on: string }[]
}

const result = (won: number, refunded: number) =>
  won > 0 ? <span className="win">Won {usd(won)}</span> : refunded > 0 ? <span>Refunded {usd(refunded)}</span> : <span className="wrong">No win</span>

export function MyEntriesPage() {
  const { data, error, loading } = useRpc<Ledger>('my_ledger')
  const pool = useRpc<Pool>('get_pool')
  const admin = useAdminName()
  if (loading && !data) return <Loading />
  if (!data) return <main className="page" id="main"><Err>{error}</Err></main>
  const t = data.totals
  // What's owed counting open bets too (they're money in, just not settled yet).
  const rem = t.remaining_cents + t.unresolved_cents
  const ballotIds = new Set((pool.data?.markets ?? []).map((m) => m.id))

  // The 12 ballot picks show as one line; side bets one line each.
  const openBallot = data.unresolved.filter((u) => ballotIds.has(u.market_id))
  const openSide = data.unresolved.filter((u) => !ballotIds.has(u.market_id))
  const doneBallot = data.resolved.filter((r) => ballotIds.has(r.market_id))
  const doneSide = data.resolved.filter((r) => !ballotIds.has(r.market_id))
  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0)

  return (
    <main className="page" id="main">
      <h1>My money</h1>
      <Err>{error}</Err>

      {data.is_admin ? (
        <p className="callout">You run the pool, so nothing changes hands for your own picks.</p>
      ) : rem > 0 ? (
        <p className="callout warn">You owe {admin} <strong>{usd(rem)}</strong>.</p>
      ) : rem < 0 ? (
        <p className="callout ok-callout">{admin} owes you <strong>{usd(-rem)}</strong>.</p>
      ) : (
        <p className="callout">You&rsquo;re square with {admin}.</p>
      )}

      <section className="section" aria-labelledby="open-h">
        <h2 id="open-h">Waiting on results</h2>
        {data.unresolved.length === 0 ? <p className="muted">Nothing open.</p> : (
          <ul className="mlist">
            {openBallot.length > 0 && (
              <li>
                <Link className="mrow" to="/ballot">
                  <div className="mrow-top"><span className="mrow-title">Main ballot</span><span>{usd(sum(openBallot, (u) => u.commitment_cents))}</span></div>
                  <div className="mrow-meta">{openBallot[0].phase === 'open' ? `Closes ${formatET(openBallot[0].entry_deadline)}` : 'Closed · waiting on results'}</div>
                </Link>
              </li>
            )}
            {openSide.map((u) => (
              <li key={u.market_id}>
                <Link className="mrow" to={`/m/${u.market_id}`}>
                  <div className="mrow-top"><span className="mrow-title">{u.title}</span><span>{usd(u.commitment_cents)}</span></div>
                  <div className="mrow-meta">{u.phase === 'open' ? `Closes ${formatET(u.entry_deadline)}` : 'Closed · waiting on results'}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.resolved.length > 0 && (
        <section className="section" aria-labelledby="done-h">
          <h2 id="done-h">Results</h2>
          <table className="t">
            <thead><tr><th>Bet</th><th className="num">Put in</th><th>Result</th></tr></thead>
            <tbody>
              {doneBallot.length > 0 && (
                <tr>
                  <td>Main ballot <span className="muted small">({doneBallot.length} of 12 settled)</span></td>
                  <td className="num">{usd(sum(doneBallot, (r) => r.commitment_cents))}</td>
                  <td>{result(sum(doneBallot, (r) => r.gross_cents), sum(doneBallot, (r) => r.refund_cents))}</td>
                </tr>
              )}
              {doneSide.map((r) => (
                <tr key={r.market_id}>
                  <td><Link to={`/m/${r.market_id}`}>{r.title}</Link></td>
                  <td className="num">{usd(r.commitment_cents)}</td>
                  <td>{result(r.gross_cents, r.refund_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!data.is_admin && (t.collected_cents > 0 || t.paid_out_cents > 0 || data.transfers.length > 0) && (
        <section className="section">
          <h2>Payments</h2>
          <ul className="mlist">
            {data.transfers.map((x) => (
              <li key={x.id} className="mrow-top" style={{ padding: '8px 4px' }}>
                <span>{x.direction === 'collected' ? `You paid ${admin}` : `${admin} paid you`} · {x.occurred_on}</span>
                <span>{usd(x.amount_cents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="hint">The total includes open bets. No money moves through this site; {admin} keeps track of payments.</p>
    </main>
  )
}
