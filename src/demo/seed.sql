-- DEMO FIXTURES. Entirely fictional people, candidates, and numbers. Loaded only by the
-- in-browser demo; never part of the migrations and never run against a real database.

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

insert into public.markets (id, kind, title, jurisdiction, status, proposed_by, candidates, has_other,
                            outcome_basis, rules_note, buy_in_cents, entry_deadline, approved_at, polling_ref) values
  ('a0000000-0000-4000-8000-000000000001', 'senate', 'DEMO · Senate, Fictional State', 'Fictional State', 'open',
   'd0000000-0000-4000-8000-000000000002',
   '[{"id":"c1","name":"Elena Garcia","party":"D"},{"id":"c2","name":"Tom Whitfield","party":"R"},{"id":"c3","name":"Ana Lee","party":"L"}]',
   true, 'single_round', 'Demo fixture. Certified results from the (fictional) state canvass.', 1000,
   now() + interval '4 days', now() - interval '2 days', '{"race_type":"senate","state":"MI","district":null,"special":false}'),
  ('a0000000-0000-4000-8000-000000000002', 'governor', 'DEMO · Governor, Example State', 'Example State', 'open',
   'd0000000-0000-4000-8000-000000000003',
   '[{"id":"c1","name":"Rosa Delgado","party":"D"},{"id":"c2","name":"Mark Hale","party":"R"}]',
   true, 'single_round', 'Demo fixture. Certified results from the (fictional) state canvass.', 1000,
   now() + interval '1 day', now() - interval '3 days', '{"race_type":"governor","state":"AZ","district":null,"special":false}'),
  ('a0000000-0000-4000-8000-000000000003', 'house', 'DEMO · House, Sample District 7', 'Sample District 7', 'open',
   'd0000000-0000-4000-8000-000000000004',
   '[{"id":"c1","name":"Jordan Ellis","party":"R"},{"id":"c2","name":"Priya Nair","party":"D"}]',
   true, 'single_round', 'Demo fixture. Certified results from the (fictional) county canvass.', 1000,
   now() + interval '1 day', now() - interval '5 days', '{"race_type":"house","state":"TX","district":"07","special":false}');


do $$
declare
  admin uuid := 'd0000000-0000-4000-8000-000000000001';
  maya uuid := 'd0000000-0000-4000-8000-000000000002';
  dev uuid := 'd0000000-0000-4000-8000-000000000003';
  priya uuid := 'd0000000-0000-4000-8000-000000000004';
  alex uuid := 'd0000000-0000-4000-8000-000000000005';
  a uuid := 'a0000000-0000-4000-8000-000000000001';
  b uuid := 'a0000000-0000-4000-8000-000000000002';
  c uuid := 'a0000000-0000-4000-8000-000000000003';
  cong uuid;
begin
  select id into cong from public.markets where kind = 'congress';

  -- A: open, entries sealed.
  perform set_config('request.jwt.claim.sub', maya::text, false);
  perform public.submit_entry(a, 'c1', '{"c1":520,"c2":430,"c3":30,"other":20}');
  perform public.submit_entry(cong, null, null, '{"house":{"d":222,"r":213,"o":0},"senate":{"d":48,"r":51,"o":1}}');
  perform set_config('request.jwt.claim.sub', dev::text, false);
  perform public.submit_entry(a, 'c2', '{"c1":450,"c2":490,"c3":40,"other":20}');
  perform public.submit_entry(cong, null, null, '{"house":{"d":215,"r":220,"o":0},"senate":{"d":47,"r":52,"o":1}}');

  -- B and C: entries go in while open, then the deadline is moved into the past.
  perform set_config('request.jwt.claim.sub', maya::text, false);
  perform public.submit_entry(b, 'c1', '{"c1":512,"c2":478,"other":10}');
  perform public.submit_entry(c, 'c1', '{"c1":540,"c2":450,"other":10}');
  perform set_config('request.jwt.claim.sub', dev::text, false);
  perform public.submit_entry(b, 'c2', '{"c1":470,"c2":520,"other":10}');
  perform public.submit_entry(c, 'c1', '{"c1":520,"c2":470,"other":10}');
  perform set_config('request.jwt.claim.sub', priya::text, false);
  perform public.submit_entry(b, 'c1', '{"c1":530,"c2":460,"other":10}');
  perform public.submit_entry(c, 'c2', '{"c1":440,"c2":550,"other":10}');
  perform set_config('request.jwt.claim.sub', alex::text, false);
  perform public.submit_entry(b, 'c1', '{"c1":505,"c2":485,"other":10}');
  perform public.submit_entry(c, 'c1', '{"c1":510,"c2":480,"other":10}');

  perform set_config('session_replication_role', 'replica', false);
  update public.markets set entry_deadline = now() - interval '2 hours' where id in (b, c);
  perform set_config('session_replication_role', 'origin', false);

  insert into public.polling_snapshots (market_id, source_kind, source_name, source_url, as_of, fetched_at, data) values
    (a, 'fixture', 'Demo fixture (invented numbers, not real polling)', null, current_date - 3, now() - interval '3 days',
     '{"candidates":[{"name":"Elena Garcia","party":"D","pct":47.0},{"name":"Tom Whitfield","party":"R","pct":44.0},{"name":"Ana Lee","party":"L","pct":3.0}],"undecided":6,"note":"Invented for the demo."}'),
    (b, 'fixture', 'Demo fixture (invented numbers, not real polling)', null, current_date - 6, now() - interval '6 days',
     '{"candidates":[{"name":"Rosa Delgado","party":"D","pct":49.0},{"name":"Mark Hale","party":"R","pct":46.0}],"undecided":5,"note":"Invented for the demo."}');

  -- C: settled.
  perform set_config('request.jwt.claim.sub', admin::text, false);
  perform public.enter_result(c, 'c1', 523, null, 'https://example.invalid/demo-canvass');
  perform public.confirm_settlement(c);
  perform public.record_transfer(alex, 'collected', 1000, current_date, 'Demo: paid by Venmo');
  perform set_config('request.jwt.claim.sub', '', false);
end $$;

update public.group_settings set open_signup = true;
