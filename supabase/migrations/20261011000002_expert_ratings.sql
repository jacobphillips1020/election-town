-- Election Town: expert race ratings come from a reliable, permitted source.
--
-- The PollingSource feed's "expert_ratings" was stale and wrong (Alaska's Cook rating was "Solid R"; Cook's own page
-- says Toss Up, and 6 of 13 spot-checked races differed). Ratings are now read daily from the "Predictions" table on
-- Wikipedia's 2026 Senate elections page (official MediaWiki API, CC BY-SA), which carries Cook, Inside Elections and
-- Sabato with each forecaster's own date. Cook's terms prohibit automated access, so their site is not scraped.

create table public.expert_ratings (
  race_key text primary key,                   -- 'senate:AK::0' (type:state:district:special), same as race_polling
  ratings jsonb not null,                      -- [{"source":"Cook Political Report","rating":"Toss Up","as_of":"2026-10-06"}]
  fetched_at timestamptz not null default now()
);
alter table public.expert_ratings enable row level security; -- no policies: clients read through get_pool() / race_board()
revoke all on public.expert_ratings from public, anon, authenticated;

create or replace function app.polling_json(p public.race_polling) returns jsonb
language sql stable as $$
  select case when p.race_key is null then null else jsonb_build_object(
    'dem_name', p.dem_name, 'rep_name', p.rep_name, 'dem_avg', p.dem_avg, 'rep_avg', p.rep_avg,
    'margin_label', p.margin_label, 'rating', p.rating, 'poll_count', p.poll_count,
    'last_poll_date', p.last_poll_date, 'page', p.page, 'fetched_at', p.fetched_at,
    'experts', (select x.ratings from public.expert_ratings x where x.race_key = p.race_key)) end
$$;

-- Same function as before, plus each Senate race's ratings (so races without polling show them too).
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

alter table public.race_polling drop column experts;
