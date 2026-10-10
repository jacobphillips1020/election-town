import { lazy, Suspense, useEffect } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppProvider, useApp } from './data/context'
import { rememberDestination } from './lib'
import { AuthPage } from './ui/Auth'
import { JoinPage } from './ui/Join'
import { Loading } from './ui/common'
import { HomePage } from './ui/Home'
import { BallotPage } from './ui/Ballot'
import { CardPage } from './ui/Card'
import { SideBetsPage } from './ui/SideBets'
import { MarketPage } from './ui/MarketDetail'
import { OpenMarketPage } from './ui/OpenMarket'
import { MyEntriesPage } from './ui/MyEntries'
import { Masthead, NinetiesFooter } from './ui/FlagBanner'
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
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <DemoBar />
      <Masthead />
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
      <p>Ask the organizer for the invitation link and open it while signed in. You can keep browsing meanwhile.</p>
      <p><Link to="/">See the pool</Link></p>
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
          <Route path="/" element={<HomePage />} />
          <Route path="/ballot" element={<BallotPage />} />
          <Route path="/card" element={<CardPage />} />
          <Route path="/side" element={<SideBetsPage />} />
          <Route path="/m/:id" element={<MarketPage />} />
          <Route path="/open" element={<OpenMarketPage />} />
          <Route path="/propose" element={<Navigate to="/open" replace />} />
          <Route path="/entries" element={<Members><MyEntriesPage /></Members>} />
          <Route path="/admin" element={<Members><AdminPage /></Members>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <NinetiesFooter />
    </>
  )
}
