import { lazy, Suspense, useEffect } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppProvider, useApp } from './data/context'
import { rememberDestination } from './lib'
import { AuthPage } from './ui/Auth'
import { JoinPage } from './ui/Join'
import { Loading } from './ui/common'
import { MarketsPage } from './ui/Markets'
import { MarketPage } from './ui/MarketDetail'
import { ProposePage } from './ui/Propose'
import { MyEntriesPage } from './ui/MyEntries'
import { FlagBanner, NinetiesFooter } from './ui/FlagBanner'
import { AdminPage } from './ui/Admin'

const DevBoard = import.meta.env.DEV ? lazy(() => import('./ui/DevBoard')) : null

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
  const loc = useLocation()
  const next = encodeURIComponent(loc.pathname + loc.search)
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <DemoBar />
      <FlagBanner />
      <header className="top">
        <div className="top-in">
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>Markets</NavLink>
            {uid && me?.is_member && <NavLink to="/entries">My entries</NavLink>}
            {me?.is_admin && <NavLink to="/admin">Admin</NavLink>}
          </nav>
          {uid ? (
            <span className="who">
              {me?.display_name}
              <button className="btn ghost small" onClick={() => backend.signOut()}>
                Sign out
              </button>
            </span>
          ) : backend.mode === 'live' && !loc.pathname.startsWith('/auth') && (
            <span className="who">
              <Link className="btn ghost small" to={`/auth?next=${next}`}>Sign in</Link>
              <Link className="btn small" to={`/auth?mode=signup&next=${next}`}>Sign up</Link>
            </span>
          )}
        </div>
      </header>
    </>
  )
}

/** Joins automatically while sign-up is open (covers accounts created while the group was invite-only). */
function AutoJoin() {
  const { backend, uid, me, refreshMe } = useApp()
  useEffect(() => {
    if (uid && me && !me.is_member && me.open_signup) backend.rpc('join_open_group').then(refreshMe).catch(() => undefined)
  }, [uid, me, backend, refreshMe])
  return null
}

function NotMember() {
  const loc = useLocation()
  useEffect(() => {
    if (loc.pathname !== '/') rememberDestination(loc.pathname + loc.search)
  }, [loc])
  return (
    <main className="page" id="main">
      <h1>The group is invite-only right now</h1>
      <p>Ask the organizer for the invitation link and open it while signed in. You can keep browsing the markets meanwhile.</p>
      <p><Link to="/">Browse markets</Link></p>
    </main>
  )
}

/** Private pages (My entries, Admin) need an account in the group. Browsing doesn't. */
function Members({ children }: { children: React.ReactNode }) {
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
      <AutoJoin />
      {/* key resets every screen's state when the signed-in person changes */}
      <div key={uid ?? 'anon'}>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/join/:token" element={<JoinPage />} />
          {DevBoard && <Route path="/dev/board" element={<Suspense fallback={null}><DevBoard /></Suspense>} />}
          <Route path="/" element={<MarketsPage />} />
          <Route path="/m/:id" element={<MarketPage />} />
          <Route path="/propose" element={<ProposePage />} />
          <Route path="/entries" element={<Members><MyEntriesPage /></Members>} />
          <Route path="/admin" element={<Members><AdminPage /></Members>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <NinetiesFooter />
    </>
  )
}
