-- Election Town: tables, guards, and row-level security.
-- Runs on Supabase Postgres (auth schema provided by Supabase). Plain Postgres otherwise.
--
-- Security model in one paragraph:
--   * Clients get SELECT on a few tables (filtered by RLS) and EXECUTE on RPC functions.
--     They never get INSERT/UPDATE/DELETE on tables.
--   * Sealed picks: entries are readable only by their owner until the market's
--     entry_deadline passes (judged by database time), then by group members.
--     There is deliberately no admin exception.
--   * Admin = a row in `admins`, created only by supabase/seed/bootstrap_admin.sql
--     run by the project owner. No API path creates admins.

create schema if not exists app;

-- ---------------------------------------------------------------- group + people

create table public.group_settings (
  id boolean primary key default true check (id),
  name text not null default 'Election Town',
  default_buy_in_cents int not null default 1000 check (default_buy_in_cents between 100 and 100000),
  -- Nov 2, 2026 8:00 p.m. America/New_York (EST, UTC-5) = Nov 3 01:00 UTC
  default_deadline timestamptz not null default '2026-11-03 01:00:00+00',
  updated_at timestamptz not null default now()
);
insert into public.group_settings default values;

create table public.admins (
  user_id uuid primary key references auth.users on delete cascade
);

create table public.members (
  user_id uuid primary key references auth.users on delete cascade,
  joined_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  created_at timestamptz not null default now()
);

create table public.invites (
  token text primary key default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- ---------------------------------------------------------------- markets

create table public.markets (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('senate', 'house', 'governor', 'congress')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  jurisdiction text not null default '',
  status text not null default 'proposed'
    check (status in ('proposed', 'rejected', 'open', 'canceled', 'settled')),
  proposed_by uuid references auth.users,
  -- [{ "id": "c1", "name": "...", "party": "D|R|I|L|G|O" }], order = display order
  candidates jsonb not null default '[]',
  has_other boolean not null default true,
  outcome_basis text not null default 'single_round'
    check (outcome_basis in ('single_round', 'runoff_final', 'rcv_final')),
  rules_note text not null default '',
  buy_in_cents int check (buy_in_cents is null or buy_in_cents between 100 and 100000),
  entry_deadline timestamptz,
  -- provider race reference, e.g. {"race_type":"senate","state":"NC","district":null}
  polling_ref jsonb,
  -- entered by admin after close, applied by confirm_settlement
  result_winner_id text,
  result_winner_share_tenths int check (result_winner_share_tenths between 0 and 1000),
  result_seats jsonb,
  result_source_url text,
  result_entered_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

-- Exactly one live Control of Congress market (a canceled one may be replaced).
create unique index one_live_congress_market on public.markets (kind)
  where kind = 'congress' and status not in ('rejected', 'canceled');

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets on delete restrict,
  user_id uuid not null references auth.users on delete restrict,
  winner_id text,          -- race markets
  shares jsonb,            -- race markets: { "<candidate id>": tenths, "other": tenths }, sums to 1000
  seats jsonb,             -- congress: {"house":{"d":..,"r":..,"o":..},"senate":{...}}
  commitment_cents int not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (market_id, user_id)
);

-- One run per settlement/cancel/correction. Never updated or deleted: history is kept.
create table public.settlement_runs (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets on delete restrict,
  version int not null,
  outcome text not null check (outcome in ('settled', 'no_winner_refund', 'underfilled_refund', 'canceled_refund')),
  result jsonb not null default '{}',
  reason text,
  pool_cents int not null,
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique (market_id, version)
);

create table public.payouts (
  run_id uuid not null references public.settlement_runs on delete restrict,
  market_id uuid not null references public.markets on delete restrict,
  entry_id uuid not null references public.entries on delete restrict,
  user_id uuid not null,
  commitment_cents int not null,
  gross_cents int not null default 0,   -- includes the winner's own stake
  refund_cents int not null default 0,  -- released commitment
  eligible boolean not null default false,
  error_value int,                      -- tenths of a point (races) or seats (congress)
  primary key (run_id, entry_id)
);

-- Manual money records. Appended, voided (never deleted).
create table public.money_transfers (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references auth.users,
  direction text not null check (direction in ('collected', 'paid_out')),
  amount_cents int not null check (amount_cents > 0),
  occurred_on date not null,
  note text not null default '',
  recorded_at timestamptz not null default clock_timestamp(),
  voided_at timestamptz
);

create table public.polling_snapshots (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets on delete cascade,
  source_kind text not null check (source_kind in ('provider', 'manual', 'fixture')),
  source_name text not null,
  source_url text,
  as_of date not null,
  fetched_at timestamptz not null default clock_timestamp(),
  -- as published: {"candidates":[{"name","party","pct"}], "undecided": n|null, "other": n|null, "note": ""}
  data jsonb not null
);
create index polling_snapshots_market on public.polling_snapshots (market_id, fetched_at desc);

-- ---------------------------------------------------------------- helpers

create function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

create function app.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where user_id = auth.uid())
      or exists (select 1 from public.admins where user_id = auth.uid())
