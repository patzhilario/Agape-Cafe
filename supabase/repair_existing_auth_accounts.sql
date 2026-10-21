-- Repair Supabase Auth users that existed before the Agape Cafe schema was installed.
-- Safe to run more than once; existing profiles and assigned roles are preserved.

insert into public.profiles (id, email, display_name, avatar_path)
select
  auth_user.id,
  auth_user.email,
  coalesce(
    auth_user.raw_user_meta_data ->> 'full_name',
    auth_user.raw_user_meta_data ->> 'name',
    ''
  ),
  auth_user.raw_user_meta_data ->> 'avatar_url'
from auth.users as auth_user
on conflict (id) do nothing;

insert into public.user_roles (user_id, role)
select profile.id, 'customer'
from public.profiles as profile
where not exists (
  select 1
  from public.user_roles as user_role
  where user_role.user_id = profile.id
);
