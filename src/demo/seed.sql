-- DEMO FIXTURES. Fictional people and picks. Loaded only by the in-browser demo (after src/demo/polling.sql);
-- never part of the migrations and never run against a real database.
-- The main pool is open with three ballots in; there's an open side bet, a closed one, and a settled one.

update public.group_settings set open_signup = false;  -- so 'Sam' starts outside the group

insert into auth.users (id, email, raw_user_meta_data) values
  ('d0000000-0000-4000-8000-000000000001', 'admin@demo.invalid', '{"display_name":"Demo Admin"}'),
  ('d0000000-0000-4000-8000-000000000002', 'maya@demo.invalid',  '{"display_name":"Maya"}'),
  ('d0000000-0000-4000-8000-000000000003', 'dev@demo.invalid',   '{"display_name":"Dev"}'),
  ('d0000000-0000-4000-8000-000000000004', 'priya@demo.invalid', '{"display_name":"Priya"}'),
  ('d0000000-0000-4000-8000-000000000005', 'alex@demo.invalid',  '{"display_name":"Alex"}'),
  ('d0000000-0000-4000-8000-000000000006', 'sam@demo.invalid',   '{"display_name":"Sam"}');

insert into public.admins (user_id) values ('d0000000-0000-4000-8000-000000000001');
insert into public.member_contacts (user_id, phone) values
  ('d0000000-0000-4000-8000-000000000001', '+13125550100'), ('d0000000-0000-4000-8000-000000000002', '+13125550101'),
  ('d0000000-0000-4000-8000-000000000003', '+13125550102'), ('d0000000-0000-4000-8000-000000000004', '+13125550103'),
  ('d0000000-0000-4000-8000-000000000005', '+13125550104'), ('d0000000-0000-4000-8000-000000000006', '+13125550105');
insert into public.members (user_id)
  select id from auth.users where id <> 'd0000000-0000-4000-8000-000000000006';
update public.group_settings set pay_note = 'Venmo the organizer $50 before the pool closes (demo).';

-- A ballot from a compact spec: 'AK 1 51.2, GA 1 54.0, ...' (state, candidate 1 or 2, two-way share).
-- States left out, and null seat counts, are submitted blank.
create function public.demo_ballot(p_who uuid, p_spec text, p_senate_r int, p_house_r int) returns void
language plpgsql as $$
declare v jsonb := '{}'; m public.markets; part text; f text[]; w int; s int;
begin
  perform set_config('request.jwt.claim.sub', p_who::text, false);
  for m in select * from public.markets where featured and status = 'open' loop
    if m.kind = 'senate_seats' and p_senate_r is not null then v := v || jsonb_build_object(m.id, jsonb_build_object('seats', jsonb_build_object('r', p_senate_r)));
    elsif m.kind = 'house_seats' and p_house_r is not null then v := v || jsonb_build_object(m.id, jsonb_build_object('seats', jsonb_build_object('r', p_house_r)));
    else
      foreach part in array string_to_array(p_spec, ',') loop
        f := regexp_split_to_array(btrim(part), '\s+');
        if f[1] = m.polling_ref ->> 'state' then
          w := f[2]::int; s := round(f[3]::numeric * 10)::int;
          v := v || jsonb_build_object(m.id, jsonb_build_object('winner_id', 'c' || w,
                 'shares', jsonb_build_object('c' || w, s, 'c' || (3 - w), 1000 - s)));
        end if;
      end loop;
    end if;
  end loop;
  perform public.submit_ballot(v);
end $$;

do $$
declare
  admin uuid := 'd0000000-0000-4000-8000-000000000001';
  maya uuid := 'd0000000-0000-4000-8000-000000000002';
  dev uuid := 'd0000000-0000-4000-8000-000000000003';
  priya uuid := 'd0000000-0000-4000-8000-000000000004';
  alex uuid := 'd0000000-0000-4000-8000-000000000005';
  ny17 uuid; ks uuid; mn uuid;
begin
  -- The main pool: three ballots in (Alex hasn't filled one out yet; Priya left Texas and the House blank for now).
  perform public.demo_ballot(maya, 'AK 1 51.0, GA 1 54.5, IA 2 50.5, ME 1 51.5, MI 1 51.0, NE 2 51.0, NH 1 53.0, NC 1 54.0, OH 1 51.5, TX 2 50.5', 48, 202);
  perform public.demo_ballot(dev,  'AK 2 50.5, GA 1 53.0, IA 2 51.0, ME 2 50.5, MI 1 50.5, NE 2 52.0, NH 1 52.0, NC 1 53.5, OH 2 50.5, TX 2 52.0', 51, 214);
  perform public.demo_ballot(priya,'AK 1 52.0, GA 1 55.0, IA 1 50.5, ME 1 52.0, MI 1 52.5, NE 1 50.5, NH 1 54.0, NC 1 55.0, OH 1 52.0', 45, null);

  -- Side bets: NY-17 open, Kansas closed (picks revealed), Minnesota settled.
  perform set_config('request.jwt.claim.sub', dev::text, false);
  ny17 := public.launch_race('house', 'NY', '17');
  perform public.submit_entry(ny17, 'c2', '{"c1":490,"c2":510}');
  perform set_config('request.jwt.claim.sub', maya::text, false);
  perform public.submit_entry(ny17, 'c1', '{"c1":505,"c2":495}');
  ks := public.launch_race('senate', 'KS');
  mn := public.launch_race('senate', 'MN');
  perform public.submit_entry(ks, 'c1', '{"c1":510,"c2":490}');
  perform public.submit_entry(mn, 'c1', '{"c1":535,"c2":465}');
  perform set_config('request.jwt.claim.sub', dev::text, false);
  perform public.submit_entry(ks, 'c2', '{"c1":480,"c2":520}');
  perform public.submit_entry(mn, 'c1', '{"c1":520,"c2":480}');
  perform set_config('request.jwt.claim.sub', priya::text, false);
  perform public.submit_entry(ks, 'c2', '{"c1":470,"c2":530}');
  perform public.submit_entry(mn, 'c2', '{"c1":490,"c2":510}');
  perform set_config('request.jwt.claim.sub', alex::text, false);
  perform public.submit_entry(ks, 'c1', '{"c1":515,"c2":485}');
  perform public.submit_entry(mn, 'c1', '{"c1":545,"c2":455}');

  perform set_config('session_replication_role', 'replica', false);
  update public.markets set entry_deadline = now() - interval '2 hours' where id in (ks, mn);
  perform set_config('session_replication_role', 'origin', false);

  perform set_config('request.jwt.claim.sub', admin::text, false);
  perform public.enter_result(mn, 'c1', 527, null, 'https://example.invalid/demo-canvass');
  perform public.confirm_settlement(mn);
  perform public.record_transfer(alex, 'collected', 1000, current_date, 'Demo: paid by Venmo');
  perform set_config('request.jwt.claim.sub', '', false);
end $$;

drop function public.demo_ballot(uuid, text, int, int);
update public.group_settings set open_signup = true;
