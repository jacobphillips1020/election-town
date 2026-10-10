-- Election Town: public browsing and open sign-up.
-- Anyone can browse markets, polling, entry counts and pools, and the race board. Signing up is needed
-- only to propose or enter. Picks, names on picks, balances and phone numbers stay member-only.
-- New accounts join the group automatically while group_settings.open_signup is true (admin switch).

alter table public.group_settings add column open_signup boolean not null default true;

-- ---------------------------------------------------------------- public reads (metadata only)

drop policy markets_read on public.markets;
create policy markets_read on public.markets for select using (true);
drop policy polling_read on public.polling_snapshots;
create policy polling_read on public.polling_snapshots for select using (true);
drop policy runs_read on public.settlement_runs;
create policy runs_read on public.settlement_runs for select using (true);
drop policy catalog_read on public.race_catalog;
create policy catalog_read on public.race_catalog for select using (true);
grant usage on schema public to anon;
grant select on public.markets, public.polling_snapshots, public.settlement_runs, public.race_catalog to anon;

-- Reads become definer functions with explicit privacy rules, so they work for visitors too.
create or replace function app.market_stats(p_market uuid) returns table (entrants int, pool_cents int)
language plpgsql volatile security definer set search_path = '' as $$
begin
  return query
    select count(*)::int, coalesce(sum(e.commitment_cents), 0)::int
    from public.entries e where e.market_id = p_market;
end $$;

create or replace function app.market_json(m public.markets) returns jsonb
language sql volatile security definer set search_path = '' as $$
  select (case when m.status = 'settled' then to_jsonb(m)
               else to_jsonb(m) - 'result_winner_id' - 'result_winner_share_tenths' - 'result_seats'
                                - 'result_source_url' - 'result_entered_at' end)
         - 'proposed_by'
    || jsonb_build_object(
         'phase', case when m.status = 'open' and app.deadline_passed_at(m.entry_deadline, clock_timestamp())
                       then 'closed' else m.status end,
         'entrants', s.entrants, 'pool_cents', s.pool_cents,
         'has_entry', exists (select 1 from public.entries e where e.market_id = m.id and e.user_id = auth.uid()),
         'proposed_by_me', m.proposed_by = auth.uid(),
         'proposed_by_name', case when app.is_member() then (select display_name from public.profiles where user_id = m.proposed_by) end)
  from app.market_stats(m.id) s
$$;

create or replace function public.list_markets() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.sweep_underfilled();
  return coalesce((select jsonb_agg(app.market_json(m) order by m.created_at, m.id) from public.markets m), '[]'::jsonb);
end $$;

create or replace function public.get_market(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare m public.markets; v_closed boolean;
begin
  perform app.sweep_underfilled();
  select * into m from public.markets where id = p_id;
  if m.id is null then raise exception 'Market not found'; end if;
  v_closed := app.deadline_passed_at(m.entry_deadline, clock_timestamp());
  return jsonb_build_object(
    'market', app.market_json(m),
    'my_entry', case when auth.uid() is not null then (select to_jsonb(e) from public.entries e where e.market_id = p_id and e.user_id = auth.uid()) end,
    -- Others' picks: group members only, and only after close. (RLS enforces the same on the table.)
    'entries', case when v_closed and app.is_member() then
      (select coalesce(jsonb_agg(jsonb_build_object(
          'id', e.id, 'user_id', e.user_id, 'display_name', p.display_name, 'winner_id', e.winner_id,
          'shares', e.shares, 'seats', e.seats, 'commitment_cents', e.commitment_cents)
          order by p.display_name, e.id), '[]'::jsonb)
       from public.entries e join public.profiles p on p.user_id = e.user_id where e.market_id = p_id) end,
    'polling', jsonb_build_object(
      'latest', (select to_jsonb(s) from public.polling_snapshots s where s.market_id = p_id
                 order by s.fetched_at desc limit 1),
      'at_close', case when v_closed then (select to_jsonb(s) from public.polling_snapshots s
                 where s.market_id = p_id and s.fetched_at <= m.entry_deadline
                 order by s.fetched_at desc limit 1) end),
    'runs', (select coalesce(jsonb_agg(jsonb_build_object('version', r.version, 'outcome', r.outcome,
               'reason', r.reason, 'result', r.result, 'pool_cents', r.pool_cents, 'created_at', r.created_at)
               order by r.version), '[]'::jsonb) from public.settlement_runs r where r.market_id = p_id),
    'payouts', (select coalesce(jsonb_agg(jsonb_build_object('entry_id', py.entry_id, 'user_id', py.user_id,
               'eligible', py.eligible, 'error_value', py.error_value, 'gross_cents', py.gross_cents,
               'refund_cents', py.refund_cents, 'commitment_cents', py.commitment_cents)), '[]'::jsonb)
               from public.payouts py
               where py.run_id = (select r.id from public.settlement_runs r where r.market_id = p_id
                                  order by r.version desc limit 1)
                 and (py.user_id = auth.uid() or (v_closed and app.is_member()))));
end $$;

create or replace function public.race_board() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'race_type', c.race_type, 'state', c.state, 'district', c.district, 'special', c.is_special,
      'polling', case when p.race_key is null then null else jsonb_build_object(
          'dem_name', p.dem_name, 'rep_name', p.rep_name, 'dem_avg', p.dem_avg, 'rep_avg', p.rep_avg,
          'margin_label', p.margin_label, 'rating', p.rating, 'poll_count', p.poll_count,
          'last_poll_date', p.last_poll_date, 'page', p.page, 'fetched_at', p.fetched_at) end,
      'market', (select jsonb_build_object('id', m.id, 'title', m.title,
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

-- ---------------------------------------------------------------- joining

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_phone text := app.normalize_phone(new.raw_user_meta_data ->> 'phone');
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 'Member'), 40));
  if v_phone is not null then
    insert into public.member_contacts (user_id, phone) values (new.id, v_phone) on conflict do nothing;
  end if;
  -- Open sign-up: a new account joins the group straight away (the admin can switch this off).
  if (select g.open_signup from public.group_settings g) then
    insert into public.members (user_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;

-- An account created while the group was invite-only can join once sign-up is open.
create function public.join_open_group() returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '28000'; end if;
  if not (select g.open_signup from public.group_settings g) then
    raise exception 'The group is invite-only right now. Ask the organizer for an invitation link.';
  end if;
  insert into public.members (user_id) values (auth.uid()) on conflict do nothing;
  return true;
end $$;

create function public.set_open_signup(p_open boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_admin();
  update public.group_settings set open_signup = coalesce(p_open, true), updated_at = clock_timestamp();
end $$;

-- Visitors (not signed in) may only read; members may join; admin may switch sign-up.
revoke all on function public.join_open_group(), public.set_open_signup(boolean) from public, anon;
grant execute on function public.join_open_group(), public.set_open_signup(boolean) to authenticated;
grant execute on function public.list_markets(), public.get_market(uuid), public.race_board() to anon, authenticated;

create or replace function public.get_me() returns jsonb
language sql volatile security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'is_member', app.is_member(),
    'is_admin', app.is_admin(),
    'display_name', (select display_name from public.profiles where user_id = auth.uid()),
    'has_phone', exists (select 1 from public.member_contacts where user_id = auth.uid()),
    'open_signup', (select g.open_signup from public.group_settings g),
    'group', case when app.is_member() then
       (select to_jsonb(g) || jsonb_build_object('admin_name',
          (select p.display_name from public.admins a join public.profiles p on p.user_id = a.user_id limit 1))
        from public.group_settings g) end)
$$;
