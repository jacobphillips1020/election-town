import { expect, test } from 'vitest'
import { jpegPdf } from './pdf'

test('one-page PDF: header, image object, and a cross-reference table whose offsets point at each object', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
  const pdf = jpegPdf(jpeg, 1200, 1560)
  const text = new TextDecoder('latin1').decode(pdf)
  expect(text.startsWith('%PDF-1.4')).toBe(true)
  expect(text).toContain('/MediaBox [0 0 612 796]')
  expect(text).toContain('/Width 1200 /Height 1560')
  expect(text).toContain(`/Length ${jpeg.length}`)
  const xrefAt = Number(text.match(/startxref\n(\d+)/)![1])
  const offsets = text.slice(xrefAt).match(/(\d{10}) 00000 n/g)!.map((s) => Number(s.slice(0, 10)))
  expect(offsets).toHaveLength(5)
  // byte offsets (TextDecoder latin1 maps bytes 1:1 to characters)
  offsets.forEach((o, i) => expect(text.slice(o, o + 8)).toBe(`${i + 1} 0 obj\n`))
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
})
