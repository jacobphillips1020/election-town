# Election Town: project status

Private prediction pool for friends on the Nov 2026 US midterms. Vite + React + TypeScript;
Supabase (Auth + Postgres with row-level security) for the live version. Last updated 2026-10-09.

**State: local build complete and tested. Not published. Live integration is blocked on account setup (below).**

## What exists

- `supabase/migrations/` (3 files): tables, guards, RLS, scoring, settlement, ledger, RPC surface, privileges.
  Scoring and settlement live **only** in SQL; the UI previews by calling the same functions.
- `src/` React app: Markets, Market detail (entry form, sealed receipt, reveal, results), My entries, Propose,
  Admin (proposals, markets, results/settlement/corrections, ledger + CSV, group defaults + invite links).
- Demo mode (no env vars): the real migrations run in an in-browser Postgres (PGlite) with fictional fixtures
  (`src/demo/seed.sql`). Yellow bar says so. It is not a multiuser service.
- `api/polling-refresh.ts` + `src/polling/pollingsource.ts`: server-side polling refresh, 6 h cache, **disabled**
  until PollingSource is verified (see Blockers).
- Tests (`npm test`): 48 passing. DB authorization matrix (anonymous / non-member / member / owner / admin),
  sealed picks, closing boundary, locked terms, scoring, ties, penny conservation, idempotent settlement,
  corrections, balance formula, demo seed, plus domain unit tests.

## Decisions I made (change if you disagree)

- **Winner must be strictly largest among named candidates.** "Other candidates" is an aggregate of unnamed
  people, so it isn't compared against the winner.
- **Closing is derived from database time** (`clock_timestamp() >= entry_deadline`) in RLS and write guards.
  No cron and no page visit needed. Fewer-than-two-entrant cancellation is recorded by a deterministic,
  idempotent sweep that runs whenever any member loads markets or a ledger.
- **Withdraw deletes the entry** (no edit history is kept, per "don't expose edit history").
- **Admin sees nothing extra.** The admin ledger omits commitments on markets that haven't closed, so even
  the admin can't tell who has entered before close. Cancelling a market before close keeps picks sealed.
- **Group default deadline/buy-in** pre-fill new markets. They're editable only while no entry exists
  anywhere; markets still on the old default (and unentered) follow the change.
- **Polling "at close" snapshot** = latest snapshot captured at or before the deadline (no job needed).
  If none, the UI says it wasn't captured.
- **Admin bootstrap** is `supabase/seed/bootstrap_admin.sql`, run once by the project owner. No API path.
- **Control of Congress** market is seeded by the migration (the one definitional record; no fabricated data).
  Caucus treatment text is in its `rules_note`; edit via the Admin → Markets tab before entries exist.
- **Name:** "Election Town" (folder `election-town`, was "Called It").

## Blockers / needed from Jake (nothing is published yet)

1. **Supabase project** (free): create account + project; give the app its URL and anon key via `.env.local`.
2. **Email delivery.** Supabase docs: the built-in email service only delivers to your own team and is capped
   at 2 messages/hour, "not meant for production". Friends can't verify/reset without **custom SMTP** (needs a
   sender/domain you control). Decide: set up SMTP, or turn off "Confirm email" (invite link still gates the
   group; password reset would still need SMTP).
3. **Apply migrations + admin bootstrap** (needs the Supabase CLI: `brew install supabase/tap/supabase`, small).
4. **PollingSource (optional, $15/month Pro):** subscribe at https://pollingsource.com/subscribe.php.
   Verified so far: `GET /api/v1/races` and `/api/v1/race?race_type=&state=[&district=]` return JSON; Pro
   "adds data exports and API access". **Not stated anywhere:** how API keys are issued/sent, the auth method,
   response schema, rate limits, and whether caching/storing results is allowed (Terms are silent; they
   prohibit automated collection "without permission" and say data shouldn't be the sole basis for
   "wagering decisions"). Email the vendor (contact via innovativedata.us) to get that in writing before paying.
   Until then use manual polling snapshots (Admin → Markets → Record polling).
5. **Vercel deploy** after approval (static site + `api/` function; env vars listed in `.env.example`).

## Not verified (could not run here)

- Real Supabase Auth flows (sign-up email, verification link, reset) and PKCE callback on a real project.
- The Vercel function in `api/` (never deployed; provider call intentionally unimplemented).
- Native share sheet on a phone (copy-link fallback implemented).
