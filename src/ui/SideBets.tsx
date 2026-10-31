// Side bets: any race that isn't on the main ballot. Opened by any member, $5 by default, same pick
// (winner + two-way vote share). Simple view: polling, how many are in, the pot, when it closes.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAdminName, useRpc } from '../data/context'
import { boardKey, type BoardRace } from '../domain/board'
import { formatET, usd } from '../domain/format'
import type { Market, Phase } from '../domain/types'
import { Err, Loading, PhasePill } from './common'
import { MatchupBar } from './RaceBoard'

const TABS: { id: string; label: string; phases: Phase[] }[] = [
  { id: 'open', label: 'Open', phases: ['open'] },
  { id: 'closed', label: 'Closed', phases: ['closed'] },
  { id: 'settled', label: 'Settled', phases: ['settled', 'canceled'] },
]

export function SideBetsPage() {
  const list = useRpc<Market[]>('list_markets')
  const board = useRpc<BoardRace[]>('race_board')
  const admin = useAdminName()
  const [tab, setTab] = useState('open')
  const side = (list.data ?? []).filter((m) => !m.featured && ['senate', 'house', 'governor'].includes(m.kind))
  const byMarket = new Map((board.data ?? []).filter((r) => r.market).map((r) => [r.market!.id, r]))
  const t = TABS.find((x) => x.id === tab)!
  const rows = side.filter((m) => t.phases.includes(m.phase)).sort((a, b) => b.entrants - a.entrants || a.title.localeCompare(b.title))

  return (
    <main className="page" id="main">
      <div className="sec-head">
        <h1 style={{ margin: 0 }}>Side bets</h1>
        <Link to="/open" className="btn">Open a side bet</Link>
      </div>
      <p className="lede">
        Bet on any other race. $5, same rules as the ballot. Open one and send friends the link.
        Want a different stake? Ask {admin}.
      </p>
      <div className="filters" role="group" aria-label="Status">
        {TABS.map((x) => (
          <button key={x.id} className="chip" aria-pressed={x.id === tab} onClick={() => setTab(x.id)}>
            {x.label} ({side.filter((m) => x.phases.includes(m.phase)).length})
          </button>
        ))}
      </div>
      <Err>{list.error}</Err>
      {list.loading && !list.data ? <Loading /> : rows.length === 0 ? (
        <p className="muted">{tab === 'open' ? 'No side bets yet. Open the first one.' : 'Nothing here yet.'}</p>
      ) : (
        <ul className="mlist">
          {rows.map((m) => {
            const r = byMarket.get(m.id)
            return (
              <li key={m.id}>
                <Link to={`/m/${m.id}`} className="mrow">
                  <div className="mrow-top">
                    <span className="mrow-title">{m.title}</span>
                    <PhasePill phase={m.phase} />
                  </div>
                  {r?.polling?.dem_avg != null && r.polling.rep_avg != null && <MatchupBar key={boardKey(r)} r={r} />}
                  <div className="mrow-meta">
                    <span><b>{m.entrants} in</b> · {usd(m.pool_cents)} pot</span>
                    <span>{usd(m.buy_in_cents ?? 0)} stake</span>
                    <span>{m.phase === 'open' ? `closes ${formatET(m.entry_deadline)}` : m.phase === 'closed' ? 'picks revealed · awaiting results' : m.phase === 'settled' ? 'settled' : 'canceled'}</span>
                    {m.has_entry && <span className="ok">You&rsquo;re in</span>}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
