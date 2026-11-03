// The ballot: every main-pool pick on one page, with the polling and ratings next to each race.
// Picks are saved in this browser as you go, so you can close it and come back; submitting sends them
// all at once. You can change and resubmit until the pool closes.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccount, useAdminName, useApp, useRpc } from '../data/context'
import { formatET, usd } from '../domain/format'
import { RATINGS_LINKS, buildBallot, checkPick, draftFromBallot, isBlank, raceLinks, sideOf, type Draft, type Pool, type PoolMarket, type Tier } from '../domain/pool'
import { HOUSE_2024_R, HOUSE_MAJORITY, SENATE_NOW_R, impliedSenateR, senateKey, senateR, type Side } from '../domain/senate'
import { Err, Loading } from './common'
import { Invite, PayNote } from './Invite'
import { Experts, Links, RacePick, SeatPick } from './Pick'
import { Balance } from './Balance'

// Unsubmitted picks are kept per person in this browser ("anon" before sign-up, carried over once signed up).
const KEY = (uid: string | null) => `et-ballot-draft-v3:${uid ?? 'anon'}`
type Saved = { draft: Draft; at: number; tier?: Tier }
const read = (k: string): Saved | null => {
  try { return JSON.parse(localStorage.getItem(k) ?? 'null') } catch { return null }
}
const saveLocal = (uid: string | null, draft: Draft | null, tier?: Tier) => {
  try { if (draft) localStorage.setItem(KEY(uid), JSON.stringify({ draft, at: Date.now(), tier })); else localStorage.removeItem(KEY(uid)) } catch { /* private mode */ }
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
  const serverTier: Tier = pool.my_tier ?? 'full'
  const [tier, setTier] = useState<Tier>(() => currentDraft(uid, pool.my_updated_at)?.tier ?? serverTier)
  const price = tier === 'half' ? pool.half_ballot_cents : pool.ballot_cents
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const [tried, setTried] = useState(false)
  const firstBad = useRef<HTMLElement | null>(null)

  const open = !pool.closed && pool.markets.some((m) => m.phase === 'open')
  const races = pool.markets.filter((m) => m.kind === 'senate')
  const seatSen = pool.markets.find((m) => m.kind === 'senate_seats')
  const seatHouse = pool.markets.find((m) => m.kind === 'house_seats')
  const sides = pickedSides(pool.markets, draft)
  const implied = impliedSenateR(pool.senate, sides)
  const racesPicked = Object.keys(sides).length
  const pollsR = senateR(pool.senate)

  // The Senate seat pick follows your race picks until you set it yourself.
  const effective: Draft = useMemo(() => {
    if (!seatSen || draft[seatSen.id]?.touched) return draft
    return { ...draft, [seatSen.id]: { r: String(implied) } }
  }, [draft, seatSen, implied])

  const dirty = JSON.stringify(normalize(effective)) !== JSON.stringify(normalize(server)) || (!!pool.my_ballot && tier !== serverTier)
  const { picks, problems, skipped } = buildBallot(pool.markets, effective)
  const count = pool.markets.filter((m) => m.phase === 'open').length
  const made = count - problems.length - skipped.length

  // Keep a draft only once something has actually been picked.
  const anyPick = Object.values(draft).some((p) => p.winner || (p.r ?? '').trim())
  useEffect(() => { if (open) saveLocal(uid, dirty && anyPick ? draft : null, tier) }, [draft, dirty, anyPick, open, uid, tier])

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
    if (skipped.length && !confirm(`Still blank: ${skipped.map(label).join(', ')}.\n\nSubmit anyway? You can fill ${skipped.length === 1 ? 'it' : 'them'} in later. Anything blank at the close still pays in but can't win.`)) return
    if (!account.signedIn) { saveLocal(null, draft, tier); nav(account.signupPath('/ballot')); return }
    if (!account.isMember) { setErr('The group is invite-only right now. Ask the organizer for the invitation link.'); return }
    setBusy(true)
    try {
      await backend.rpc('submit_ballot', { p_picks: picks, p_tier: tier })
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

  const stamp = pool.my_updated_at ? new Date(pool.my_updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null
  const youR = (m: PoolMarket | undefined) => (m && checkPick(m, effective[m.id]).ok ? +effective[m.id]!.r! : null)

  return (
    <main className="page" id="main">
      <p className="small"><Link to="/">← The pool</Link></p>
      <h1>{submitted ? 'Your ballot' : 'Fill out your ballot'}</h1>
      <p className="lede">
        {open ? <>{count || 12} picks. Change them as often as you like until {formatET(pool.deadline)}.</> : <>The pool closed {formatET(pool.deadline)}.</>}
      </p>

      <fieldset className="tiers" disabled={!open}>
        <legend>Your buy-in</legend>
        <label className={`tier${tier === 'half' ? ' on' : ''}`}>
          <input type="radio" name="tier" value="half" checked={tier === 'half'} onChange={() => { setDone(false); setTier('half') }} />
          <span className="tier-price">{usd(pool.half_ballot_cents)}</span>
          <span className="tier-desc">Half stakes on every pick</span>
        </label>
        <label className={`tier${tier === 'full' ? ' on' : ''}`}>
          <input type="radio" name="tier" value="full" checked={tier === 'full'} onChange={() => { setDone(false); setTier('full') }} />
          <span className="tier-price">{usd(pool.ballot_cents)}</span>
          <span className="tier-desc">Full stakes: win up to twice as much</span>
        </label>
        <p className="tiers-how">Everyone plays for the first half of each pot. Only {usd(pool.ballot_cents)} ballots play for the second half.</p>
      </fieldset>

      <details className="how">
        <summary>How it works</summary>
        <ul>
          <li>Pick each winner and their <b>two-way vote share</b>: their votes divided by the votes for the two listed candidates. A race that ends 48&ndash;42 with 10% for others is 53.3&ndash;46.7.</li>
          <li>Right winner first; then the closest share takes that race&rsquo;s pot. For seats, the closest guess wins.</li>
          <li>Leave a race blank and your money still goes in. You just can&rsquo;t win that one.</li>
          <li>No one sees anyone&rsquo;s picks until the pool closes.</li>
          <li>Ratings: Senate <Links links={RATINGS_LINKS.senate} /> · House <Links links={RATINGS_LINKS.house} /></li>
        </ul>
      </details>

      {done && (
        <div className="callout ok-callout" role="status">
          <strong>You&rsquo;re in ({usd(price)}).</strong>{' '}
          {skipped.length > 0 && <>{skipped.length} still blank. </>}
          {pool.pay_note ? <PayNote text={pool.pay_note} /> : <>Pay {admin} before the pool closes.</>}
          <div className="row" style={{ marginTop: 8 }}>
            <Link className="btn" to="/card">Share my picks</Link>
            <Link className="btn ghost" to="/">See the pool</Link>
          </div>
        </div>
      )}
      {done && <Invite pool={pool} submitted />}

      <h2 className="ballot-h">Senate races</h2>
      <ol className="ballot">
        {races.map((m, i) => {
          const bad = tried && !checkPick(m, effective[m.id]).ok
          const p = m.polling
          return (
            <li key={m.id} id={`pick-${m.id}`} className={`ballot-item${bad ? ' bad' : ''}`}>
              <div className="bi-head">
                <span className="bi-num">{i + 1}</span>
                <h3>{m.title}</h3>
              </div>
              <div className="bi-meta">
                {p?.margin_label && <span><b>{p.margin_label}</b> · {p.poll_count} {p.poll_count === 1 ? 'poll' : 'polls'}</span>}
                <Experts experts={p?.experts} />
              </div>
              <RacePick m={m} polling={p} value={effective[m.id]} onChange={(v) => set(m.id, v)} disabled={!open} />
              <div className="bi-foot">
                <Links links={raceLinks(m, p?.page)} />
                <span className="bi-foot-r">
                  {open && !isBlank(m, effective[m.id]) && <button type="button" className="linklike small" onClick={() => set(m.id, {})}>Clear</button>}
                  <Link className="small" to={`/m/${m.id}`}>Rules</Link>
                </span>
              </div>
              {bad && <p className="err small">{(checkPick(m, effective[m.id]) as { reason: string }).reason}</p>}
            </li>
          )
        })}
      </ol>

      <h2 className="ballot-h">Republican seats</h2>
      <ol className="ballot" start={races.length + 1}>
        {seatSen && (
          <li id={`pick-${seatSen.id}`} className={`ballot-item${tried && !checkPick(seatSen, effective[seatSen.id]).ok ? ' bad' : ''}`}>
            <div className="bi-head"><span className="bi-num">{races.length + 1}</span><h3>Senate</h3></div>
            <p className="implied">
              {racesPicked === 0
                ? <>Republicans hold <b>{implied}</b> today. Your race picks will move this.</>
                : <>Your race picks add up to <b>{implied}</b>. This assumes Kansas and South Carolina stay Republican, and there are no other upsets.</>}{' '}
              {draft[seatSen.id]?.touched && +(effective[seatSen.id]?.r ?? '') !== implied
                ? <button type="button" className="linklike" disabled={!open} onClick={() => set(seatSen.id, { r: String(implied) })}>Use {implied}</button>
                : null}
            </p>
            <SeatPick id={seatSen.id} chamber="senate" min={35} max={65} disabled={!open} value={effective[seatSen.id]?.r}
              onChange={(r) => set(seatSen.id, { r, touched: true })} />
            <Balance total={100} line={50} lineLabel="50 keeps R control" rows={[
              { label: 'Now', r: SENATE_NOW_R },
              { label: 'Polls', r: pollsR },
              { label: 'Markets', r: sen?.r_median ?? null, note: sen?.d_control_pct != null ? `Dems ${Math.round(sen.d_control_pct)}% to win` : undefined },
              { label: 'You', r: youR(seatSen), strong: true },
            ]} />
          </li>
        )}
        {seatHouse && (
          <li id={`pick-${seatHouse.id}`} className={`ballot-item${tried && !checkPick(seatHouse, effective[seatHouse.id]).ok ? ' bad' : ''}`}>
            <div className="bi-head"><span className="bi-num">{races.length + 2}</span><h3>House</h3></div>
            <p className="implied">
              Republicans won {HOUSE_2024_R} in 2024. {HOUSE_MAJORITY} is a majority.
              {house?.r_median != null && <> Markets say about {Math.round(house.r_median)}.</>}
            </p>
            <SeatPick id={seatHouse.id} chamber="house" min={170} max={260} disabled={!open} value={effective[seatHouse.id]?.r}
              onChange={(r) => set(seatHouse.id, { r, touched: true })} />
            {open && !isBlank(seatHouse, effective[seatHouse.id]) && <button type="button" className="linklike small" onClick={() => set(seatHouse.id, { r: '', touched: true })}>Clear</button>}
            <Balance total={435} line={HOUSE_MAJORITY} lineLabel="218 for a majority" rows={[
              { label: '2024', r: HOUSE_2024_R },
              { label: 'Markets', r: house?.r_median ?? null, note: house?.d_control_pct != null ? `Dems ${Math.round(house.d_control_pct)}% to win` : undefined },
              { label: 'You', r: youR(seatHouse), strong: true },
            ]} />
          </li>
        )}
      </ol>
      <p className="board-source">Sources: polls from PollingSource, ratings via Wikipedia, seat odds from Polymarket.</p>

      {open && submitted && (
        <p style={{ marginTop: 16 }}><button type="button" className="linklike danger-link" disabled={busy} onClick={withdraw}>Withdraw my ballot</button></p>
      )}
      {!me && open && <p className="hint">No account needed to fill it out. You&rsquo;ll sign up when you submit, and your picks are kept.</p>}

      {open && (
        <div className="submitbar">
          <Err>{err}</Err>
          <div className="submitbar-in">
            <span className="submit-count">
              {submitted && !dirty ? <>Submitted{stamp && ` ${stamp}`} ✓</> : <><b>{made}</b>/{count} picked</>}
              {skipped.length > 0 && <span className="muted"> · {skipped.length} blank</span>}
            </span>
            <button type="button" className="btn submit" disabled={busy || (submitted && !dirty)} onClick={submit}>
              {busy ? 'Saving…' : !account.signedIn ? `Sign up to submit · ${usd(price)}` : submitted ? (dirty ? `Save · ${usd(price)}` : 'Saved') : `Submit · ${usd(price)}`}
            </button>
          </div>
        </div>
      )}
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

