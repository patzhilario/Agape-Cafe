create table public.pending_user_access (
  email text primary key check (email = lower(btrim(email))),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  role public.app_role not null,
  branch_ids uuid[] not null default array[]::uuid[],
  permission_ids uuid[] not null default array[]::uuid[],
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (
    (role in ('staff', 'branch_admin') and cardinality(branch_ids) > 0)
    or (role in ('customer', 'super_admin')
      and cardinality(branch_ids) = 0
      and cardinality(permission_ids) = 0)
  )
);

alter table public.pending_user_access enable row level security;
revoke all on public.pending_user_access from anon, authenticated;

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

  insert into public.profiles (id, email, display_name, avatar_path)
  values (
    new.id,
    new.email,
    full_name,
    new.raw_user_meta_data ->> 'avatar_url'
  );

  if has_pending_access then
    insert into public.user_roles (user_id, role, granted_by)
    values (new.id, pending_access.role, pending_access.invited_by);

    if pending_access.role in ('branch_admin', 'staff') then
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

create or replace function public.admin_invite_user_access(
  target_email text,
  target_display_name text,
  new_role public.app_role,
  branch_ids uuid[],
  permission_ids uuid[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(target_email));
  normalized_name text := btrim(target_display_name);
  existing_user_id uuid;
  requested_branches uuid[] := coalesce(branch_ids, array[]::uuid[]);
  requested_permissions uuid[] := coalesce(permission_ids, array[]::uuid[]);
  matching_branch_count bigint;
  matching_permission_count bigint;
begin
  if not public.has_role('super_admin') then
    raise exception 'Super Admin permission is required.' using errcode = '42501';
  end if;

  if normalized_email is null
      or length(normalized_email) > 254
      or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.';
  end if;

  if normalized_name is null or length(normalized_name) not between 1 and 120 then
    raise exception 'Enter a name between 1 and 120 characters.';
  end if;

  if exists (
      select 1 from unnest(requested_branches) as requested(branch_id)
      where branch_id is null
    )
    or exists (
      select 1 from unnest(requested_permissions) as requested(permission_id)
      where permission_id is null
    ) then
    raise exception 'Branch and permission selections cannot contain null values.';
  end if;

  if new_role in ('customer', 'super_admin')
      and (cardinality(requested_branches) > 0 or cardinality(requested_permissions) > 0) then
    raise exception 'Customer and Super Admin accounts cannot receive branch-level access.';
  end if;

  if new_role in ('branch_admin', 'staff') and cardinality(requested_branches) = 0 then
    raise exception 'Branch administrators and staff must be assigned to at least one branch.';
  end if;

  if cardinality(requested_branches) <>
      (select count(distinct branch_id) from unnest(requested_branches) as requested(branch_id))
    or cardinality(requested_permissions) <>
      (select count(distinct permission_id) from unnest(requested_permissions) as requested(permission_id)) then
    raise exception 'Duplicate branch or permission selections are not allowed.';
  end if;

  select count(*) into matching_branch_count
  from public.branches
  where id = any(requested_branches);
  if matching_branch_count <> cardinality(requested_branches) then
    raise exception 'One or more selected branches do not exist.';
  end if;

  select count(*) into matching_permission_count
  from public.permissions
  where id = any(requested_permissions);
  if matching_permission_count <> cardinality(requested_permissions) then
    raise exception 'One or more selected permissions do not exist.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(normalized_email, 0)
  );

  select id into existing_user_id
  from public.profiles
  where lower(email) = normalized_email;

  if existing_user_id is not null then
    update public.profiles
    set display_name = normalized_name
    where id = existing_user_id;

    perform public.admin_set_staff_access(
      existing_user_id,
      new_role,
      requested_branches,
      requested_permissions
    );

    return 'updated';
  end if;

  insert into public.pending_user_access (
    email,
    display_name,
    role,
    branch_ids,
    permission_ids,
    invited_by
  )
  values (
    normalized_email,
    normalized_name,
    new_role,
    requested_branches,
    requested_permissions,
    (select auth.uid())
  )
  on conflict (email) do update
  set display_name = excluded.display_name,
      role = excluded.role,
      branch_ids = excluded.branch_ids,
      permission_ids = excluded.permission_ids,
      invited_by = excluded.invited_by,
      created_at = now();

  insert into public.audit_logs (
    actor_id,
    action,
    record_type,
    details
  )
  values (
    (select auth.uid()),
    'account_access_invited',
    'pending_user_access',
    jsonb_build_object(
      'email', normalized_email,
      'display_name', normalized_name,
      'role', new_role,
      'branch_ids', requested_branches,
      'permission_ids', requested_permissions
    )
  );

  return 'pending';
end;
$$;

revoke all on function public.admin_invite_user_access(
  text, text, public.app_role, uuid[], uuid[]
) from public, anon, authenticated;
grant execute on function public.admin_invite_user_access(
  text, text, public.app_role, uuid[], uuid[]
) to authenticated;

notify pgrst, 'reload schema';
