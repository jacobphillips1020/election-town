// Keeps the database tests working on any date. The migrations hard-code the real closing time and Election Day, so
// once those pass, everything that needs an open pool fails. After loading the migrations, setTestClock moves both into
// the future, keeping their real relationship: the pool closes 4 hours before Election Day starts. Test databases only;
// nothing here touches the migrations. "the migrations set the real closing time" in pool.test.ts checks the real values.
import type { PGlite } from '@electric-sql/pglite'

const HOUR = 3600e3
const closesAt = (Math.floor(Date.now() / HOUR) + 30 * 24) * HOUR

/** The pool's closing time in test databases. */
export const POOL_DEADLINE = new Date(closesAt).toISOString()
/** Election Day's start in test databases: the latest allowed closing time. */
export const ELECTION_DAY_START = new Date(closesAt + 4 * HOUR).toISOString()
/** A time this many hours from the pool's closing time. */
export const hoursFromClose = (h: number) => new Date(closesAt + h * HOUR).toISOString()
/** One second too late to close before Election Day. */
export const JUST_AFTER_ELECTION_DAY_START = new Date(closesAt + 4 * HOUR + 1000).toISOString()

const setElectionDayStart = (db: PGlite, at: string) =>
  db.exec(`create or replace function app.election_day_start() returns timestamptz
           language sql immutable as $$ select timestamptz '${at}' $$;`)

/** Call right after loading migrations. Markets move by the same amount as the default, so any that matched it still do. */
export async function setTestClock(db: PGlite) {
  await db.exec(`set session_replication_role = replica;
                 update public.markets m set entry_deadline = m.entry_deadline + (timestamptz '${POOL_DEADLINE}' - g.default_deadline)
                 from public.group_settings g where m.entry_deadline is not null;
                 update public.group_settings set default_deadline = '${POOL_DEADLINE}' where id;
                 set session_replication_role = origin;`)
  await setElectionDayStart(db, ELECTION_DAY_START)
}

/** The situation when results really get entered: Election Day has started, not just the pool closed. */
export const electionDayHasStarted = (db: PGlite) => setElectionDayStart(db, new Date(Date.now() - 1000).toISOString())
