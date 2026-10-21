create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  record_type text not null,
  record_id uuid,
  branch_id uuid references public.branches (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index audit_logs_actor_id_idx on public.audit_logs (actor_id, created_at desc);
alter table public.audit_logs enable row level security;

create policy "Super admins can view audit logs"
on public.audit_logs for select to authenticated
using (public.has_role('super_admin'));

revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;

create or replace function public.has_permission(
  target_branch_id uuid,
  target_module_id text,
  required_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_account()
    and (
      public.has_role('super_admin')
      or exists (
        select 1
        from public.user_permissions as user_permission
        join public.permissions as permission
          on permission.id = user_permission.permission_id
        where user_permission.user_id = (select auth.uid())
          and user_permission.branch_id = target_branch_id
          and permission.module_id = target_module_id
          and (
            permission.action = required_action
            or permission.action = 'manage'
          )
      )
    );
$$;

revoke all on function public.has_permission(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.has_permission(uuid, text, text)
  to authenticated;

create or replace function public.admin_set_staff_access(
  target_user_id uuid,
  new_role public.app_role,
  branch_ids uuid[],
  permission_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_roles text[];
  role_count bigint;
  requested_branches uuid[] := coalesce(branch_ids, array[]::uuid[]);
  requested_permissions uuid[] := coalesce(permission_ids, array[]::uuid[]);
begin
  if not public.has_role('super_admin') then
    raise exception 'Super Admin permission is required.' using errcode = '42501';
  end if;

  if target_user_id = (select auth.uid()) then
    raise exception 'You cannot change your own account access.' using errcode = '42501';
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
      (select count(distinct branch_id) from unnest(requested_branches) as requested(branch_id)) then
    raise exception 'A branch cannot be selected more than once.';
  end if;

  if cardinality(requested_permissions) <>
      (select count(distinct permission_id) from unnest(requested_permissions) as requested(permission_id)) then
    raise exception 'A permission cannot be selected more than once.';
  end if;

  perform 1 from public.profiles where id = target_user_id;
  if not found then
    raise exception 'The selected account does not exist.';
  end if;

  select coalesce(array_agg(role::text order by role::text), array[]::text[])
  into old_roles
  from public.user_roles
  where user_id = target_user_id;

  if 'super_admin' = any(old_roles) and new_role <> 'super_admin' then
    select count(*) into role_count
    from public.user_roles
    where role = 'super_admin';

    if role_count <= 1 then
      raise exception 'The last Super Admin cannot be removed.';
    end if;
  end if;

  delete from public.user_branch_assignments
  where user_id = target_user_id;

  delete from public.user_roles
  where user_id = target_user_id;

  insert into public.user_roles (user_id, role, granted_by)
  values (target_user_id, new_role, (select auth.uid()));

  if new_role in ('branch_admin', 'staff') then
    insert into public.user_branch_assignments (user_id, branch_id, assigned_by)
    select target_user_id, requested.branch_id, (select auth.uid())
    from unnest(requested_branches) as requested(branch_id);

    insert into public.user_permissions (user_id, branch_id, permission_id, granted_by)
    select target_user_id, requested_branch.branch_id,
      requested_permission.permission_id, (select auth.uid())
    from unnest(requested_branches) as requested_branch(branch_id)
    cross join unnest(requested_permissions) as requested_permission(permission_id);
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    record_type,
    record_id,
    details
  )
  values (
    (select auth.uid()),
    'account_access_updated',
    'profile',
    target_user_id,
    jsonb_build_object(
      'previous_roles', old_roles,
      'new_role', new_role,
      'branch_ids', requested_branches,
      'permission_ids', requested_permissions
    )
  );
end;
$$;

revoke all on function public.admin_set_staff_access(uuid, public.app_role, uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function public.admin_set_staff_access(uuid, public.app_role, uuid[], uuid[])
  to authenticated;

revoke insert, update, delete on public.user_roles from authenticated;
revoke insert, update, delete on public.user_branch_assignments from authenticated;
revoke insert, update, delete on public.user_permissions from authenticated;
