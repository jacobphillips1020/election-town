import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useApp } from '../data/context'
import { takeDestination } from '../lib'
import { Err } from './common'

export function JoinPage() {
  const { token } = useParams()
  const { backend, uid, me, refreshMe } = useApp()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Authentication is required; the invitation link is kept through sign-in via ?next=.
  if (!uid) return <Navigate to={`/auth?next=${encodeURIComponent(`/join/${token}`)}`} replace />
  if (me?.is_member)
    return (
      <main className="page" id="main">
        <h1>You&rsquo;re already in</h1>
        <button className="btn" onClick={() => nav(takeDestination())}>Go to markets</button>
      </main>
    )

  async function join() {
    setBusy(true)
    setError('')
    try {
      await backend.rpc('redeem_invite', { p_token: token })
      refreshMe()
      nav(takeDestination(), { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page" id="main" style={{ maxWidth: '28rem' }}>
      <h1>Join the Election Town group</h1>
      <p>You&rsquo;ll be able to enter predictions on the November 2026 races and see the group&rsquo;s picks once entries close.</p>
      <Err>{error}</Err>
      <button className="btn" onClick={join} disabled={busy}>Join the group</button>
    </main>
  )
}
