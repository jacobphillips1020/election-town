-- Results page: each server run stores one estimate (see src/live). Vote counts and race estimates are public.
-- Names beside picks and money stay members-only, same as everywhere else after the pool closes.
create table public.live_snapshots (
  id bigint generated always as identity primary key,
  fetched_at timestamptz not null default now(),
  public jsonb not null,
  members jsonb not null
);
alter table public.live_snapshots enable row level security; -- no policies: read through get_live()
revoke all on public.live_snapshots from public, anon, authenticated;

create function public.get_live() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.live_snapshots; p public.live_snapshots;
begin
  select * into s from public.live_snapshots order by fetched_at desc, id desc limit 1;
  if s.id is null then return null; end if;
  select * into p from public.live_snapshots where fetched_at < s.fetched_at order by fetched_at desc, id desc limit 1;
  return jsonb_build_object(
    'live', s.public,
    'members', case when app.is_member() then s.members end,
    'previous', case when p.id is not null then jsonb_build_object('fetched_at', p.fetched_at, 'bets',
      (select jsonb_agg(jsonb_build_object('id', b ->> 'id', 'p50', b #> '{share,p50}')) from jsonb_array_elements(p.public -> 'bets') b)) end
  );
end $$;
revoke all on function public.get_live() from public;
grant execute on function public.get_live() to anon, authenticated;
