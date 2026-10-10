// A one-page PDF holding a single JPEG image, built by hand (no library): the page is sized to the image's
// shape, 8.5 inches wide. Enough for "download my picks as a PDF".

const enc = new TextEncoder()

export function jpegPdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  const pageW = 612
  const pageH = Math.round((pageW * height) / width)
  const draw = enc.encode(`q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`)
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let size = 0
  const push = (p: Uint8Array | string) => {
    const b = typeof p === 'string' ? enc.encode(p) : p
    parts.push(b)
    size += b.length
  }
  const obj = (n: number, body: (Uint8Array | string)[]) => {
    offsets[n] = size
    push(`${n} 0 obj\n`)
    body.forEach(push)
    push('\nendobj\n')
  }
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>'])
  obj(2, ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'])
  obj(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`])
  obj(4, [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream'])
  obj(5, [`<< /Length ${draw.length} >>\nstream\n`, draw, '\nendstream'])
  const xref = size
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`)
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
