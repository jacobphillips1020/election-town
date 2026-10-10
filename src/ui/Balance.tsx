// Balance of power: one thin bar per source (now, polls, markets, your picks, the group), same scale,
// with the control line in the middle. Republican seats fill from the right.
export type BalanceRow = { label: string; r: number | null; note?: string; strong?: boolean }

export function Balance({ total, rows, line, lineLabel, leftLabel = 'Dem + Ind' }: {
  total: number
  rows: BalanceRow[]
  line: number
  lineLabel: string
  leftLabel?: string
}) {
  const shown = rows.filter((x) => x.r !== null)
  return (
    <div className="bal" role="table" aria-label={`Seats out of ${total}`}>
      <div className="bal-head" role="row">
        <span role="columnheader" />
        <span role="columnheader" className="bal-axis">
          <span style={{ color: 'var(--dem)' }}>{leftLabel}</span>
          <span className="bal-line-label" style={{ left: `${(1 - line / total) * 100}%` }}>{lineLabel}</span>
          <span style={{ color: 'var(--rep)' }}>Rep</span>
        </span>
      </div>
      {shown.map((x) => {
        const r = x.r!
        const rp = (r / total) * 100
        const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
        return (
          <div key={x.label} className={`bal-row${x.strong ? ' bal-strong' : ''}`} role="row">
            <span className="bal-label" role="rowheader">{x.label}</span>
            <span className="bal-cell" role="cell">
              <span className="bal-bar" aria-label={`${round(total - r)} to ${round(r)}`}>
                <span className="bal-d" style={{ width: `${100 - rp}%` }}><span>{round(total - r)}</span></span>
                <span className="bal-r" style={{ width: `${rp}%` }}><span>{round(r)}</span></span>
                <span className="bal-line" style={{ left: `${(1 - line / total) * 100}%` }} />
              </span>
              {x.note && <span className="bal-note">{x.note}</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}
