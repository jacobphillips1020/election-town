import { useState, type ReactNode } from 'react'
import type { Candidate, Phase } from '../domain/types'

export const PARTY_LABEL: Record<string, string> = { D: 'Democratic', R: 'Republican', I: 'Independent', L: 'Libertarian', G: 'Green', O: 'Other' }
export const partyVar = (p: string | undefined) =>
  p === 'D' ? 'var(--dem)' : p === 'R' ? 'var(--rep)' : p === 'I' ? 'var(--ind)' : 'var(--oth)'

export function PartyTag({ party }: { party?: string }) {
  return (
    <span className="party-tag" style={{ color: partyVar(party) }} title={party ? PARTY_LABEL[party] : undefined}>
      <span className="dot" style={{ background: partyVar(party) }} aria-hidden="true" />
      {party ?? ''}
    </span>
  )
}

export function Err({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <p className="err" role="alert">
      {children}
    </p>
  )
}

export function Loading() {
  return <p className="muted page">Loading…</p>
}

const PHASE_LABEL: Record<Phase, string> = {
  proposed: 'Proposed', rejected: 'Not approved', open: 'Open', closed: 'Awaiting final results', settled: 'Settled', canceled: 'Canceled',
}
export function PhasePill({ phase }: { phase: Phase }) {
  return <span className={`pill pill-${phase}`}>{PHASE_LABEL[phase]}</span>
}

/** Native share where available, otherwise copy the link. */
export function ShareButton({ path, title }: { path: string; title: string }) {
  const [msg, setMsg] = useState('')
  const url = `${window.location.origin}${path}`
  async function go() {
    try {
      if (navigator.share) {
        await navigator.share({ title, url })
        return
      }
      await navigator.clipboard.writeText(url)
      setMsg('Link copied')
    } catch {
      setMsg(url)
    }
    setTimeout(() => setMsg(''), 3000)
  }
  return (
    <span className="share">
      <button type="button" className="btn ghost" onClick={go}>
        Share
      </button>
      {msg && <span className="muted small" role="status"> {msg}</span>}
    </span>
  )
}

/** Horizontal stacked bar of shares in tenths. */
export function ShareBar({ parts, label }: { parts: { id: string; tenths: number; color: string; name: string }[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.tenths, 0) || 1
  return (
    <div className="sharebar" role="img" aria-label={label}>
      {parts.map((p) => (
        <span key={p.id} style={{ width: `${(p.tenths / total) * 100}%`, background: p.color }} title={`${p.name}: ${(p.tenths / 10).toFixed(1)}%`} />
      ))}
    </div>
  )
}

export function candColor(c: Candidate | undefined) {
  return partyVar(c?.party)
}

/** One entrant's value per dot on a 0–100 line, with the group mean as a tick. Pure SVG, no library. */
export function StripPlot({ values, mean, min = 0, max = 100, color, label }: {
  values: number[]; mean: number; min?: number; max?: number; color: string; label: string
}) {
  const x = (v: number) => ((v - min) / (max - min)) * 100
  return (
    <svg className="strip" viewBox="0 0 100 14" preserveAspectRatio="none" role="img" aria-label={label}>
      <line x1="0" y1="7" x2="100" y2="7" stroke="var(--line)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
      {values.map((v, i) => (
        <circle key={i} cx={x(v)} cy="7" r="2" fill={color} fillOpacity="0.55" />
      ))}
      <line x1={x(mean)} x2={x(mean)} y1="1" y2="13" stroke="var(--ink)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
