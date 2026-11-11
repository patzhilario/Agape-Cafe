begin;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  full_name text;
  pending_access public.pending_user_access%rowtype;
  has_pending_access boolean;
begin
  -- Google can sign in or link to an existing account. A new account must
  -- be registered through email/password before it can use Google login.
  if new.raw_app_meta_data ->> 'provider' = 'google'
    or (new.raw_app_meta_data -> 'providers') ? 'google' then
    raise exception 'Create an account with email and password before using Google login.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(coalesce(lower(btrim(new.email)), ''), 0)
  );

  select *
  into pending_access
  from public.pending_user_access
  where email = lower(btrim(new.email))
  for update;
  has_pending_access := found;

  full_name := coalesce(
    case when has_pending_access then pending_access.display_name end,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    ''
  );

  insert into public.profiles (id, email, display_name, avatar_path, phone, address)
  values (
    new.id,
    new.email,
    full_name,
    new.raw_user_meta_data ->> 'avatar_url',
    nullif(left(btrim(new.raw_user_meta_data ->> 'signup_phone'), 40), ''),
    nullif(left(btrim(new.raw_user_meta_data ->> 'signup_address'), 500), '')
  );

  if has_pending_access then
    insert into public.user_roles (user_id, role, granted_by)
    values (new.id, pending_access.role, pending_access.invited_by);

    if pending_access.role = 'staff' then
      insert into public.user_branch_assignments (user_id, branch_id, assigned_by)
      select new.id, requested.branch_id, pending_access.invited_by
      from unnest(pending_access.branch_ids) as requested(branch_id);

      insert into public.user_permissions (user_id, branch_id, permission_id, granted_by)
      select new.id, requested_branch.branch_id,
        requested_permission.permission_id, pending_access.invited_by
      from unnest(pending_access.branch_ids) as requested_branch(branch_id)
      cross join unnest(pending_access.permission_ids) as requested_permission(permission_id);
    end if;

    insert into public.audit_logs (
      actor_id,
      action,
      record_type,
      record_id,
      details
    )
    values (
      pending_access.invited_by,
      'invited_account_registered',
      'profile',
      new.id,
      jsonb_build_object(
        'email', lower(btrim(new.email)),
        'role', pending_access.role,
        'branch_ids', pending_access.branch_ids,
        'permission_ids', pending_access.permission_ids
      )
    );

    delete from public.pending_user_access
    where email = pending_access.email;
  else
    insert into public.user_roles (user_id, role)
    values (new.id, 'customer');
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

commit;
