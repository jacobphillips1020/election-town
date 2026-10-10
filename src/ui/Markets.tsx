import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useRpc } from '../data/context'
import { formatET, plural, usd } from '../domain/format'
import type { Kind, Market, Phase } from '../domain/types'
import { Err, Loading, PhasePill } from './common'

const TABS: { id: string; label: string; phases: Phase[] }[] = [
  { id: 'open', label: 'Open', phases: ['open'] },
  { id: 'closed', label: 'Closed', phases: ['closed'] },
  { id: 'settled', label: 'Settled', phases: ['settled', 'canceled'] },
  { id: 'proposed', label: 'Proposed', phases: ['proposed'] },
]
const KINDS: { id: Kind | 'all'; label: string }[] = [
  { id: 'all', label: 'All races' }, { id: 'senate', label: 'Senate' }, { id: 'house', label: 'House' },
  { id: 'governor', label: 'Governor' }, { id: 'congress', label: 'Congress' },
]

export const KIND_LABEL: Record<Kind, string> = { senate: 'Senate', house: 'House', governor: 'Governor', congress: 'Congress' }

export function MarketRow({ m }: { m: Market }) {
  const closed = m.phase === 'closed'
  return (
    <li>
      <Link to={`/m/${m.id}`} className="mrow">
        <div className="mrow-top">
          <span className="mrow-title">{m.title}</span>
          <PhasePill phase={m.phase} />
        </div>
        <div className="mrow-meta">
          <span>{KIND_LABEL[m.kind]}</span>
          {m.phase === 'proposed' ? (
            <span>Proposed by {m.proposed_by_name ?? 'a member'}</span>
          ) : (
            <>
              <span>
                {m.phase === 'open' ? `Entries close ${formatET(m.entry_deadline)}` : closed ? 'Picks revealed · awaiting final results' : m.phase === 'settled' ? 'Picks revealed · settled' : 'Canceled'}
              </span>
              <span>{usd(m.buy_in_cents ?? 0)} buy-in</span>
              <span>
                {plural(m.entrants, 'entry', 'entries')} · {usd(m.pool_cents)} committed
              </span>
              <span>{m.has_entry ? 'You’re in' : m.phase === 'open' ? 'Not entered' : 'You didn’t enter'}</span>
            </>
          )}
        </div>
      </Link>
    </li>
  )
}

export function MarketsPage() {
  const { data, error, loading } = useRpc<Market[]>('list_markets')
  const [params, setParams] = useSearchParams()
  const [kind, setKind] = useState<Kind | 'all'>('all')
  const tabId = params.get('tab') ?? 'open'
  const tab = TABS.find((t) => t.id === tabId) ?? TABS[0]

  const rows = (data ?? [])
    .filter((m) => tab.phases.includes(m.phase) && (kind === 'all' || m.kind === kind))
    .sort((a, b) => (a.entry_deadline ?? '').localeCompare(b.entry_deadline ?? ''))
  const count = (t: (typeof TABS)[number]) => (data ?? []).filter((m) => t.phases.includes(m.phase)).length

  return (
    <main className="page" id="main">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Markets</h1>
        <Link to="/propose" className="btn">Propose a race</Link>
      </div>
      <div className="filters" role="group" aria-label="Status">
        {TABS.map((t) => (
          <button key={t.id} className="chip" aria-pressed={t.id === tab.id} onClick={() => setParams(t.id === 'open' ? {} : { tab: t.id })}>
            {t.label} ({count(t)})
          </button>
        ))}
      </div>
      <div className="filters" role="group" aria-label="Race type" style={{ marginTop: -4 }}>
        {KINDS.map((k) => (
          <button key={k.id} className="chip" aria-pressed={k.id === kind} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      <Err>{error}</Err>
      {loading && !data ? <Loading /> : rows.length === 0 ? (
        <p className="muted">Nothing here yet.{tab.id === 'open' && ' Propose a race to get things started.'}</p>
      ) : (
        <ul className="mlist">{rows.map((m) => <MarketRow key={m.id} m={m} />)}</ul>
      )}
    </main>
  )
}
