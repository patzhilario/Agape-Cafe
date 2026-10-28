create or replace function public.admin_delete_user_account(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
  super_admin_count bigint;
begin
  if not public.has_role('super_admin') then
    raise exception 'Super Admin permission is required.' using errcode = '42501';
  end if;

  if target_user_id = (select auth.uid()) then
    raise exception 'You cannot delete your own account.' using errcode = '42501';
  end if;

  select email into target_email
  from public.profiles
  where id = target_user_id;

  if not found then
    raise exception 'The selected account does not exist.';
  end if;

  if exists (
    select 1
    from public.user_roles
    where user_id = target_user_id and role = 'super_admin'
  ) then
    perform 1
    from public.user_roles
    where role = 'super_admin'
    order by user_id
    for update;

    select count(*) into super_admin_count
    from public.user_roles
    where role = 'super_admin';

    if super_admin_count <= 1 then
      raise exception 'The last Super Admin cannot be deleted.';
    end if;
  end if;

  delete from public.pending_user_access
  where email = lower(target_email);

  begin
    delete from auth.users
    where id = target_user_id;
  exception when foreign_key_violation then
    raise exception 'This account has order or financial history and cannot be permanently deleted.'
      using errcode = '23503';
  end;

  insert into public.audit_logs (actor_id, action, record_type, record_id, details)
  values (
    (select auth.uid()),
    'account_deleted',
    'profile',
    target_user_id,
    jsonb_build_object('email', target_email)
  );
end;
$$;

revoke all on function public.admin_delete_user_account(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_delete_user_account(uuid)
  to authenticated;

notify pgrst, 'reload schema';
