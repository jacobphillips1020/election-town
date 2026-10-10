# Election Town: project status

**v2 (the main pool) live 2026-10-10 · https://election-town.vercel.app** (v1 launched earlier the same day).
Migration 9 applied to the live project; pool closes **Tue Oct 27, 11:59 p.m. ET** (editable in Admin → Pool).

Friends' prediction pool for the Nov 2026 US midterms. Vite + React + TypeScript on Vercel (Hobby), Supabase
(Auth + Postgres with row-level security) in project `election-town` (ref `gupgyvyxocsxqbwjyira`, us-east-1).
Private GitHub repo `jacobphillips1020/election-town`; pushing to `main` deploys.

## How it works (v2)

- **One ballot, 12 picks, $50** (like the old Google Form, but with the polling next to every race):
  - the 10 Senate races that decide control (expert battlegrounds: AK, GA, IA, ME, MI, NE, NH, NC, OH special, TX).
    Pick the winner and their **two-way vote share** (winner's votes ÷ votes for the two listed candidates; 48–42 with
    10% others = 53.3–46.7). $4 each; among those who picked the winner, the closest share takes that race's pot
    (exact ties split; nobody right = refunds).
  - **Republican seats** in the next Senate and the next House. $5 each; closest guess takes the pot.
    (Republican seats, because Nebraska's contender Osborn is an independent: "Democratic seats" would be ambiguous.)
  - The Senate seat pick starts at what your race picks add up to (31 not up + other races as polled + your 10) and
    follows them until you set your own number.
  - **Always $50 all in.** Any pick can be left blank: its stake still goes into that pot, but it can't win.
    Submit what you have (at least one pick) and finish or change it until the close; the UI says so everywhere.
  - Picks save in the browser as you go (per person; only used if newer than the submitted ballot). Submitting is
    all-or-nothing per save (`submit_ballot`). Visitors can fill it out before signing up; the draft survives sign-up.
- **Home page** = the visual: tile map of all 35 Senate races (polls / my picks / the group), balance-of-power bars
  (now, polls, Polymarket, you, the group), House bars + polled-district strip, the 12 picks with pots. Tap a state for
  polling, expert ratings (Cook / Inside Elections / Sabato via PollingSource), pot, research links.
- **After the close:** the map switches to the group's composite (shaded by % of ballots agreeing), group averages,
  you vs the group, and the 2024-style grid of every ballot (anonymized, members only; "You" outlined).
- **Share my picks** (`/card`): a fun map card of your own picks (banner art, shares on each state, Senate/House
  verdicts). Download PDF (hand-built, `src/domain/pdf.ts`) or PNG, or share from a phone. Picks are otherwise sealed.
- **Invite friends**: "Want to up the stakes?" band on the home page and after submitting (share sheet / text /
  copy) with ready-made copy incl. the live pot and close time. Link previews: Open Graph tags in `index.html` +
  `public/og.jpg` (1200×630, made from the banner; checked with Facebook/WhatsApp/Slack bot user agents).
- **Payment note** (Admin → Pool): live note is "Venmo @jake-phillips-3 $50 before picks close."; a Venmo @handle
  becomes a link. Shown after submitting and on the home page for members who are in.
- **Side bets** (`/side`): any other race, opened by a member from the race board, $5, same pick (winner + two-way
  share). Invite friends by share sheet / text. Admin can change a side bet's stake or closing time.
- **Admin**: Pool tab (closing time, stakes, payment instructions shown after submitting; who has submitted, never
  what), Side bets, Results (race: winner + two-way share; seats: Republican count), Ledger, Group.
- Sealed until close by database time; visitors never see picks, names on picks, balances or phone numbers.

## Data sources

- **PollingSource** (free, no key): race averages + candidate names + expert ratings, daily cron + on demand (≤12 h;
  race details ≤3 days). Coverage 2026-10-10: 27/35 Senate, 81 House districts.
- **Polymarket** public feed (no key): "Republican Senate/House seats after the 2026 midterms" price ranges → median
  seats; "Which party wins the Senate/House" → control odds. Stored in `seat_forecasts` (≤6 h, daily cron).
  Model forecasts (DDHQ, Silver Bulletin, Poliwave) block automated access or are paywalled.
- "Now" = today's Senate (53 R); the House row is the 2024 result (220 R). Hard-coded in `src/domain/senate.ts`.

## Code map

- `supabase/migrations/` (9 files; the 9th, `20261011000001_main_pool.sql`, is the v2 pool). Scoring and settlement
  live only in SQL.
- `src/ui/Home.tsx` (dashboard), `Ballot.tsx`, `Card.tsx` + `cardSvg.ts`, `SideBets.tsx`, `MarketDetail.tsx`,
  `Pick.tsx` (race + seat pickers), `TileMap.tsx`, `Balance.tsx`, `Admin.tsx`.
- `src/domain/pool.ts` (ballot draft, colors, links), `senate.ts` (holders, seat math), `tiles.ts`, `pdf.ts`.
- `src/polling/forecast.ts` (Polymarket), `board.ts` (+ expert ratings); `api/polling.ts`, `api/polling-cron.ts`.
- Demo mode (no env vars): real migrations in PGlite + `src/demo/polling.sql` (public data snapshot) + `seed.sql`
  (fictional people). Dev only: `?demo=closed` shows the pool after close; `?demo=open` goes back.
- Tests: `npm test` (116).

## Keys and settings

- Vercel env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (= the **publishable** key, type Config),
  `SUPABASE_SERVICE_ROLE_KEY` (= the **sb_secret** key, type Secret). Local: `.env.local` (git-ignored).
- Supabase legacy JWT keys are **disabled**. Forgotten passwords: `supabase/seed/reset_member_password.sql`.
- Live SQL: `supabase db query --linked --project-ref gupgyvyxocsxqbwjyira -f <file>` (CLI is logged in).

## Known gaps / next ideas

- Test phone sign-up with a second real number before sharing widely.
- Per-race Polymarket odds on the ballot (needs a slug per race).
- The slate is fixed in the migration; swapping a race means a small SQL change before the first ballots.
- Optional: `CRON_SECRET`, custom domain, courtesy email to PollingSource.