$$;

create function app.require_member() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '28000'; end if;
  if not app.is_member() then raise exception 'Group members only' using errcode = '42501'; end if;
end $$;

create function app.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '28000'; end if;
  if not app.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
end $$;

-- Entries close at the deadline instant, judged by the database clock.
create function app.deadline_passed_at(p_deadline timestamptz, p_at timestamptz) returns boolean
language sql immutable as $$ select p_deadline is not null and p_at >= p_deadline $$;

create function app.market_closed(p_market uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  select coalesce(app.deadline_passed_at(m.entry_deadline, clock_timestamp()), false)
  from public.markets m where m.id = p_market
$$;

-- Polls close, and deadlines may not be set later than, the start of Election Day (ET).
create function app.election_day_start() returns timestamptz
language sql immutable as $$ select timestamptz '2026-11-03 05:00:00+00' $$;

-- ---------------------------------------------------------------- guards

create function app.validate_seat_chamber(p jsonb, p_total int, p_label text) returns void
language plpgsql immutable as $$
declare k text; v numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception '% seats are required', p_label; end if;
  foreach k in array array['d', 'r', 'o'] loop
    v := (p ->> k)::numeric;
    if v is null or v <> trunc(v) or v < 0 then raise exception '% seats must be whole numbers', p_label; end if;
  end loop;
  if (p ->> 'd')::int + (p ->> 'r')::int + (p ->> 'o')::int <> p_total then
    raise exception '% seats must total %', p_label, p_total;
  end if;
end $$;

create function app.validate_seats(p jsonb) returns void
language plpgsql immutable as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Seat prediction is required'; end if;
  perform app.validate_seat_chamber(p -> 'house', 435, 'House');
  perform app.validate_seat_chamber(p -> 'senate', 100, 'Senate');
end $$;

create function app.validate_prediction(m public.markets, p_winner text, p_shares jsonb, p_seats jsonb) returns void
language plpgsql stable as $$
declare
  ids text[]; keys text[]; k text; v jsonb; n int; total int := 0; wshare int;
begin
  if m.kind = 'congress' then
    if p_winner is not null or p_shares is not null then raise exception 'Seat markets take seat counts only'; end if;
    perform app.validate_seats(p_seats);
    return;
  end if;

  if p_seats is not null then raise exception 'Race markets take a winner and vote shares only'; end if;
  if p_shares is null or jsonb_typeof(p_shares) <> 'object' then raise exception 'Vote shares are required'; end if;

  select array_agg(c ->> 'id' order by c ->> 'id') into ids from jsonb_array_elements(m.candidates) c;
  if m.has_other then ids := array_append(ids, 'other'); end if;
  select array_agg(x order by x) into keys from jsonb_object_keys(p_shares) x;
  select array_agg(x order by x) into ids from unnest(ids) x;
  if keys is distinct from ids then raise exception 'Vote shares must cover every listed candidate'; end if;

  for k, v in select * from jsonb_each(p_shares) loop
    n := case when jsonb_typeof(v) = 'number' and v::text ~ '^[0-9]{1,4}$' then v::text::int else -1 end;
    if n < 0 or n > 1000 then
      raise exception 'Vote shares must be whole tenths between 0.0 and 100.0';
    end if;
    total := total + n;
  end loop;
  if total <> 1000 then raise exception 'Vote shares must total exactly 100.0%%'; end if;

  if p_winner is null or not exists (select 1 from jsonb_array_elements(m.candidates) c where c ->> 'id' = p_winner) then
    raise exception 'The winner must be one of the listed candidates';
  end if;
  wshare := (p_shares ->> p_winner)::int;
  for k, v in select * from jsonb_each(p_shares) loop
    if k <> p_winner and k <> 'other' and v::text::int >= wshare then
      raise exception 'The selected winner must have the largest share';
    end if;
  end loop;
end $$;

create function app.entries_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m public.markets;
begin
  select * into m from public.markets
  where id = case when tg_op = 'DELETE' then old.market_id else new.market_id end for share;
  if m.id is null then raise exception 'Unknown market'; end if;
  if m.status <> 'open' then raise exception 'This market is not open for entries'; end if;
  if clock_timestamp() >= m.entry_deadline then raise exception 'Entries are closed' using errcode = 'P0001'; end if;

  if tg_op = 'DELETE' then return old; end if;

  if tg_op = 'UPDATE' and (new.market_id, new.user_id) is distinct from (old.market_id, old.user_id) then
    raise exception 'An entry cannot move to another market or person';
  end if;
  perform app.validate_prediction(m, new.winner_id, new.shares, new.seats);
  new.commitment_cents := m.buy_in_cents;
  new.updated_at := clock_timestamp();
  return new;
end $$;

create trigger entries_guard before insert or update or delete on public.entries
  for each row execute function app.entries_guard();

-- Terms freeze with the first entry; a closed market can never be reopened.
create function app.markets_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.entries where market_id = old.id)
     and (new.kind, new.buy_in_cents, new.entry_deadline, new.candidates, new.has_other, new.outcome_basis, new.rules_note)
         is distinct from
         (old.kind, old.buy_in_cents, old.entry_deadline, old.candidates, old.has_other, old.outcome_basis, old.rules_note)
  then
    raise exception 'Terms are locked once the first entry exists. Cancel and replace the market instead.';
  end if;
  if new.entry_deadline is distinct from old.entry_deadline
     and old.entry_deadline is not null and clock_timestamp() >= old.entry_deadline then
    raise exception 'A closed market cannot be reopened';
  end if;
  return new;
