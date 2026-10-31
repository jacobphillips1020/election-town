-- Election Town: two ballot sizes, $25 and $50.
--
-- Every ballot covers all 12 picks; the buy-in is split across them. A $25 ballot ('half') puts half of each pick's
-- stake into that pick's pot ($2 per race, $2.50 per seat count); a $50 ballot ('full') puts in the whole stake.
-- Each pot pays out in two halves, each won the usual way (right winner, closest share; closest seat count):
--   the first half: the best call among everyone; the second half: the best call among $50 ballots.
-- This is the poker side-pot rule: nobody wins more from another player than they put in themselves.
-- If nobody in a half called it (or fewer than two are in it), that half is refunded to the people who paid into it.

alter table public.entries add column tier text not null default 'full' check (tier in ('full', 'half'));

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
  -- Main-pool ballots come in two sizes: 'full' ($50) pays the whole stake on every pick, 'half' ($25) half of it.
  if not m.featured then new.tier := 'full'; end if;
  new.commitment_cents := case when new.tier = 'half' then m.buy_in_cents / 2 else m.buy_in_cents end;
  new.updated_at := clock_timestamp();
  return new;
end $$;

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
  -- One layer per stake level ("side pots"): everyone is in the first layer; only the bigger stakes are in the next.
  levels as (select lvl, coalesce(lag(lvl) over (order by lvl), 0) as prev from (select distinct cc as lvl from s) d),
  layer as (
    select l.lvl, s.eid, s.elig, s.err, (s.cc >= l.lvl) as inl, (least(s.cc, l.lvl) - least(s.cc, l.prev)) as part
    from levels l cross join s
  ),
  lagg as (
    select y.lvl, sum(y.part)::int as pool, (count(*) filter (where y.inl))::int as n,
           (count(*) filter (where y.inl and y.elig))::int as ne, min(y.err) filter (where y.inl and y.elig) as best
    from layer y group by y.lvl
  ),
  lwin as (
    select y.lvl, y.eid, row_number() over (partition by y.lvl order by y.eid::text) as rn
    from layer y join lagg a on a.lvl = y.lvl
    where y.inl and y.elig and y.err = a.best and a.ne > 0 and a.n >= 2
  ),
  lwc as (select w.lvl, count(*)::int as c from lwin w group by w.lvl),
  pay as (
    select y.eid,
      sum(case when w.eid is not null then a.pool / c.c + case when w.rn <= a.pool % c.c then 1 else 0 end else 0 end)::int as gross,
      sum(case when a.n < 2 or a.ne = 0 then y.part else 0 end)::int as refund
    from layer y join lagg a on a.lvl = y.lvl
    left join lwc c on c.lvl = y.lvl
    left join lwin w on w.lvl = y.lvl and w.eid = y.eid
    group by y.eid
  )
  select s.eid, s.uid, s.cc, s.elig, case when s.elig then s.err end, p.gross, p.refund
  from s join pay p on p.eid = s.eid;
end $$;

drop function public.submit_ballot(jsonb);
create function public.submit_ballot(p_picks jsonb, p_tier text default 'full') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.markets; v jsonb; n int := 0; made int := 0;
begin
  perform app.require_member();
  if exists (select 1 from public.markets where featured and status <> 'rejected' and clock_timestamp() >= entry_deadline) then
    raise exception 'The pool has closed' using errcode = 'P0001';
  end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'object' then raise exception 'Make at least one pick'; end if;
  if p_tier is null or p_tier not in ('full', 'half') then raise exception 'Choose a $25 or $50 ballot'; end if;
  perform set_config('app.ballot', 'on', true);
  for m in select * from public.markets where featured and status = 'open' order by sort_order, id loop
    v := coalesce(p_picks -> (m.id::text), '{}'::jsonb);
    if jsonb_typeof(v) <> 'object' then raise exception '%: unreadable pick', m.title; end if;
    if v ?| array['winner_id', 'shares', 'seats'] then made := made + 1; end if;
    begin
      insert into public.entries (market_id, user_id, winner_id, shares, seats, commitment_cents, tier)
      values (m.id, auth.uid(), v ->> 'winner_id', v -> 'shares', v -> 'seats', 0, p_tier)
      on conflict (market_id, user_id) do update
        set winner_id = excluded.winner_id, shares = excluded.shares, seats = excluded.seats, tier = excluded.tier;
    exception when others then
      raise exception '%: %', m.title, sqlerrm;
    end;
    n := n + 1;
  end loop;
  perform set_config('app.ballot', '', true);
  if n = 0 then raise exception 'The ballot is not open'; end if;
  if made = 0 then raise exception 'Make at least one pick'; end if;
  return jsonb_build_object('picks', made, 'blank', n - made, 'tier', p_tier, 'submitted_at', clock_timestamp());
