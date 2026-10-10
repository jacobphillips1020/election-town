-- Election Town v2: the main pool.
--
-- One ballot, entered and edited as a whole until the pool closes:
--   * the 10 Senate races that decide control. Pick the winner and their share of the two-candidate vote;
--     among those who picked the winner, the closest share takes that race's pot (the v1 race scoring);
--   * Republican seats in the next Senate, and in the next House. The closest guess takes the pot.
-- Each pick is its own pot: $4 per Senate race and $5 per seat count, so a ballot is $50. A ballot is always the
-- whole $50: a pick left blank still puts its stake in that pot, but a blank pick can't win it.
-- Side bets are any other race, opened by a member at $5. The admin can move the pool's closing time,
-- and change a side bet's stake or closing time.
-- Seat forecasts from prediction markets are stored next to the polling for the home page.

-- ---------------------------------------------------------------- schema

alter table public.markets
  add column featured boolean not null default false,
  add column sort_order int not null default 0;
alter table public.markets drop constraint markets_kind_check;
alter table public.markets add constraint markets_kind_check
  check (kind in ('senate', 'house', 'governor', 'congress', 'senate_seats', 'house_seats'));
create unique index one_live_seat_market on public.markets (kind)
  where kind in ('senate_seats', 'house_seats') and status not in ('rejected', 'canceled');

-- How to pay the organizer, shown after a ballot is submitted ("Venmo @name by Oct 30").
alter table public.group_settings add column pay_note text not null default '' check (char_length(pay_note) <= 300);

-- Expert ratings (Cook, Inside Elections, Sabato) published with each race's polling detail.
alter table public.race_polling add column experts jsonb;

-- Seat forecasts for the home page, refreshed by the server (written with the service key only).
create table public.seat_forecasts (
  chamber text primary key check (chamber in ('senate', 'house')),
  source_name text not null,
  source_url text not null,
  r_median numeric,                       -- median Republican seats implied by the market
  d_control_pct numeric,                  -- chance Democrats win the chamber, 0-100
  buckets jsonb not null default '[]',    -- [{label, lo, hi, p}] as published, p normalized to sum to 1
  fetched_at timestamptz not null default now()
);
alter table public.seat_forecasts enable row level security; -- no policies: read through get_pool()
revoke all on public.seat_forecasts from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers

create function app.is_seat_kind(p text) returns boolean
language sql immutable as $$ select p in ('congress', 'senate_seats', 'house_seats') $$;

create function app.seat_total(p text) returns int
language sql immutable as $$ select case p when 'senate_seats' then 100 when 'house_seats' then 435 end $$;

create function app.valid_r_seats(p_kind text, p jsonb) returns boolean
language sql immutable as $$
  select coalesce(jsonb_typeof(p -> 'r') = 'number' and (p ->> 'r') ~ '^[0-9]{1,3}$'
                  and (p ->> 'r')::int <= app.seat_total(p_kind), false)
$$;

-- States whose general election can be decided in a later round.
create function app.basis_for(p_state text) returns text
language sql immutable as $$
  select case when p_state in ('AK', 'ME') then 'rcv_final' when p_state = 'GA' then 'runoff_final' else 'single_round' end
$$;

