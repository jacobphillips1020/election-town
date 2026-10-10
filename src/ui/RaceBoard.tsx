// The race board: scan every polled 2026 race (who's running, who's ahead, how solid), then open its market.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { boardKey, boardLabel, hasAverage, lastName, marginText, ratingTone, viewRaces, type BoardRace, type BoardView } from '../domain/board'
import { basisSentence } from '../domain/races'
import { pollingPageUrl } from '../domain/states'
import { Err, PartyTag } from './common'

const PAGE = 30

export function RaceBoard({ races, onOpen, opening, error, note, initialQuery = '' }: {
  races: BoardRace[]
  onOpen: (r: BoardRace) => void
  opening: string | null
  error: string
  note?: string
  initialQuery?: string
}) {
  const [view, setView] = useState<BoardView>({ query: initialQuery, kind: 'all', sort: 'closest' })
  const [open, setOpen] = useState<string | null>(() => {
    const hits = initialQuery ? viewRaces(races, { query: initialQuery, kind: 'all', sort: 'closest' }) : []
    return hits.length === 1 ? boardKey(hits[0]) : null
  })
  const [shown, setShown] = useState(PAGE)
  const rows = useMemo(() => viewRaces(races, view), [races, view])
  const polled = races.filter(hasAverage).length
  const updated = races.reduce((t, r) => (r.polling && r.polling.fetched_at > t ? r.polling.fetched_at : t), '')
  const set = (p: Partial<BoardView>) => { setView({ ...view, ...p }); setShown(PAGE) }

  return (
    <div className="board">
      <div className="field" style={{ marginBottom: 8 }}>
        <label htmlFor="race-search" className="sr-only">Find a race</label>
        <input id="race-search" type="search" value={view.query} onChange={(e) => set({ query: e.target.value })}
          placeholder="Search a state, district or race: Utah 2, Ohio senate…" autoComplete="off" />
      </div>
      <div className="board-controls">
        <div className="filters" role="group" aria-label="Race type" style={{ margin: 0 }}>
          {(['all', 'senate', 'governor', 'house'] as const).map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={view.kind === k} onClick={() => set({ kind: k })}>
              {k === 'all' ? 'All' : k === 'senate' ? 'Senate' : k === 'governor' ? 'Governor' : 'House'}
            </button>
          ))}
        </div>
        <div className="seg-toggle" role="group" aria-label="Sort">
          <button type="button" aria-pressed={view.sort === 'closest'} onClick={() => set({ sort: 'closest' })}>Closest</button>
          <button type="button" aria-pressed={view.sort === 'az'} onClick={() => set({ sort: 'az' })}>A–Z</button>
        </div>
      </div>

      <p className="board-count" aria-live="polite">
        {view.query.trim()
          ? `${rows.length} ${rows.length === 1 ? 'race matches' : 'races match'}`
          : `${rows.length} races with a polling average${view.sort === 'closest' ? ', closest first' : ''}`}
      </p>
      {note && <p className="hint">{note}</p>}
      <Err>{error}</Err>

      <ul className="board-list">
        {rows.slice(0, shown).map((r) => (
          <RaceRow key={boardKey(r)} r={r} open={open === boardKey(r)}
            onToggle={() => setOpen(open === boardKey(r) ? null : boardKey(r))}
            onOpen={() => onOpen(r)} busy={opening === boardKey(r)} />
        ))}
      </ul>
      {rows.length > shown && (
        <button type="button" className="btn ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setShown(shown + PAGE)}>
          Show {Math.min(PAGE, rows.length - shown)} more
        </button>
      )}
      {view.query.trim() === '' && (
        <p className="hint" style={{ marginTop: 12 }}>
          {races.length - polled} more races have no polling average yet. Search to find one, like &ldquo;Utah 2&rdquo;.
        </p>
      )}
      {view.query.trim() !== '' && rows.length === 0 && (
        <p className="hint">No 2026 race matches. Not every state has a Senate or governor race this year; every state has House seats.</p>
      )}
      <p className="board-source">
        Polling: PollingSource average (<a href="https://pollingsource.com" target="_blank" rel="noreferrer">pollingsource.com</a>).
        Democratic and Republican averages as published; the gap is undecided and other candidates. Not a forecast.
        {updated && <> Updated {new Date(updated).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.</>}
      </p>
    </div>
  )
}

function RatingChip({ rating }: { rating: string }) {
  const t = ratingTone(rating)
  return <span className={`rate ${t.side ? `rate-${t.side.toLowerCase()}${t.level}` : 'rate-toss'}`}>{rating}</span>
}

