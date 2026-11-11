-- Set target_email to the initial Admin's email and run this once in
-- the Supabase SQL Editor after applying all current migrations, including schema cleanup.
begin;

do $$
declare
  target_email constant text := 'replace-with-admin-email@example.com';
  target_display_name constant text := 'Admin';
  normalized_email text := lower(btrim(target_email));
  target_user_id uuid;
begin
  if normalized_email = 'replace-with-admin-email@example.com'
      or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Set target_email to the initial Admin email before running this script.';
  end if;

  -- Synchronize with first sign-in and other invitations for this address.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(normalized_email, 0));

  if exists (select 1 from public.user_roles where role = 'admin') then
    raise exception 'An Admin already exists. Use Account management to grant additional access.';
  end if;

  if exists (
    select 1 from app_private.pending_user_access where role = 'admin' and email <> normalized_email
  ) then
    raise exception 'A different initial Admin email is already configured.';
  end if;

  select id into target_user_id
  from auth.users
  where lower(email) = normalized_email;

  if target_user_id is null then
    insert into app_private.pending_user_access (email, display_name, role)
    values (normalized_email, target_display_name, 'admin')
    on conflict (email) do update
    set display_name = excluded.display_name,
        role = excluded.role,
        branch_ids = excluded.branch_ids,
        permission_ids = excluded.permission_ids,
        invited_by = excluded.invited_by;

    raise notice 'Initial Admin access will be granted when the invited account signs up.';
    return;
  end if;

  insert into public.profiles (id, email, display_name, avatar_path)
  select id, email,
    coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', target_display_name),
    raw_user_meta_data ->> 'avatar_url'
  from auth.users
  where id = target_user_id
  on conflict (id) do nothing;

  delete from app_private.pending_user_access where email = normalized_email;
  delete from public.user_branch_assignments where user_id = target_user_id;
  delete from public.user_roles where user_id = target_user_id;
  insert into public.user_roles (user_id, role)
  values (target_user_id, 'admin');

  insert into public.audit_logs (actor_id, action, record_type, record_id, details)
  values (null, 'initial_admin_provisioned', 'profile', target_user_id,
    jsonb_build_object('provisioned_by', 'trusted_setup'));

  raise notice 'The existing Auth account has been granted Admin access.';
end;
$$;

commit;
