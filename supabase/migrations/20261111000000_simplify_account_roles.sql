begin;

-- Keep catalog-deparsed function and policy references schema-qualified.
set local search_path = pg_catalog;

lock table public.pending_user_access, public.user_roles in access exclusive mode;

-- An account may already have both branch roles. Keep its existing Staff grant.
delete from public.user_roles as branch_grant
using public.user_roles as staff_grant
where branch_grant.user_id = staff_grant.user_id
  and branch_grant.role = 'branch_admin'
  and staff_grant.role = 'staff';

alter type public.app_role rename to legacy_app_role;
create type public.app_role as enum ('admin', 'staff', 'customer');

alter table public.pending_user_access
  drop constraint pending_user_access_check;

alter table public.user_roles alter column role type public.app_role using (
  case role::text when 'super_admin' then 'admin'
    when 'branch_admin' then 'staff' else role::text end
)::public.app_role;

alter table public.pending_user_access
  alter column role type public.app_role using (
    case role::text when 'super_admin' then 'admin'
      when 'branch_admin' then 'staff' else role::text end
  )::public.app_role,
  add constraint pending_user_access_check check (
    (role = 'staff' and cardinality(branch_ids) > 0)
    or (role in ('customer', 'admin')
      and cardinality(branch_ids) = 0
      and cardinality(permission_ids) = 0)
  );

alter function public.has_role(public.legacy_app_role) rename to has_legacy_role;

create function public.has_role(required_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_account()
    and exists (
      select 1
      from public.user_roles
      where user_id = (select auth.uid())
        and role = required_role
    );
$$;

revoke all on function public.has_role(public.app_role) from public, anon, authenticated;
grant execute on function public.has_role(public.app_role) to anon, authenticated;

-- Rebind policies to the new signature while retaining their commands and grantees.
do $$
declare
  policy record;
  using_clause text;
  check_clause text;
begin
  for policy in
    select p.polname, p.polrelid::regclass as relation,
      pg_get_expr(p.polqual, p.polrelid) as using_expression,
      pg_get_expr(p.polwithcheck, p.polrelid) as check_expression
    from pg_policy as p
    where exists (
      select 1 from pg_depend as d
      where d.classid = 'pg_policy'::regclass and d.objid = p.oid
        and d.refclassid = 'pg_proc'::regclass
        and d.refobjid = 'public.has_legacy_role(public.legacy_app_role)'::regprocedure
    )
  loop
    using_clause := replace(replace(policy.using_expression,
      'public.has_legacy_role(', 'public.has_role('),
      '''super_admin''::public.legacy_app_role', '''admin''::public.app_role');
    check_clause := replace(replace(policy.check_expression,
      'public.has_legacy_role(', 'public.has_role('),
      '''super_admin''::public.legacy_app_role', '''admin''::public.app_role');

    execute format('alter policy %I on %s%s%s', policy.polname, policy.relation,
      coalesce(' using (' || using_clause || ')', ''),
      coalesce(' with check (' || check_clause || ')', ''));
  end loop;
end;
$$;

-- Update role checks in installed routines, including the access RPC signatures.
-- Use the installed bodies so both the standalone and combined setups keep their business logic.
do $$
declare
  definition text;
begin
  for definition in
    select pg_get_functiondef(p.oid)
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname not in ('handle_new_auth_user', 'has_legacy_role')
      and p.prosrc like '%''super_admin''%'
  loop
    definition := replace(definition, 'public.legacy_app_role', 'public.app_role');
    definition := replace(definition, 'in (''branch_admin'', ''staff'')', '= ''staff''');
    definition := replace(definition, 'Branch administrators and staff must be', 'Staff must be');
    definition := replace(definition, 'a Super Admin', 'an Admin');
    definition := replace(definition, 'A Super Admin', 'An Admin');
    definition := replace(definition, 'Super Admin', 'Admin');
    definition := replace(definition, 'super admins', 'admins');
    definition := replace(definition, 'super_admin', 'admin');
    execute definition;
  end loop;
end;
$$;

drop function public.admin_invite_user_access(text, text, public.legacy_app_role, uuid[], uuid[]);
drop function public.admin_set_staff_access(uuid, public.legacy_app_role, uuid[], uuid[]);
drop function public.has_legacy_role(public.legacy_app_role);
drop type public.legacy_app_role;

revoke all on function public.admin_set_staff_access(uuid, public.app_role, uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function public.admin_set_staff_access(uuid, public.app_role, uuid[], uuid[])
  to authenticated;

revoke all on function public.admin_invite_user_access(text, text, public.app_role, uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function public.admin_invite_user_access(text, text, public.app_role, uuid[], uuid[])
  to authenticated;

-- Carry forward an unclaimed initial Admin setup from the old provisioning script.
do $$
begin
  if to_regclass('public.initial_super_admin_config') is not null
    and not exists (select 1 from public.user_roles where role = 'admin') then
    insert into public.pending_user_access (email, display_name, role)
    select config.email, 'Admin', 'admin'
    from public.initial_super_admin_config as config
    where not exists (select 1 from auth.users where lower(email) = config.email)
    on conflict (email) do update
    set role = excluded.role, branch_ids = '{}', permission_ids = '{}';
  end if;
end;
$$;

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

notify pgrst, 'reload schema';

commit;
