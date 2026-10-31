// "Want to up the stakes? Invite your friends." Share the main ballot with one short line plus the link.
// The link itself also previews well (index.html: og:title / og:description / og:image = public/og.jpg).
import { useState } from 'react'
import { usd } from '../domain/format'
import type { Pool } from '../domain/pool'

const SITE = 'https://election-town.vercel.app'

/** What goes alongside the link. The link itself previews with the banner card (index.html / public/og.jpg). */
export const INVITE_TEXT = '🦅🦅🇺🇸 Make your prediction for this year’s midterms and win money! 🇺🇸🦅🦅🦅🦅'

export function Invite({ pool, compact = false }: { pool: Pool; submitted?: boolean; compact?: boolean }) {
  const [msg, setMsg] = useState('')
  const url = typeof window !== 'undefined' && window.location.hostname !== 'localhost' ? `${window.location.origin}/` : `${SITE}/`
  const text = INVITE_TEXT
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 4000) }

  async function share() {
    try {
      if (navigator.share) { await navigator.share({ title: 'Election Town: the 2026 Midterm Pool', text, url }); return }
      await navigator.clipboard.writeText(`${text} ${url}`)
      flash('Invite copied. Paste it into a text or group chat.')
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') flash('Couldn’t open sharing here. Use Copy instead.')
    }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(`${text} ${url}`); flash('Copied. Paste it anywhere.') } catch { flash(url) }
  }

  return (
    <section className={`invite${compact ? ' compact' : ''}`} aria-labelledby="invite-h">
      <div className="invite-copy">
        <h2 id="invite-h">Want to up the stakes? Invite your friends.</h2>
        <p>Every ballot adds {usd(pool.half_ballot_cents)} or {usd(pool.ballot_cents)} to the pot.{pool.ballots > 0 && <> Right now: <b>{pool.ballots}</b> {pool.ballots === 1 ? 'ballot' : 'ballots'}, <b>{usd(pool.pot_cents)}</b>.</>}</p>
      </div>
      <div className="invite-actions">
        <button type="button" className="btn" onClick={share}>Share invite</button>
        <a className="btn ghost" href={`sms:?&body=${encodeURIComponent(`${text} ${url}`)}`}>Text it</a>
        <button type="button" className="btn ghost" onClick={copy}>Copy</button>
      </div>
      {msg && <p className="small ok" role="status" style={{ margin: 0 }}>{msg}</p>}
    </section>
  )
}

/** The organizer's payment note, with a Venmo handle ("@name") turned into a link to their Venmo profile. */
export function PayNote({ text }: { text: string }) {
  if (!/venmo/i.test(text)) return <>{text}</>
  const parts = text.split(/(@[A-Za-z0-9_-]{3,30})/)
  return (
    <>
      {parts.map((p, i) => p.startsWith('@')
        ? <a key={i} href={`https://venmo.com/u/${p.slice(1)}`} target="_blank" rel="noreferrer"><b>{p}</b></a>
        : p)}
    </>
  )
}
