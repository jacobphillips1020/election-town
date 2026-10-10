// The ballot: every main-pool pick on one page, with the polling and ratings next to each race.
// Picks are saved in this browser as you go, so you can close it and come back; submitting sends them
// all at once. You can change and resubmit until the pool closes.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccount, useAdminName, useApp, useRpc } from '../data/context'
import { formatET, usd } from '../domain/format'
import { RATINGS_LINKS, buildBallot, checkPick, draftFromBallot, isBlank, raceLinks, sideOf, type Draft, type Pool, type PoolMarket } from '../domain/pool'
import { HOUSE_2024_R, HOUSE_MAJORITY, SENATE_NOW_R, senateKey, senateR, type Side } from '../domain/senate'
import { Err, Loading } from './common'
import { Invite, PayNote } from './Invite'
import { Experts, Links, RacePick, RatingChip, SeatPick } from './Pick'
import { Balance } from './Balance'

// Unsubmitted picks are kept per person in this browser ("anon" before sign-up, carried over once signed up).
const KEY = (uid: string | null) => `et-ballot-draft-v3:${uid ?? 'anon'}`
type Saved = { draft: Draft; at: number }
const read = (k: string): Saved | null => {
  try { return JSON.parse(localStorage.getItem(k) ?? 'null') } catch { return null }
}
const saveLocal = (uid: string | null, draft: Draft | null) => {
  try { if (draft) localStorage.setItem(KEY(uid), JSON.stringify({ draft, at: Date.now() })); else localStorage.removeItem(KEY(uid)) } catch { /* private mode */ }
}

/** This person's unsubmitted draft, if it's newer than their submitted ballot. */
export function currentDraft(uid: string | null, submittedAt: string | null): Saved | null {
  const own = read(KEY(uid))
  const carried = uid && !own && !submittedAt ? read(KEY(null)) : null // filled out before signing up
  const d = own ?? carried
  if (!d) return null
  if (submittedAt && d.at <= Date.parse(submittedAt)) return null
  return d
}

/** Side picked in each featured Senate race, keyed like the Senate math ("OH*" for Ohio's special). */
export function pickedSides(markets: PoolMarket[], d: Draft): Record<string, Side> {
  const out: Record<string, Side> = {}
  for (const m of markets) {
    if (m.kind !== 'senate' || !m.polling_ref) continue
    const c = m.candidates.find((x) => x.id === d[m.id]?.winner)
    if (c) out[senateKey(m.polling_ref.state, m.polling_ref.special)] = sideOf(c)
  }
  return out
}

export function BallotPage() {
  const { data, error, loading, reload } = useRpc<Pool>('get_pool')
  if (loading && !data) return <Loading />
  if (!data) return <main className="page" id="main"><Err>{error ?? 'Could not load the ballot.'}</Err></main>
  return <BallotForm pool={data} reload={reload} />
}

