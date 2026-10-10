import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../data/context'
import { safeNext } from '../lib'
import { Err } from './common'

export function AuthPage() {
  const { backend, uid } = useApp()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in')
  const [phone, setPhone] = useState('')
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
        if (phone.replace(/\D/g, '').length < 10) throw new Error('Enter a phone number with area code.')
        const r = await backend.signUp(email.trim(), password, name.trim(), phone.trim())
        if (r.needsVerification) setInfo('Your account was created, but email confirmation is still switched on for this project. Ask the organizer to turn it off.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page" id="main" style={{ maxWidth: '28rem' }}>
      <h1>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create your account' : 'Forgot your password?'}</h1>
      {mode === 'forgot' ? (
        <p>
          Election Town doesn&rsquo;t send emails. Text the person who invited you and ask them to reset your password;
          they&rsquo;ll send you a temporary one.
        </p>
      ) : (
      <form onSubmit={submit} noValidate>
        {mode === 'up' && (
          <div className="field">
            <label htmlFor="name">Display name</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" maxLength={40} required />
            <p className="hint">Shown to the group. Your email and phone are never shown to other members.</p>
          </div>
        )}
        {mode === 'up' && (
          <div className="field">
            <label htmlFor="phone">Mobile phone</label>
            <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="(312) 555-0123" required />
            <p className="hint">Only the organizer sees this. It&rsquo;s how they reach you about payments and deadlines.</p>
          </div>
        )}
        <div className="field">
          <label htmlFor="email">{mode === 'up' ? 'Email (just your login name; we never email it)' : 'Email'}</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </div>
        {(
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
          {mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      )}
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
