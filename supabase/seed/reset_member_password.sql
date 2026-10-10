-- Run by the project owner in the Supabase dashboard SQL editor when a friend forgets their
-- password (they text you). Replace the two values, run it, then text them the temporary password.
-- They should change it after signing in. Nothing here is reachable from the app.
do $$
declare
  v_phone text := '+13125550123';          -- their number, as the admin list shows it
  v_temp  text := 'REPLACE_WITH_A_TEMP_PASSWORD';
  v_id uuid;
begin
  select user_id into v_id from public.member_contacts where phone = v_phone;
  if v_id is null then raise exception 'No member with that phone number'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(v_temp, extensions.gen_salt('bf')), updated_at = now()
   where id = v_id;
end $$;