function BallotForm({ pool, reload }: { pool: Pool; reload: () => void }) {
  const { backend, me, uid } = useApp()
  const account = useAccount()
  const admin = useAdminName()
  const nav = useNavigate()
  const server = useMemo(() => draftFromBallot(pool.my_ballot), [pool.my_ballot])
  const [draft, setDraft] = useState<Draft>(() => currentDraft(uid, pool.my_updated_at)?.draft ?? server)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const [tried, setTried] = useState(false)
  const firstBad = useRef<HTMLElement | null>(null)

  const open = !pool.closed && pool.markets.some((m) => m.phase === 'open')
  const races = pool.markets.filter((m) => m.kind === 'senate')
  const seatSen = pool.markets.find((m) => m.kind === 'senate_seats')
  const seatHouse = pool.markets.find((m) => m.kind === 'house_seats')
  const implied = senateR(pool.senate, pickedSides(pool.markets, draft))
  const pollsR = senateR(pool.senate)

  // The Senate seat pick follows your race picks until you set it yourself.
  const effective: Draft = useMemo(() => {
    if (!seatSen || draft[seatSen.id]?.touched) return draft
    return { ...draft, [seatSen.id]: { r: String(implied) } }
  }, [draft, seatSen, implied])

  const dirty = JSON.stringify(normalize(effective)) !== JSON.stringify(normalize(server))
  const { picks, problems, skipped } = buildBallot(pool.markets, effective)
  const count = pool.markets.filter((m) => m.phase === 'open').length
  const made = count - problems.length - skipped.length

  // Keep a draft only once something has actually been picked.
  const anyPick = Object.values(draft).some((p) => p.winner || (p.r ?? '').trim())
  useEffect(() => { if (open) saveLocal(uid, dirty && anyPick ? draft : null) }, [draft, dirty, anyPick, open, uid])

  const set = (id: string, v: Draft[string]) => { setDone(false); setDraft((d) => ({ ...d, [id]: v })) }

  async function submit() {
    setErr('')
    setTried(true)
    if (problems.length) {
      setErr(`${problems.length} ${problems.length === 1 ? 'pick needs' : 'picks need'} attention: ${problems.map((p) => p.m.title).join(', ')}.`)
      firstBad.current = document.getElementById(`pick-${problems[0].m.id}`)
      firstBad.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    if (made === 0) { setErr('Make at least one pick.'); return }
    if (skipped.length && !confirm(`${skipped.length === 1 ? 'One pick is' : `${skipped.length} picks are`} still blank: ${skipped.map(label).join(', ')}.\n\nThat's fine: submit now and fill ${skipped.length === 1 ? 'it' : 'them'} in any time before ${formatET(pool.deadline)}. Anything still blank at the close stays in the pot but can't win.\n\nSubmit what you have?`)) return
    if (!account.signedIn) { saveLocal(null, draft); nav(account.signupPath('/ballot')); return }
    if (!account.isMember) { setErr('The group is invite-only right now. Ask the organizer for the invitation link.'); return }
    setBusy(true)
    try {
      await backend.rpc('submit_ballot', { p_picks: picks })
      saveLocal(uid, null)
      saveLocal(null, null)
      setDone(true)
      reload()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not submit.')
    } finally {
      setBusy(false)
    }
  }

  async function withdraw() {
    if (!confirm('Withdraw your whole ballot? You can submit a new one until the pool closes.')) return
    setBusy(true)
    try {
      await backend.rpc('withdraw_ballot')
      saveLocal(uid, null)
      setDraft({})
      reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not withdraw.')
    } finally {
      setBusy(false)
    }
  }

  const submitted = !!pool.my_ballot && Object.keys(pool.my_ballot).length > 0
  const sen = pool.forecasts.senate
  const house = pool.forecasts.house

  return (
    <main className="page" id="main">
      <p className="small"><Link to="/">← The pool</Link></p>
      <h1>{submitted ? 'Your ballot' : 'Fill out your ballot'}</h1>
      <p className="lede">
        {count || 12} picks, {usd(pool.ballot_cents)} all in.{' '}
        {open ? <><b>Submit what you have now and come back to finish or change it any time</b> until {formatET(pool.deadline)}.
          {' '}Your picks also save in this browser as you go. A race still blank at the close stays in the pot (your {usd(pool.ballot_cents)}
          {' '}covers it), it just can&rsquo;t win.</>
          : <>The pool closed {formatET(pool.deadline)}.</>}
      </p>

      {done && (
        <div className="callout ok-callout" role="status">
          <strong>Ballot in. </strong>
          {skipped.length > 0 ? <>{skipped.length} still blank; come back and fill {skipped.length === 1 ? 'it' : 'them'} in any time. </> : null}
          You can change any pick until {formatET(pool.deadline)}; just come back to My Ballot.{' '}
          {pool.pay_note ? <>Next: <PayNote text={pool.pay_note} /></> : <>Pay {admin} {usd(pool.ballot_cents)} before the pool closes.</>}
          <div className="row" style={{ marginTop: 8 }}>
            <Link className="btn" to="/card">Share my picks</Link>
            <Link className="btn ghost" to="/">See the pool</Link>
          </div>
        </div>
      )}
      {done && <Invite pool={pool} submitted />}
      {!done && submitted && !dirty && open && (
        <p className="callout" role="status">
          Submitted{pool.my_updated_at && ` ${new Date(pool.my_updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}.
          {' '}{skipped.length > 0 && <b>{skipped.length} still blank. </b>}Change or fill in anything below and resubmit, as often as you like, until {formatET(pool.deadline)}. <Link to="/card">Share my picks</Link>
        </p>
      )}
      {submitted && dirty && open && <p className="callout warn" role="status">You have unsubmitted changes. Resubmit to save them.</p>}

      <p className="research">
        <span>Research:</span> Senate ratings <Links links={RATINGS_LINKS.senate} />
      </p>

      <h2 className="ballot-h">The Senate races that decide control</h2>
      <p className="hint" style={{ marginTop: -4 }}>
        Pick each winner and their two-way vote share. {races[0] ? usd(races[0].buy_in_cents ?? 0) : '$4'} per race:
        among those who pick the winner, the closest share takes that race&rsquo;s pot.
      </p>
      <div className="explain">
        <b>Two-way vote share</b> = the winner&rsquo;s votes ÷ the votes for the two candidates listed. Votes for anyone
        else don&rsquo;t count. So a race that ends <b>48% to 42%</b> with 10% for others is <b>53.3% to 46.7%</b> two-way.
        The polling on each race is converted the same way.
      </div>
      <ol className="ballot">
        {races.map((m, i) => {
          const bad = tried && !checkPick(m, effective[m.id]).ok
          const p = m.polling
          return (
            <li key={m.id} id={`pick-${m.id}`} className={`ballot-item${bad ? ' bad' : ''}`}>
              <div className="bi-head">
                <span className="bi-num">{i + 1}</span>
                <h3>{m.title}</h3>
                {p?.rating && <RatingChip rating={p.rating} prefix="Polls" />}
              </div>
              <div className="bi-meta">
                {p?.margin_label && <span><b>{p.margin_label}</b> in {p.poll_count} {p.poll_count === 1 ? 'poll' : 'polls'}</span>}
                <Experts experts={p?.experts} />
              </div>
              <RacePick m={m} polling={p} value={effective[m.id]} onChange={(v) => set(m.id, v)} disabled={!open} />
              <div className="bi-foot">
                <Links links={raceLinks(m, p?.page)} />
                <span className="bi-foot-r">
                  {open && !isBlank(m, effective[m.id]) && <button type="button" className="linklike small" onClick={() => set(m.id, {})}>Clear pick</button>}
                  <Link className="small" to={`/m/${m.id}`}>Rules & details</Link>
                </span>
              </div>
              {bad && <p className="err small">{(checkPick(m, effective[m.id]) as { reason: string }).reason}</p>}
            </li>
          )
        })}
      </ol>

      <h2 className="ballot-h">Seats</h2>
      <p className="hint" style={{ marginTop: -4 }}>
        How many seats will Republicans hold? {seatSen ? usd(seatSen.buy_in_cents ?? 0) : '$5'} each: the closest guess takes the pot.
        <> House ratings <Links links={RATINGS_LINKS.house} /></>
      </p>
      <ol className="ballot" start={races.length + 1}>
        {seatSen && (
          <li id={`pick-${seatSen.id}`} className={`ballot-item${tried && !checkPick(seatSen, effective[seatSen.id]).ok ? ' bad' : ''}`}>
            <div className="bi-head"><span className="bi-num">{races.length + 1}</span><h3>Senate: Republican seats</h3></div>
            <p className="implied">
              Your race picks add up to <b>{implied} Republican seats</b>
              {draft[seatSen.id]?.touched
                ? <> · <button type="button" className="linklike" disabled={!open} onClick={() => set(seatSen.id, { r: String(implied) })}>use {implied}</button></>
                : <> (31 not up this year, the other races as polled, plus your {races.length}). Set your own number if you think otherwise.</>}
            </p>
            <SeatPick id={seatSen.id} chamber="senate" min={35} max={65} disabled={!open} value={effective[seatSen.id]?.r}
              onChange={(r) => set(seatSen.id, { r, touched: true })} />
            <Balance total={100} line={50} lineLabel="50 keeps R control" rows={[
              { label: 'Now', r: SENATE_NOW_R },
              { label: 'Polls', r: pollsR },
              { label: 'Markets', r: sen?.r_median ?? null, note: sen?.d_control_pct != null ? `Dems ${Math.round(sen.d_control_pct)}% to win` : undefined },
              { label: 'You', r: checkPick(seatSen, effective[seatSen.id]).ok ? +effective[seatSen.id]!.r! : null, strong: true },
            ]} />
          </li>
        )}
        {seatHouse && (
          <li id={`pick-${seatHouse.id}`} className={`ballot-item${tried && !checkPick(seatHouse, effective[seatHouse.id]).ok ? ' bad' : ''}`}>
            <div className="bi-head"><span className="bi-num">{races.length + 2}</span><h3>House: Republican seats</h3></div>
            <p className="implied">
              Republicans won {HOUSE_2024_R} in 2024; {HOUSE_MAJORITY} is a majority.
              {house?.r_median != null && <> Betting markets put them near <b>{Math.round(house.r_median)}</b>.</>}
            </p>
            <SeatPick id={seatHouse.id} chamber="house" min={170} max={260} disabled={!open} value={effective[seatHouse.id]?.r}
              onChange={(r) => set(seatHouse.id, { r, touched: true })} />
            {open && !isBlank(seatHouse, effective[seatHouse.id]) && <button type="button" className="linklike small" onClick={() => set(seatHouse.id, { r: '', touched: true })}>Clear pick</button>}
            <Balance total={435} line={HOUSE_MAJORITY} lineLabel="218 for a majority" rows={[
              { label: '2024', r: HOUSE_2024_R },
              { label: 'Markets', r: house?.r_median ?? null, note: house?.d_control_pct != null ? `Dems ${Math.round(house.d_control_pct)}% to win` : undefined },
              { label: 'You', r: checkPick(seatHouse, effective[seatHouse.id]).ok ? +effective[seatHouse.id]!.r! : null, strong: true },
            ]} />
          </li>
        )}
      </ol>
      <p className="board-source">
        Polling: PollingSource averages. Race ratings: Cook, Inside Elections and Sabato, as compiled on Wikipedia. Markets: Polymarket seat prices (median).
        Two-way share = votes for the two listed candidates only.
      </p>

      {open && (
        <div className="submitbar">
          <div className="submitbar-in">
            <span className="submit-count"><span><b>{made}</b> of {count} picked{skipped.length > 0 && ` · ${skipped.length} blank`}{dirty && submitted ? ' · unsaved changes' : ''}</span>
              <span className="submit-sub">Editable until {formatET(pool.deadline)}</span></span>
            <Err>{err}</Err>
            <button type="button" className="btn submit" disabled={busy || (submitted && !dirty)} onClick={submit}>
              {busy ? 'Saving…' : !account.signedIn ? `Sign up to submit · ${usd(pool.ballot_cents)}` : submitted ? (dirty ? 'Save changes' : 'Submitted ✓') : skipped.length ? `Submit what I have · ${usd(pool.ballot_cents)}` : `Submit ballot · ${usd(pool.ballot_cents)}`}
            </button>
          </div>
        </div>
      )}
      {open && submitted && (
        <p style={{ marginTop: 16 }}><button type="button" className="linklike danger-link" disabled={busy} onClick={withdraw}>Withdraw my ballot</button></p>
      )}
      {!me && open && <p className="hint">You can fill this out now. Signing up (name, mobile, password) is only needed to submit; your picks are kept.</p>}
    </main>
  )
}

const label = (m: PoolMarket) => (m.kind === 'senate_seats' ? 'Senate seats' : m.kind === 'house_seats' ? 'House seats' : m.title)

/** Compare drafts by meaning, not by how they were typed. */
function normalize(d: Draft) {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(d)) {
    if (v.r !== undefined) { if ((v.r ?? '').trim()) out[k] = `r${v.r.trim()}` }
    else if (v.winner) out[k] = `${v.winner}:${parseFloat(v.share ?? '').toFixed(1)}`
  }
  return Object.fromEntries(Object.entries(out).sort())
}

