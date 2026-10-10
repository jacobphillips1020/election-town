-- Election Town: markets created by the old two-step "propose" flow are opened on the group defaults,
-- matching the one-step flow. Candidates still marked "to be confirmed" are filled from the race board
-- when names are available; otherwise the market stays proposed (the admin can cancel it).
update public.markets m set
  candidates = case when m.candidates::text ilike '%(to be confirmed)%' and p.dem_name is not null and p.rep_name is not null
                    then app.normalize_candidates(jsonb_build_array(jsonb_build_object('name', p.dem_name, 'party', 'D'),
                                                                    jsonb_build_object('name', p.rep_name, 'party', 'R')))
                    else m.candidates end,
  buy_in_cents = g.default_buy_in_cents,
  entry_deadline = g.default_deadline,
  status = 'open',
  approved_at = clock_timestamp()
from public.group_settings g, public.race_polling p
where m.status = 'proposed'
  and p.race_key = app.race_key(m.polling_ref ->> 'race_type', m.polling_ref ->> 'state', m.polling_ref ->> 'district', (m.polling_ref ->> 'special')::boolean)
  and clock_timestamp() < g.default_deadline
  and (m.candidates::text not ilike '%(to be confirmed)%' or (p.dem_name is not null and p.rep_name is not null));
