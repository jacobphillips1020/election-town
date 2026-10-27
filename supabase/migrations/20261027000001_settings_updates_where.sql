-- Election Town: admin settings saves failed on the live site with "UPDATE requires a WHERE clause".
-- Supabase runs API requests with pg-safeupdate, which rejects UPDATE/DELETE statements without a WHERE clause,
-- even inside functions. group_settings has exactly one row (id = true), so these now say "where id".

create or replace function public.set_open_signup(p_open boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_admin();
  update public.group_settings set open_signup = coalesce(p_open, true), updated_at = clock_timestamp() where id;
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

create or replace function public.set_pay_note(p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_admin();
  if char_length(btrim(coalesce(p_note, ''))) > 300 then raise exception 'Keep the payment note under 300 characters'; end if;
  update public.group_settings set pay_note = btrim(coalesce(p_note, '')), updated_at = clock_timestamp() where id;
end $$;
