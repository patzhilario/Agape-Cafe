begin;

-- Existing profiles keep their saved display names and email login.
alter table public.profiles
  add column username text check (
    username is null or username ~ '^[a-z0-9][a-z0-9_.]{2,29}$'
  ),
  add column first_name text check (first_name is null or length(btrim(first_name)) between 1 and 60),
  add column last_name text check (last_name is null or length(btrim(last_name)) between 1 and 60),
  add column middle_initial text check (middle_initial is null or middle_initial ~ '^[[:alpha:]]$');

create unique index profiles_username_key on public.profiles (username);

-- Expose availability without exposing an account's email or profile.
create function public.is_username_available(requested_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(lower(btrim(requested_username)) ~ '^[a-z0-9][a-z0-9_.]{2,29}$', false)
    and not exists (
      select 1 from public.profiles where username = lower(btrim(requested_username))
    );
$$;

revoke all on function public.is_username_available(text) from public, anon, authenticated;
grant execute on function public.is_username_available(text) to anon, authenticated;

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
  requested_username text := lower(btrim(new.raw_user_meta_data ->> 'username'));
  requested_first_name text := btrim(new.raw_user_meta_data ->> 'first_name');
  requested_last_name text := btrim(new.raw_user_meta_data ->> 'last_name');
  requested_middle_initial text := nullif(upper(btrim(new.raw_user_meta_data ->> 'middle_initial')), '');
  requested_phone text := btrim(new.raw_user_meta_data ->> 'signup_phone');
begin
  -- Google can sign in or link to an existing account. A new account must
  -- be registered through email/password before it can use Google login.
  if new.raw_app_meta_data ->> 'provider' = 'google'
    or (new.raw_app_meta_data -> 'providers') ? 'google' then
    raise exception 'Create an account with email and password before using Google login.';
  end if;

  if requested_username is null
      or requested_username !~ '^[a-z0-9][a-z0-9_.]{2,29}$' then
    raise exception 'Enter a valid username with 3 to 30 characters.';
  end if;
  if requested_first_name is null or length(requested_first_name) not between 1 and 60
      or requested_last_name is null or length(requested_last_name) not between 1 and 60 then
    raise exception 'First name and last name are required, with up to 60 characters each.';
  end if;
  if requested_middle_initial is not null and requested_middle_initial !~ '^[[:alpha:]]$' then
    raise exception 'Enter one letter for the optional middle initial.';
  end if;
  if requested_phone is null or length(requested_phone) not between 1 and 40 then
    raise exception 'A phone number is required, with up to 40 characters.';
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

  full_name := concat_ws(' ', requested_first_name,
    case when requested_middle_initial is not null then requested_middle_initial || '.' end,
    requested_last_name);

  insert into public.profiles (
    id, email, display_name, avatar_path, phone, address,
    username, first_name, last_name, middle_initial
  )
  values (
    new.id, new.email, full_name, new.raw_user_meta_data ->> 'avatar_url',
    requested_phone,
    nullif(left(btrim(new.raw_user_meta_data ->> 'signup_address'), 500), ''),
    requested_username, requested_first_name, requested_last_name, requested_middle_initial
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
