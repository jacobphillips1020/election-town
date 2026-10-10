import { useEffect } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppProvider, useApp } from './data/context'
import { rememberDestination } from './lib'
import { AuthPage, CallbackPage, ResetPage } from './ui/Auth'
import { JoinPage } from './ui/Join'
import { Loading } from './ui/common'
import { MarketsPage } from './ui/Markets'
import { MarketPage } from './ui/MarketDetail'
import { ProposePage } from './ui/Propose'
import { MyEntriesPage } from './ui/MyEntries'
import { AdminPage } from './ui/Admin'

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}

function DemoBar() {
  const { backend, uid } = useApp()
  if (backend.mode !== 'demo') return null
  return (
    <div className="demo-bar" role="note">
      <div className="demo-bar-in">
        <strong>Demo.</strong>
        <span>Fictional people and numbers, stored only in this browser. Not a working multiuser service.</span>
        <label className="small" style={{ margin: 0 }}>
          Act as{' '}
          <select
            style={{ width: 'auto', minHeight: 32, padding: '2px 6px' }}
            value={uid ?? ''}
            onChange={(e) => backend.actAs!(e.target.value || null)}
          >
            <option value="">Signed out</option>
            {backend.personas!.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.note}
              </option>
            ))}
          </select>
        </label>
        <button className="btn ghost small" onClick={() => backend.resetDemo!()}>
          Reset demo data
        </button>
      </div>
    </div>
  )
}

function Header() {
  const { backend, uid, me } = useApp()
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <DemoBar />
      <header className="top">
        <div className="top-in">
          <Link to="/" className="brand">
            Election <span>Town</span>
          </Link>
          {uid && me?.is_member && (
            <nav className="nav" aria-label="Main">
              <NavLink to="/" end>Markets</NavLink>
              <NavLink to="/entries">My entries</NavLink>
              {me.is_admin && <NavLink to="/admin">Admin</NavLink>}
            </nav>
          )}
          {uid && (
            <span className="who">
              {me?.display_name}
              <button className="btn ghost small" onClick={() => backend.signOut()}>
                Sign out
              </button>
            </span>
          )}
        </div>
      </header>
    </>
  )
}

function NotMember() {
  const loc = useLocation()
  useEffect(() => {
    if (loc.pathname !== '/') rememberDestination(loc.pathname + loc.search)
  }, [loc])
  return (
    <main className="page" id="main">
      <h1>You&rsquo;re signed in, but not in the group yet</h1>
      <p>Election Town is invite-only. Ask the person who invited you for the group invitation link and open it while signed in.</p>
      {loc.pathname !== '/' && <p className="muted">After you join, you&rsquo;ll land back on the page you were trying to open.</p>}
    </main>
  )
}

function Gate({ children }: { children: React.ReactNode }) {
  const { uid, me, meLoading } = useApp()
  const loc = useLocation()
  if (!uid) return <Navigate to={`/auth?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  if (meLoading || !me) return <Loading />
  if (!me.is_member) return <NotMember />
  return <>{children}</>
}

function Shell() {
  const { uid } = useApp()
  return (
    <>
      <Header />
      {/* key resets every screen's state when the signed-in person changes */}
      <div key={uid ?? 'anon'}>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/auth/callback" element={<CallbackPage />} />
          <Route path="/auth/reset" element={<ResetPage />} />
          <Route path="/join/:token" element={<JoinPage />} />
          <Route path="/" element={<Gate><MarketsPage /></Gate>} />
          <Route path="/m/:id" element={<Gate><MarketPage /></Gate>} />
          <Route path="/propose" element={<Gate><ProposePage /></Gate>} />
          <Route path="/entries" element={<Gate><MyEntriesPage /></Gate>} />
          <Route path="/admin" element={<Gate><AdminPage /></Gate>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </>
  )
}
