create extension if not exists pgcrypto;

create type public.app_role as enum (
  'super_admin',
  'branch_admin',
  'staff',
  'customer'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text not null default '',
  phone text,
  avatar_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  phone text,
  email text,
  operating_hours jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.user_branch_assignments (
  user_id uuid not null references public.profiles (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete restrict,
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, branch_id)
);

create table public.modules (
  id text primary key,
  name text not null,
  description text not null default '',
  is_active boolean not null default true
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  module_id text not null references public.modules (id) on delete restrict,
  action text not null check (
    action in ('view', 'create', 'edit', 'approve', 'cancel', 'export', 'manage')
  ),
  unique (module_id, action)
);

create table public.user_permissions (
  user_id uuid not null,
  branch_id uuid not null,
  permission_id uuid not null references public.permissions (id) on delete restrict,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, branch_id, permission_id),
  foreign key (user_id, branch_id)
    references public.user_branch_assignments (user_id, branch_id)
    on delete cascade
);

create index user_branch_assignments_branch_id_idx
  on public.user_branch_assignments (branch_id);
create index user_permissions_branch_permission_idx
  on public.user_permissions (branch_id, permission_id);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger branches_set_updated_at
before update on public.branches
for each row execute function public.set_updated_at();

create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  full_name text;
begin
  full_name := coalesce(
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

  insert into public.user_roles (user_id, role)
  values (new.id, 'customer');

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

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

create function public.is_active_account()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_active
  );
$$;

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

create function public.can_access_branch(target_branch_id uuid)
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
        from public.user_branch_assignments
        where user_id = (select auth.uid())
          and branch_id = target_branch_id
      )
    );
$$;

alter table public.profiles enable row level security;
alter table public.branches enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_branch_assignments enable row level security;
alter table public.modules enable row level security;
alter table public.permissions enable row level security;
alter table public.user_permissions enable row level security;

create policy "Users and admins can read profiles"
on public.profiles for select to authenticated
using (id = (select auth.uid()) or public.has_role('super_admin'));

create policy "Users can update their own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()) and public.is_active_account())
with check (id = (select auth.uid()) and public.is_active_account());

create policy "Super admins can update profiles"
on public.profiles for update to authenticated
using (public.has_role('super_admin'))
with check (public.has_role('super_admin'));

create policy "Public can view active branches"
on public.branches for select to anon, authenticated
using (is_active or public.can_access_branch(id));

create policy "Super admins can manage branches"
on public.branches for all to authenticated
using (public.has_role('super_admin'))
with check (public.has_role('super_admin'));

create policy "Users and super admins can read roles"
on public.user_roles for select to authenticated
using (user_id = (select auth.uid()) or public.has_role('super_admin'));

create policy "Super admins can manage roles"
on public.user_roles for all to authenticated
using (public.has_role('super_admin'))
with check (public.has_role('super_admin'));

create policy "Users and super admins can read branch assignments"
on public.user_branch_assignments for select to authenticated
using (user_id = (select auth.uid()) or public.has_role('super_admin'));

create policy "Super admins can manage branch assignments"
on public.user_branch_assignments for all to authenticated
using (public.has_role('super_admin'))
with check (public.has_role('super_admin'));

create policy "Authenticated users can read module definitions"
on public.modules for select to authenticated
using (true);

create policy "Authenticated users can read permission definitions"
on public.permissions for select to authenticated
using (true);

create policy "Users and super admins can read user permissions"
on public.user_permissions for select to authenticated
using (user_id = (select auth.uid()) or public.has_role('super_admin'));

create policy "Super admins can manage user permissions"
on public.user_permissions for all to authenticated
using (public.has_role('super_admin'))
with check (public.has_role('super_admin'));

insert into public.modules (id, name, description) values
  ('dashboard', 'Dashboard', 'Business overview'),
  ('orders', 'Orders', 'Order processing and fulfillment'),
  ('menu', 'Menu', 'Products, categories, variants, and add-ons'),
  ('inventory', 'Inventory', 'Stock and inventory movements'),
  ('promotions', 'Promotions and discounts', 'Promotions and discount requests'),
  ('customers', 'Customer management', 'Customer accounts and order summaries'),
  ('reports', 'Reports', 'Operational reports and exports'),
  ('financials', 'Financial monitoring', 'Expenses, costs, and profit estimates'),
  ('branches', 'Branch settings', 'Branch configuration'),
  ('staff', 'Staff management', 'Staff assignments and access')
on conflict (id) do nothing;

insert into public.permissions (module_id, action)
select modules.id, actions.action
from public.modules
cross join (
  values ('view'), ('create'), ('edit'), ('approve'), ('cancel'), ('export'), ('manage')
) as actions(action)
on conflict (module_id, action) do nothing;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, phone, avatar_path) on public.profiles to authenticated;

revoke all on public.branches from anon, authenticated;
grant select on public.branches to anon, authenticated;
grant insert, update, delete on public.branches to authenticated;

revoke all on public.user_roles from anon, authenticated;
grant select, insert, update, delete on public.user_roles to authenticated;

revoke all on public.user_branch_assignments from anon, authenticated;
grant select, insert, update, delete on public.user_branch_assignments to authenticated;

revoke all on public.modules, public.permissions from anon, authenticated;
grant select on public.modules, public.permissions to authenticated;

revoke all on public.user_permissions from anon, authenticated;
grant select, insert, update, delete on public.user_permissions to authenticated;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.is_active_account() from public, anon, authenticated;
revoke all on function public.has_role(public.app_role) from public, anon, authenticated;
revoke all on function public.can_access_branch(uuid) from public, anon, authenticated;

grant execute on function public.is_active_account() to authenticated;
grant execute on function public.has_role(public.app_role) to anon, authenticated;
grant execute on function public.can_access_branch(uuid) to anon, authenticated;
