-- Election Town: scoring, settlement, ledger, and the RPC surface the app calls.
-- Scoring lives only here (one implementation); the UI previews by calling these functions.

-- ---------------------------------------------------------------- scoring + settlement

-- Per-entry outcome for a result. Pure computation; writes nothing.
--  races:    only entries that picked the winner are eligible; lowest |share error| wins.
--  congress: everyone is eligible; error = half the sum of the six absolute seat differences.
--  Ties split the whole pool; leftover cents go to the lowest entry ids (stable order).
--  Fewer than 2 entries, or nobody eligible: everyone is refunded.
create function app.compute_outcome(p_market uuid, p_winner text, p_share int, p_seats jsonb)
returns table (entry_id uuid, user_id uuid, commitment_cents int, eligible boolean,
               error_value int, gross_cents int, refund_cents int)
language plpgsql stable security definer set search_path = '' as $$
declare m public.markets;
begin
  select * into m from public.markets where id = p_market;
  return query
  with s as (
    select e.id as eid, e.user_id as uid, e.commitment_cents as cc,
      case when m.kind = 'congress' then true else e.winner_id = p_winner end as elig,
      case when m.kind = 'congress' then
        ( abs((e.seats #>> '{house,d}')::int  - (p_seats #>> '{house,d}')::int)
        + abs((e.seats #>> '{house,r}')::int  - (p_seats #>> '{house,r}')::int)
        + abs((e.seats #>> '{house,o}')::int  - (p_seats #>> '{house,o}')::int)
        + abs((e.seats #>> '{senate,d}')::int - (p_seats #>> '{senate,d}')::int)
        + abs((e.seats #>> '{senate,r}')::int - (p_seats #>> '{senate,r}')::int)
        + abs((e.seats #>> '{senate,o}')::int - (p_seats #>> '{senate,o}')::int) ) / 2
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

-- Append a settlement/refund run and its payout rows. Caller holds the market lock.
create function app.write_run(p_market uuid, p_outcome text, p_result jsonb, p_reason text,
                              p_refund_all boolean, p_by uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ver int; v_run uuid; v_pool int; v_outcome text := p_outcome;
begin
  if not p_refund_all and v_outcome is null then
    select case when count(*) < 2 then 'underfilled_refund'
                when not bool_or(c.eligible) then 'no_winner_refund'
                else 'settled' end
      into v_outcome
    from app.compute_outcome(p_market, p_result ->> 'winner_id',
                             (p_result ->> 'winner_share_tenths')::int, p_result -> 'seats') c;
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from public.settlement_runs where market_id = p_market;
  select coalesce(sum(commitment_cents), 0) into v_pool from public.entries where market_id = p_market;
  insert into public.settlement_runs (market_id, version, outcome, result, reason, pool_cents, created_by)
  values (p_market, v_ver, v_outcome, p_result, p_reason, v_pool, p_by)
  returning id into v_run;

  if p_refund_all then
    insert into public.payouts (run_id, market_id, entry_id, user_id, commitment_cents, gross_cents, refund_cents, eligible)
    select v_run, p_market, e.id, e.user_id, e.commitment_cents, 0, e.commitment_cents, false
    from public.entries e where e.market_id = p_market;
  else
    insert into public.payouts (run_id, market_id, entry_id, user_id, commitment_cents, gross_cents, refund_cents, eligible, error_value)
    select v_run, p_market, c.entry_id, c.user_id, c.commitment_cents, c.gross_cents, c.refund_cents, c.eligible, c.error_value
    from app.compute_outcome(p_market, p_result ->> 'winner_id',
                             (p_result ->> 'winner_share_tenths')::int, p_result -> 'seats') c;
  end if;
  return v_run;
end $$;

-- Closed markets with fewer than two entries are canceled and fully refunded.
-- Deterministic from server time, so any member's page load may trigger it; idempotent.
create function app.sweep_underfilled() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select mk.id from public.markets mk
    where mk.status = 'open' and clock_timestamp() >= mk.entry_deadline
      and (select count(*) from public.entries e where e.market_id = mk.id) < 2
    for update skip locked
  loop
    perform app.write_run(r.id, 'underfilled_refund', '{}'::jsonb, 'Fewer than two entries at close', true, null);
    update public.markets set status = 'canceled', cancel_reason = 'Fewer than two entries at close'
    where id = r.id;
  end loop;
end $$;

create function app.validate_result(m public.markets, p_winner text, p_share int, p_seats jsonb) returns void
language plpgsql stable as $$
begin
  if m.kind = 'congress' then
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

create function public.enter_result(p_market uuid, p_winner text, p_share_tenths int, p_seats jsonb, p_source_url text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.markets;
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
  update public.markets set
    result_winner_id = case when m.kind = 'congress' then null else p_winner end,
    result_winner_share_tenths = case when m.kind = 'congress' then null else p_share_tenths end,
    result_seats = case when m.kind = 'congress' then p_seats else null end,
    result_source_url = p_source_url, result_entered_at = clock_timestamp()
  where id = p_market;
end $$;

-- What settlement would do with the entered result. Writes nothing.
create function public.preview_settlement(p_market uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare m public.markets; v_rows jsonb; v_outcome text; v_result jsonb;
begin
  perform app.require_admin();
  select * into m from public.markets where id = p_market;
  if m.id is null then raise exception 'Market not found'; end if;
  if m.result_entered_at is null then raise exception 'Enter the certified result first'; end if;
  if clock_timestamp() < m.entry_deadline then raise exception 'Entries are still open'; end if;
  v_result := jsonb_build_object('winner_id', m.result_winner_id,
                                 'winner_share_tenths', m.result_winner_share_tenths,
                                 'seats', m.result_seats, 'source_url', m.result_source_url);
  select jsonb_agg(jsonb_build_object(
           'entry_id', c.entry_id, 'user_id', c.user_id, 'display_name', p.display_name,
           'winner_id', e.winner_id, 'shares', e.shares, 'seats', e.seats,
           'eligible', c.eligible, 'error_value', c.error_value,
           'gross_cents', c.gross_cents, 'refund_cents', c.refund_cents) order by p.display_name, c.entry_id),
         case when count(*) < 2 then 'underfilled_refund'
              when not bool_or(c.eligible) then 'no_winner_refund' else 'settled' end
    into v_rows, v_outcome
  from app.compute_outcome(p_market, m.result_winner_id, m.result_winner_share_tenths, m.result_seats) c
  join public.entries e on e.id = c.entry_id
  join public.profiles p on p.user_id = c.user_id;
  return jsonb_build_object('market_id', p_market, 'result', v_result, 'outcome', coalesce(v_outcome, 'underfilled_refund'),
                            'rows', coalesce(v_rows, '[]'::jsonb),
                            'pool_cents', (select coalesce(sum(commitment_cents), 0) from public.entries where market_id = p_market));
end $$;

-- Atomic and idempotent: a second call returns the existing run.
create function public.confirm_settlement(p_market uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.markets; v_run uuid; v_result jsonb;
begin
  perform app.require_admin();
  perform app.sweep_underfilled();
  select * into m from public.markets where id = p_market for update;
  if m.id is null then raise exception 'Market not found'; end if;
  if m.status in ('settled', 'canceled') then
    select id into v_run from public.settlement_runs where market_id = p_market order by version desc limit 1;
    return jsonb_build_object('run_id', v_run, 'already_settled', true);
  end if;
  if m.status <> 'open' then raise exception 'This market cannot be settled'; end if;
  if clock_timestamp() < m.entry_deadline then raise exception 'Entries are still open'; end if;
  if m.result_entered_at is null then raise exception 'Enter the certified result first'; end if;
  v_result := jsonb_build_object('winner_id', m.result_winner_id,
                                 'winner_share_tenths', m.result_winner_share_tenths,
                                 'seats', m.result_seats, 'source_url', m.result_source_url);
  v_run := app.write_run(p_market, null, v_result, null, false, auth.uid());
  update public.markets set status = 'settled' where id = p_market;
  return jsonb_build_object('run_id', v_run, 'already_settled', false);
end $$;

-- Audited correction: appends a new run; recorded transfers are untouched.
-- p_expected_version guards against a double-click or stale screen.
create function public.correct_settlement(p_market uuid, p_expected_version int, p_winner text,
                                          p_share_tenths int, p_seats jsonb, p_source_url text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.markets; v_cur int; v_run uuid;
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
  update public.markets set
    result_winner_id = case when m.kind = 'congress' then null else p_winner end,
    result_winner_share_tenths = case when m.kind = 'congress' then null else p_share_tenths end,
    result_seats = case when m.kind = 'congress' then p_seats else null end,
    result_source_url = p_source_url, result_entered_at = clock_timestamp()
  where id = p_market;
  v_run := app.write_run(p_market, null,
    jsonb_build_object('winner_id', case when m.kind = 'congress' then null else p_winner end,
                       'winner_share_tenths', case when m.kind = 'congress' then null else p_share_tenths end,
                       'seats', case when m.kind = 'congress' then p_seats end, 'source_url', p_source_url),
    btrim(p_reason), false, auth.uid());
  return jsonb_build_object('run_id', v_run, 'version', v_cur + 1);
end $$;

-- ---------------------------------------------------------------- reads

create function app.market_stats(p_market uuid) returns table (entrants int, pool_cents int)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.require_member();
  return query
    select count(*)::int, coalesce(sum(e.commitment_cents), 0)::int
    from public.entries e where e.market_id = p_market;
end $$;

create function app.market_json(m public.markets) returns jsonb
language sql volatile security invoker set search_path = '' as $$
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
         'proposed_by_name', (select display_name from public.profiles where user_id = m.proposed_by))
  from app.market_stats(m.id) s
$$;

create function public.get_me() returns jsonb
language sql volatile security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'is_member', app.is_member(),
    'is_admin', app.is_admin(),
    'display_name', (select display_name from public.profiles where user_id = auth.uid()),
    'group', case when app.is_member() then
       (select to_jsonb(g) || jsonb_build_object('admin_name',
          (select p.display_name from public.admins a join public.profiles p on p.user_id = a.user_id limit 1))
        from public.group_settings g) end)
$$;

create function public.list_markets() returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
begin
  perform app.require_member();
  perform app.sweep_underfilled();
  return coalesce((select jsonb_agg(app.market_json(m) order by m.created_at, m.id) from public.markets m), '[]'::jsonb);
end $$;

create function public.get_market(p_id uuid) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare m public.markets; v_closed boolean;
begin
  perform app.require_member();
  perform app.sweep_underfilled();
  select * into m from public.markets where id = p_id;
  if m.id is null then raise exception 'Market not found'; end if;
  v_closed := app.deadline_passed_at(m.entry_deadline, clock_timestamp());
  return jsonb_build_object(
    'market', app.market_json(m),
    'my_entry', (select to_jsonb(e) from public.entries e where e.market_id = p_id and e.user_id = auth.uid()),
    -- Others' picks: present only after close (RLS enforces this independently).
    'entries', case when v_closed then
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
                                  order by r.version desc limit 1)));
end $$;

-- ---------------------------------------------------------------- entries

create function public.submit_entry(p_market uuid, p_winner text default null,
                                    p_shares jsonb default null, p_seats jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.entries;
begin
  perform app.require_member();
  insert into public.entries (market_id, user_id, winner_id, shares, seats, commitment_cents)
  values (p_market, auth.uid(), p_winner, p_shares, p_seats, 0)
  on conflict (market_id, user_id) do update
    set winner_id = excluded.winner_id, shares = excluded.shares, seats = excluded.seats
  returning * into v;
  return to_jsonb(v);
end $$;

create function public.withdraw_entry(p_market uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform app.require_member();
  delete from public.entries where market_id = p_market and user_id = auth.uid();
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ---------------------------------------------------------------- markets (proposals + admin)

create function app.normalize_candidates(p jsonb) returns jsonb
language plpgsql immutable as $$
declare o jsonb := '[]'; c jsonb; i int := 0; nm text; names text[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) not between 2 and 8 then
    raise exception 'List between 2 and 8 named candidates';
  end if;
  for c in select * from jsonb_array_elements(p) loop
    i := i + 1;
    nm := btrim(c ->> 'name');
    if nm is null or char_length(nm) not between 1 and 60 then raise exception 'Each candidate needs a name'; end if;
    if lower(nm) = any (names) then raise exception 'Candidate names must be unique'; end if;
    if coalesce(c ->> 'party', '') not in ('D', 'R', 'I', 'L', 'G', 'O') then
      raise exception 'Each candidate needs a party label';
    end if;
    names := names || lower(nm);
    o := o || jsonb_build_array(jsonb_build_object('id', 'c' || i, 'name', nm, 'party', c ->> 'party'));
  end loop;
  return o;
end $$;

create function public.propose_market(p_kind text, p_title text, p_jurisdiction text, p_candidates jsonb,
                                      p_has_other boolean default true, p_basis text default 'single_round',
                                      p_note text default '', p_polling_ref jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform app.require_member();
  if p_kind not in ('senate', 'house', 'governor') then
    raise exception 'Propose a Senate, House, or governor race';
  end if;
  insert into public.markets (kind, title, jurisdiction, status, proposed_by, candidates, has_other,
                              outcome_basis, rules_note, polling_ref)
  values (p_kind, p_title, coalesce(p_jurisdiction, ''), 'proposed', auth.uid(),
          app.normalize_candidates(p_candidates), coalesce(p_has_other, true),
          p_basis, coalesce(p_note, ''), p_polling_ref)
  returning id into v;
  return v;
end $$;

-- Approves a proposal, or edits an open market that has no entries yet.
create function public.approve_market(p_id uuid, p_candidates jsonb, p_has_other boolean, p_basis text,
                                      p_rules_note text, p_buy_in_cents int, p_deadline timestamptz,
                                      p_polling_ref jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.markets;
begin
  perform app.require_admin();
  select * into m from public.markets where id = p_id for update;
  if m.id is null then raise exception 'Market not found'; end if;
  if m.status not in ('proposed', 'open') then raise exception 'This market cannot be edited'; end if;
  if p_deadline is null or p_deadline <= clock_timestamp() then raise exception 'The deadline must be in the future'; end if;
  if p_deadline > app.election_day_start() then raise exception 'Entries must close before Election Day (Nov 3, 12:00 a.m. ET)'; end if;
  if p_buy_in_cents is null or p_buy_in_cents not between 100 and 100000 then
    raise exception 'Buy-in must be between $1 and $1,000';
  end if;
  if p_rules_note is null or btrim(p_rules_note) = '' then
    raise exception 'Describe the outcome definition and result source';
  end if;
  if p_basis not in ('single_round', 'runoff_final', 'rcv_final') then raise exception 'Unknown outcome basis'; end if;
  update public.markets set
    candidates = case when kind = 'congress' then '[]'::jsonb else app.normalize_candidates(p_candidates) end,
    has_other = case when kind = 'congress' then false else coalesce(p_has_other, true) end,
    outcome_basis = p_basis, rules_note = btrim(p_rules_note),
    buy_in_cents = p_buy_in_cents, entry_deadline = p_deadline,
    polling_ref = coalesce(p_polling_ref, polling_ref),
    status = 'open', approved_at = coalesce(approved_at, clock_timestamp())
  where id = p_id;
end $$;

create function public.reject_market(p_id uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_admin();
  update public.markets set status = 'rejected', cancel_reason = nullif(btrim(p_reason), '')
  where id = p_id and status = 'proposed';
  if not found then raise exception 'Only proposals can be rejected'; end if;
end $$;

-- Cancels an open market and releases every commitment.
create function public.cancel_market(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.markets;
begin
  perform app.require_admin();
  perform app.sweep_underfilled();
  select * into m from public.markets where id = p_id for update;
  if m.id is null then raise exception 'Market not found'; end if;
  if m.status <> 'open' then raise exception 'Only open markets can be canceled'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'A reason is required'; end if;
  perform app.write_run(p_id, 'canceled_refund', '{}'::jsonb, btrim(p_reason), true, auth.uid());
  update public.markets set status = 'canceled', cancel_reason = btrim(p_reason) where id = p_id;
end $$;

-- Group defaults pre-fill new markets. Editable only while no entries exist anywhere.
create function public.set_group_defaults(p_buy_in_cents int, p_deadline timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare g public.group_settings;
begin
  perform app.require_admin();
  select * into g from public.group_settings;
  if exists (select 1 from public.entries) then
    raise exception 'Group defaults are locked once any entry exists';
  end if;
  if p_deadline <= clock_timestamp() or p_deadline > app.election_day_start() then
    raise exception 'Default deadline must be in the future and before Election Day';
  end if;
  if p_buy_in_cents not between 100 and 100000 then raise exception 'Buy-in must be between $1 and $1,000'; end if;
  -- Markets still on the old default (and without entries) follow the new default.
  update public.markets set entry_deadline = p_deadline
  where status = 'open' and entry_deadline = g.default_deadline;
  update public.group_settings set default_deadline = p_deadline, default_buy_in_cents = p_buy_in_cents,
                                   updated_at = clock_timestamp();
end $$;

-- ---------------------------------------------------------------- invites + membership

create function public.create_invite() returns text
language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  perform app.require_admin();
  insert into public.invites default values returning token into t;
  return t;
end $$;

create function public.revoke_invite(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_admin();
  update public.invites set revoked_at = coalesce(revoked_at, clock_timestamp()) where token = p_token;
end $$;

create function public.list_invites() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from public.invites i), '[]'::jsonb);
end $$;

create function public.redeem_invite(p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '28000'; end if;
  if not exists (select 1 from public.invites where token = p_token and revoked_at is null) then
    raise exception 'This invitation link is not valid';
  end if;
  insert into public.members (user_id) values (auth.uid()) on conflict do nothing;
  return true;
end $$;

-- ---------------------------------------------------------------- polling

create function public.record_polling(p_market uuid, p_source_name text, p_source_url text,
                                      p_as_of date, p_data jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid; c jsonb;
begin
  perform app.require_admin();
  if not exists (select 1 from public.markets where id = p_market) then raise exception 'Market not found'; end if;
  if p_source_name is null or btrim(p_source_name) = '' then raise exception 'Source name is required'; end if;
  if p_as_of is null then raise exception 'As-of date is required'; end if;
  if p_data is null or jsonb_typeof(p_data -> 'candidates') <> 'array' then
    raise exception 'Enter at least one candidate figure';
  end if;
  for c in select * from jsonb_array_elements(p_data -> 'candidates') loop
    if jsonb_typeof(c -> 'pct') <> 'number' or (c ->> 'pct')::numeric not between 0 and 100 then
      raise exception 'Polling figures must be between 0 and 100';
    end if;
  end loop;
  insert into public.polling_snapshots (market_id, source_kind, source_name, source_url, as_of, data)
  values (p_market, 'manual', btrim(p_source_name), nullif(btrim(coalesce(p_source_url, '')), ''), p_as_of, p_data)
  returning id into v;
  return v;
end $$;

-- ---------------------------------------------------------------- money + ledger

-- remaining = committed - gross payouts - refunds - collected + paid out
--   > 0  member owes admin     < 0  admin owes member
-- Unresolved commitments are reported separately and never counted as losses.
create function app.ledger_rows(p_user uuid, p_closed_only boolean)
returns table (user_id uuid, display_name text, committed_cents bigint, gross_cents bigint,
               refund_cents bigint, collected_cents bigint, paid_out_cents bigint,
               remaining_cents bigint, unresolved_cents bigint)
language sql volatile security definer set search_path = '' as $$
  with latest as (
    select distinct on (r.market_id) r.id, r.market_id
    from public.settlement_runs r order by r.market_id, r.version desc
  ),
  pay as (
    select py.user_id, sum(py.commitment_cents) as c, sum(py.gross_cents) as g, sum(py.refund_cents) as r
    from public.payouts py
    join latest l on l.id = py.run_id
    join public.markets m on m.id = py.market_id
    where (p_user is null or py.user_id = p_user)
      and (not p_closed_only or app.deadline_passed_at(m.entry_deadline, clock_timestamp()))
    group by py.user_id
  ),
  unres as (
    select e.user_id, sum(e.commitment_cents) as u
    from public.entries e join public.markets m on m.id = e.market_id
    where m.status = 'open' and (p_user is null or e.user_id = p_user)
      and (not p_closed_only or app.deadline_passed_at(m.entry_deadline, clock_timestamp()))
    group by e.user_id
  ),
  tr as (
    select t.member_id as user_id,
           coalesce(sum(t.amount_cents) filter (where t.direction = 'collected'), 0) as col,
           coalesce(sum(t.amount_cents) filter (where t.direction = 'paid_out'), 0) as po
    from public.money_transfers t
    where t.voided_at is null and (p_user is null or t.member_id = p_user)
    group by t.member_id
  ),
  everyone as (
    select pay.user_id from pay union select unres.user_id from unres union select tr.user_id from tr
  )
  select ev.user_id, pr.display_name,
         coalesce(pay.c, 0)::bigint, coalesce(pay.g, 0)::bigint, coalesce(pay.r, 0)::bigint,
         coalesce(tr.col, 0)::bigint, coalesce(tr.po, 0)::bigint,
         (coalesce(pay.c, 0) - coalesce(pay.g, 0) - coalesce(pay.r, 0) - coalesce(tr.col, 0) + coalesce(tr.po, 0))::bigint,
         coalesce(unres.u, 0)::bigint
  from everyone ev
  join public.profiles pr on pr.user_id = ev.user_id
  left join pay on pay.user_id = ev.user_id
  left join unres on unres.user_id = ev.user_id
  left join tr on tr.user_id = ev.user_id
$$;

create function public.my_ledger() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_me uuid := auth.uid();
begin
  perform app.require_member();
  perform app.sweep_underfilled();
  return jsonb_build_object(
    'is_admin', app.is_admin(),
    'totals', coalesce((select to_jsonb(r) - 'user_id' - 'display_name' from app.ledger_rows(v_me, false) r),
      jsonb_build_object('committed_cents', 0, 'gross_cents', 0, 'refund_cents', 0, 'collected_cents', 0,
                         'paid_out_cents', 0, 'remaining_cents', 0, 'unresolved_cents', 0)),
    'resolved', (select coalesce(jsonb_agg(jsonb_build_object(
          'market_id', m.id, 'title', m.title, 'kind', m.kind, 'status', m.status,
          'commitment_cents', py.commitment_cents, 'gross_cents', py.gross_cents, 'refund_cents', py.refund_cents,
          'eligible', py.eligible, 'error_value', py.error_value, 'outcome', r.outcome) order by m.created_at), '[]'::jsonb)
        from public.payouts py
        join public.settlement_runs r on r.id = py.run_id
        join public.markets m on m.id = py.market_id
        where py.user_id = v_me
          and r.version = (select max(r2.version) from public.settlement_runs r2 where r2.market_id = r.market_id)),
    'unresolved', (select coalesce(jsonb_agg(jsonb_build_object(
          'market_id', m.id, 'title', m.title, 'kind', m.kind, 'commitment_cents', e.commitment_cents,
          'entry_deadline', m.entry_deadline,
          'phase', case when app.deadline_passed_at(m.entry_deadline, clock_timestamp()) then 'closed' else 'open' end)
          order by m.entry_deadline), '[]'::jsonb)
        from public.entries e join public.markets m on m.id = e.market_id
        where e.user_id = v_me and m.status = 'open'),
    'transfers', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'direction', t.direction,
          'amount_cents', t.amount_cents, 'occurred_on', t.occurred_on, 'note', t.note) order by t.occurred_on), '[]'::jsonb)
        from public.money_transfers t where t.member_id = v_me and t.voided_at is null));
end $$;

-- Per-person balances. Pre-close commitments are deliberately omitted: who has entered
-- a market stays hidden from the admin too until entries close.
create function public.admin_ledger() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.require_admin();
  perform app.sweep_underfilled();
  return jsonb_build_object(
    'people', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object(
          'is_admin', exists (select 1 from public.admins a where a.user_id = r.user_id)) order by r.display_name)
        from app.ledger_rows(null, true) r), '[]'::jsonb),
    'breakdown', (select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', py.user_id, 'market_id', m.id, 'title', m.title, 'outcome', r.outcome,
          'commitment_cents', py.commitment_cents, 'gross_cents', py.gross_cents, 'refund_cents', py.refund_cents,
          'eligible', py.eligible, 'error_value', py.error_value) order by m.title), '[]'::jsonb)
        from public.payouts py
        join public.settlement_runs r on r.id = py.run_id
        join public.markets m on m.id = py.market_id
        where app.deadline_passed_at(m.entry_deadline, clock_timestamp())
          and r.version = (select max(r2.version) from public.settlement_runs r2 where r2.market_id = r.market_id)),
    'transfers', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'member_id', t.member_id,
          'display_name', p.display_name, 'direction', t.direction, 'amount_cents', t.amount_cents,
          'occurred_on', t.occurred_on, 'note', t.note, 'voided_at', t.voided_at) order by t.occurred_on desc, t.recorded_at desc), '[]'::jsonb)
        from public.money_transfers t join public.profiles p on p.user_id = t.member_id));
end $$;

create function public.record_transfer(p_member uuid, p_direction text, p_amount_cents int,
                                       p_occurred_on date, p_note text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform app.require_admin();
  if p_direction not in ('collected', 'paid_out') then raise exception 'Direction must be collected or paid_out'; end if;
  if exists (select 1 from public.admins where user_id = p_member) then
    raise exception 'The admin does not transfer money to themself';
  end if;
  if not exists (select 1 from public.members where user_id = p_member) then raise exception 'Unknown member'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Amount must be positive'; end if;
  insert into public.money_transfers (member_id, direction, amount_cents, occurred_on, note)
  values (p_member, p_direction, p_amount_cents, coalesce(p_occurred_on, current_date), coalesce(p_note, ''))
  returning id into v;
  return v;
end $$;

create function public.void_transfer(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_admin();
  update public.money_transfers set voided_at = coalesce(voided_at, clock_timestamp()) where id = p_id;
end $$;

-- ---------------------------------------------------------------- the one Congress market

insert into public.markets (kind, title, jurisdiction, status, candidates, has_other, outcome_basis,
                            rules_note, buy_in_cents, entry_deadline, approved_at)
select 'congress', 'Control of Congress', 'United States', 'open', '[]'::jsonb, false, 'single_round',
       'Resolves on the election-determined party composition of the 120th Congress, including any '
       || 'necessary runoffs. Later party switches, vacancies, and special elections do not change the result. '
       || 'House: Democratic, Republican, Other (independents count as Other), 435 seats. '
       || 'Senate: Democratic caucus, Republican caucus, Other, 100 seats, including seats not up this year; '
       || 'independents count with the caucus they join for the 120th Congress, and an independent who joins '
       || 'neither counts as Other. If an exceptional vacancy or an unresolved contest means the result cannot '
       || 'be expressed in these categories, the market stays pending or is canceled with refunds; the scoring '
       || 'basis is never changed. Score = half the sum of absolute differences across the six seat counts.',
       default_buy_in_cents, default_deadline, now()
from public.group_settings;
