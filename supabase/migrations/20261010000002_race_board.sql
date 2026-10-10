-- Election Town: the race board. One row per race that PollingSource publishes an average for,
-- refreshed by the server (daily job + on demand, at most every 12 hours). Read only through race_board().

create table public.race_polling (
  race_key text primary key,                 -- 'house:UT:02:0' (type:state:district:special)
  race_type text not null,
  state text not null,
  district text,
  is_special boolean not null default false,
  dem_name text,
  rep_name text,
  dem_avg numeric,
  rep_avg numeric,
  margin_label text,
  rating text,
  poll_count int not null default 0,
  last_poll_date date,
  page text,
  fetched_at timestamptz not null default now(),
  names_fetched_at timestamptz
);
alter table public.race_polling enable row level security; -- no policies: clients read via race_board()
revoke all on public.race_polling from public, anon, authenticated;

create function app.race_key(p_type text, p_state text, p_district text, p_special boolean) returns text
language sql immutable as $$
  select p_type || ':' || p_state || ':' || coalesce(p_district, '') || ':' || case when p_special then '1' else '0' end
$$;

-- Every race on the 2026 ballot, with its polling (if any) and its market (if one exists).
create function public.race_board() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.require_member();
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

create or replace function public.propose_race(p_race_type text, p_state text, p_district text default null,
                                    p_special boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_state text := upper(btrim(coalesce(p_state, '')));
  v_dist text;
  v_special boolean := coalesce(p_special, false);
  v_ref jsonb; v_name text; v_title text; v_label text; v_basis text; v_note text; v_id uuid;
  v_dem text; v_rep text; v_cands jsonb;
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
    raise exception 'This race already has a market';
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
  -- States whose general election can be decided in a later round.
  v_basis := case when v_state in ('AK', 'ME') then 'rcv_final' when v_state = 'GA' then 'runoff_final' else 'single_round' end;
  v_note := 'Settles on the certified results from ' || v_name || '''s official election authority: the winner and their '
         || 'share of all valid candidate votes, rounded once to one decimal place.'
         || case v_basis
              when 'rcv_final' then ' This race settles on the final round of ranked-choice tabulation.'
              when 'runoff_final' then ' This race settles on the decisive runoff round, or on the general election if no runoff is needed.'
              else '' end;

  -- Candidates come from the race board (names in the published polls); otherwise placeholders
  -- that the admin must replace before the race can open.
  select p.dem_name, p.rep_name into v_dem, v_rep from public.race_polling p
  where p.race_key = app.race_key(p_race_type, v_state, v_dist, v_special);
  v_cands := case when v_dem is not null and v_rep is not null and lower(v_dem) <> lower(v_rep)
                  then jsonb_build_array(jsonb_build_object('name', v_dem, 'party', 'D'), jsonb_build_object('name', v_rep, 'party', 'R'))
                  else '[{"name":"Democratic nominee (to be confirmed)","party":"D"},
                         {"name":"Republican nominee (to be confirmed)","party":"R"}]'::jsonb end;

  insert into public.markets (kind, title, jurisdiction, status, proposed_by, candidates, has_other,
                              outcome_basis, rules_note, polling_ref)
  values (p_race_type, v_title, v_label, 'proposed', auth.uid(), app.normalize_candidates(v_cands),
          true, v_basis, v_note, v_ref)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.race_board() from public, anon;
grant execute on function public.race_board() to authenticated;
revoke all on function public.propose_race(text, text, text, boolean) from public, anon;
grant execute on function public.propose_race(text, text, text, boolean) to authenticated;
