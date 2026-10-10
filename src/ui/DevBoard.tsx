// Development-only preview of the race board using a local, git-ignored sample (.local/board-sample.json).
// Not routed in production builds.
import { useState } from 'react'
import type { BoardRace } from '../domain/board'
import { RaceBoard } from './RaceBoard'

const files = import.meta.glob('../../.local/board-sample.json', { eager: true, import: 'default' }) as Record<string, BoardRace[]>
const sample = Object.values(files)[0] ?? []

export default function DevBoard() {
  const [msg, setMsg] = useState('')
  return (
    <main className="page" id="main">
      <h1>Propose a race</h1>
      <p className="muted" style={{ maxWidth: '36rem' }}>Pick a race to add to the pool. (Dev preview with a local sample; nothing is saved.)</p>
      {msg && <p className="ok">{msg}</p>}
      <RaceBoard races={sample} adminName="Jake" onPropose={(r) => setMsg(`Would propose ${r.state} ${r.race_type}`)} proposing={null} error="" />
    </main>
  )
}
