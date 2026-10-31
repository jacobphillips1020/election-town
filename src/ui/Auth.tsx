import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../data/context'
import { loginIdFor, normalizePhone, safeNext } from '../lib'
import { Err } from './common'

export function AuthPage() {
  const { backend, uid } = useApp()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>(params.get('mode') === 'signup' ? 'up' : 'in')
  const [phone, setPhone] = useState('')
  const [login, setLogin] = useState('')
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
      if (mode === 'in') {
        const id = loginIdFor(login)
        if (!id) throw new Error('Enter your mobile number (or the email you signed up with).')
        await backend.signIn(id, password)
      } else if (mode === 'up') {
        const phoneE164 = normalizePhone(phone)
        if (!name.trim()) throw new Error('Enter the name your friends will see.')
        if (!phoneE164) throw new Error('Enter a mobile number with area code.')
        if (password.length < 8) throw new Error('Use at least 8 characters for your password.')
        const r = await backend.signUp(loginIdFor(phoneE164)!, password, name.trim(), phoneE164)
        if (r.needsVerification) setInfo('Your account was created, but this project still requires email confirmation. Tell the organizer.')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      setError(/already registered/i.test(msg) ? 'That number already has an account. Sign in instead.'
        : /invalid login/i.test(msg) ? 'That number and password don’t match.' : msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page" id="main" style={{ maxWidth: '26rem' }}>
      <h1>{mode === 'up' ? 'Sign up to play' : mode === 'in' ? 'Sign in' : 'Forgot your password?'}</h1>
      {mode === 'up' && <p className="muted">A name your friends will see and a number the organizer can text. That&rsquo;s it.</p>}
      {mode === 'up' && next === '/ballot' && <p className="callout ok-callout">Your picks are saved. You&rsquo;ll be back on your ballot after this.</p>}
      {mode === 'forgot' ? (
        <p>Text the organizer and ask them to reset your password; they&rsquo;ll send you a temporary one.</p>
      ) : (
        <form onSubmit={submit} noValidate>
          {mode === 'up' ? (
            <>
              <div className="field">
                <label htmlFor="name">Your name</label>
                <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" maxLength={40} placeholder="e.g. Maya R." />
              </div>
              <div className="field">
                <label htmlFor="phone">Mobile number</label>
                <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="(312) 555-0123" />
                <p className="hint">You sign in with it. Only the organizer can see it.</p>
              </div>
            </>
          ) : (
            <div className="field">
              <label htmlFor="login">Mobile number (or email)</label>
              <input id="login" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" placeholder="(312) 555-0123" />
              <p className="hint">Signed up with an email address? Use that here.</p>
            </div>
          )}
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8}
              autoComplete={mode === 'up' ? 'new-password' : 'current-password'} />
            {mode === 'up' && <p className="hint">At least 8 characters.</p>}
          </div>
          <Err>{error}</Err>
          {info && <p className="ok" role="status">{info}</p>}
          <button className="btn" disabled={busy} style={{ width: '100%' }}>{mode === 'up' ? 'Create account' : 'Sign in'}</button>
        </form>
      )}
      <p className="small" style={{ marginTop: 16 }}>
        {mode === 'up' && <>Already have an account? <button className="btn ghost small" onClick={() => setMode('in')}>Sign in</button></>}
        {mode === 'in' && (
          <>
            New here? <button className="btn ghost small" onClick={() => setMode('up')}>Sign up</button>{' '}
            <button className="btn ghost small" onClick={() => setMode('forgot')}>Forgot password</button>
          </>
        )}
        {mode === 'forgot' && <button className="btn ghost small" onClick={() => setMode('in')}>Back to sign in</button>}
      </p>
    </main>
  )
}
