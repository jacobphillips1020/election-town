// The late-90s patriotic banner: waving flag, an eagle flying across, WordArt title. Decorative only.
import { Link } from 'react-router-dom'

function Eagle() {
  return (
    <svg className="eagle" viewBox="0 0 120 60" aria-hidden="true">
      <g className="wing wing-back">
        <path d="M58 30 C50 18 36 8 14 4 L22 10 L10 10 L20 15 L8 17 L22 21 C34 26 46 31 58 34 Z" fill="#3d2814" />
      </g>
      <path d="M47 33 L36 28 L39 33 L35 38 L47 36 Z" fill="#fff" stroke="#2a1c0e" strokeWidth=".7" />
      <ellipse cx="62" cy="34" rx="16" ry="7" fill="#4a3018" />
      <path d="M72 38 l3 5 m-1 -5 l3 5" stroke="#f2b705" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="80" cy="30" r="6.2" fill="#fff" stroke="#2a1c0e" strokeWidth=".7" />
      <path d="M85.5 28.5 L92 30.5 L88 32 L85.5 33 Z" fill="#f2b705" stroke="#8a6300" strokeWidth=".5" />
      <circle cx="82" cy="29" r="1" fill="#111" />
      <path d="M78 26.8 l6 1.2" stroke="#2a1c0e" strokeWidth="1" />
      <g className="wing wing-front">
        <path d="M66 30 C72 16 86 6 108 2 L100 9 L112 10 L101 15 L112 18 L98 21 C88 25 76 30 68 34 Z" fill="#5a3a1c" />
      </g>
    </svg>
  )
}

export function FlagBanner() {
  return (
    <div className="flag-banner">
      <div className="flag-canton" aria-hidden="true" />
      <div className="flag-wave" aria-hidden="true" />
      <Eagle />
      <Link to="/" className="flag-title">
        <span className="wordart">Election Town</span>
        <span className="flag-tagline">★ America&rsquo;s Most Patriotic Friends-Only Prediction Pool ★ Est. 2026 ★</span>
      </Link>
    </div>
  )
}

export function NinetiesFooter() {
  return (
    <footer className="nineties-footer">
      <span>★ ★ ★</span>
      <p>Election Town &middot; Proudly counting every vote (eventually) &middot; Best viewed in any browser at any resolution</p>
      <p className="muted">No real money moves through this site. No eagles were harmed.</p>
    </footer>
  )
}
