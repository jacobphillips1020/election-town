import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../data/context'
import { safeNext } from '../lib'
import { Err } from './common'

export function AuthPage() {
  const { backend, uid } = useApp()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  if (uid) return <Navigate to={next} replace />

  if (backend.mode === 'demo') {
    return (
      <main className="page" id="main">
        <h1>Choose a demo person</h1>
        <p className="muted">
          Demo mode has no real accounts. Pick who you want to act as; you can switch any time from the yellow bar.
        </p>
        <ul className="mlist">
          {backend.personas!.map((p) => (
            <li key={p.id}>
              <button className="mrow btn ghost" style={{ width: '100%', textAlign: 'left', border: 0 }} onClick={() => backend.actAs!(p.id)}>
                <span className="mrow-title">{p.name}</span>
                <span className="muted"> — {p.note}</span>
              </button>
            </li>
          ))}
        </ul>
      </main>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setInfo('')
    try {
      if (mode === 'in') await backend.signIn(email.trim(), password)
      else if (mode === 'up') {
        if (!name.trim()) throw new Error('Enter the name your friends will see.')
        const r = await backend.signUp(email.trim(), password, name.trim(), next)
        if (r.needsVerification) setInfo('Check your email and open the verification link to finish signing up.')
      } else {
        await backend.sendReset(email.trim())
        setInfo('If that email has an account, a reset link is on its way.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page" id="main" style={{ maxWidth: '28rem' }}>
      <h1>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create your account' : 'Reset your password'}</h1>
      <form onSubmit={submit} noValidate>
        {mode === 'up' && (
          <div className="field">
            <label htmlFor="name">Display name</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" maxLength={40} required />
            <p className="hint">Shown to the group. Your email is never shown.</p>
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </div>
        {mode !== 'forgot' && (
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8}
              autoComplete={mode === 'up' ? 'new-password' : 'current-password'} required />
            {mode === 'up' && <p className="hint">At least 8 characters.</p>}
          </div>
        )}
        <Err>{error}</Err>
        {info && <p className="ok" role="status">{info}</p>}
        <button className="btn" disabled={busy}>
          {mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}
        </button>
      </form>
      <p className="small" style={{ marginTop: 16 }}>
        {mode !== 'in' && <button className="btn ghost small" onClick={() => setMode('in')}>Back to sign in</button>}{' '}
        {mode === 'in' && (
          <>
            <button className="btn ghost small" onClick={() => setMode('up')}>Create account</button>{' '}
            <button className="btn ghost small" onClick={() => setMode('forgot')}>Forgot password</button>
          </>
        )}
      </p>
    </main>
  )
}

/** Landing page for email-verification links. The Supabase client exchanges the code automatically. */
export function CallbackPage() {
  const { uid } = useApp()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (uid) nav(safeNext(params.get('next')), { replace: true })
  }, [uid, nav, params])
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 6000)
    return () => clearTimeout(t)
  }, [])
  return (
    <main className="page" id="main">
      <p>Signing you in…</p>
      {slow && (
        <p className="muted">
          That is taking a while. <Link to="/auth">Go to sign in</Link>.
        </p>
      )}
    </main>
  )
}

export function ResetPage() {
  const { backend, uid } = useApp()
  const nav = useNavigate()
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      await backend.setPassword(pw)
      nav('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the password.')
    }
  }
  if (!uid)
    return (
      <main className="page" id="main">
        <p>Open the reset link from your email to choose a new password.</p>
      </main>
    )
  return (
    <main className="page" id="main" style={{ maxWidth: '28rem' }}>
      <h1>Choose a new password</h1>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="npw">New password</label>
          <input id="npw" type="password" value={pw} minLength={8} autoComplete="new-password" onChange={(e) => setPw(e.target.value)} required />
        </div>
        <Err>{error}</Err>
        <button className="btn">Save password</button>
      </form>
    </main>
  )
}