function shortDate(iso: string | null) {
  return iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null
}

export function MatchupBar({ r }: { r: BoardRace }) {
  const p = r.polling!
  const d = p.dem_avg!, rep = p.rep_avg!
  const lead = d > rep ? 'D' : rep > d ? 'R' : null
  return (
    <div className="mu">
      <div className="mu-names">
        <span className={`mu-d-name${lead === 'D' ? ' lead' : ''}`}>{lastName(p.dem_name, 'Democrat')} <span className="mu-num">{d.toFixed(1)}</span></span>
        <span className={`mu-r-name${lead === 'R' ? ' lead' : ''}`}><span className="mu-num">{rep.toFixed(1)}</span> {lastName(p.rep_name, 'Republican')}</span>
      </div>
      <div className="mu-bar" aria-hidden="true">
        <span className="mu-d" style={{ width: `${Math.min(d, 100)}%` }} />
        <span className="mu-r" style={{ width: `${Math.min(rep, 100)}%` }} />
        <span className="mu-mid" />
      </div>
    </div>
  )
}

function RaceRow({ r, open, onToggle, onOpen, busy }: {
  r: BoardRace; open: boolean; onToggle: () => void; onOpen: () => void; busy: boolean
}) {
  const p = r.polling
  const avg = hasAverage(r)
  const named = !!(p?.dem_name && p?.rep_name)
  const label = boardLabel(r)
  const id = `race-${boardKey(r).replace(/[^a-z0-9]/gi, '-')}`
  const summary = avg
    ? `${label}. ${p!.rating ?? ''}. ${p!.dem_name ?? 'Democrat'}, Democrat, ${p!.dem_avg!.toFixed(1)} percent; ${p!.rep_name ?? 'Republican'}, Republican, ${p!.rep_avg!.toFixed(1)} percent.`
    : `${label}. No polling average yet.`
  return (
    <li className={`board-row${open ? ' open' : ''}${r.market ? ' in-pool' : ''}`}>
      <button type="button" className="board-hit" aria-expanded={open} aria-controls={id} aria-label={summary} onClick={onToggle}>
        <span className="board-top">
          <span className="board-title">{label}</span>
          <span className="board-chips">
            {r.market && <span className="rate rate-pool">Market open</span>}
            {p?.rating && <RatingChip rating={p.rating} />}
          </span>
        </span>
        {avg ? (
          <>
            <MatchupBar r={r} />
            <span className="board-meta">
              <strong>{marginText(r)}</strong>
              <span>{p!.poll_count} {p!.poll_count === 1 ? 'poll' : 'polls'}</span>
              {p!.last_poll_date && <span>last poll {shortDate(p!.last_poll_date)}</span>}
            </span>
          </>
        ) : (
          <span className="board-meta">No polling average yet</span>
        )}
      </button>

      {open && (
        <div className="board-detail" id={id}>
          {avg && (
            <ul className="board-cands">
              <li><span>{p!.dem_name ?? 'Democratic nominee (to be confirmed)'}</span><PartyTag party="D" /><span className="mu-num">{p!.dem_avg!.toFixed(1)}%</span></li>
              <li><span>{p!.rep_name ?? 'Republican nominee (to be confirmed)'}</span><PartyTag party="R" /><span className="mu-num">{p!.rep_avg!.toFixed(1)}%</span></li>
            </ul>
          )}
          {r.market ? (
            <p className="small" style={{ margin: '0 0 10px' }}>This race already has a market. Head over to place your bet.</p>
          ) : named ? (
            <p className="small" style={{ margin: '0 0 10px' }}>
              Opens with the top two by polling plus &ldquo;Other candidates&rdquo;. {basisSentence(r.state)} You can change your pick until entries close.
            </p>
          ) : (
            <p className="small" style={{ margin: '0 0 10px' }}>The candidates for this race haven&rsquo;t been published yet, so its market can&rsquo;t be opened.</p>
          )}
          <div className="row">
            {r.market ? (
              <Link className="btn" to={`/m/${r.market.id}`}>Place a bet</Link>
            ) : named ? (
              <button type="button" className="btn" disabled={busy} onClick={onOpen}>{busy ? 'Opening…' : 'Open market & place bet'}</button>
            ) : null}
            <a className="btn ghost" href={p?.page ?? pollingPageUrl({ race_type: r.race_type, state: r.state, district: r.district, special: r.special })}
              target="_blank" rel="noreferrer">Polling page ↗</a>
          </div>
        </div>
      )}
    </li>
  )
}

