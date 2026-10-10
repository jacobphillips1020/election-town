-- Election Town: privileges. Default-deny, then grant exactly what the app needs.
-- Clients may read a few tables (RLS filters rows) and call RPC functions. They may not
-- write to tables directly.

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

grant usage on schema public to authenticated;
grant usage on schema app to authenticated;

-- Row-filtered reads (policies in 0001). RPCs below are the normal path.
grant select on public.group_settings, public.admins, public.members, public.profiles,
                public.markets, public.entries, public.settlement_runs, public.payouts,
                public.money_transfers, public.polling_snapshots, public.invites
  to authenticated;

-- RPC surface.
grant execute on function
  public.get_me(), public.list_markets(), public.get_market(uuid),
  public.submit_entry(uuid, text, jsonb, jsonb), public.withdraw_entry(uuid),
  public.propose_market(text, text, text, jsonb, boolean, text, text, jsonb),
  public.approve_market(uuid, jsonb, boolean, text, text, int, timestamptz, jsonb),
  public.reject_market(uuid, text), public.cancel_market(uuid, text),
  public.set_group_defaults(int, timestamptz),
  public.create_invite(), public.revoke_invite(text), public.list_invites(), public.redeem_invite(text),
  public.record_polling(uuid, text, text, date, jsonb),
  public.enter_result(uuid, text, int, jsonb, text), public.preview_settlement(uuid),
  public.confirm_settlement(uuid), public.correct_settlement(uuid, int, text, int, jsonb, text, text),
  public.my_ledger(), public.admin_ledger(),
  public.record_transfer(uuid, text, int, date, text), public.void_transfer(uuid)
  to authenticated;

-- Helpers used inside policies and invoker functions. Each checks its own authorization.
grant execute on function
  app.is_admin(), app.is_member(), app.require_member(), app.require_admin(),
  app.market_closed(uuid), app.deadline_passed_at(timestamptz, timestamptz),
  app.market_stats(uuid), app.market_json(public.markets), app.sweep_underfilled()
  to authenticated;
