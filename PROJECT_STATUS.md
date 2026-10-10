# Election Town: project status

Private prediction pool for friends on the Nov 2026 US midterms. Vite + React + TypeScript;
Supabase (Auth + Postgres with row-level security) for the live version. Last updated 2026-10-09.

**State (2026-10-09): built and tested (53 tests). Private GitHub repo: jacobphillips1020/election-town. Supabase project
`election-town` (us-east-1) created, migrations applied, Confirm email OFF, admin bootstrapped. Runs locally against the
live project (`.env.local`, git-ignored). **Deployed: https://election-town.vercel.app** (Vercel Hobby, auto-deploys on
push to `main`). Polling is ON by default (kill switch: `POLLINGSOURCE_DISABLED=true`); storing snapshots needs `SUPABASE_SERVICE_ROLE_KEY` in Vercel.**

## What exists

- `supabase/migrations/` (4 files): tables, guards, RLS, scoring, settlement, ledger, RPC surface, privileges, then the race
  catalog + `propose_race` (20261010000001). **Migration 4 must be applied to the live project before deploying the UI that calls it.**
  Scoring and settlement live **only** in SQL; the UI previews by calling the same functions.
- `src/` React app: Markets, Market detail (entry form, sealed receipt, reveal, results), My entries, Propose,
  Admin (proposals, markets, results/settlement/corrections, ledger + CSV, members + phone numbers, group defaults, invites).
- Demo mode (no env vars): the real migrations run in an in-browser Postgres (PGlite) with fictional fixtures
  (`src/demo/seed.sql`). Yellow bar says so. It is not a multiuser service.
- `api/polling.ts` + `src/polling/{pollingsource,refresh}.ts`: server-side race lookup/refresh, 6 h cache, members only,
  on by default. A race with no published average is stored as an explicit "none yet" snapshot (no re-polling).

## Decisions

- **Accounts:** email + password with **"Confirm email" OFF** in Supabase, so the app never sends email. Email is
  just the login name. **Phone number is required at sign-up** and stored in `member_contacts` (admin-only read);
  that is how the admin reaches people. Forgotten passwords: friend texts the admin, admin runs
  `supabase/seed/reset_member_password.sql`. Automated texting (e.g. Twilio) is a possible later add-on.
- **Admin sees who has entered an open market, never what they picked** (owner decision 2026-10-09). Other
  members still can't see who has entered until close. Picks are sealed from the admin in RLS.
- **Proposals are system-defined (owner decision 2026-10-10):** the only input is picking a race from the 506-race
  2026 catalog (`race_catalog` table; 35 Senate incl. OH/FL specials, 36 governor, 435 House). `propose_race` derives
  title, candidates (loaded from the polling data, "to be confirmed" placeholders otherwise), outcome basis
  (AK/ME → ranked-choice final round, GA → runoff-capable, else single round), "Other" remainder (always on) and the
  resolution wording. There is no free-form proposal API. One live market per race. Admin edits candidates at approval;
  a race can't open while any "to be confirmed" name remains.
- **Polling:** fetched the moment a race is proposed, refreshed ≤ every 6 h when opened, and daily by a Vercel cron
  (`/api/polling-cron`, 10:00 UTC) so averages move day over day and a snapshot exists before each deadline.
- **Race ↔ polling link:** every race market stores `polling_ref` = {race_type, state, district, special}.
  The adapter refuses to store a response whose race/state/district/special flag doesn't match.
- **Winner must be strictly largest among named candidates.** "Other candidates" is an aggregate, not compared.
- **Closing is derived from database time** in RLS and write guards: no cron, no page visit needed.
  Fewer-than-two-entrant cancellation is recorded by a deterministic idempotent sweep run on any member's load.
- **Withdraw deletes the entry** (no edit history is kept).
- **Group default deadline/buy-in** pre-fill new markets; editable only while no entry exists anywhere.
- **Polling "at close" snapshot** = latest snapshot captured at or before the deadline. If none, UI says so.
- **Admin bootstrap** is `supabase/seed/bootstrap_admin.sql`, run once by the project owner. No API path.
- **Control of Congress** market is seeded by the migration; caucus treatment is in its `rules_note`.

## PollingSource (verified 2026-10-09)

- `GET https://pollingsource.com/api/v1/race?race_type=&state=[&district=]` returned JSON **with no key and no
  payment** (4 small test requests). The About page nonetheless lists API access under Pro ($15/mo); Terms are
  silent on caching and prohibit automated collection "without permission". Owner decision: use it free, send a
  courtesy email, pay only if they ask or cut access. Fallback if cut off: last snapshot (marked stale) + manual entry.
- Averages are Democratic and Republican only (no other candidates, no undecided). Shown as published.
- Special elections: API has an `is_special` flag but no documented way to pick between two Senate races in one
  state (OH and FL have specials in 2026). The adapter treats a flag mismatch as "not this race"; use manual entry.

## Coverage note

PollingSource publishes averages for 27/35 Senate, 29/36 governor and 80/435 House races (2026-10-10), D and R only.
Candidate names auto-load only for those; other races get placeholders the admin replaces at approval. A future
option is the FEC API (free key) to suggest names for unpolled races.

## Next steps (Jake)

1. On the live site: Admin → Group → create an invitation link (it will use the live address), text it to one friend,
   confirm they appear under Members with their phone number.
2. Create the real races (members propose; admin approves in Admin → Proposals). Deadlines default to Nov 2, 8:00 p.m. ET.
3. Polling: add `SUPABASE_SERVICE_ROLE_KEY` in Vercel (Supabase → Project Settings → API; Vercel only, never git or a
   VITE_ variable), then redeploy. Polling for a race is fetched and stored the moment it is proposed, and refreshed
   at most every 6 hours when someone opens it.
4. Optional: courtesy email to PollingSource.

## Not verified (could not run here)

- Phone landing in `member_contacts` for the real sign-up (covered by tests against a stand-in auth schema; check Admin → Group → Members).
- `extensions.crypt` in `reset_member_password.sql` on a real Supabase project.
- The Vercel function in `api/` (never deployed).
- Native share sheet on a phone (copy-link fallback implemented).
