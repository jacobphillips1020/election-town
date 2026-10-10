import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAdminName, useApp } from '../data/context'
import type { Basis } from '../domain/types'
import { Err } from './common'

type Row = { name: string; party: string }

export function ProposePage() {
  const { backend } = useApp()
  const admin = useAdminName()
  const nav = useNavigate()
  const [kind, setKind] = useState('senate')
  const [title, setTitle] = useState('')
  const [jurisdiction, setJurisdiction] = useState('')
  const [rows, setRows] = useState<Row[]>([{ name: '', party: 'D' }, { name: '', party: 'R' }])
  const [hasOther, setHasOther] = useState(true)
  const [basis, setBasis] = useState<Basis>('single_round')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const id = await backend.rpc<string>('propose_market', {
        p_kind: kind, p_title: title.trim(), p_jurisdiction: jurisdiction.trim(),
        p_candidates: rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), party: r.party })),
        p_has_other: hasOther, p_basis: basis, p_note: note.trim(),
      })
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
      <p className="muted">{admin} reviews proposals and sets the buy-in and entry deadline. Senate, House, and governor races only.</p>
      <form onSubmit={submit}>
        <div className="grid2">
          <div className="field">
            <label htmlFor="kind">Race type</label>
            <select id="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="senate">U.S. Senate</option>
              <option value="house">U.S. House</option>
              <option value="governor">Governor</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="jur">State / district</label>
            <input id="jur" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} placeholder="e.g. Ohio, or OH-09" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ohio Senate" required />
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
          <legend style={{ fontWeight: 650, fontSize: '.9rem', marginBottom: 4 }}>Candidates on the ballot</legend>
          {rows.map((r, i) => (
            <div className="row" key={i} style={{ marginBottom: 8 }}>
              <input className="grow" aria-label={`Candidate ${i + 1} name`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Full name" style={{ flex: '1 1 12rem' }} />
              <select aria-label={`Candidate ${i + 1} party`} value={r.party} onChange={(e) => set(i, { party: e.target.value })} style={{ width: '9rem' }}>
                <option value="D">Democratic</option><option value="R">Republican</option><option value="I">Independent</option>
                <option value="L">Libertarian</option><option value="G">Green</option><option value="O">Other party</option>
              </select>
              {rows.length > 2 && <button type="button" className="btn ghost small" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}
            </div>
          ))}
          {rows.length < 8 && <button type="button" className="btn ghost small" onClick={() => setRows([...rows, { name: '', party: 'O' }])}>Add candidate</button>}
          <p className="hint">List everyone who could plausibly win. Anyone not listed can&rsquo;t be picked as the winner.</p>
          <label style={{ fontWeight: 500, marginTop: 8 }}>
            <input type="checkbox" checked={hasOther} onChange={(e) => setHasOther(e.target.checked)} /> Include an &ldquo;Other candidates&rdquo; remainder
          </label>
        </fieldset>

        <div className="field">
          <label htmlFor="basis">Outcome basis</label>
          <select id="basis" value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
            <option value="single_round">Single election round</option>
            <option value="runoff_final">Runoff: winner and share in the decisive runoff</option>
            <option value="rcv_final">Ranked-choice: winner and share in the final round</option>
          </select>
          <p className="hint">Runoffs and ranked-choice races settle on the decisive final round only.</p>
        </div>
        <div className="field">
          <label htmlFor="note">Anything the admin should know (optional)</label>
          <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where results will be certified, special rules, links…" />
        </div>
        <Err>{error}</Err>
        <button className="btn" disabled={busy}>Send proposal</button>
      </form>
    </main>
  )
}
