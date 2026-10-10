-- Election Town: launching a market is one step. Picking a race opens its market immediately on the
-- group defaults (buy-in, entries-close time), with candidates and rules from the data. No admin approval.
-- The admin can still edit a market's terms before its first bet, or cancel it.

drop function public.propose_race(text, text, text, boolean);

create function public.launch_race(p_race_type text, p_state text, p_district text default null,
                                    p_special boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_state text := upper(btrim(coalesce(p_state, '')));
  v_dist text;
  v_special boolean := coalesce(p_special, false);
  v_ref jsonb; v_name text; v_title text; v_label text; v_basis text; v_note text; v_id uuid;
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
    raise exception 'This race already has a market. Open it to place your bet.';
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

  -- Candidates come from the race board (names in the published polls). No names, no launch:
  -- the market must be complete the moment it opens, because the first bet locks its terms.
  select p.dem_name, p.rep_name into v_dem, v_rep from public.race_polling p
  where p.race_key = app.race_key(p_race_type, v_state, v_dist, v_special);
  if v_dem is null or v_rep is null or lower(v_dem) = lower(v_rep) then
    raise exception 'The candidates for this race haven''t been published yet, so its market can''t be opened';
  end if;
  v_cands := jsonb_build_array(jsonb_build_object('name', v_dem, 'party', 'D'), jsonb_build_object('name', v_rep, 'party', 'R'));

  select * into g from public.group_settings;
  if clock_timestamp() >= g.default_deadline then
    raise exception 'Entries for this election have closed';
  end if;

  insert into public.markets (kind, title, jurisdiction, status, proposed_by, candidates, has_other,
                              outcome_basis, rules_note, polling_ref, buy_in_cents, entry_deadline, approved_at)
  values (p_race_type, v_title, v_label, 'open', auth.uid(), app.normalize_candidates(v_cands),
          true, v_basis, v_note, v_ref, g.default_buy_in_cents, g.default_deadline, clock_timestamp())
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.launch_race(text, text, text, boolean) from public, anon;
grant execute on function public.launch_race(text, text, text, boolean) to authenticated;