end $$;

create trigger markets_guard before update on public.markets
  for each row execute function app.markets_guard();

-- Settlement history is append-only.
create function app.append_only() returns trigger
language plpgsql as $$
begin raise exception '% is append-only', tg_table_name; end $$;

create trigger settlement_runs_append_only before update or delete on public.settlement_runs
  for each row execute function app.append_only();
create trigger payouts_append_only before update or delete on public.payouts
  for each row execute function app.append_only();

-- Profile row on sign-up. Display name comes from sign-up metadata; never the email.
create function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 'Member'), 40));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------- row-level security

alter table public.group_settings enable row level security;
alter table public.admins enable row level security;
alter table public.members enable row level security;
alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.markets enable row level security;
alter table public.entries enable row level security;
alter table public.settlement_runs enable row level security;
alter table public.payouts enable row level security;
alter table public.money_transfers enable row level security;
alter table public.polling_snapshots enable row level security;

create policy group_read on public.group_settings for select using (app.is_member());
create policy admins_self on public.admins for select using (user_id = auth.uid());
create policy members_read on public.members for select using (app.is_member());
create policy profiles_read on public.profiles for select using (user_id = auth.uid() or app.is_member());
create policy invites_admin on public.invites for select using (app.is_admin());
create policy markets_read on public.markets for select using (app.is_member());

-- The sealed-picks rule. No admin clause.
create policy entries_sealed on public.entries for select using (
  user_id = auth.uid()
  or (app.is_member() and app.market_closed(market_id))
);

create policy runs_read on public.settlement_runs for select using (app.is_member());
create policy payouts_read on public.payouts for select using (
  user_id = auth.uid()
  or (app.is_member() and app.market_closed(market_id))
);
create policy transfers_read on public.money_transfers for select using (
  member_id = auth.uid() or app.is_admin()
);
create policy polling_read on public.polling_snapshots for select using (app.is_member());
