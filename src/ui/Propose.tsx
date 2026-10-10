import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAccount, useAdminName, useApp, useRpc } from '../data/context'
import { boardKey, type BoardRace } from '../domain/board'
import { refreshBoardApi, refreshMarket } from '../polling/client'
import { Loading } from './common'
import { RaceBoard } from './RaceBoard'

/** The only input is the race. Everything else is derived by the system (propose_race in the database). */
export function ProposePage() {
  const { backend } = useApp()
  const admin = useAdminName()
  const nav = useNavigate()
  const board = useRpc<BoardRace[]>('race_board')
  const [proposing, setProposing] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const account = useAccount()
  const [params] = useSearchParams()

  // Keep the board current: the server refreshes it at most every 12 hours, for everyone.
  useEffect(() => {
    if (backend.mode !== 'live' || !account.isMember) return
    setRefreshing(true)
    refreshBoardApi(backend).then((r) => { if (r?.status === 'refreshed') board.reload() }).finally(() => setRefreshing(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, account.isMember])

  async function propose(r: BoardRace) {
    if (!account.signedIn) return nav(account.signupPath('/propose'))
    if (!account.isMember) return setError('The group is invite-only right now. Ask the organizer for the invitation link.')
    setProposing(boardKey(r))
    setError('')
    try {
      const id = await backend.rpc<string>('propose_race', {
        p_race_type: r.race_type, p_state: r.state, p_district: r.district, p_special: r.special,
      })
      // Polling for the new market starts right away (bounded wait; the market page retries on open).
      await Promise.race([refreshMarket(backend, id), new Promise((res) => setTimeout(res, 6000))])
      nav(`/m/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the proposal.')
      setProposing(null)
    }
  }

  const races = board.data ?? []
  const anyPolling = races.some((r) => r.polling)
  const note = backend.mode === 'demo'
    ? 'Demo mode: live polling isn’t loaded here, so races show without averages. Search to pick one.'
    : !anyPolling ? (refreshing ? 'Loading the latest polling…' : 'Polling hasn’t loaded yet. Search to pick a race.') : undefined

  return (
    <main className="page" id="main">
      <h1>Propose a race</h1>
      <p className="muted" style={{ maxWidth: '36rem' }}>
        Pick a race to add to the pool. Candidates, polling and settlement rules fill in automatically;
        {' '}{admin} approves it and sets the buy-in and entry deadline.
      </p>
      {board.loading && !board.data ? <Loading /> : (
        <RaceBoard races={races} adminName={admin} onPropose={propose} proposing={proposing} error={error || board.error || ''} note={note} initialQuery={params.get('q') ?? ''} />
      )}
    </main>
  )
}
