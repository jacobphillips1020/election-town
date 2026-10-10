// Masthead: the patriotic banner image plus a late-90s menu bar (navy, beveled serif tabs).
import { Link, useLocation } from 'react-router-dom'
import { useApp } from '../data/context'

export function Masthead() {
  const { backend, uid, me } = useApp()
  const loc = useLocation()
  const tab = new URLSearchParams(loc.search).get('tab')
  const onHome = loc.pathname === '/'
  const next = encodeURIComponent(loc.pathname + loc.search)
  const current = (on: boolean) => (on ? { 'aria-current': 'page' as const } : {})
  return (
    <header className="masthead">
      <Link to="/" className="masthead-banner">
        <img src="/banner.jpg" alt="Election Town: 2026 midterm prediction pool" width={1858} height={302} />
      </Link>
      <nav className="menubar" aria-label="Main">
        <Link to="/" {...current(onHome && tab !== 'settled')}>Markets</Link>
        {me?.is_member && <Link to="/entries" {...current(loc.pathname === '/entries')}>My picks</Link>}
        <Link to="/?tab=settled" {...current(onHome && tab === 'settled')}>Results</Link>
        <span className="menubar-fill" />
        {uid ? (
          <details className="menubar-user">
            <summary>{me?.display_name ?? 'Account'} ▾</summary>
            <div className="menubar-menu">
              {me?.is_admin && <Link to="/admin">Admin</Link>}
              <button type="button" onClick={() => backend.signOut()}>Sign out</button>
            </div>
          </details>
        ) : backend.mode === 'live' && !loc.pathname.startsWith('/auth') ? (
          <>
            <Link to={`/auth?next=${next}`}>Sign in</Link>
            <Link to={`/auth?mode=signup&next=${next}`}>Sign up</Link>
          </>
        ) : null}
      </nav>
    </header>
  )
}

export function NinetiesFooter() {
  return (
    <footer className="nineties-footer">
      <span>★ ★ ★</span>
      <p>Election Town &middot; Proudly counting every vote (eventually) &middot; Best viewed in any browser at any resolution</p>
      <p className="muted">No real money moves through this site. No eagles were harmed.</p>
    </footer>
  )
}
