import { Link } from 'react-router-dom'
import { useAdminName, useRpc } from '../data/context'
import { formatET, usd } from '../domain/format'
import { Err, Loading } from './common'

type Ledger = {
  is_admin: boolean
  totals: Record<'committed_cents' | 'gross_cents' | 'refund_cents' | 'collected_cents' | 'paid_out_cents' | 'remaining_cents' | 'unresolved_cents', number>
  resolved: { market_id: string; title: string; kind: string; status: string; commitment_cents: number; gross_cents: number; refund_cents: number; eligible: boolean; error_value: number | null; outcome: string }[]
  unresolved: { market_id: string; title: string; commitment_cents: number; entry_deadline: string; phase: 'open' | 'closed' }[]
  transfers: { id: string; direction: 'collected' | 'paid_out'; amount_cents: number; occurred_on: string }[]
}

function resultLabel(r: Ledger['resolved'][number]) {
  if (r.gross_cents > 0) return <span className="win">Won {usd(r.gross_cents)}</span>
  if (r.refund_cents > 0) return <span>Refunded {usd(r.refund_cents)}</span>
  if (!r.eligible && r.outcome === 'settled' && r.error_value === null && r.kind !== 'congress') return <span className="wrong">Wrong winner</span>
  return <span className="wrong">No payout</span>
}

export function MyEntriesPage() {
  const { data, error, loading } = useRpc<Ledger>('my_ledger')
  const admin = useAdminName()
  if (loading && !data) return <Loading />
  if (!data) return <main className="page" id="main"><Err>{error}</Err></main>
  const t = data.totals
  const net = t.gross_cents + t.refund_cents - t.committed_cents
  const rem = t.remaining_cents

  return (
    <main className="page" id="main">
      <h1>My picks</h1>
      <Err>{error}</Err>

      <section className="section" aria-labelledby="bal">
        <h2 id="bal">Settlement balance</h2>
        {data.is_admin ? (
          <p>
            Your own entries settle within your own books, so no transfer is needed. Net result on settled markets:{' '}
            <strong>{usd(net)}</strong>.
          </p>
        ) : rem > 0 ? (
          <p className="callout warn">You owe {admin} <strong>{usd(rem)}</strong>.</p>
        ) : rem < 0 ? (
          <p className="callout">{admin} owes you <strong>{usd(-rem)}</strong>.</p>
        ) : (
          <p className="callout">You&rsquo;re square. Nothing to transfer right now.</p>
        )}
        <dl className="kv">
          <dt>Committed (settled markets)</dt><dd>{usd(t.committed_cents)}</dd>
          <dt>Winnings (gross, includes your stake)</dt><dd>{usd(t.gross_cents)}</dd>
          <dt>Refunded / released</dt><dd>{usd(t.refund_cents)}</dd>
          <dt>Net result</dt><dd>{usd(net)}</dd>
          <dt>Paid to {admin} (collected)</dt><dd>{usd(t.collected_cents)}</dd>
          <dt>Paid out to you</dt><dd>{usd(t.paid_out_cents)}</dd>
        </dl>
        <p className="hint">Committed is what you&rsquo;ve entered. Collected is money {admin} has actually received. No money moves in this app.</p>
      </section>

      <section className="section" aria-labelledby="pend">
        <h2 id="pend">Awaiting results · {usd(t.unresolved_cents)} committed</h2>
        {data.unresolved.length === 0 ? <p className="muted">No open entries.</p> : (
          <ul className="mlist">
            {data.unresolved.map((u) => (
              <li key={u.market_id}>
                <Link className="mrow" to={`/m/${u.market_id}`}>
                  <div className="mrow-top"><span className="mrow-title">{u.title}</span><span>{usd(u.commitment_cents)}</span></div>
                  <div className="mrow-meta">
                    {u.phase === 'open' ? `Entries close ${formatET(u.entry_deadline)}` : 'Picks revealed · awaiting final results'}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">Unresolved entries aren&rsquo;t losses; they only count once a market settles.</p>
      </section>

      <section className="section" aria-labelledby="res">
        <h2 id="res">Settled</h2>
        {data.resolved.length === 0 ? <p className="muted">Nothing settled yet.</p> : (
          <div className="scroll-x">
            <table className="t">
              <thead><tr><th>Market</th><th className="num">Entered</th><th>Result</th></tr></thead>
              <tbody>
                {data.resolved.map((r) => (
                  <tr key={r.market_id}>
                    <td><Link to={`/m/${r.market_id}`}>{r.title}</Link></td>
                    <td className="num">{usd(r.commitment_cents)}</td>
                    <td>{resultLabel(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.transfers.length > 0 && (
        <section className="section">
          <h2>Transfers recorded</h2>
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
    </main>
  )
}
