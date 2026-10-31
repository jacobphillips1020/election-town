// "Share my picks": your ballot as a fun map card. Download it as a PDF or image, or share it from your phone.
// Your picks are sealed in the app until the pool closes; this card is yours to share (or not) as you like.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp, useRpc } from '../data/context'
import { jpegPdf } from '../domain/pdf'
import { draftFromBallot, type Pool } from '../domain/pool'
import { senateR as impliedSenateR } from '../domain/senate'
import { currentDraft, pickedSides } from './Ballot'
import { CARD_H, CARD_W, cardSvg } from './cardSvg'
import { Err, Loading } from './common'

async function render(svg: string, type: 'image/png' | 'image/jpeg'): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error('Could not draw the card')); img.src = url })
    const canvas = document.createElement('canvas')
    canvas.width = CARD_W
    canvas.height = CARD_H
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, CARD_W, CARD_H)
    ctx.drawImage(img, 0, 0, CARD_W, CARD_H)
    return await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('Could not draw the card'))), type, 0.92))
  } finally {
    URL.revokeObjectURL(url)
  }
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** The masthead artwork as a data: URL, so it is embedded in the card (and in its PNG/PDF). */
function useBanner() {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    fetch('/banner.jpg').then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (!b) return
      const fr = new FileReader()
      fr.onload = () => live && setUrl(String(fr.result))
      fr.readAsDataURL(b)
    }).catch(() => undefined)
    return () => { live = false }
  }, [])
  return url
}

export function CardPage() {
  const { data, error, loading } = useRpc<Pool>('get_pool')
  if (loading && !data) return <Loading />
  if (!data) return <main className="page" id="main"><Err>{error ?? 'Could not load your picks.'}</Err></main>
  return <CardView pool={data} />
}

function CardView({ pool }: { pool: Pool }) {
  const { me, uid } = useApp()
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const submitted = !!pool.my_ballot && Object.keys(pool.my_ballot).length > 0
  // What's actually submitted; before the first submit, this browser's draft.
  const picks = useMemo(() => (submitted ? draftFromBallot(pool.my_ballot) : currentDraft(uid, null)?.draft ?? {}), [uid, pool.my_ballot, submitted])
  const sen = pool.markets.find((m) => m.kind === 'senate_seats')
  const house = pool.markets.find((m) => m.kind === 'house_seats')
  const num = (s?: string) => (s && /^\d{1,3}$/.test(s) ? +s : null)
  const senateR = num(sen && picks[sen.id]?.r) ?? impliedSenateR(pool.senate, pickedSides(pool.markets, picks))
  const houseR = num(house && picks[house.id]?.r)
  const name = me?.display_name ?? 'My'
  const banner = useBanner()
  const svg = useMemo(() => cardSvg({ name, pool, picks, senateR, houseR, banner }), [name, pool, picks, senateR, houseR, banner])
  const file = `election-town-picks-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const any = Object.values(picks).some((p) => p.winner)

  async function run(kind: string, f: () => Promise<void>) {
    setBusy(kind)
    setErr('')
    try { await f() } catch (e) { if ((e as Error)?.name !== 'AbortError') setErr(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy('') }
  }
  const pdf = () => run('pdf', async () => {
    const jpg = new Uint8Array(await (await render(svg, 'image/jpeg')).arrayBuffer())
    save(new Blob([jpegPdf(jpg, CARD_W, CARD_H) as BlobPart], { type: 'application/pdf' }), `${file}.pdf`)
  })
  const png = () => run('png', async () => save(await render(svg, 'image/png'), `${file}.png`))
  const canShareFiles = typeof navigator !== 'undefined' && 'canShare' in navigator
  const share = () => run('share', async () => {
    const f = new File([await render(svg, 'image/png')], `${file}.png`, { type: 'image/png' })
    if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: 'My 2026 midterm picks' })
    else save(f, f.name)
  })

  return (
    <main className="page" id="main">
      <p className="small"><Link to="/ballot">← My ballot</Link></p>
      <h1>Share my picks</h1>
      <p className="lede">
        Your picks, ready to send. No one can see them on the site until the pool closes.
      </p>
      {!submitted && <p className="callout warn">{any ? 'These picks aren’t submitted yet.' : 'Fill out your ballot first.'} <Link to="/ballot">Go to my ballot</Link></p>}
      <div className="card-actions row">
        <button className="btn" disabled={!!busy || !any} onClick={pdf}>{busy === 'pdf' ? 'Making PDF…' : 'Download PDF'}</button>
        <button className="btn ghost" disabled={!!busy || !any} onClick={png}>{busy === 'png' ? 'Drawing…' : 'Download image'}</button>
        {canShareFiles && <button className="btn ghost" disabled={!!busy || !any} onClick={share}>{busy === 'share' ? 'Opening…' : 'Share…'}</button>}
      </div>
      <Err>{err}</Err>
      <div className="card-preview" role="img" aria-label={`${name}'s picks card`} dangerouslySetInnerHTML={{ __html: svg }} />
    </main>
  )
}