end $$;

create or replace function public.get_pool() returns jsonb
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
    'half_ballot_cents', (select coalesce(sum(buy_in_cents / 2), 0) from public.markets where featured and status not in ('rejected', 'canceled')),
    'tiers', (select jsonb_build_object('full', count(*) filter (where t.tier = 'full'), 'half', count(*) filter (where t.tier = 'half'))
              from (select distinct on (e.user_id) e.tier from public.entries e join public.markets m on m.id = e.market_id
                    where m.featured and m.status not in ('rejected', 'canceled') order by e.user_id) t),
    'my_tier', case when v_uid is not null then (
        select e.tier from public.entries e join public.markets m on m.id = e.market_id
        where m.featured and e.user_id = v_uid limit 1) end,
    'admin_ballots', case when app.is_admin() then (
        select coalesce(jsonb_agg(jsonb_build_object('name', p.display_name, 'tier', t.tier) order by p.display_name), '[]'::jsonb)
        from (select distinct on (e.user_id) e.user_id, e.tier from public.entries e join public.markets m on m.id = e.market_id
              where m.featured and m.status not in ('rejected', 'canceled') order by e.user_id) t
        join public.profiles p on p.user_id = t.user_id) end,
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
          'pots', (select jsonb_build_object(
                     'main', coalesce(sum(least(e.commitment_cents, m.buy_in_cents / 2)), 0),
                     'high', coalesce(sum(e.commitment_cents - least(e.commitment_cents, m.buy_in_cents / 2)), 0))
                   from public.entries e where e.market_id = m.id),
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
          'experts', (select x.ratings from public.expert_ratings x where x.race_key = app.race_key('senate', c.state, null, c.is_special)),
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

create or replace function public.set_pool_terms(p_deadline timestamptz, p_race_buy_in_cents int, p_seat_buy_in_cents int) returns void
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
  if p_race_buy_in_cents % 2 <> 0 or p_seat_buy_in_cents % 2 <> 0 then
    raise exception 'Stakes must split evenly in half for $25 ballots (use an even number of cents)';
  end if;
  update public.markets set entry_deadline = p_deadline,
    buy_in_cents = case when kind in ('senate_seats', 'house_seats') then p_seat_buy_in_cents else p_race_buy_in_cents end
  where featured and status = 'open';
  -- Side bets that were closing with the pool keep closing with it; new side bets use the new time.
  update public.markets set entry_deadline = p_deadline
  where not featured and status = 'open' and entry_deadline = v_old;
  update public.group_settings set default_deadline = p_deadline, updated_at = clock_timestamp() where id;
  -- Ballots already in owe the new stakes.
  perform set_config('app.ballot', 'on', true);
  update public.entries e set commitment_cents = m.buy_in_cents
  from public.markets m where m.id = e.market_id and m.featured and m.status = 'open' and e.commitment_cents <> m.buy_in_cents;
  perform set_config('app.ballot', '', true);
end $$;

revoke all on function public.submit_ballot(jsonb, text) from public, anon;
grant execute on function public.submit_ballot(jsonb, text) to authenticated;
