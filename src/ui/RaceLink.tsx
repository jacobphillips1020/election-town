import { useEffect, useState } from 'react'
import { useApp } from '../data/context'
import { STATES, pollingPageUrl, type PollingRef } from '../domain/states'
import { lookupRace, type Lookup } from '../polling/client'

export type RefDraft = { state: string; district: string; special: boolean }
export const EMPTY_REF: RefDraft = { state: '', district: '', special: false }

export function refToDraft(r: PollingRef | null | undefined): RefDraft {
  return r ? { state: r.state, district: r.district ?? '', special: r.special } : EMPTY_REF
}

/** Builds the structured reference the database stores; null until it's complete. */
export function toRef(kind: string, d: RefDraft): PollingRef | null {
  if (kind !== 'senate' && kind !== 'house' && kind !== 'governor') return null
  if (!d.state) return null
  if (kind === 'house') {
    const t = d.district.trim().toUpperCase()
    if (!/^(AL|\d{1,2})$/.test(t)) return null
    return { race_type: 'house', state: d.state, district: t === 'AL' ? 'AL' : t.padStart(2, '0'), special: d.special }
  }
  return { race_type: kind, state: d.state, district: null, special: d.special }
}

export function RaceLinkFields({ kind, value, onChange }: { kind: string; value: RefDraft; onChange: (d: RefDraft) => void }) {
  const ref = toRef(kind, value)
  return (
    <div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="rl-state">State</label>
          <select id="rl-state" value={value.state} onChange={(e) => onChange({ ...value, state: e.target.value })}>
            <option value="">Select…</option>
            {STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </div>
        {kind === 'house' && (
          <div className="field">
            <label htmlFor="rl-dist">District number</label>
            <input id="rl-dist" inputMode="numeric" value={value.district} onChange={(e) => onChange({ ...value, district: e.target.value })} placeholder="e.g. 9 (AL if at-large)" />
          </div>
        )}
      </div>
      <label style={{ fontWeight: 500 }}>
        <input type="checkbox" checked={value.special} onChange={(e) => onChange({ ...value, special: e.target.checked })} /> This is a special election
      </label>
      {ref && <PollingLink r={ref} />}
    </div>
  )
}

export function PollingLink({ r }: { r: PollingRef }) {
  return (
    <p className="hint">
      Polling average for this race:{' '}
      <a href={pollingPageUrl(r)} target="_blank" rel="noreferrer">view it on PollingSource</a>. Check that it&rsquo;s the same race you mean.
    </p>
  )
}

/** Live lookup of the chosen race's polling average (only when the server-side lookup is switched on). */
export function LookupPreview({ r }: { r: PollingRef | null }) {
  const { backend } = useApp()
  const [res, setRes] = useState<Lookup | null>(null)
  const key = r ? JSON.stringify(r) : ''
  useEffect(() => {
    setRes(null)
    if (!r) return
    let live = true
    lookupRace(backend, r).then((x) => live && setRes(x))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, backend])
  if (!r || !res || res.status === 'disabled' || res.status === 'unavailable') return null
  if (res.status === 'mismatch') return <p className="hint">The polling source returned a different race than expected, so no average is linked.</p>
  if (!res.snapshot) return <p className="hint">No polling average is published for this race yet.</p>
  const d = res.snapshot.data.candidates
  return (
    <p className="callout" role="status">
      <strong>PollingSource average:</strong> {d.map((c) => `${c.name} ${c.pct.toFixed(1)}%`).join(' · ')}. {res.snapshot.data.note}
    </p>
  )
}
