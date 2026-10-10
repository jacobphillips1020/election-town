# Election Town

A private, invite-only prediction pool for the November 2026 US midterms. Friends enter fixed buy-in
predictions on Senate, House, and governor races plus one combined Control of Congress seat market.
Picks stay sealed until entries close, then everyone's picks and a group forecast are revealed.
Money never moves in the app; the admin records transfers by hand.

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

- **Enforced in the database:** other members' picks (and who has entered) are unreadable until the entry
  deadline passes, judged by database time. Non-members and signed-out users read nothing. The admin account
  has no special read access to sealed picks. Writes at or after the deadline are rejected.
- **Not cryptographic secrecy.** Whoever owns the Supabase project (the database owner or anyone with the
  service-role key or dashboard access) can read the tables directly. Treat the project login and the service-role key
  as the keys to everyone's sealed picks, and never put the service-role key in `VITE_*` variables or the repo.
- Realtime is intentionally not used; the migration also removes tables from the realtime publication.
- Members see display names, never email addresses (profiles hold no email).

## Going live (summary)

1. Create a Supabase project; apply the migrations in order (`supabase db push` or the SQL editor).
2. Set up custom SMTP (Supabase's built-in email only reaches your own team, 2/hour).
3. Add redirect URLs (`http://localhost:5173/**`, your deployed URL `/**`) under Authentication → URL Configuration.
4. Sign up in the app, then run `supabase/seed/bootstrap_admin.sql` once (your email) to become admin.
5. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` (and later Vercel).
6. Create an invitation link in Admin → Group and share it.
