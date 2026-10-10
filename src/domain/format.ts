export function usd(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const rem = abs % 100
  return `${sign}$${dollars.toLocaleString('en-US')}${rem ? '.' + String(rem).padStart(2, '0') : ''}`
}

/** Tenths of a percentage point -> "51.8%". Accepts fractional tenths (means). */
export function pct(tenths: number, digits = 1): string {
  return `${(tenths / 10).toFixed(digits)}%`
}

const ET = 'America/New_York'

/** "Nov 2 at 8:00 p.m. ET" — the timezone is always explicit. */
export function formatET(iso: string | null | undefined): string {
  if (!iso) return 'No deadline set'
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('en-US', { timeZone: ET, month: 'short', day: 'numeric' }).format(d)
  const time = new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
  return `${date} at ${time.replace(' AM', ' a.m.').replace(' PM', ' p.m.')} ET`
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Value for <input type="datetime-local"> showing New York wall time. */
export function toETInput(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const g = (t: string) => parts.find((p) => p.type === t)!.value
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`
}

/** New York wall time ("2026-11-02T20:00") -> UTC ISO string. */
export function fromETInput(local: string): string {
  const [datePart, timePart] = local.split('T')
  const [y, mo, d] = datePart.split('-').map(Number)
  const [h, mi] = timePart.split(':').map(Number)
  // Try both US offsets and keep the one that round-trips to the same New York wall time.
  for (const offset of [4, 5]) {
    const utc = new Date(Date.UTC(y, mo - 1, d, h + offset, mi))
    if (toETInput(utc.toISOString()) === local) return utc.toISOString()
  }
  return new Date(Date.UTC(y, mo - 1, d, h + 5, mi)).toISOString()
}
