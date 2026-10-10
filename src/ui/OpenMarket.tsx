import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAccount, useApp, useRpc } from '../data/context'
import { boardKey, type BoardRace } from '../domain/board'
import { refreshBoardApi, refreshMarket } from '../polling/client'
import { Loading } from './common'
import { RaceBoard } from './RaceBoard'

/** Pick a race, open its market, place your bet. Everything else comes from the data (launch_race in the database). */
export function OpenMarketPage() {
  const { backend, me } = useApp()
  const nav = useNavigate()
  const board = useRpc<BoardRace[]>('race_board')
  const account = useAccount()
  const [params] = useSearchParams()
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  // Keep the board current: the server refreshes it at most every 12 hours, for everyone.
  useEffect(() => {
    if (backend.mode !== 'live' || !account.isMember) return
    setRefreshing(true)
    refreshBoardApi(backend).then((r) => { if (r?.status === 'refreshed') board.reload() }).finally(() => setRefreshing(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, account.isMember])

  async function openMarket(r: BoardRace) {
    if (!account.signedIn) return nav(account.signupPath(`/open?q=${encodeURIComponent(`${r.state} ${r.race_type} ${r.district ?? ''}`.trim())}`))
    if (!account.isMember) return setError('The group is invite-only right now. Ask the organizer for the invitation link.')
    setOpening(boardKey(r))
    setError('')
    try {
      const id = await backend.rpc<string>('launch_race', {
        p_race_type: r.race_type, p_state: r.state, p_district: r.district, p_special: r.special,
      })
      // Store this race's polling snapshot right away (bounded wait; the market page retries on open).
      await Promise.race([refreshMarket(backend, id), new Promise((res) => setTimeout(res, 4000))])
      nav(`/m/${id}?new=1`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the market.')
      setOpening(null)
    }
  }

  const races = board.data ?? []
  const anyPolling = races.some((r) => r.polling)
  const note = backend.mode === 'demo'
    ? 'Demo mode: live polling isn’t loaded here, so races show without averages.'
    : !anyPolling ? (refreshing ? 'Loading the latest polling…' : 'Polling hasn’t loaded yet.') : undefined
  const buyIn = me?.group ? `$${me.group.default_buy_in_cents / 100}` : 'a fixed'

  return (
    <main className="page" id="main">
      <h1>Open a market</h1>
      <p className="muted" style={{ maxWidth: '38rem' }}>
        Pick a race, open its market, and place your bet. The candidates, polling, rules, {buyIn} buy-in and closing time
        are all set for you. You can change your pick until entries close.
      </p>
      {board.loading && !board.data ? <Loading /> : (
        <RaceBoard races={races} onOpen={openMarket} opening={opening} error={error || board.error || ''}
          note={note} initialQuery={params.get('q') ?? ''} />
      )}
    </main>
  )
}
