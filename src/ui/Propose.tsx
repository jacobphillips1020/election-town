import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAdminName, useApp, useRpc } from '../data/context'
import { RACES, basisSentence, raceLabel, raceTitle, searchRaces, toPollingRef, type RaceEntry } from '../domain/races'
import { pollingPageUrl } from '../domain/states'
import type { Market } from '../domain/types'
import { lookupRace, refreshMarket, type Lookup } from '../polling/client'
import { Err } from './common'

/** The only input is the race. Everything else is derived by the system (see propose_race in the database). */
export function ProposePage() {
  const { backend } = useApp()
  const admin = useAdminName()
  const nav = useNavigate()
  const existing = useRpc<Market[]>('list_markets')
  const [query, setQuery] = useState('')
  const [race, setRace] = useState<RaceEntry | null>(null)
  const [found, setFound] = useState<{ loading: boolean; res: Lookup | null }>({ loading: false, res: null })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const matches = useMemo(() => searchRaces(query), [query])

  useEffect(() => {
    if (!race) return
    setFound({ loading: true, res: null })
    let live = true
    lookupRace(backend, toPollingRef(race)).then((res) => live && setFound({ loading: false, res }))
    return () => { live = false }
  }, [race, backend])

  const snap = found.res?.snapshot ?? null
  const dup = race && (existing.data ?? []).find((m) => m.polling_ref && ['proposed', 'open', 'settled'].includes(m.phase) &&
    m.polling_ref.race_type === race.kind && m.polling_ref.state === race.state &&
    m.polling_ref.district === race.district && m.polling_ref.special === race.special)

  async function submit() {
    if (!race) return
    setBusy(true)
    setError('')
    try {
      const id = await backend.rpc<string>('propose_race', {
        p_race_type: race.kind, p_state: race.state, p_district: race.district, p_special: race.special,
      })
      // Polling and candidate names load the moment a race is proposed (bounded wait; the page retries on open).
      await Promise.race([refreshMarket(backend, id), new Promise((r) => setTimeout(r, 6000))])
      nav(`/m/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the proposal.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page" id="main" style={{ maxWidth: '36rem' }}>
      <h1>Propose a race</h1>
      <p className="muted">
        Pick one of the {RACES.length} races on the 2026 ballot. Candidates, polling and settlement rules are filled in
        automatically; {admin} confirms the race and sets the buy-in and entry deadline.
      </p>

      {!race ? (
        <div className="field">
          <label htmlFor="race-search">Find a race</label>
          <input id="race-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Ohio senate, Arizona governor, Utah 2" autoComplete="off" />
          {query.trim() && matches.length === 0 && (
            <p className="hint">No 2026 race matches. Not every state has a Senate or governor race this year; every state has House seats.</p>
          )}
          <ul className="mlist" style={{ marginTop: 8 }}>
            {matches.map((r) => (
              <li key={`${r.kind}${r.state}${r.district}${r.special}`}>
                <button type="button" className="mrow" style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, font: 'inherit', cursor: 'pointer' }}
                  onClick={() => setRace(r)}>
                  <span className="mrow-title">{raceLabel(r)}</span>
                  <span className="muted small"> · {r.polled ? 'polling average available' : 'no polling average yet'}</span>
                </button>
              </li>
            ))}
          </ul>
          {!query.trim() && <p className="hint">Type a state and a race: &ldquo;Utah 2&rdquo; for its 2nd House district, &ldquo;Ohio senate&rdquo;, &ldquo;Arizona gov&rdquo;.</p>}
        </div>
      ) : (
        <div>
          <div className="panel">
            <div className="mrow-top">
              <strong>{raceLabel(race)}</strong>
              <button type="button" className="btn ghost small" onClick={() => { setRace(null); setFound({ loading: false, res: null }) }}>Change</button>
            </div>
            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>Market</dt><dd>{raceTitle(race)}</dd>
              <dt>Settlement</dt><dd>{basisSentence(race.state)}</dd>
              <dt>Candidates</dt>
              <dd>
                {found.loading ? 'Loading from the polling average…'
                  : snap ? snap.data.candidates.map((c) => c.name).join(' · ')
                  : 'Filled in automatically once polling publishes them'}
              </dd>
              <dt>Polling</dt>
              <dd>
                {found.loading ? 'Checking…'
                  : snap ? snap.data.candidates.map((c) => `${c.pct.toFixed(1)}%`).join(' – ')
                  : 'No average published yet'}
                {' · '}<a href={pollingPageUrl(toPollingRef(race))} target="_blank" rel="noreferrer">PollingSource</a>
              </dd>
            </dl>
          </div>

          {dup && (
            <p className="callout warn">
              A market for this race already exists: <Link to={`/m/${dup.id}`}>{dup.title}</Link>.
            </p>
          )}
          <Err>{error}</Err>
          <button className="btn" disabled={busy || found.loading || !!dup} onClick={submit}>Propose this race</button>
        </div>
      )}
    </main>
  )
}
