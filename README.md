# Election Town

A friends' prediction pool for the November 2026 US midterms: https://election-town.vercel.app

One ballot, 12 picks, $50: the 10 Senate races that decide control (winner + share of the two-way vote) and
Republican seats in the next Senate and House. The home page is a live map and balance of power (polling, expert
ratings, Polymarket seat forecasts); after the close it shows what the group picked. Anyone can browse and fill out a
ballot; signing up (name, mobile, password) is needed to submit. Side bets cover any other race ($5). Picks stay sealed
until close; your own picks card (PDF/PNG) is yours to share. Money never moves in the app; the admin records
transfers by hand.

Status and decisions: see `PROJECT_STATUS.md`.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # database rules + domain logic
npm run build    # typecheck + production build
```

With no `.env.local` the app runs in **demo mode**: fictional data in your browser, a persona picker instead of
sign-in. To connect a real Supabase project, copy `.env.example` to `.env.local` and fill in the URL and anon key.

## How it's built

- `supabase/migrations/*.sql` is the product's rulebook: tables, guards, RLS, scoring, settlement, ledger.
  Clients can only read a few tables (row-filtered) and call RPC functions; they have no direct write access.
- `src/data/` has two interchangeable backends behind one `rpc(name, args)` call: Supabase (live) and PGlite (demo/tests).
- Tests run the real migrations on an in-process Postgres and act as different users.

## Privacy: what is and isn't protected

- **Public:** markets, polling, forecasts, ballot counts and pot sizes, the race board; after the close, the group's
  split for each pick (no names).
- **Members only, enforced in the database:** everyone's picks and who made them (and only after entries close; the
  ballot grid is anonymized), balances, payouts by person. Phone numbers are visible only to their owner and the admin.
- The admin can see who has entered an open market (to chase payments) but not what they picked.
- **Not cryptographic secrecy.** Whoever controls the Supabase project (dashboard access or the `sb_secret` key)
  can read everything. Never put the secret key in a `VITE_*` variable or the repo.
- Realtime is not used; the migrations keep every table out of the realtime publication.

## Live setup (done 2026-10-10)

Supabase project with the migrations applied in order, Confirm email off, legacy JWT keys disabled; admin
bootstrapped with `supabase/seed/bootstrap_admin.sql`. Vercel env vars: see `PROJECT_STATUS.md`.
