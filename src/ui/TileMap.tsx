// Square-tile US map (SVG). Every state is the same size; races are colored, the rest stay pale.
import type { KeyboardEvent } from 'react'
import { NO_RACE, inkOn } from '../domain/pool'
import { stateName } from '../domain/states'
import { TILES, TILE_COLS, TILE_ROWS } from '../domain/tiles'

export type Tile = { fill: string; sub?: string; star?: boolean; title?: string }
const CELL = 48
const SIZE = 44

export function TileMap({ tiles, selected, onSelect, label }: {
  tiles: Record<string, Tile>
  selected?: string | null
  onSelect?: (state: string) => void
  label: string
}) {
  const key = (e: KeyboardEvent, st: string) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(st) }
  }
  return (
    <svg className="tilemap" viewBox={`-2 -2 ${TILE_COLS * CELL} ${TILE_ROWS * CELL}`} role="group" aria-label={label}>
      {Object.entries(TILES).map(([st, [c, r]]) => {
        const t = tiles[st]
        const fill = t?.fill ?? NO_RACE
        const ink = t ? inkOn(fill) : '#8b8574'
        const active = !!t && !!onSelect
        return (
          <g key={st} transform={`translate(${c * CELL},${r * CELL})`}
            className={`tile${active ? ' tile-hit' : ''}${selected === st ? ' tile-sel' : ''}${t?.star ? ' tile-star' : ''}`}
            {...(active ? { role: 'button', tabIndex: 0, 'aria-label': t?.title ?? stateName(st), 'aria-pressed': selected === st,
              onClick: () => onSelect!(st), onKeyDown: (e: KeyboardEvent) => key(e, st) } : { 'aria-hidden': true })}>
            <rect width={SIZE} height={SIZE} rx={5} fill={fill} />
            {t?.star && <rect className="tile-ring" x={1.5} y={1.5} width={SIZE - 3} height={SIZE - 3} rx={4} fill="none" />}
            <text x={SIZE / 2} y={t?.sub ? 19 : 27} textAnchor="middle" className={`tile-code${t?.sub ? ' has-sub' : ''}`} fill={ink}>{st}</text>
            {t?.sub && <text x={SIZE / 2} y={34} textAnchor="middle" className="tile-sub" fill={ink}>{t.sub}</text>}
            {t?.title && <title>{t.title}</title>}
          </g>
        )
      })}
    </svg>
  )
}

export function MapLegend({ group = false }: { group?: boolean }) {
  const items = group
    ? [['#1d4f9f', '90%+'], ['#5f88cf', '75%+'], ['#a9c0ea', '60%+'], ['#d8cdaa', 'Split'], ['#eeb0a8', '60%+'], ['#d66b5e', '75%+'], ['#b42318', '90%+']]
    : [['#1d4f9f', 'Solid'], ['#5f88cf', 'Likely'], ['#a9c0ea', 'Lean'], ['#d8cdaa', 'Toss-up'], ['#eeb0a8', 'Lean'], ['#d66b5e', 'Likely'], ['#b42318', 'Solid']]
  return (
    <div className="legend" aria-hidden="true">
      <span className="legend-scale-wrap">
        <span className="legend-scale">
        {items.map(([c, l], i) => <span key={i} className="legend-sw" style={{ background: c }} title={l} />)}
      </span>
      <span className="legend-ends"><span>Dem</span><span>{group ? 'Split' : 'Toss-up'}</span><span>Rep</span></span>
      </span>
      <span className="legend-key"><span className="legend-star" /> On the ballot</span>
    </div>
  )
}
