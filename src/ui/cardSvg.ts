// The shareable "my picks" card: a self-contained SVG (system fonts only, so it also renders to PNG/PDF).
// Late-90s campaign-flyer energy: navy masthead, gold stars, flag stripes, tile map of the picks.
import { lastName } from '../domain/board'
import { NO_RACE, inkOn, levelFromMargin, levelFromPick, sideOf, tone, type Draft, type Pool } from '../domain/pool'
import { HELD_BY, HOUSE_MAJORITY, SENATE_CONTROL_R, leftSide, senateKey } from '../domain/senate'
import { TILES } from '../domain/tiles'

export const CARD_W = 1200
export const CARD_H = 1560

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const SERIF = "Georgia, 'Times New Roman', serif"
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"

function star(cx: number, cy: number, r: number, fill: string) {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2
    const rr = i % 2 ? r * 0.42 : r
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`
  })
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`
}

/** banner: the site's masthead artwork as a data: URL (so it survives the trip to PNG/PDF); text masthead if absent. */
export type CardInput = { name: string; pool: Pool; picks: Draft; senateR: number | null; houseR: number | null; banner?: string | null }

export function cardSvg({ name, pool, picks, senateR, houseR, banner }: CardInput): string {
  const W = CARD_W, H = CARD_H
  const featured = new Map(pool.markets.filter((m) => m.kind === 'senate').map((m) => [senateKey(m.polling_ref!.state, m.polling_ref!.special), m]))
  const out: string[] = []
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`)
  // paper + flag-stripe frame
  out.push(`<rect width="${W}" height="${H}" fill="#b22234"/>`)
  out.push(`<rect x="10" y="10" width="${W - 20}" height="${H - 20}" fill="#fff"/>`)
  out.push(`<rect x="20" y="20" width="${W - 40}" height="${H - 40}" fill="#b22234"/>`)
  out.push(`<rect x="30" y="30" width="${W - 60}" height="${H - 60}" fill="#faf7f0"/>`)
  // masthead: the banner artwork (or a text version), then the owner's name on a navy band
  out.push(`<rect x="30" y="30" width="${W - 60}" height="232" fill="#0b1a3d"/>`)
  if (banner) {
    out.push(`<image href="${banner}" x="30" y="30" width="${W - 60}" height="${Math.round((W - 60) * 302 / 1858)}" preserveAspectRatio="xMidYMid slice"/>`)
  } else {
    for (let i = 0; i < 13; i++) out.push(star(90 + i * 85, 66, 13, '#c9a227'))
    out.push(`<text x="${W / 2}" y="150" text-anchor="middle" font-family="${SERIF}" font-size="72" font-weight="700" fill="#fff" letter-spacing="6">ELECTION TOWN</text>`)
  }
  out.push(`<text x="${W / 2}" y="${banner ? 250 : 214}" text-anchor="middle" font-family="${SERIF}" font-style="italic" font-size="40" fill="#f3d77a">${esc(name)}&#8217;s 2026 Midterm Picks</text>`)
  out.push(`<rect x="30" y="262" width="${W - 60}" height="6" fill="#c9a227"/>`)

  // map
  const CELL = 96, SIZE = 88, X0 = (W - 11 * CELL) / 2 + 4, Y0 = 306
  for (const [st, [c, r]] of Object.entries(TILES)) {
    const x = X0 + c * CELL, y = Y0 + r * CELL
    const row = pool.senate.find((s) => s.state === st)
    let fill = NO_RACE, top = '', mid = '', bold = false
    if (row) {
      const k = senateKey(row.state, row.special)
      const m = featured.get(k)
      const d = m ? picks[m.id] : undefined
      const cand = m?.candidates.find((x) => x.id === d?.winner)
      const share = parseFloat(d?.share ?? '')
      if (m && cand && share > 50) {
        fill = tone(sideOf(cand), levelFromPick(share)); top = lastName(cand.name, cand.name); mid = share.toFixed(1); bold = true
      } else {
        const p = row.polling
        if (p?.dem_avg != null && p.rep_avg != null) {
          const margin = p.dem_avg - p.rep_avg
          const lvl = levelFromMargin(margin)
          fill = tone(lvl ? (margin >= 0 ? leftSide(st) : 'R') : null, lvl)
        } else fill = tone(HELD_BY[k] === 'D' ? 'D' : 'R', 3)
      }
    }
    const ink = row ? inkOn(fill) : '#9a937f'
    out.push(`<rect x="${x}" y="${y}" width="${SIZE}" height="${SIZE}" rx="8" fill="${fill}"${bold ? ' stroke="#16181d" stroke-width="4"' : ''}/>`)
    if (bold) {
      out.push(`<text x="${x + SIZE / 2}" y="${y + 28}" text-anchor="middle" font-family="${SANS}" font-size="20" font-weight="800" fill="${ink}">${st}</text>`)
      out.push(`<text x="${x + SIZE / 2}" y="${y + 52}" text-anchor="middle" font-family="${SANS}" font-size="${top.length > 8 ? 13 : 16}" font-weight="600" fill="${ink}">${esc(top)}</text>`)
      out.push(`<text x="${x + SIZE / 2}" y="${y + 76}" text-anchor="middle" font-family="${SANS}" font-size="20" font-weight="800" fill="${ink}">${mid}</text>`)
    } else {
      out.push(`<text x="${x + SIZE / 2}" y="${y + 52}" text-anchor="middle" font-family="${SANS}" font-size="22" font-weight="700" fill="${ink}">${st}</text>`)
    }
  }
  out.push(`<text x="${W / 2}" y="${Y0 + 8 * CELL + 14}" text-anchor="middle" font-family="${SANS}" font-size="20" fill="#5d6370">Outlined: my picks, with each winner&#8217;s share of the two-way vote. Other states: current polls.</text>`)

  // the bottom line
  const bar = (y: number, label: string, r: number | null, total: number, line: number, verdict: string) => {
    const x = 90, w = W - 180
    out.push(`<text x="${x}" y="${y - 14}" font-family="${SERIF}" font-size="34" font-weight="700" fill="#16181d">${label}</text>`)
    if (r === null) return
    const rw = (r / total) * w
    out.push(`<text x="${x + w}" y="${y - 14}" text-anchor="end" font-family="${SERIF}" font-style="italic" font-size="30" fill="#16181d">${esc(verdict)}</text>`)
    out.push(`<rect x="${x}" y="${y}" width="${w - rw}" height="54" fill="#1d4f9f"/>`)
    out.push(`<rect x="${x + w - rw}" y="${y}" width="${rw}" height="54" fill="#b42318"/>`)
    out.push(`<rect x="${x + w * (1 - line / total) - 2}" y="${y - 8}" width="4" height="70" fill="#16181d"/>`)
    out.push(`<text x="${x + 16}" y="${y + 38}" font-family="${SANS}" font-size="28" font-weight="800" fill="#fff">${total - r} Dem + Ind</text>`)
    out.push(`<text x="${x + w - 16}" y="${y + 38}" text-anchor="end" font-family="${SANS}" font-size="28" font-weight="800" fill="#fff">${r} Rep</text>`)
  }
  const yb = Y0 + 8 * CELL + 90
  bar(yb, 'SENATE', senateR, 100, SENATE_CONTROL_R,
    senateR === null ? '' : senateR >= SENATE_CONTROL_R ? 'Republicans hold the Senate' : 'Democrats flip the Senate')
  bar(yb + 150, 'HOUSE', houseR, 435, HOUSE_MAJORITY,
    houseR === null ? '' : houseR >= HOUSE_MAJORITY ? 'Republicans hold the House' : 'Democrats flip the House')

  // footer
  out.push(`<rect x="30" y="${H - 110}" width="${W - 60}" height="80" fill="#0b1a3d"/>`)
  out.push(star(80, H - 70, 16, '#c9a227'))
  out.push(star(W - 80, H - 70, 16, '#c9a227'))
  out.push(`<text x="${W / 2}" y="${H - 62}" text-anchor="middle" font-family="${SERIF}" font-size="26" fill="#fff">Called it first at Election Town &#183; Paid for by nobody &#183; Approved by an eagle</text>`)
  out.push('</svg>')
  return out.join('')
}