create function app.race_rules(p_state text, p_basis text) returns text
language sql immutable as $$
  select 'Pick the winner and their two-way vote share: their votes divided by the votes for the two listed candidates '
      || 'only, from the certified results published by ' || app.state_name(p_state) || '''s official election authority. '
      || 'Votes for anyone else don''t count, so a 48% to 42% result with 10% for others is 53.3% to 46.7% two-way. '
      || 'Among those who picked the winner, the closest share takes this race''s pot; exact ties split it. '
      || 'If nobody picked the winner, or another candidate wins, everyone gets their stake back.'
      || case p_basis
           when 'rcv_final' then ' This race is decided by the final round of ranked-choice tabulation.'
           when 'runoff_final' then ' This race is decided by the runoff if one is needed.'
           else '' end
$$;

create function app.polling_json(p public.race_polling) returns jsonb
language sql stable as $$
  select case when p.race_key is null then null else jsonb_build_object(
    'dem_name', p.dem_name, 'rep_name', p.rep_name, 'dem_avg', p.dem_avg, 'rep_avg', p.rep_avg,
    'margin_label', p.margin_label, 'rating', p.rating, 'poll_count', p.poll_count,
    'last_poll_date', p.last_poll_date, 'page', p.page, 'fetched_at', p.fetched_at, 'experts', p.experts) end
$$;

revoke all on function app.is_seat_kind(text), app.seat_total(text), app.valid_r_seats(text, jsonb),
  app.basis_for(text), app.race_rules(text, text), app.polling_json(public.race_polling) from public;

-- ---------------------------------------------------------------- validation and guards

create or replace function app.validate_prediction(m public.markets, p_winner text, p_shares jsonb, p_seats jsonb) returns void
language plpgsql stable as $$
declare
  ids text[]; keys text[]; k text; v jsonb; n int; total int := 0; wshare int;
begin
  if m.kind in ('senate_seats', 'house_seats') then
    if p_winner is not null or p_shares is not null then raise exception 'Seat picks take a seat count only'; end if;
    if not app.valid_r_seats(m.kind, p_seats) then
      raise exception 'Republican seats must be a whole number from 0 to %', app.seat_total(m.kind);
    end if;
    return;
  end if;

  if m.kind = 'congress' then
    if p_winner is not null or p_shares is not null then raise exception 'Seat markets take seat counts only'; end if;
    perform app.validate_seats(p_seats);
    return;
  end if;

  if p_seats is not null then raise exception 'Race markets take a winner and vote shares only'; end if;
  if p_winner is null or not exists (select 1 from jsonb_array_elements(m.candidates) c where c ->> 'id' = p_winner) then
    raise exception 'Pick a winner';
  end if;
  if p_shares is null or jsonb_typeof(p_shares) <> 'object' then raise exception 'Enter the winner''s vote share'; end if;

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

  wshare := (p_shares ->> p_winner)::int;
  for k, v in select * from jsonb_each(p_shares) loop
    if k <> p_winner and k <> 'other' and v::text::int >= wshare then
      if m.has_other then raise exception 'The selected winner must have the largest share'; end if;
      raise exception 'The winner''s share must be more than 50%%';
    end if;
  end loop;
end $$;

create or replace function app.entries_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m public.markets;
begin
  select * into m from public.markets
  where id = case when tg_op = 'DELETE' then old.market_id else new.market_id end for share;
  if m.id is null then raise exception 'Unknown market'; end if;
  if m.status <> 'open' then raise exception 'This market is not open for entries'; end if;
  if clock_timestamp() >= m.entry_deadline then raise exception 'Entries are closed' using errcode = 'P0001'; end if;
  -- Main-pool picks are entered, changed and withdrawn together, through the ballot functions only.
  if m.featured and coalesce(current_setting('app.ballot', true), '') <> 'on' then
    raise exception 'Main-pool picks are made on the ballot';
  end if;

  if tg_op = 'DELETE' then return old; end if;

  if tg_op = 'UPDATE' and (new.market_id, new.user_id) is distinct from (old.market_id, old.user_id) then
    raise exception 'An entry cannot move to another market or person';
  end if;
  -- A blank main-pool pick: the stake is in the pot, with no prediction (so it can't win).
  if not (m.featured and new.winner_id is null and new.shares is null and new.seats is null) then
    perform app.validate_prediction(m, new.winner_id, new.shares, new.seats);
    if m.kind in ('senate_seats', 'house_seats') then new.seats := jsonb_build_object('r', (new.seats ->> 'r')::int); end if;
  end if;
  new.commitment_cents := m.buy_in_cents;
  new.updated_at := clock_timestamp();
  return new;
end $$;

-- What a pick means freezes with the first entry. Stakes and closing times may move while a market is open
-- (admin only; everyone already in then owes the new stake). A closed market can never be reopened.
create or replace function app.markets_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.entries where market_id = old.id)
     and (new.kind, new.candidates, new.has_other, new.outcome_basis, new.rules_note, new.featured)
         is distinct from
         (old.kind, old.candidates, old.has_other, old.outcome_basis, old.rules_note, old.featured)
  then
    raise exception 'Terms are locked once the first entry exists. Cancel and replace the market instead.';
  end if;
  if old.entry_deadline is not null and clock_timestamp() >= old.entry_deadline then
    if new.entry_deadline is distinct from old.entry_deadline then raise exception 'A closed market cannot be reopened'; end if;
    if new.buy_in_cents is distinct from old.buy_in_cents then raise exception 'The stake cannot change after entries close'; end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- scoring + results

-- Per-entry outcome for a result. Pure computation; writes nothing.
--  races:  only entries that picked the winner are eligible; closest share for the winner takes the pot.
--  seats:  everyone is eligible; closest Republican seat count takes the pot.
--  congress (retired): half the sum of the six absolute seat differences.
--  Ties split the whole pool; leftover cents go to the lowest entry ids (stable order).
--  A blank main-pool pick is in the pot but never eligible.
--  Fewer than 2 entries, or nobody eligible: everyone is refunded.
create or replace function app.compute_outcome(p_market uuid, p_winner text, p_share int, p_seats jsonb)
returns table (entry_id uuid, user_id uuid, commitment_cents int, eligible boolean,
               error_value int, gross_cents int, refund_cents int)
language plpgsql stable security definer set search_path = '' as $$
declare m public.markets;
begin
  select * into m from public.markets where id = p_market;
  return query
  with s as (
    select e.id as eid, e.user_id as uid, e.commitment_cents as cc,
      case when app.is_seat_kind(m.kind) then e.seats is not null else coalesce(e.winner_id = p_winner, false) end as elig,
      case when m.kind = 'congress' then
        ( abs((e.seats #>> '{house,d}')::int  - (p_seats #>> '{house,d}')::int)
        + abs((e.seats #>> '{house,r}')::int  - (p_seats #>> '{house,r}')::int)
        + abs((e.seats #>> '{house,o}')::int  - (p_seats #>> '{house,o}')::int)
        + abs((e.seats #>> '{senate,d}')::int - (p_seats #>> '{senate,d}')::int)
        + abs((e.seats #>> '{senate,r}')::int - (p_seats #>> '{senate,r}')::int)
        + abs((e.seats #>> '{senate,o}')::int - (p_seats #>> '{senate,o}')::int) ) / 2
      when m.kind in ('senate_seats', 'house_seats') then abs((e.seats ->> 'r')::int - (p_seats ->> 'r')::int)
      else abs((e.shares ->> p_winner)::int - p_share) end as err
    from public.entries e where e.market_id = p_market
  ),
  agg as (
    select count(*)::int as n, coalesce(sum(cc), 0)::int as pool,
           coalesce(min(err) filter (where elig), 0)::int as best,
           (count(*) filter (where elig))::int as ne
    from s
  ),
  win as (
    select s.eid, row_number() over (order by s.eid::text) as rn
    from s cross join agg
    where s.elig and s.err = agg.best and agg.ne > 0 and agg.n >= 2
  ),
  wc as (select count(*)::int as c from win)
  select s.eid, s.uid, s.cc, s.elig, case when s.elig then s.err end,
         case when w.eid is not null
              then agg.pool / wc.c + case when w.rn <= agg.pool % wc.c then 1 else 0 end
              else 0 end,
         case when agg.n < 2 or agg.ne = 0 then s.cc else 0 end
  from s cross join agg cross join wc left join win w on w.eid = s.eid;
end $$;

create or replace function app.validate_result(m public.markets, p_winner text, p_share int, p_seats jsonb) returns void
language plpgsql stable as $$
begin
  if m.kind in ('senate_seats', 'house_seats') then
    if not app.valid_r_seats(m.kind, p_seats) then
      raise exception 'Enter the Republican seat count (0 to %)', app.seat_total(m.kind);
    end if;
  elsif m.kind = 'congress' then
    perform app.validate_seats(p_seats);
  else
    if p_winner is null or not exists (select 1 from jsonb_array_elements(m.candidates) c where c ->> 'id' = p_winner) then
      raise exception 'The winner must be one of the listed candidates';
    end if;
    if p_share is null or p_share < 1 or p_share > 1000 then
      raise exception 'Winner share must be between 0.1 and 100.0';
    end if;
  end if;
end $$;

create function app.result_seats(p_kind text, p_seats jsonb) returns jsonb
language sql immutable as $$
  select case when p_kind in ('senate_seats', 'house_seats') then jsonb_build_object('r', (p_seats ->> 'r')::int)
              when p_kind = 'congress' then p_seats end
$$;
revoke all on function app.result_seats(text, jsonb) from public;

create or replace function public.enter_result(p_market uuid, p_winner text, p_share_tenths int, p_seats jsonb, p_source_url text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.markets; v_seat boolean;
begin
  perform app.require_admin();
  perform app.sweep_underfilled();
  select * into m from public.markets where id = p_market for update;
  if m.id is null then raise exception 'Market not found'; end if;
  if m.status <> 'open' then raise exception 'This market is not awaiting results'; end if;
  if clock_timestamp() < m.entry_deadline then raise exception 'Entries are still open'; end if;
  perform app.validate_result(m, p_winner, p_share_tenths, p_seats);
  if p_source_url is null or p_source_url !~ '^https?://' then
    raise exception 'A result source URL (http or https) is required';
  end if;
  v_seat := app.is_seat_kind(m.kind);
  update public.markets set
    result_winner_id = case when v_seat then null else p_winner end,
    result_winner_share_tenths = case when v_seat then null else p_share_tenths end,
    result_seats = app.result_seats(m.kind, p_seats),
    result_source_url = p_source_url, result_entered_at = clock_timestamp()
  where id = p_market;
end $$;

create or replace function public.correct_settlement(p_market uuid, p_expected_version int, p_winner text,
                                          p_share_tenths int, p_seats jsonb, p_source_url text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.markets; v_cur int; v_run uuid; v_seat boolean;
begin
  perform app.require_admin();
  select * into m from public.markets where id = p_market for update;
  if m.id is null or m.status <> 'settled' then raise exception 'Only settled markets can be corrected'; end if;
  select max(version) into v_cur from public.settlement_runs where market_id = p_market;
  if v_cur is distinct from p_expected_version then
    raise exception 'This market was already corrected (now at version %). Reload and review.', v_cur;
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'A reason is required for a correction'; end if;
  if p_source_url is null or p_source_url !~ '^https?://' then raise exception 'A result source URL is required'; end if;
  perform app.validate_result(m, p_winner, p_share_tenths, p_seats);
  v_seat := app.is_seat_kind(m.kind);
  update public.markets set
    result_winner_id = case when v_seat then null else p_winner end,
    result_winner_share_tenths = case when v_seat then null else p_share_tenths end,
    result_seats = app.result_seats(m.kind, p_seats),
    result_source_url = p_source_url, result_entered_at = clock_timestamp()
  where id = p_market;
  v_run := app.write_run(p_market, null,
    jsonb_build_object('winner_id', case when v_seat then null else p_winner end,
                       'winner_share_tenths', case when v_seat then null else p_share_tenths end,
                       'seats', app.result_seats(m.kind, p_seats), 'source_url', p_source_url),
    btrim(p_reason), false, auth.uid());
  return jsonb_build_object('run_id', v_run, 'version', v_cur + 1);
end $$;

-- ---------------------------------------------------------------- the ballot

-- p_picks: {"<market id>": {"winner_id": "c1", "shares": {"c1": 515, "c2": 485}} | {"seats": {"r": 48}} | {}}
-- The ballot is always the whole set: a missing or empty pick is entered blank (its stake still goes in that pot).
-- At least one real pick is required. All or nothing: one bad pick saves none of them.
create function public.submit_ballot(p_picks jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.markets; v jsonb; n int := 0; made int := 0;
begin
  perform app.require_member();
  if exists (select 1 from public.markets where featured and status <> 'rejected' and clock_timestamp() >= entry_deadline) then
    raise exception 'The pool has closed' using errcode = 'P0001';
  end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'object' then raise exception 'Make at least one pick'; end if;
  perform set_config('app.ballot', 'on', true);
  for m in select * from public.markets where featured and status = 'open' order by sort_order, id loop
    v := coalesce(p_picks -> (m.id::text), '{}'::jsonb);
    if jsonb_typeof(v) <> 'object' then raise exception '%: unreadable pick', m.title; end if;
    if v ?| array['winner_id', 'shares', 'seats'] then made := made + 1; end if;
    begin
      insert into public.entries (market_id, user_id, winner_id, shares, seats, commitment_cents)
      values (m.id, auth.uid(), v ->> 'winner_id', v -> 'shares', v -> 'seats', 0)
      on conflict (market_id, user_id) do update
        set winner_id = excluded.winner_id, shares = excluded.shares, seats = excluded.seats;
    exception when others then
      raise exception '%: %', m.title, sqlerrm;
    end;
    n := n + 1;
  end loop;
  perform set_config('app.ballot', '', true);
  if n = 0 then raise exception 'The ballot is not open'; end if;
  if made = 0 then raise exception 'Make at least one pick'; end if;
  return jsonb_build_object('picks', made, 'blank', n - made, 'submitted_at', clock_timestamp());
end $$;

create function public.withdraw_ballot() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform app.require_member();
  perform set_config('app.ballot', 'on', true);
  delete from public.entries e using public.markets m
  where m.id = e.market_id and m.featured and m.status = 'open' and e.user_id = auth.uid();
  get diagnostics n = row_count;
  perform set_config('app.ballot', '', true);
  return n;
end $$;

-- Everything the home page and the ballot need, in one call. Public.
-- Before the close: polling, forecasts, counts and pots, and (signed in) your own ballot.
-- After the close: also the group's split for every pick; members also get every ballot, anonymized.
create function public.get_pool() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_member boolean := app.is_member();
  v_deadline timestamptz;
  v_closed boolean;
begin
  perform app.sweep_underfilled();
  select min(entry_deadline) into v_deadline from public.markets where featured and status not in ('rejected', 'canceled');
  v_closed := coalesce(app.deadline_passed_at(v_deadline, clock_timestamp()), false);
  return jsonb_build_object(
    'deadline', v_deadline,
    'closed', v_closed,
    'ballot_cents', (select coalesce(sum(buy_in_cents), 0) from public.markets where featured and status not in ('rejected', 'canceled')),
    'ballots', (select count(distinct e.user_id) from public.entries e join public.markets m on m.id = e.market_id
                where m.featured and m.status not in ('rejected', 'canceled')),
    'pot_cents', (select coalesce(sum(e.commitment_cents), 0) from public.entries e join public.markets m on m.id = e.market_id
                  where m.featured and m.status not in ('rejected', 'canceled')),
    'pay_note', case when v_member then (select pay_note from public.group_settings) end,
    'my_ballot', case when v_uid is not null then (
        select jsonb_object_agg(e.market_id, jsonb_build_object('winner_id', e.winner_id, 'shares', e.shares, 'seats', e.seats))
        from public.entries e join public.markets m on m.id = e.market_id
        where m.featured and e.user_id = v_uid) end,
    'my_updated_at', case when v_uid is not null then (
        select max(e.updated_at) from public.entries e join public.markets m on m.id = e.market_id
        where m.featured and e.user_id = v_uid) end,
    'markets', (select coalesce(jsonb_agg(app.market_json(m) || jsonb_build_object(
          'polling', (select app.polling_json(p) from public.race_polling p
                      where p.race_key = app.race_key(m.polling_ref ->> 'race_type', m.polling_ref ->> 'state',
                                                      m.polling_ref ->> 'district', (m.polling_ref ->> 'special')::boolean)),
          'tally', case when v_closed then (
            select jsonb_build_object(
              'n', count(*) filter (where e.winner_id is not null or e.seats is not null),
              'blank', count(*) filter (where e.winner_id is null and e.seats is null),
              'picks', (select coalesce(jsonb_object_agg(x.w, x.c), '{}'::jsonb)
                        from (select e2.winner_id w, count(*) c from public.entries e2
                              where e2.market_id = m.id and e2.winner_id is not null group by 1) x),
              'mean_shares', (select coalesce(jsonb_object_agg(k.key, round(k.avg, 1)), '{}'::jsonb)
                              from (select s.key, avg(s.value::text::numeric) avg
                                    from public.entries e3, jsonb_each(e3.shares) s
                                    where e3.market_id = m.id group by 1) k),
              'r_mean', round(avg((e.seats ->> 'r')::numeric), 1),
              'r_median', percentile_cont(0.5) within group (order by (e.seats ->> 'r')::numeric),
              'r_min', min((e.seats ->> 'r')::int), 'r_max', max((e.seats ->> 'r')::int))
            from public.entries e where e.market_id = m.id) end)
        order by m.sort_order, m.id), '[]'::jsonb)
      from public.markets m where m.featured and m.status <> 'rejected'),
    'ballots_grid', case when v_closed and v_member then (
        select coalesce(jsonb_agg(jsonb_build_object('you', b.user_id = v_uid, 'picks', b.picks) order by b.k), '[]'::jsonb)
        from (select e.user_id, md5(e.user_id::text || v_deadline::text) k,
                     jsonb_object_agg(e.market_id, jsonb_strip_nulls(jsonb_build_object(
                       'w', e.winner_id, 's', e.shares -> e.winner_id, 'r', e.seats -> 'r'))) picks
              from public.entries e join public.markets m on m.id = e.market_id
              where m.featured and m.status not in ('rejected', 'canceled')
              group by e.user_id) b) end,
    'senate', (select coalesce(jsonb_agg(jsonb_build_object(
          'state', c.state, 'special', c.is_special, 'polling', app.polling_json(p),
          'market', (select jsonb_build_object('id', mk.id, 'featured', mk.featured) from public.markets mk
                     where mk.status in ('open', 'settled') and mk.polling_ref ->> 'race_type' = 'senate'
                       and mk.polling_ref ->> 'state' = c.state and (mk.polling_ref ->> 'special')::boolean = c.is_special
                     limit 1))
        order by c.state, c.is_special), '[]'::jsonb)
      from public.race_catalog c
      left join public.race_polling p on p.race_key = app.race_key(c.race_type, c.state, c.district, c.is_special)
      where c.race_type = 'senate'),
    'house_polls', (select coalesce(jsonb_agg(jsonb_build_object('state', p.state, 'district', p.district,
                        'margin', round(p.dem_avg - p.rep_avg, 1)) order by p.dem_avg - p.rep_avg), '[]'::jsonb)
      from public.race_polling p where p.race_type = 'house' and p.dem_avg is not null and p.rep_avg is not null),
    'forecasts', (select coalesce(jsonb_object_agg(f.chamber, to_jsonb(f) - 'chamber'), '{}'::jsonb) from public.seat_forecasts f),
    'polling_fetched_at', (select max(p.fetched_at) from public.race_polling p));
end $$;

-- ---------------------------------------------------------------- admin: closing times, stakes, payment note

create function public.set_pool_terms(p_deadline timestamptz, p_race_buy_in_cents int, p_seat_buy_in_cents int) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old timestamptz;
begin
  perform app.require_admin();
  select min(entry_deadline) into v_old from public.markets where featured and status = 'open';
  if v_old is null then raise exception 'The pool is not open'; end if;
  if clock_timestamp() >= v_old then raise exception 'The pool has closed and cannot be reopened'; end if;
  if p_deadline is null or p_deadline <= clock_timestamp() then raise exception 'The closing time must be in the future'; end if;
  if p_deadline > app.election_day_start() then
    raise exception 'The pool must close before Election Day (Nov 3, 12:00 a.m. ET)';
  end if;
  if p_race_buy_in_cents is null or p_race_buy_in_cents not between 100 and 100000
     or p_seat_buy_in_cents is null or p_seat_buy_in_cents not between 100 and 100000 then
    raise exception 'Stakes must be between $1 and $1,000';
  end if;
  update public.markets set entry_deadline = p_deadline,
    buy_in_cents = case when kind in ('senate_seats', 'house_seats') then p_seat_buy_in_cents else p_race_buy_in_cents end
  where featured and status = 'open';
  -- Side bets that were closing with the pool keep closing with it; new side bets use the new time.
  update public.markets set entry_deadline = p_deadline
  where not featured and status = 'open' and entry_deadline = v_old;
  update public.group_settings set default_deadline = p_deadline, updated_at = clock_timestamp();
  -- Ballots already in owe the new stakes.
  perform set_config('app.ballot', 'on', true);
  update public.entries e set commitment_cents = m.buy_in_cents
  from public.markets m where m.id = e.market_id and m.featured and m.status = 'open' and e.commitment_cents <> m.buy_in_cents;
  perform set_config('app.ballot', '', true);
end $$;

create function public.set_market_terms(p_id uuid, p_buy_in_cents int, p_deadline timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.markets;
begin
  perform app.require_admin();
  select * into m from public.markets where id = p_id for update;
  if m.id is null then raise exception 'Market not found'; end if;
  if m.featured then raise exception 'Main-pool picks follow the pool''s stakes and closing time'; end if;
  if m.status <> 'open' or clock_timestamp() >= m.entry_deadline then raise exception 'Only open side bets can be changed'; end if;
  if p_deadline is null or p_deadline <= clock_timestamp() then raise exception 'The closing time must be in the future'; end if;
  if p_deadline > app.election_day_start() then raise exception 'Bets must close before Election Day (Nov 3, 12:00 a.m. ET)'; end if;
  if p_buy_in_cents is null or p_buy_in_cents not between 100 and 100000 then raise exception 'Stake must be between $1 and $1,000'; end if;
  update public.markets set buy_in_cents = p_buy_in_cents, entry_deadline = p_deadline where id = p_id;
  update public.entries set commitment_cents = p_buy_in_cents where market_id = p_id and commitment_cents <> p_buy_in_cents;
end $$;

create function public.set_pay_note(p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_admin();
  if char_length(btrim(coalesce(p_note, ''))) > 300 then raise exception 'Keep the payment note under 300 characters'; end if;
  update public.group_settings set pay_note = btrim(coalesce(p_note, '')), updated_at = clock_timestamp();
end $$;

-- Replaced by set_pool_terms (pool closing time and stakes) and set_market_terms (one side bet).
drop function public.set_group_defaults(int, timestamptz);

-- ---------------------------------------------------------------- side bets: same pick, $5 by default

create or replace function public.launch_race(p_race_type text, p_state text, p_district text default null,
                                               p_special boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_state text := upper(btrim(coalesce(p_state, '')));
  v_dist text;
  v_special boolean := coalesce(p_special, false);
  v_ref jsonb; v_name text; v_title text; v_label text; v_basis text; v_id uuid;
  v_dem text; v_rep text; v_cands jsonb; g public.group_settings;
begin
  perform app.require_member();
  if p_race_type is null or p_race_type not in ('senate', 'governor', 'house') then
    raise exception 'Choose a Senate, House, or governor race';
  end if;
  v_dist := case when p_race_type = 'house' then upper(btrim(coalesce(p_district, ''))) end;
  if v_dist ~ '^[0-9]{1,2}$' then v_dist := lpad(v_dist::int::text, 2, '0'); end if;

  if not exists (select 1 from public.race_catalog c
                 where c.race_type = p_race_type and c.state = v_state
                   and c.district is not distinct from v_dist and c.is_special = v_special) then
    raise exception 'That race is not on the 2026 ballot';
  end if;
  v_ref := app.normalize_polling_ref(p_race_type,
             jsonb_build_object('state', v_state, 'district', v_dist, 'special', v_special));
  if exists (select 1 from public.markets m
             where m.status in ('proposed', 'open', 'settled')
               and m.polling_ref ->> 'race_type' = p_race_type and m.polling_ref ->> 'state' = v_state
               and m.polling_ref ->> 'district' is not distinct from v_dist
               and (m.polling_ref ->> 'special')::boolean = v_special) then
    raise exception 'This race already has a bet. Open it to make your pick.';
  end if;

  v_name := app.state_name(v_state);
  v_title := case p_race_type
    when 'senate' then v_name || ' Senate' || case when v_special then ' (special)' else '' end
    when 'governor' then v_name || ' governor'
    else case when v_dist = 'AL' then v_name || ' at-large House' else v_state || '-' || v_dist || ' House' end end;
  v_label := case p_race_type
    when 'senate' then v_name || ' — Senate' || case when v_special then ' (special election)' else '' end
    when 'governor' then v_name || ' — Governor'
    else case when v_dist = 'AL' then v_name || ' — At-large' else v_name || ' — District ' || v_dist::int end end;
  v_basis := app.basis_for(v_state);

  -- Candidates come from the race board (names in the published polls). No names, no launch:
  -- the bet must be complete the moment it opens, because the first pick locks its terms.
  select p.dem_name, p.rep_name into v_dem, v_rep from public.race_polling p
  where p.race_key = app.race_key(p_race_type, v_state, v_dist, v_special);
  if v_dem is null or v_rep is null or lower(v_dem) = lower(v_rep) then
    raise exception 'The candidates for this race haven''t been published yet, so it can''t be opened';
  end if;
  v_cands := jsonb_build_array(jsonb_build_object('name', v_dem, 'party', 'D'), jsonb_build_object('name', v_rep, 'party', 'R'));

  select * into g from public.group_settings;
  if clock_timestamp() >= g.default_deadline then
    raise exception 'Bets for this election have closed';
  end if;

  insert into public.markets (kind, title, jurisdiction, status, proposed_by, candidates, has_other,
                              outcome_basis, rules_note, polling_ref, buy_in_cents, entry_deadline, approved_at)
  values (p_race_type, v_title, v_label, 'open', auth.uid(), app.normalize_candidates(v_cands),
          false, v_basis, app.race_rules(v_state, v_basis), v_ref, g.default_buy_in_cents, g.default_deadline, clock_timestamp())
  returning id into v_id;
  return v_id;
end $$;

-- The race board also says which races are on the main ballot, and carries expert ratings.
create or replace function public.race_board() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'race_type', c.race_type, 'state', c.state, 'district', c.district, 'special', c.is_special,
      'polling', app.polling_json(p),
      'market', (select jsonb_build_object('id', m.id, 'title', m.title, 'featured', m.featured,
                   'phase', case when m.status = 'open' and app.deadline_passed_at(m.entry_deadline, clock_timestamp())
                                 then 'closed' else m.status end)
                 from public.markets m
                 where m.status in ('proposed', 'open', 'settled') and m.polling_ref ->> 'race_type' = c.race_type
                   and m.polling_ref ->> 'state' = c.state and (m.polling_ref ->> 'district') is not distinct from c.district
                   and (m.polling_ref ->> 'special')::boolean = c.is_special
                 limit 1))), '[]'::jsonb)
    from public.race_catalog c
    left join public.race_polling p on p.race_key = app.race_key(c.race_type, c.state, c.district, c.is_special)
  );
end $$;

-- ---------------------------------------------------------------- data: the slate

-- Retire the six-number Control of Congress market (its entries are refunded). The seat picks replace it.
do $$
declare r record;
begin
  for r in select id from public.markets where kind = 'congress' and status = 'open' loop
    perform app.write_run(r.id, 'canceled_refund', '{}'::jsonb,
                          'Replaced by the Senate seats and House seats picks on the main ballot', true, null);
    update public.markets set status = 'canceled',
      cancel_reason = 'Replaced by the Senate seats and House seats picks on the main ballot' where id = r.id;
  end loop;
end $$;

-- Picks close a week before the polls: Tuesday Oct 27, 11:59 p.m. Eastern (EDT, UTC-4). The admin can move it.
-- Open markets still on the old default follow.
update public.markets m set entry_deadline = '2026-10-28 03:59:00+00'
from public.group_settings g
where m.status = 'open' and m.entry_deadline = g.default_deadline and clock_timestamp() < '2026-10-28 03:59:00+00';
update public.group_settings set default_buy_in_cents = 500, default_deadline = '2026-10-28 03:59:00+00'
where clock_timestamp() < '2026-10-28 03:59:00+00';

-- Open side bets that nobody has entered yet move to the new terms.
update public.markets m set buy_in_cents = 500, has_other = false,
  rules_note = app.race_rules(m.polling_ref ->> 'state', m.outcome_basis)
where m.status = 'open' and m.kind in ('senate', 'house', 'governor') and not m.featured
  and not exists (select 1 from public.entries e where e.market_id = m.id);

-- The 10 Senate races that decide control (expert battlegrounds: Cook, Inside Elections, Sabato), A to Z.
insert into public.markets (kind, title, jurisdiction, status, candidates, has_other, outcome_basis, rules_note,
                            buy_in_cents, entry_deadline, approved_at, polling_ref, featured, sort_order)
select 'senate',
       app.state_name(v.st) || ' Senate' || case when v.sp then ' (special)' else '' end,
       app.state_name(v.st) || ' — Senate' || case when v.sp then ' (special election)' else '' end,
       'open',
       app.normalize_candidates(jsonb_build_array(jsonb_build_object('name', v.n1, 'party', v.p1),
                                                  jsonb_build_object('name', v.n2, 'party', v.p2))),
       false, app.basis_for(v.st), app.race_rules(v.st, app.basis_for(v.st)),
       400, g.default_deadline, clock_timestamp(),
       jsonb_build_object('race_type', 'senate', 'state', v.st, 'district', null, 'special', v.sp),
       true, v.ord
from (values
  (1,  'AK', false, 'Mary Peltola',    'D', 'Dan Sullivan',    'R'),
  (2,  'GA', false, 'Jon Ossoff',      'D', 'Mike Collins',    'R'),
  (3,  'IA', false, 'Josh Turek',      'D', 'Ashley Hinson',   'R'),
  (4,  'ME', false, 'Troy Jackson',    'D', 'Susan Collins',   'R'),
  (5,  'MI', false, 'Abdul El-Sayed',  'D', 'Mike Rogers',     'R'),
  (6,  'NE', false, 'Dan Osborn',      'I', 'Pete Ricketts',   'R'),
  (7,  'NH', false, 'Chris Pappas',    'D', 'John E. Sununu',  'R'),
  (8,  'NC', false, 'Roy Cooper',      'D', 'Michael Whatley', 'R'),
  (9,  'OH', true,  'Sherrod Brown',   'D', 'Jon Husted',      'R'),
  (10, 'TX', false, 'James Talarico',  'D', 'Ken Paxton',      'R')
) v(ord, st, sp, n1, p1, n2, p2)
cross join public.group_settings g
where not exists (select 1 from public.markets m
                  where m.status in ('proposed', 'open', 'settled') and m.polling_ref ->> 'race_type' = 'senate'
                    and m.polling_ref ->> 'state' = v.st and (m.polling_ref ->> 'special')::boolean = v.sp);

insert into public.markets (kind, title, jurisdiction, status, candidates, has_other, outcome_basis, rules_note,
                            buy_in_cents, entry_deadline, approved_at, featured, sort_order)
select v.kind, v.title, v.jur, 'open', '[]'::jsonb, false, 'single_round', v.note, 500, g.default_deadline, clock_timestamp(), true, v.ord
from (values
  (11, 'senate_seats', 'Senate seats', 'United States Senate',
   'Republican seats in the Senate of the 120th Congress: all 100 seats, including the 65 not up this year, as decided by '
   || 'the November 3 elections and any runoffs. Democrats and independents both count as not Republican. Later '
   || 'appointments, party switches and vacancies don''t change the result. The closest guess takes the pot; exact ties split it.'),
  (12, 'house_seats', 'House seats', 'United States House',
   'Republican seats in the House of the 120th Congress (435 seats), as decided by the November 3 elections, runoffs and '
   || 'certified recounts. Later vacancies and party switches don''t change the result. The closest guess takes the pot; '
   || 'exact ties split it.')
) v(ord, kind, title, jur, note)
cross join public.group_settings g
where not exists (select 1 from public.markets m where m.kind = v.kind and m.status not in ('rejected', 'canceled'));

-- ---------------------------------------------------------------- privileges

revoke all on function public.get_pool(), public.submit_ballot(jsonb), public.withdraw_ballot(),
  public.set_pool_terms(timestamptz, int, int), public.set_market_terms(uuid, int, timestamptz),
  public.set_pay_note(text) from public, anon;
grant execute on function public.get_pool() to anon, authenticated;
grant execute on function public.submit_ballot(jsonb), public.withdraw_ballot(),
  public.set_pool_terms(timestamptz, int, int), public.set_market_terms(uuid, int, timestamptz),
  public.set_pay_note(text) to authenticated;
