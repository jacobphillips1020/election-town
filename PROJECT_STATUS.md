# Election Town: project status

**v1 launched 2026-10-10 · https://election-town.vercel.app**

Friends' prediction pool for the Nov 2026 US midterms. Vite + React + TypeScript on Vercel (Hobby), Supabase
(Auth + Postgres with row-level security) in project `election-town` (ref `gupgyvyxocsxqbwjyira`, us-east-1).
Private GitHub repo `jacobphillips1020/election-town`; pushing to `main` deploys.

## How it works (v1)

- **Browse without an account:** markets, polling, entry counts/pools, the race board, the home "Closest races".
- **Sign up = name + mobile + password** (no email; login id is derived from the phone, "Confirm email" is off).
  Older email accounts (Jake's) sign in with their email. Open sign-up: new accounts join the group automatically;
  Admin → Group has an invite-only switch.
- **Open a market in one step:** pick a race on the board → "Open market & place bet". `launch_race` opens it on the
  group defaults ($10 buy-in, entries close Nov 2 8:00 p.m. ET) with candidates (top two by polling) and rules from
  the data. Only races with published candidate names can be opened. No approval queue. One market per race.
- **Bets:** fixed buy-in, editable/withdrawable until close; sealed until the deadline (database time), then revealed
  to members with the group forecast. Visitors never see picks, names on picks, balances, or phone numbers.
- **Settlement, ledger, CSV, corrections, transfers:** Admin tabs Markets / Results / Ledger / Group.
- **Polling:** PollingSource API (free, no key; see below). Race board refreshed daily by Vercel cron
  (`/api/polling-cron`, 10:00 UTC) and on demand (≤ every 12 h); each market's snapshot stored when opened and
  ≤ every 6 h; the "polling at close" snapshot is the last one before the deadline.
- **Look:** Jake's banner artwork (`public/banner.jpg`) + navy menu bar; clean app below; 90s footer.

## Code map

- `supabase/migrations/` (8 files, all applied to the live project, in order): tables/RLS → logic → privileges →
  race catalog → race board → public browsing/open sign-up → one-step launch → open leftover proposals.
  Scoring and settlement live only in SQL.
- `src/` app; `src/data/` live (Supabase) and demo (in-browser Postgres) backends behind one `rpc()`.
- `api/polling.ts` (member-only lookups/refresh), `api/polling-cron.ts` (daily job), `src/polling/*` (adapter, board, refresh).
- Tests: `npm test` (92): DB authorization for visitors/non-members/members/admin, sealed picks, deadline boundary,
  scoring/ties/pennies, idempotent settlement, ledger, launch rules, polling adapter/board/refresh, catalog.
- `vite.config.ts` fails a production build if the Supabase settings are missing (prevents a silent demo deploy).

## Keys and settings

- Vercel env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (= the **publishable** key, type Config),
  `SUPABASE_SERVICE_ROLE_KEY` (= the **sb_secret** key, type Secret). Local: `.env.local` (git-ignored).
- Supabase legacy JWT keys (anon/service_role) are **disabled** (one was exposed in a screenshot on 2026-10-10).
- Forgotten passwords: friend texts Jake → run `supabase/seed/reset_member_password.sql` in the SQL editor.

## PollingSource

`/api/v1/races` and `/api/v1/race` return JSON with no key. About page ties API access to Pro ($15/mo); Terms are
silent on caching. Owner decision: use it free, small cached volume, pay only if asked. Coverage 2026-10-10:
27/35 Senate, 29/36 governor, 80/435 House; D and R averages only; 122 races have both candidate names.

## Known gaps / next ideas

- **Test the phone sign-up with a second real number** before sharing widely (not testable by Claude).
- Unpolled races and polled races without names can't be opened (FEC API could supply names later).
- Independents/third parties are covered only by "Other candidates" (not pickable as winner).
- Vercel's bot checkpoint may challenge scripted requests; browsers and Vercel cron are fine.
- `/api/polling-cron` is callable without a secret (harmless: rate-limited by freshness). Optionally set `CRON_SECRET`.
- Optional: custom domain (Vercel → Settings → Domains), courtesy email to PollingSource.
