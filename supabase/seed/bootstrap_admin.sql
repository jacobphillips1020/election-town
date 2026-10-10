-- Run ONCE, by the project owner, in the Supabase dashboard SQL editor
-- (never from the app). Makes the account with this email the sole admin.
-- Steps: 1) sign up in the app with your email, 2) replace the email below, 3) run this.
do $$
declare
  v_email text := 'REPLACE_WITH_YOUR_EMAIL';
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(v_email);
  if v_id is null then
    raise exception 'No account with that email yet. Sign up in the app first, then run this again.';
  end if;
  insert into public.admins (user_id) values (v_id) on conflict do nothing;
  insert into public.members (user_id) values (v_id) on conflict do nothing;
end $$;
