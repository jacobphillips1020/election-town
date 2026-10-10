import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApp, useRpc } from '../data/context'
import { boardLabel, hasAverage, viewRaces, type BoardRace } from '../domain/board'
import { MatchupBar } from './RaceBoard'
import { formatET, plural, usd } from '../domain/format'
import type { Kind, Market, Phase } from '../domain/types'
import { Err, Loading, PhasePill } from './common'

const TABS: { id: string; label: string; phases: Phase[] }[] = [
  { id: 'open', label: 'Open', phases: ['open'] },
  { id: 'closed', label: 'Closed', phases: ['closed'] },
  { id: 'settled', label: 'Settled', phases: ['settled', 'canceled'] },
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

function PhonePrompt() {
  const { backend, me, refreshMe } = useApp()
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  if (!me || me.has_phone) return null
  return (
    <form className="panel" onSubmit={async (e) => {
      e.preventDefault()
      try { await backend.rpc('set_my_phone', { p_phone: phone }); refreshMe() } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.') }
    }}>
      <label htmlFor="myphone">Add your mobile number</label>
      <p className="hint" style={{ marginTop: 0 }}>Only the organizer sees it. It&rsquo;s how they reach you about payments and deadlines.</p>
      <div className="row">
        <input id="myphone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(312) 555-0123" style={{ flex: '1 1 12rem' }} />
        <button className="btn">Save</button>
      </div>
      <Err>{error}</Err>
    </form>
  )
}

export function MarketsPage() {
  const { data, error, loading } = useRpc<Market[]>('list_markets')
  const [params, setParams] = useSearchParams()
  const tabId = params.get('tab') ?? 'open'
  const tab = TABS.find((t) => t.id === tabId) ?? TABS[0]

  const rows = (data ?? [])
    .filter((m) => tab.phases.includes(m.phase))
    .sort((a, b) => (a.entry_deadline ?? '').localeCompare(b.entry_deadline ?? ''))
  const count = (t: (typeof TABS)[number]) => (data ?? []).filter((m) => t.phases.includes(m.phase)).length

  return (
    <main className="page" id="main">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Markets</h1>
        <Link to="/open" className="btn">Open a market</Link>
      </div>
      <PhonePrompt />
      <div className="filters" role="group" aria-label="Status">
        {TABS.map((t) => (
          <button key={t.id} className="chip" aria-pressed={t.id === tab.id} onClick={() => setParams(t.id === 'open' ? {} : { tab: t.id })}>
            {t.label} ({count(t)})
          </button>
        ))}
      </div>
      <Err>{error}</Err>
      {loading && !data ? <Loading /> : rows.length === 0 ? (
        <p className="muted">Nothing here yet.{tab.id === 'open' && ' Open a market to get things started.'}</p>
      ) : (
        <ul className="mlist">{rows.map((m) => <MarketRow key={m.id} m={m} />)}</ul>
      )}
      <p className="hint" style={{ marginTop: 10 }}>Fixed buy-in per race. You can change or withdraw your pick any time until that race&rsquo;s entries close.</p>
      {tab.id === 'open' && <ClosestRaces />}
    </main>
  )
}

/** Home-page teaser: the tightest races without a market yet, one tap from opening one. */
function ClosestRaces() {
  const { data } = useRpc<BoardRace[]>('race_board')
  const top = viewRaces((data ?? []).filter((r) => !r.market && hasAverage(r) && r.polling?.dem_name && r.polling?.rep_name), { query: '', kind: 'all', sort: 'closest' }).slice(0, 5)
  if (top.length === 0) return null
  return (
    <section className="section" aria-labelledby="closest">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="closest" style={{ margin: 0 }}>Closest races</h2>
        <Link to="/open" className="small">See all races →</Link>
      </div>
      <p className="hint" style={{ marginTop: 4 }}>No market yet. Tap one to open its market and place your bet.</p>
      <ul className="board-list">
        {top.map((r) => (
          <li key={`${r.race_type}${r.state}${r.district}${r.special}`} className="board-row">
            <Link className="board-hit" to={`/open?q=${encodeURIComponent(boardLabel(r).replace(' — ', ' '))}`}>
              <span className="board-top"><span className="board-title">{boardLabel(r)}</span>
                {r.polling?.rating && <span className="muted small">{r.polling.rating}</span>}</span>
              <MatchupBar r={r} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
