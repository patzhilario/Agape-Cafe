-- Agape Cafe full database setup
-- For a fresh Supabase project only. Run this file instead of the individual migration files.
-- Do not rerun on a project where these migrations have already been applied.
-- Provision the initial Super Admin separately using provision_initial_super_admin.sql.
-- ============================================================================
-- Migration: 20261019000000_foundation.sql
-- ============================================================================
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


-- ============================================================================
-- Migration: 20261019001000_auth_permissions.sql
-- ============================================================================
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


-- ============================================================================
-- Migration: 20261019002000_public_menu.sql
-- ============================================================================
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  sort_order integer not null default 0,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories (id) on delete set null,
  name text not null,
  sku text not null unique,
  description text not null default '',
  image_path text,
  price numeric(10, 2) not null check (price >= 0),
  sort_order integer not null default 0,
  is_published boolean not null default false,
  is_featured boolean not null default false,
  is_best_seller boolean not null default false,
  is_available boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null,
  price numeric(10, 2) not null check (price >= 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (product_id, name)
);

create table public.product_addons (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null,
  price numeric(10, 2) not null default 0 check (price >= 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (product_id, name)
);

create table public.branch_product_availability (
  branch_id uuid not null references public.branches (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  is_available boolean not null default true,
  price_override numeric(10, 2) check (price_override is null or price_override >= 0),
  updated_at timestamptz not null default now(),
  primary key (branch_id, product_id)
);

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  terms text not null default '',
  discount_type text not null check (discount_type in ('fixed', 'percentage')),
  discount_value numeric(10, 2) not null check (discount_value > 0),
  max_discount numeric(10, 2) check (max_discount is null or max_discount > 0),
  minimum_purchase numeric(10, 2) not null default 0 check (minimum_purchase >= 0),
  starts_at timestamptz not null,
  ends_at timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create index products_public_listing_idx
  on public.products (sort_order, name)
  where is_published and archived_at is null and is_available;
create index products_category_id_idx on public.products (category_id);
create index product_variants_product_idx
  on public.product_variants (product_id, sort_order)
  where is_active;
create index product_addons_product_idx
  on public.product_addons (product_id, sort_order)
  where is_active;
create index branch_product_availability_product_idx
  on public.branch_product_availability (product_id, branch_id)
  where is_available;
create index promotions_active_dates_idx
  on public.promotions (starts_at, ends_at)
  where is_active;

create trigger categories_set_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger promotions_set_updated_at
before update on public.promotions
for each row execute function public.set_updated_at();

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_addons enable row level security;
alter table public.branch_product_availability enable row level security;
alter table public.promotions enable row level security;

create policy "Public can view published categories"
on public.categories for select to anon, authenticated
using (is_published or public.has_role('super_admin'));

create policy "Super admins can manage categories"
on public.categories for all to authenticated
using (public.has_role('super_admin'))
with check (public.has_role('super_admin'));

create policy "Public can view published products"
on public.products for select to anon, authenticated
using (
  (
    is_published
    and is_available
    and archived_at is null
    and exists (
      select 1 from public.categories
      where categories.id = products.category_id
        and categories.is_published
    )
  )
  or public.has_role('super_admin')
);

create policy "Super admins can manage products"
on public.products for all to authenticated
using (public.has_role('super_admin'))
with check (public.has_role('super_admin'));

create policy "Public can view variants for published products"
on public.product_variants for select to anon, authenticated
using (
  is_active
  and exists (
    select 1 from public.products
    where products.id = product_variants.product_id
      and products.is_published
      and products.is_available
      and products.archived_at is null
  )
  or public.has_role('super_admin')
);

create policy "Super admins can manage variants"
on public.product_variants for all to authenticated
using (public.has_role('super_admin'))
with check (public.has_role('super_admin'));

create policy "Public can view add-ons for published products"
on public.product_addons for select to anon, authenticated
using (
  is_active
  and exists (
    select 1 from public.products
    where products.id = product_addons.product_id
      and products.is_published
      and products.is_available
      and products.archived_at is null
  )
  or public.has_role('super_admin')
);

create policy "Super admins can manage add-ons"
on public.product_addons for all to authenticated
using (public.has_role('super_admin'))
with check (public.has_role('super_admin'));

create policy "Public can view available branch products"
on public.branch_product_availability for select to anon, authenticated
using (
  is_available
  and exists (
    select 1 from public.branches
    where branches.id = branch_product_availability.branch_id
      and branches.is_active
  )
  and exists (
    select 1 from public.products
    where products.id = branch_product_availability.product_id
      and products.is_published
      and products.is_available
      and products.archived_at is null
  )
  or public.can_access_branch(branch_id)
);

create policy "Authorized branch users can manage branch product availability"
on public.branch_product_availability for all to authenticated
using (
  public.can_access_branch(branch_id)
  and public.has_permission(branch_id, 'menu', 'edit')
)
with check (
  public.can_access_branch(branch_id)
  and public.has_permission(branch_id, 'menu', 'edit')
);

create policy "Public can view current active promotions"
on public.promotions for select to anon, authenticated
using (
  (
    is_active
    and starts_at <= now()
    and (ends_at is null or ends_at > now())
  )
  or public.has_role('super_admin')
);

create policy "Super admins can manage promotions"
on public.promotions for all to authenticated
using (public.has_role('super_admin'))
with check (public.has_role('super_admin'));

revoke all on public.categories, public.products, public.product_variants,
  public.product_addons, public.branch_product_availability, public.promotions
from anon, authenticated;

grant select on public.categories, public.products, public.product_variants,
  public.product_addons, public.branch_product_availability, public.promotions
to anon, authenticated;

grant insert, update, delete on public.categories, public.products,
  public.product_variants, public.product_addons, public.promotions
to authenticated;

grant insert, update, delete on public.branch_product_availability
to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-images',
  'menu-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Anyone can view public menu images"
on storage.objects for select to anon, authenticated
using (bucket_id = 'menu-images');

create policy "Super admins can upload menu images"
on storage.objects for insert to authenticated
with check (bucket_id = 'menu-images' and public.has_role('super_admin'));

create policy "Super admins can update menu images"
on storage.objects for update to authenticated
using (bucket_id = 'menu-images' and public.has_role('super_admin'))
with check (bucket_id = 'menu-images' and public.has_role('super_admin'));

create policy "Super admins can delete menu images"
on storage.objects for delete to authenticated
using (bucket_id = 'menu-images' and public.has_role('super_admin'));


-- ============================================================================
-- Migration: 20261019003000_customer_orders.sql
-- ============================================================================
create type public.order_fulfillment_method as enum (
  'dine_in',
  'takeout',
  'pickup'
);

create type public.order_status as enum (
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'completed',
  'cancelled'
);

create type public.payment_status as enum (
  'unpaid',
  'pending',
  'paid',
  'failed',
  'refunded',
  'partially_refunded'
);

create table public.branch_product_stock (
  branch_id uuid not null references public.branches (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  quantity_on_hand integer not null check (quantity_on_hand >= 0),
  quantity_reserved integer not null default 0
    check (quantity_reserved >= 0 and quantity_reserved <= quantity_on_hand),
  updated_at timestamptz not null default now(),
  primary key (branch_id, product_id),
  foreign key (branch_id, product_id)
    references public.branch_product_availability (branch_id, product_id)
    on delete cascade
);

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  instructions text not null default '',
  settlement_type text not null check (settlement_type in ('pay_at_branch', 'provider')),
  provider text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (settlement_type = 'pay_at_branch' and provider is null)
    or (settlement_type = 'provider' and provider is not null)
  )
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references public.profiles (id) on delete restrict,
  branch_id uuid not null references public.branches (id) on delete restrict,
  client_request_id uuid not null,
  request_fingerprint text not null,
  customer_name text not null,
  customer_email text,
  customer_phone text not null,
  fulfillment_method public.order_fulfillment_method not null,
  customer_note text not null default '',
  status public.order_status not null default 'pending',
  payment_status public.payment_status not null default 'unpaid',
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  discount_total numeric(12, 2) not null default 0
    check (discount_total >= 0 and discount_total <= subtotal),
  total numeric(12, 2) not null check (total >= 0 and total = subtotal - discount_total),
  promotion_id uuid references public.promotions (id) on delete set null,
  cancellation_reason text,
  stock_released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, client_request_id)
);

create sequence public.order_number_sequence;

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  product_id uuid references public.products (id) on delete set null,
  variant_id uuid references public.product_variants (id) on delete set null,
  product_name text not null,
  product_sku text not null,
  variant_name text,
  quantity integer not null check (quantity between 1 and 20),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  line_subtotal numeric(12, 2) not null check (line_subtotal >= 0),
  discount_amount numeric(12, 2) not null default 0
    check (discount_amount >= 0 and discount_amount <= line_subtotal),
  line_total numeric(12, 2) not null check (line_total >= 0),
  promotion_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  check (line_total = line_subtotal - discount_amount)
);

create table public.order_item_addons (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete restrict,
  addon_id uuid references public.product_addons (id) on delete set null,
  addon_name text not null,
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete restrict,
  payment_method_id uuid references public.payment_methods (id) on delete set null,
  payment_method_code text not null,
  payment_method_name text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  status public.payment_status not null default 'unpaid',
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.promotions
  add column max_uses integer check (max_uses is null or max_uses > 0),
  add column max_uses_per_customer integer
    check (max_uses_per_customer is null or max_uses_per_customer > 0);

create table public.promotion_products (
  promotion_id uuid not null references public.promotions (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  primary key (promotion_id, product_id)
);

create table public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions (id) on delete restrict,
  customer_id uuid not null references public.profiles (id) on delete restrict,
  order_id uuid not null unique references public.orders (id) on delete restrict,
  discount_amount numeric(12, 2) not null check (discount_amount > 0),
  created_at timestamptz not null default now()
);

create index orders_customer_created_idx on public.orders (customer_id, created_at desc);
create index orders_branch_created_idx on public.orders (branch_id, created_at desc);
create index orders_branch_status_idx on public.orders (branch_id, status, created_at desc);
create index order_items_order_id_idx on public.order_items (order_id);
create index order_item_addons_item_idx on public.order_item_addons (order_item_id);
create index promotion_redemptions_promotion_idx
  on public.promotion_redemptions (promotion_id, customer_id);
create index branch_product_stock_available_idx
  on public.branch_product_stock (branch_id, product_id)
  where quantity_on_hand > quantity_reserved;

create trigger branch_product_stock_set_updated_at
before update on public.branch_product_stock
for each row execute function public.set_updated_at();

create trigger payment_methods_set_updated_at
before update on public.payment_methods
for each row execute function public.set_updated_at();

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

alter table public.branch_product_stock enable row level security;
alter table public.payment_methods enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_addons enable row level security;
alter table public.payments enable row level security;
alter table public.promotion_products enable row level security;
alter table public.promotion_redemptions enable row level security;

create policy "Public can view sellable product stock"
on public.branch_product_stock for select to anon, authenticated
using (
  quantity_on_hand > quantity_reserved
  and exists (
    select 1
    from public.branch_product_availability as availability
    join public.branches as branch on branch.id = availability.branch_id
    join public.products as product on product.id = availability.product_id
    where availability.branch_id = branch_product_stock.branch_id
      and availability.product_id = branch_product_stock.product_id
      and availability.is_available
      and branch.is_active
      and product.is_published
      and product.is_available
      and product.archived_at is null
  )
  or public.can_access_branch(branch_id)
);

create policy "Super admins can manage product stock"
on public.branch_product_stock for all to authenticated
using (public.has_role('super_admin'))
with check (public.has_role('super_admin'));

create policy "Anyone can view active payment methods"
on public.payment_methods for select to anon, authenticated
using (is_active or public.has_role('super_admin'));

create policy "Super admins can manage payment methods"
on public.payment_methods for all to authenticated
using (public.has_role('super_admin'))
with check (public.has_role('super_admin'));

create policy "Customers and authorized branch staff can view orders"
on public.orders for select to authenticated
using (
  customer_id = (select auth.uid())
  or (
    public.can_access_branch(branch_id)
    and public.has_permission(branch_id, 'orders', 'view')
  )
);

create policy "Customers and authorized branch staff can view order items"
on public.order_items for select to authenticated
using (
  exists (
    select 1 from public.orders
    where orders.id = order_items.order_id
      and (
        orders.customer_id = (select auth.uid())
        or (
          public.can_access_branch(orders.branch_id)
          and public.has_permission(orders.branch_id, 'orders', 'view')
        )
      )
  )
);

create policy "Customers and authorized branch staff can view item add-ons"
on public.order_item_addons for select to authenticated
using (
  exists (
    select 1
    from public.order_items
    join public.orders on orders.id = order_items.order_id
    where order_items.id = order_item_addons.order_item_id
      and (
        orders.customer_id = (select auth.uid())
        or (
          public.can_access_branch(orders.branch_id)
          and public.has_permission(orders.branch_id, 'orders', 'view')
        )
      )
  )
);

create policy "Customers and authorized branch staff can view payments"
on public.payments for select to authenticated
using (
  exists (
    select 1 from public.orders
    where orders.id = payments.order_id
      and (
        orders.customer_id = (select auth.uid())
        or (
          public.can_access_branch(orders.branch_id)
          and public.has_permission(orders.branch_id, 'orders', 'view')
        )
      )
  )
);

create policy "Public can view product targets for active promotions"
on public.promotion_products for select to anon, authenticated
using (
  exists (
    select 1 from public.promotions
    where promotions.id = promotion_products.promotion_id
      and promotions.is_active
      and promotions.starts_at <= now()
      and (promotions.ends_at is null or promotions.ends_at > now())
  )
  or public.has_role('super_admin')
);

create policy "Customers can view their own promotion redemptions"
on public.promotion_redemptions for select to authenticated
using (
  customer_id = (select auth.uid())
  or public.has_role('super_admin')
);

revoke all on public.branch_product_stock, public.payment_methods, public.orders,
  public.order_items, public.order_item_addons, public.payments,
  public.promotion_products, public.promotion_redemptions
from anon, authenticated;

grant select on public.branch_product_stock, public.payment_methods
to anon, authenticated;

grant select on public.orders, public.order_items, public.order_item_addons,
  public.payments, public.promotion_products, public.promotion_redemptions
to authenticated;

grant insert, update, delete on public.branch_product_stock,
  public.payment_methods to authenticated;

insert into public.payment_methods (
  code,
  name,
  instructions,
  settlement_type,
  is_active
)
values (
  'cash_at_branch',
  'Pay at the branch',
  'Payment is collected by staff at the selected branch. The order is not marked as paid until staff records the payment.',
  'pay_at_branch',
  true
)
on conflict (code) do nothing;

create or replace function public.create_customer_order(
  target_branch_id uuid,
  fulfillment public.order_fulfillment_method,
  payment_method_id uuid,
  client_request_id uuid,
  customer_phone text,
  customer_note text,
  requested_promotion_id uuid,
  cart_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_user_email text := (select auth.jwt() ->> 'email');
  current_profile public.profiles%rowtype;
  selected_payment_method public.payment_methods%rowtype;
  selected_promotion public.promotions%rowtype;
  item jsonb;
  addon_json jsonb;
  item_product_id uuid;
  item_variant_id uuid;
  item_quantity integer;
  item_product public.products%rowtype;
  item_variant public.product_variants%rowtype;
  item_availability public.branch_product_availability%rowtype;
  item_stock public.branch_product_stock%rowtype;
  requested_product_quantity integer;
  item_unit_price numeric(12, 2);
  item_addon_total numeric(12, 2);
  item_line_total numeric(12, 2);
  item_order_id uuid;
  item_order_number text;
  item_subtotal numeric(12, 2) := 0;
  eligible_subtotal numeric(12, 2) := 0;
  discount_total numeric(12, 2) := 0;
  request_fingerprint text;
  existing_order public.orders%rowtype;
  addon_id uuid;
  addon_value text;
  addon_record public.product_addons%rowtype;
  addon_seen uuid[];
  promotion_product_count integer;
  redemption_count integer;
  max_line_number bigint;
begin
  if current_user_id is null then
    raise exception 'Sign in to place an order.' using errcode = '42501';
  end if;

  if not public.is_active_account() then
    raise exception 'This account is not active.' using errcode = '42501';
  end if;

  if target_branch_id is null or fulfillment is null or payment_method_id is null
      or client_request_id is null then
    raise exception 'Choose a branch, fulfillment method, and payment method.';
  end if;

  if customer_phone is null or length(btrim(customer_phone)) < 7
      or length(btrim(customer_phone)) > 40
      or btrim(customer_phone) !~ '^[+()0-9[:space:].-]{7,40}$' then
    raise exception 'Enter a valid contact phone number.';
  end if;

  if customer_note is not null and length(customer_note) > 500 then
    raise exception 'Order notes cannot exceed 500 characters.';
  end if;

  if cart_items is null or jsonb_typeof(cart_items) is distinct from 'array' then
    raise exception 'Your cart must contain between 1 and 50 items.';
  end if;

  if jsonb_array_length(cart_items) < 1 or jsonb_array_length(cart_items) > 50 then
    raise exception 'Your cart must contain between 1 and 50 items.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(cart_items) as entry(value)
    where jsonb_typeof(entry.value) <> 'object'
      or not (entry.value ? 'product_id')
      or not (entry.value ? 'quantity')
      or jsonb_typeof(entry.value -> 'quantity') <> 'number'
      or (entry.value ->> 'quantity') !~ '^[0-9]+$'
      or (
        entry.value ? 'addon_ids'
        and jsonb_typeof(entry.value -> 'addon_ids') <> 'array'
      )
  ) then
    raise exception 'One or more cart items are invalid.';
  end if;

  request_fingerprint := md5(jsonb_build_object(
    'branch_id', target_branch_id,
    'fulfillment', fulfillment,
    'payment_method_id', payment_method_id,
    'customer_phone', btrim(customer_phone),
    'customer_note', coalesce(btrim(customer_note), ''),
    'promotion_id', requested_promotion_id,
    'items', cart_items
  )::text);

  perform pg_advisory_xact_lock(
    hashtextextended(current_user_id::text || ':' || client_request_id::text, 0)
  );

  select * into existing_order
  from public.orders
  where customer_id = current_user_id
    and orders.client_request_id = create_customer_order.client_request_id;

  if found then
    if existing_order.request_fingerprint <> request_fingerprint then
      raise exception 'This order submission key was already used for different cart contents.';
    end if;
    return existing_order.id;
  end if;

  select * into current_profile
  from public.profiles
  where id = current_user_id
    and is_active
  for share;
  if not found then
    raise exception 'This account is not active.' using errcode = '42501';
  end if;

  perform 1 from public.branches
  where id = target_branch_id
    and is_active
  for share;
  if not found then
    raise exception 'This branch is not accepting orders.';
  end if;

  select * into selected_payment_method
  from public.payment_methods
  where id = payment_method_id
    and is_active
    and settlement_type = 'pay_at_branch'
  for share;
  if not found then
    raise exception 'This payment method is not currently available.';
  end if;

  for item in
    select entry.value
    from jsonb_array_elements(cart_items) as entry(value)
    order by entry.value ->> 'product_id', entry.value ->> 'variant_id'
  loop
    begin
      item_product_id := (item ->> 'product_id')::uuid;
      item_quantity := (item ->> 'quantity')::integer;
      item_variant_id := nullif(item ->> 'variant_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'One or more cart items contain invalid identifiers or quantities.';
    end;

    if item_quantity is null or item_quantity < 1 or item_quantity > 20 then
      raise exception 'Each cart item quantity must be between 1 and 20.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(coalesce(item -> 'addon_ids', '[]'::jsonb)) as addon(value)
      group by addon.value
      having count(*) > 1
    ) then
      raise exception 'An add-on cannot be selected more than once for the same item.';
    end if;

    select * into item_product
    from public.products
    where id = item_product_id
      and is_published
      and is_available
      and archived_at is null
      and exists (
        select 1 from public.categories
        where categories.id = products.category_id
          and categories.is_published
      )
    for share;
    if not found then
      raise exception 'A cart product is no longer available.';
    end if;

    select * into item_availability
    from public.branch_product_availability
    where branch_id = target_branch_id
      and product_id = item_product_id
      and is_available
    for share;
    if not found then
      raise exception 'A cart product is not available at the selected branch.';
    end if;

    select * into item_stock
    from public.branch_product_stock
    where branch_id = target_branch_id
      and product_id = item_product_id
    for update;
    if item_stock.branch_id is null then
      raise exception 'A cart product does not have enough stock at the selected branch.';
    end if;
    select coalesce(sum((entry.value ->> 'quantity')::integer), 0)
      into requested_product_quantity
    from jsonb_array_elements(cart_items) as entry(value)
    where (entry.value ->> 'product_id')::uuid = item_product_id;
    if item_stock.quantity_on_hand - item_stock.quantity_reserved
        < requested_product_quantity then
      raise exception 'A cart product does not have enough stock at the selected branch.';
    end if;

    if item_variant_id is not null then
      select * into item_variant
      from public.product_variants
      where id = item_variant_id
        and product_id = item_product_id
        and is_active
      for share;
      if not found then
        raise exception 'A selected product size is no longer available.';
      end if;
      item_unit_price := item_variant.price;
    else
      if exists (
        select 1 from public.product_variants
        where product_id = item_product_id and is_active
      ) then
        raise exception 'Choose a size for each configured product.';
      end if;
      item_unit_price := coalesce(item_availability.price_override, item_product.price);
    end if;

    item_addon_total := 0;
    addon_seen := array[]::uuid[];
    for addon_value in
      select addon.value from jsonb_array_elements_text(
        coalesce(item -> 'addon_ids', '[]'::jsonb)
      ) as addon(value)
    loop
      begin
        addon_id := addon_value::uuid;
      exception when invalid_text_representation then
        raise exception 'A selected add-on identifier is invalid.';
      end;

      if addon_id = any(addon_seen) then
        raise exception 'An add-on cannot be selected more than once for the same item.';
      end if;
      addon_seen := array_append(addon_seen, addon_id);

      select * into addon_record
      from public.product_addons
      where id = addon_id
        and product_id = item_product_id
        and is_active
      for share;
      if not found then
        raise exception 'A selected add-on is no longer available.';
      end if;
      item_addon_total := item_addon_total + addon_record.price;
    end loop;

    item_line_total := (item_unit_price + item_addon_total) * item_quantity;
    item_subtotal := item_subtotal + item_line_total;
  end loop;

  if requested_promotion_id is not null then
    select * into selected_promotion
    from public.promotions
    where id = requested_promotion_id
      and is_active
      and starts_at <= now()
      and (ends_at is null or ends_at > now())
    for update;
    if not found then
      raise exception 'This promotion is no longer active.';
    end if;

    select count(*) into redemption_count
    from public.promotion_redemptions
    where promotion_id = selected_promotion.id;
    if selected_promotion.max_uses is not null
        and redemption_count >= selected_promotion.max_uses then
      raise exception 'This promotion has reached its usage limit.';
    end if;

    select count(*) into redemption_count
    from public.promotion_redemptions
    where promotion_id = selected_promotion.id
      and customer_id = current_user_id;
    if selected_promotion.max_uses_per_customer is not null
        and redemption_count >= selected_promotion.max_uses_per_customer then
      raise exception 'You have reached this promotion usage limit.';
    end if;

    if item_subtotal < selected_promotion.minimum_purchase then
      raise exception 'Your order does not meet this promotion minimum purchase.';
    end if;

    select count(*) into promotion_product_count
    from public.promotion_products
    where promotion_id = selected_promotion.id;

    if promotion_product_count = 0 then
      eligible_subtotal := item_subtotal;
    else
      eligible_subtotal := 0;
      for item in select entry.value from jsonb_array_elements(cart_items) as entry(value)
      loop
        item_product_id := (item ->> 'product_id')::uuid;
        if exists (
          select 1 from public.promotion_products
          where promotion_id = selected_promotion.id
            and product_id = item_product_id
        ) then
          select eligible_subtotal + (
            (case
              when nullif(item ->> 'variant_id', '') is not null then (
                select price from public.product_variants
                where id = (item ->> 'variant_id')::uuid
              )
              else coalesce(
                (select price_override from public.branch_product_availability
                 where branch_id = target_branch_id and product_id = item_product_id),
                (select price from public.products where id = item_product_id)
              )
            end
            + coalesce((
              select sum(addon.price)
              from public.product_addons as addon
              where addon.id in (
                select value::uuid
                from jsonb_array_elements_text(coalesce(item -> 'addon_ids', '[]'::jsonb))
              )
            ), 0)
            ) * (item ->> 'quantity')::integer
          ) into eligible_subtotal;
        end if;
      end loop;
    end if;

    if eligible_subtotal <= 0 then
      raise exception 'This promotion does not apply to the products in your cart.';
    end if;

    discount_total := case
      when selected_promotion.discount_type = 'percentage'
        then round(eligible_subtotal * selected_promotion.discount_value / 100, 2)
      else least(selected_promotion.discount_value, eligible_subtotal)
    end;
    if selected_promotion.max_discount is not null then
      discount_total := least(discount_total, selected_promotion.max_discount);
    end if;
    discount_total := least(discount_total, eligible_subtotal, item_subtotal);
  end if;

  item_order_number := 'AG-' || to_char(now() at time zone 'UTC', 'YYYYMMDD')
    || '-' || lpad(nextval('public.order_number_sequence')::text, 6, '0');

  insert into public.orders (
    order_number,
    customer_id,
    branch_id,
    client_request_id,
    request_fingerprint,
    customer_name,
    customer_email,
    customer_phone,
    fulfillment_method,
    customer_note,
    subtotal,
    discount_total,
    total,
    promotion_id
  )
  values (
    item_order_number,
    current_user_id,
    target_branch_id,
    client_request_id,
    request_fingerprint,
    coalesce(nullif(btrim(current_profile.display_name), ''), current_user_email, 'Customer'),
    current_user_email,
    btrim(customer_phone),
    fulfillment,
    coalesce(btrim(customer_note), ''),
    item_subtotal,
    discount_total,
    item_subtotal - discount_total,
    requested_promotion_id
  )
  returning id into item_order_id;

  for item in
    select entry.value
    from jsonb_array_elements(cart_items) as entry(value)
    order by entry.value ->> 'product_id', entry.value ->> 'variant_id'
  loop
    item_product_id := (item ->> 'product_id')::uuid;
    item_quantity := (item ->> 'quantity')::integer;
    item_variant_id := nullif(item ->> 'variant_id', '')::uuid;

    select * into item_product
    from public.products
    where id = item_product_id
      and is_published
      and is_available
      and archived_at is null;
    select * into item_availability
    from public.branch_product_availability
    where branch_id = target_branch_id
      and product_id = item_product_id
      and is_available;

    if item_variant_id is not null then
      select * into item_variant from public.product_variants
      where id = item_variant_id and product_id = item_product_id and is_active;
      item_unit_price := item_variant.price;
    else
      item_unit_price := coalesce(item_availability.price_override, item_product.price);
      item_variant := null;
    end if;

    item_addon_total := 0;
    for addon_value in
      select addon.value from jsonb_array_elements_text(
        coalesce(item -> 'addon_ids', '[]'::jsonb)
      ) as addon(value)
    loop
      addon_id := addon_value::uuid;
      select * into addon_record
      from public.product_addons
      where id = addon_id and product_id = item_product_id and is_active;
      item_addon_total := item_addon_total + addon_record.price;
    end loop;

    item_line_total := (item_unit_price + item_addon_total) * item_quantity;

    insert into public.order_items (
      order_id,
      product_id,
      variant_id,
      product_name,
      product_sku,
      variant_name,
      quantity,
      unit_price,
      line_subtotal,
      discount_amount,
      line_total,
      promotion_eligible
    )
    values (
      item_order_id,
      item_product.id,
      item_variant.id,
      item_product.name,
      item_product.sku,
      item_variant.name,
      item_quantity,
      item_unit_price + item_addon_total,
      item_line_total,
      0,
      item_line_total,
      requested_promotion_id is null
        or promotion_product_count = 0
        or exists (
          select 1 from public.promotion_products
          where promotion_id = requested_promotion_id
            and product_id = item_product_id
        )
    )
    returning id into addon_id;

    for addon_value in
      select addon.value from jsonb_array_elements_text(
        coalesce(item -> 'addon_ids', '[]'::jsonb)
      ) as addon(value)
    loop
      select * into addon_record
      from public.product_addons
      where id = addon_value::uuid
        and product_id = item_product_id
        and is_active;

      insert into public.order_item_addons (
        order_item_id, addon_id, addon_name, unit_price
      )
      values (addon_id, addon_record.id, addon_record.name, addon_record.price);
    end loop;

    update public.branch_product_stock
    set quantity_reserved = quantity_reserved + item_quantity
    where branch_id = target_branch_id
      and product_id = item_product_id;
  end loop;

  if discount_total > 0 then
    select count(*) into max_line_number
    from public.order_items
    where order_id = item_order_id
      and promotion_eligible;

    with eligible_items as (
      select
        id,
        line_subtotal,
        row_number() over (order by id) as line_number,
        count(*) over () as total_lines,
        sum(line_subtotal) over () as eligible_total
      from public.order_items
      where order_id = item_order_id
        and promotion_eligible
    ),
    allocations as (
      select
        id,
        case
          when line_number = total_lines then
            discount_total - coalesce(
              sum(round(discount_total * line_subtotal / eligible_total, 2))
                over (order by line_number rows between unbounded preceding and 1 preceding),
              0
            )
          else round(discount_total * line_subtotal / eligible_total, 2)
        end as allocated_discount
      from eligible_items
    )
    update public.order_items as order_item
    set discount_amount = allocations.allocated_discount,
        line_total = order_item.line_subtotal - allocations.allocated_discount
    from allocations
    where order_item.id = allocations.id;

    insert into public.promotion_redemptions (
      promotion_id, customer_id, order_id, discount_amount
    )
    values (
      requested_promotion_id, current_user_id, item_order_id, discount_total
    );
  end if;

  insert into public.payments (
    order_id,
    payment_method_id,
    payment_method_code,
    payment_method_name,
    amount,
    status
  )
  values (
    item_order_id,
    selected_payment_method.id,
    selected_payment_method.code,
    selected_payment_method.name,
    item_subtotal - discount_total,
    'unpaid'
  );

  insert into public.audit_logs (
    actor_id,
    action,
    record_type,
    record_id,
    branch_id,
    details
  )
  values (
    current_user_id,
    'customer_order_created',
    'order',
    item_order_id,
    target_branch_id,
    jsonb_build_object(
      'order_number', item_order_number,
      'fulfillment_method', fulfillment,
      'payment_method', selected_payment_method.code,
      'subtotal', item_subtotal,
      'discount_total', discount_total,
      'total', item_subtotal - discount_total
    )
  );

  return item_order_id;
end;
$$;

create or replace function public.update_order_status(
  target_order_id uuid,
  next_status public.order_status,
  cancellation_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_order public.orders%rowtype;
  order_line record;
  required_action text;
begin
  if not public.is_active_account() then
    raise exception 'This account is not active.' using errcode = '42501';
  end if;

  select * into current_order
  from public.orders
  where id = target_order_id
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;

  required_action := case
    when next_status = 'cancelled' then 'cancel'
    else 'edit'
  end;

  if not public.can_access_branch(current_order.branch_id)
      or not public.has_permission(current_order.branch_id, 'orders', required_action) then
    raise exception 'You do not have permission to update this order.'
      using errcode = '42501';
  end if;

  if next_status = 'cancelled' then
    if cancellation_reason is null or length(btrim(cancellation_reason)) < 3
        or length(btrim(cancellation_reason)) > 500 then
      raise exception 'Enter a cancellation reason between 3 and 500 characters.';
    end if;
    if current_order.status in ('cancelled', 'completed') then
      raise exception 'This order can no longer be cancelled.';
    end if;
  elsif not (
    (current_order.status = 'pending' and next_status = 'confirmed')
    or (current_order.status = 'confirmed' and next_status = 'preparing')
    or (current_order.status = 'preparing' and next_status = 'ready')
    or (current_order.status = 'ready' and next_status = 'completed')
  ) then
    raise exception 'This order status transition is not allowed.';
  end if;

  if next_status in ('cancelled', 'completed')
      and current_order.stock_released_at is null then
    for order_line in
      select product_id, quantity
      from public.order_items
      where order_id = target_order_id
        and product_id is not null
      order by product_id
    loop
      perform 1 from public.branch_product_stock
      where branch_id = current_order.branch_id
        and product_id = order_line.product_id
      for update;

      if next_status = 'cancelled' then
        update public.branch_product_stock
        set quantity_reserved = quantity_reserved - order_line.quantity
        where branch_id = current_order.branch_id
          and product_id = order_line.product_id
          and quantity_reserved >= order_line.quantity;
      else
        update public.branch_product_stock
        set quantity_on_hand = quantity_on_hand - order_line.quantity,
            quantity_reserved = quantity_reserved - order_line.quantity
        where branch_id = current_order.branch_id
          and product_id = order_line.product_id
          and quantity_on_hand >= order_line.quantity
          and quantity_reserved >= order_line.quantity;
      end if;

      if not found then
        raise exception 'Reserved product stock could not be reconciled.';
      end if;
    end loop;
  end if;

  update public.orders
  set status = next_status,
      cancellation_reason = case
        when next_status = 'cancelled' then btrim(cancellation_reason)
        else null
      end,
      stock_released_at = case
        when next_status in ('cancelled', 'completed') then now()
        else stock_released_at
      end
  where id = target_order_id;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    (select auth.uid()),
    case when next_status = 'cancelled' then 'order_cancelled' else 'order_status_updated' end,
    'order',
    target_order_id,
    current_order.branch_id,
    jsonb_build_object(
      'previous_status', current_order.status,
      'new_status', next_status,
      'cancellation_reason', case
        when next_status = 'cancelled' then btrim(cancellation_reason)
        else null
      end
    )
  );
end;
$$;

revoke all on function public.create_customer_order(
  uuid, public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.create_customer_order(
  uuid, public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb
) to authenticated;

revoke all on function public.update_order_status(
  uuid, public.order_status, text
) from public, anon, authenticated;
grant execute on function public.update_order_status(
  uuid, public.order_status, text
) to authenticated;


-- ============================================================================
-- Migration: 20261019004000_administration_inventory.sql
-- ============================================================================
create type public.inventory_movement_type as enum (
  'receipt',
  'adjustment',
  'waste',
  'order_consumption'
);

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(name)) between 1 and 120),
  check (length(btrim(unit)) between 1 and 24)
);

create table public.product_recipes (
  product_id uuid not null references public.products (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete restrict,
  quantity numeric(12, 4) not null check (quantity > 0),
  primary key (product_id, ingredient_id)
);

create table public.branch_inventory (
  branch_id uuid not null references public.branches (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete restrict,
  quantity_on_hand numeric(14, 4) not null default 0 check (quantity_on_hand >= 0),
  updated_at timestamptz not null default now(),
  primary key (branch_id, ingredient_id)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete restrict,
  ingredient_id uuid not null references public.ingredients (id) on delete restrict,
  order_id uuid references public.orders (id) on delete restrict,
  movement_type public.inventory_movement_type not null,
  quantity_delta numeric(14, 4) not null check (quantity_delta <> 0),
  unit_cost numeric(12, 4) check (unit_cost is null or unit_cost >= 0),
  note text not null default '',
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (length(note) <= 500),
  check (
    (movement_type = 'receipt' and quantity_delta > 0)
    or (movement_type in ('waste', 'order_consumption') and quantity_delta < 0)
    or movement_type = 'adjustment'
  ),
  check ((movement_type = 'order_consumption') = (order_id is not null))
);

create index inventory_movements_branch_created_idx
  on public.inventory_movements (branch_id, created_at desc);
create index inventory_movements_ingredient_created_idx
  on public.inventory_movements (ingredient_id, created_at desc);
create index product_recipes_ingredient_idx on public.product_recipes (ingredient_id);

create trigger ingredients_set_updated_at
before update on public.ingredients
for each row execute function public.set_updated_at();

create trigger branch_inventory_set_updated_at
before update on public.branch_inventory
for each row execute function public.set_updated_at();

alter table public.ingredients enable row level security;
alter table public.product_recipes enable row level security;
alter table public.branch_inventory enable row level security;
alter table public.inventory_movements enable row level security;

create policy "Authorized staff can view ingredients"
on public.ingredients for select to authenticated
using (public.has_role('super_admin') or public.is_active_account());

create policy "Super admins can manage ingredients"
on public.ingredients for all to authenticated
using (public.has_role('super_admin'))
with check (public.has_role('super_admin'));

create policy "Authorized staff can view recipes"
on public.product_recipes for select to authenticated
using (public.has_role('super_admin') or public.is_active_account());

create policy "Super admins can manage recipes"
on public.product_recipes for all to authenticated
using (public.has_role('super_admin'))
with check (public.has_role('super_admin'));

create policy "Branch staff can view inventory"
on public.branch_inventory for select to authenticated
using (
  public.can_access_branch(branch_id)
  and public.has_permission(branch_id, 'inventory', 'view')
);

create policy "Branch staff can view inventory movement history"
on public.inventory_movements for select to authenticated
using (
  public.can_access_branch(branch_id)
  and public.has_permission(branch_id, 'inventory', 'view')
);

revoke all on public.ingredients, public.product_recipes, public.branch_inventory,
  public.inventory_movements from anon, authenticated;
grant select on public.ingredients, public.product_recipes to authenticated;
grant select on public.branch_inventory, public.inventory_movements to authenticated;
grant insert, update, delete on public.ingredients, public.product_recipes to authenticated;

create or replace function public.record_inventory_movement(
  target_branch_id uuid,
  target_ingredient_id uuid,
  movement public.inventory_movement_type,
  quantity_delta numeric,
  note text default '',
  unit_cost numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  movement_id uuid;
begin
  if not public.is_active_account()
      or not public.can_access_branch(target_branch_id)
      or not (
        public.has_permission(target_branch_id, 'inventory', 'create')
        or public.has_permission(target_branch_id, 'inventory', 'edit')
      ) then
    raise exception 'You do not have permission to record inventory movements.'
      using errcode = '42501';
  end if;

  if movement = 'order_consumption' then
    raise exception 'Order consumption is recorded only when staff completes an order.';
  end if;

  if quantity_delta is null or quantity_delta = 0
      or (movement = 'receipt' and quantity_delta <= 0)
      or (movement = 'waste' and quantity_delta >= 0)
      or (movement = 'adjustment' and abs(quantity_delta) > 1000000) then
    raise exception 'Enter a valid non-zero quantity for this movement type.';
  end if;
  if note is not null and length(note) > 500 then
    raise exception 'Inventory notes cannot exceed 500 characters.';
  end if;
  if unit_cost is not null and unit_cost < 0 then
    raise exception 'Unit cost cannot be negative.';
  end if;

  perform 1 from public.branches
  where id = target_branch_id and is_active
  for share;
  if not found then
    raise exception 'The selected branch is inactive or does not exist.';
  end if;

  perform 1 from public.ingredients
  where id = target_ingredient_id and is_active
  for share;
  if not found then
    raise exception 'The selected ingredient is inactive or does not exist.';
  end if;

  insert into public.branch_inventory (branch_id, ingredient_id)
  values (target_branch_id, target_ingredient_id)
  on conflict (branch_id, ingredient_id) do nothing;

  update public.branch_inventory
  set quantity_on_hand = quantity_on_hand + quantity_delta
  where branch_id = target_branch_id
    and ingredient_id = target_ingredient_id
    and quantity_on_hand + quantity_delta >= 0;
  if not found then
    raise exception 'This movement would make inventory negative.';
  end if;

  insert into public.inventory_movements (
    branch_id, ingredient_id, movement_type, quantity_delta, unit_cost, note, actor_id
  )
  values (
    target_branch_id, target_ingredient_id, movement, quantity_delta,
    unit_cost, coalesce(btrim(note), ''), (select auth.uid())
  )
  returning id into movement_id;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    (select auth.uid()),
    'inventory_movement_recorded',
    'inventory_movement',
    movement_id,
    target_branch_id,
    jsonb_build_object(
      'ingredient_id', target_ingredient_id,
      'movement_type', movement,
      'quantity_delta', quantity_delta,
      'unit_cost', unit_cost,
      'note', coalesce(btrim(note), '')
    )
  );

  return movement_id;
end;
$$;

create or replace function public.admin_set_product_recipe(
  target_product_id uuid,
  ingredient_ids uuid[],
  quantities numeric[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('super_admin') then
    raise exception 'Super Admin permission is required to manage recipes.'
      using errcode = '42501';
  end if;

  if target_product_id is null
      or cardinality(coalesce(ingredient_ids, array[]::uuid[]))
        <> cardinality(coalesce(quantities, array[]::numeric[]))
      or cardinality(coalesce(ingredient_ids, array[]::uuid[])) > 100 then
    raise exception 'Recipe ingredients and quantities must be provided as matching lists.';
  end if;

  if exists (
    select 1
    from unnest(coalesce(ingredient_ids, array[]::uuid[])) as ingredient(id)
    where id is null
  ) or exists (
    select 1
    from unnest(coalesce(quantities, array[]::numeric[])) as amount(value)
    where value is null or value <= 0
  ) then
    raise exception 'Recipe ingredient IDs and quantities must be valid and positive.';
  end if;

  if cardinality(coalesce(ingredient_ids, array[]::uuid[])) <>
      (select count(distinct id) from unnest(coalesce(ingredient_ids, array[]::uuid[])) as ingredient(id)) then
    raise exception 'A recipe cannot include the same ingredient more than once.';
  end if;

  perform 1 from public.products
  where id = target_product_id and archived_at is null
  for share;
  if not found then
    raise exception 'The selected product is archived or does not exist.';
  end if;

  if exists (
    select 1
    from unnest(coalesce(ingredient_ids, array[]::uuid[])) as ingredient(id)
    left join public.ingredients on ingredients.id = ingredient.id
    where ingredients.id is null or not ingredients.is_active
  ) then
    raise exception 'A recipe ingredient is inactive or does not exist.';
  end if;

  delete from public.product_recipes where product_id = target_product_id;
  insert into public.product_recipes (product_id, ingredient_id, quantity)
  select target_product_id, ingredient.id, amount.value
  from unnest(coalesce(ingredient_ids, array[]::uuid[]))
       with ordinality as ingredient(id, position)
  join unnest(coalesce(quantities, array[]::numeric[]))
       with ordinality as amount(value, position)
    using (position);

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, details
  )
  values (
    (select auth.uid()),
    'product_recipe_updated',
    'product',
    target_product_id,
    jsonb_build_object('ingredient_count', cardinality(coalesce(ingredient_ids, array[]::uuid[])))
  );
end;
$$;

create or replace function public.record_order_payment(target_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_order public.orders%rowtype;
begin
  select * into current_order
  from public.orders
  where id = target_order_id
  for update;
  if not found then
    raise exception 'Order not found.';
  end if;

  if not public.is_active_account()
      or not public.can_access_branch(current_order.branch_id)
      or not public.has_permission(current_order.branch_id, 'orders', 'edit') then
    raise exception 'You do not have permission to record this payment.'
      using errcode = '42501';
  end if;

  if current_order.status = 'cancelled' or current_order.payment_status <> 'unpaid' then
    raise exception 'Only unpaid, active orders can be marked paid.';
  end if;

  update public.payments
  set status = 'paid'
  where order_id = target_order_id and status = 'unpaid';
  if not found then
    raise exception 'The order payment record could not be updated.';
  end if;

  update public.orders set payment_status = 'paid' where id = target_order_id;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    (select auth.uid()), 'order_payment_recorded', 'order', target_order_id,
    current_order.branch_id,
    jsonb_build_object('amount', current_order.total, 'payment_status', 'paid')
  );
end;
$$;

create or replace function public.update_order_status(
  target_order_id uuid,
  next_status public.order_status,
  cancellation_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_order public.orders%rowtype;
  order_line record;
  recipe_stock record;
  required_action text;
begin
  if not public.is_active_account() then
    raise exception 'This account is not active.' using errcode = '42501';
  end if;

  select * into current_order
  from public.orders
  where id = target_order_id
  for update;
  if not found then raise exception 'Order not found.'; end if;

  required_action := case when next_status = 'cancelled' then 'cancel' else 'edit' end;
  if not public.can_access_branch(current_order.branch_id)
      or not public.has_permission(current_order.branch_id, 'orders', required_action) then
    raise exception 'You do not have permission to update this order.'
      using errcode = '42501';
  end if;

  if next_status = 'cancelled' then
    if cancellation_reason is null or length(btrim(cancellation_reason)) < 3
        or length(btrim(cancellation_reason)) > 500 then
      raise exception 'Enter a cancellation reason between 3 and 500 characters.';
    end if;
    if current_order.status in ('cancelled', 'completed') then
      raise exception 'This order can no longer be cancelled.';
    end if;
  elsif not (
    (current_order.status = 'pending' and next_status = 'confirmed')
    or (current_order.status = 'confirmed' and next_status = 'preparing')
    or (current_order.status = 'preparing' and next_status = 'ready')
    or (current_order.status = 'ready' and next_status = 'completed')
  ) then
    raise exception 'This order status transition is not allowed.';
  end if;

  if next_status = 'completed' then
    if exists (
      select 1
      from public.order_items as order_item
      where order_item.order_id = target_order_id
        and order_item.product_id is not null
        and not exists (
          select 1 from public.product_recipes as recipe
          where recipe.product_id = order_item.product_id
        )
    ) then
      raise exception 'Configure a recipe for every product before completing this order.';
    end if;

    for recipe_stock in
      select recipe.ingredient_id,
             sum(recipe.quantity * order_item.quantity)::numeric(14, 4) as quantity_used
      from public.order_items as order_item
      join public.product_recipes as recipe on recipe.product_id = order_item.product_id
      where order_item.order_id = target_order_id
      group by recipe.ingredient_id
      order by recipe.ingredient_id
    loop
      perform 1 from public.branch_inventory
      where branch_id = current_order.branch_id
        and ingredient_id = recipe_stock.ingredient_id
      for update;
      if not found then
        raise exception 'Ingredient inventory is not configured for this branch.';
      end if;
      if not exists (
        select 1 from public.branch_inventory
        where branch_id = current_order.branch_id
          and ingredient_id = recipe_stock.ingredient_id
          and quantity_on_hand >= recipe_stock.quantity_used
      ) then
        raise exception 'There is not enough ingredient inventory to complete this order.';
      end if;
    end loop;
  end if;

  if next_status in ('cancelled', 'completed')
      and current_order.stock_released_at is null then
    for order_line in
      select product_id, sum(quantity)::integer as quantity
      from public.order_items
      where order_id = target_order_id and product_id is not null
      group by product_id
      order by product_id
    loop
      perform 1 from public.branch_product_stock
      where branch_id = current_order.branch_id and product_id = order_line.product_id
      for update;

      if next_status = 'cancelled' then
        update public.branch_product_stock
        set quantity_reserved = quantity_reserved - order_line.quantity
        where branch_id = current_order.branch_id
          and product_id = order_line.product_id
          and quantity_reserved >= order_line.quantity;
      else
        update public.branch_product_stock
        set quantity_on_hand = quantity_on_hand - order_line.quantity,
            quantity_reserved = quantity_reserved - order_line.quantity
        where branch_id = current_order.branch_id
          and product_id = order_line.product_id
          and quantity_on_hand >= order_line.quantity
          and quantity_reserved >= order_line.quantity;
      end if;
      if not found then raise exception 'Reserved product stock could not be reconciled.'; end if;
    end loop;
  end if;

  if next_status = 'completed' then
    for recipe_stock in
      select recipe.ingredient_id,
             sum(recipe.quantity * order_item.quantity)::numeric(14, 4) as quantity_used
      from public.order_items as order_item
      join public.product_recipes as recipe on recipe.product_id = order_item.product_id
      where order_item.order_id = target_order_id
      group by recipe.ingredient_id
      order by recipe.ingredient_id
    loop
      update public.branch_inventory
      set quantity_on_hand = quantity_on_hand - recipe_stock.quantity_used
      where branch_id = current_order.branch_id
        and ingredient_id = recipe_stock.ingredient_id;

      insert into public.inventory_movements (
        branch_id, ingredient_id, order_id, movement_type, quantity_delta,
        note, actor_id
      )
      values (
        current_order.branch_id, recipe_stock.ingredient_id, target_order_id,
        'order_consumption', -recipe_stock.quantity_used,
        'Consumed for order ' || current_order.order_number, (select auth.uid())
      );
    end loop;
  end if;

  update public.orders
  set status = next_status,
      cancellation_reason = case when next_status = 'cancelled' then btrim(cancellation_reason) else null end,
      stock_released_at = case when next_status in ('cancelled', 'completed') then now() else stock_released_at end
  where id = target_order_id;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    (select auth.uid()),
    case when next_status = 'cancelled' then 'order_cancelled' else 'order_status_updated' end,
    'order', target_order_id, current_order.branch_id,
    jsonb_build_object(
      'previous_status', current_order.status,
      'new_status', next_status,
      'cancellation_reason', case when next_status = 'cancelled' then btrim(cancellation_reason) else null end
    )
  );
end;
$$;

revoke all on function public.record_inventory_movement(
  uuid, uuid, public.inventory_movement_type, numeric, text, numeric
) from public, anon, authenticated;
grant execute on function public.record_inventory_movement(
  uuid, uuid, public.inventory_movement_type, numeric, text, numeric
) to authenticated;

revoke all on function public.admin_set_product_recipe(uuid, uuid[], numeric[])
  from public, anon, authenticated;
grant execute on function public.admin_set_product_recipe(uuid, uuid[], numeric[])
  to authenticated;

revoke all on function public.record_order_payment(uuid)
  from public, anon, authenticated;
grant execute on function public.record_order_payment(uuid) to authenticated;

revoke all on function public.update_order_status(uuid, public.order_status, text)
  from public, anon, authenticated;
grant execute on function public.update_order_status(uuid, public.order_status, text)
  to authenticated;


-- ============================================================================
-- Migration: 20261019005000_benefit_discounts.sql
-- ============================================================================
create type public.benefit_type as enum ('pwd', 'senior_citizen');
create type public.benefit_request_status as enum ('pending', 'approved', 'rejected');

create table public.benefit_discount_policy (
  id boolean primary key default true check (id),
  is_active boolean not null default true,
  discount_percent numeric(5, 2) not null default 20
    check (discount_percent >= 20 and discount_percent <= 100),
  vat_registration text not null default 'not_configured'
    check (vat_registration in ('not_configured', 'vat_registered', 'non_vat')),
  vat_rate numeric(5, 2) not null default 12
    check (vat_rate >= 0 and vat_rate <= 30),
  pwd_enabled boolean not null default true,
  senior_citizen_enabled boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.benefit_discount_policy (id) values (true)
on conflict (id) do nothing;

create table public.benefit_discount_requests (
  id uuid primary key,
  order_id uuid not null unique references public.orders (id) on delete restrict,
  customer_id uuid not null references public.profiles (id) on delete restrict,
  branch_id uuid not null references public.branches (id) on delete restrict,
  benefit_type public.benefit_type not null,
  status public.benefit_request_status not null default 'pending',
  document_path text,
  discount_percent numeric(5, 2),
  vat_registration text,
  vat_rate numeric(5, 2),
  discount_total numeric(12, 2) not null default 0 check (discount_total >= 0),
  review_note text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (document_path is null or length(document_path) between 1 and 512),
  check (review_note is null or length(review_note) <= 500)
);

create table public.benefit_discount_request_items (
  request_id uuid not null references public.benefit_discount_requests (id) on delete restrict,
  order_item_id uuid not null references public.order_items (id) on delete restrict,
  eligible_quantity integer not null check (eligible_quantity > 0),
  discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),
  primary key (request_id, order_item_id)
);

create index benefit_requests_branch_status_created_idx
  on public.benefit_discount_requests (branch_id, status, created_at desc);
create index benefit_requests_customer_created_idx
  on public.benefit_discount_requests (customer_id, created_at desc);

create trigger benefit_discount_policy_set_updated_at
before update on public.benefit_discount_policy
for each row execute function public.set_updated_at();

create trigger benefit_discount_requests_set_updated_at
before update on public.benefit_discount_requests
for each row execute function public.set_updated_at();

create function public.guard_order_with_pending_benefit_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('completed', 'cancelled')
      and old.status is distinct from new.status
      and exists (
        select 1 from public.benefit_discount_requests
        where order_id = old.id and status = 'pending'
      ) then
    raise exception 'Review or reject the pending benefit discount request before completing or cancelling this order.';
  end if;
  return new;
end;
$$;

create trigger orders_guard_pending_benefit_request
before update of status on public.orders
for each row execute function public.guard_order_with_pending_benefit_request();

create or replace function public.record_order_payment(target_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_order public.orders%rowtype;
begin
  select * into current_order
  from public.orders
  where id = target_order_id
  for update;
  if not found then raise exception 'Order not found.'; end if;

  if not public.is_active_account()
      or not public.can_access_branch(current_order.branch_id)
      or not public.has_permission(current_order.branch_id, 'orders', 'edit') then
    raise exception 'You do not have permission to record this payment.'
      using errcode = '42501';
  end if;

  if current_order.status = 'cancelled' or current_order.payment_status <> 'unpaid' then
    raise exception 'Only unpaid, active orders can be marked paid.';
  end if;
  if exists (
    select 1 from public.benefit_discount_requests
    where order_id = target_order_id and status = 'pending'
  ) then
    raise exception 'Review or reject the pending benefit request before collecting payment.';
  end if;

  update public.payments
  set status = 'paid'
  where order_id = target_order_id and status = 'unpaid';
  if not found then raise exception 'The order payment record could not be updated.'; end if;

  update public.orders set payment_status = 'paid' where id = target_order_id;
  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    (select auth.uid()), 'order_payment_recorded', 'order', target_order_id,
    current_order.branch_id,
    jsonb_build_object('amount', current_order.total, 'payment_status', 'paid')
  );
end;
$$;

alter table public.benefit_discount_policy enable row level security;
alter table public.benefit_discount_requests enable row level security;
alter table public.benefit_discount_request_items enable row level security;

create policy "Authenticated users can read benefit discount policy"
on public.benefit_discount_policy for select to authenticated
using (public.is_active_account());

create policy "Customers and assigned approvers can view benefit requests"
on public.benefit_discount_requests for select to authenticated
using (
  customer_id = (select auth.uid())
  or (
    public.can_access_branch(branch_id)
    and public.has_permission(branch_id, 'promotions', 'approve')
  )
);

create policy "Customers and assigned approvers can view benefit request items"
on public.benefit_discount_request_items for select to authenticated
using (
  exists (
    select 1
    from public.benefit_discount_requests as request
    where request.id = benefit_discount_request_items.request_id
      and (
        request.customer_id = (select auth.uid())
        or (
          public.can_access_branch(request.branch_id)
          and public.has_permission(request.branch_id, 'promotions', 'approve')
        )
      )
  )
);

revoke all on public.benefit_discount_policy, public.benefit_discount_requests,
  public.benefit_discount_request_items from anon, authenticated;
grant select on public.benefit_discount_policy, public.benefit_discount_requests,
  public.benefit_discount_request_items to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'benefit-documents',
  'benefit-documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Customers can upload their own benefit evidence"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'benefit-documents'
  and public.is_active_account()
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Assigned benefit approvers can view evidence"
on storage.objects for select to authenticated
using (
  bucket_id = 'benefit-documents'
  and exists (
    select 1
    from public.benefit_discount_requests as request
    where request.document_path = storage.objects.name
      and (
        public.has_role('super_admin')
        or (
          public.can_access_branch(request.branch_id)
          and public.has_permission(request.branch_id, 'promotions', 'approve')
        )
      )
  )
);

create policy "Assigned benefit approvers can delete evidence"
on storage.objects for delete to authenticated
using (
  bucket_id = 'benefit-documents'
  and (
    exists (
      select 1
      from public.benefit_discount_requests as request
      where request.document_path = storage.objects.name
        and (
          public.has_role('super_admin')
          or (
            public.can_access_branch(request.branch_id)
            and public.has_permission(request.branch_id, 'promotions', 'approve')
          )
        )
    )
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and not exists (
        select 1
        from public.benefit_discount_requests as request
        where request.document_path = storage.objects.name
      )
    )
  )
);

create or replace function public.admin_set_benefit_discount_policy(
  target_is_active boolean,
  target_discount_percent numeric,
  target_vat_registration text,
  target_vat_rate numeric,
  target_pwd_enabled boolean,
  target_senior_citizen_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('super_admin') then
    raise exception 'Super Admin permission is required to change benefit policy.'
      using errcode = '42501';
  end if;
  if target_is_active is null
      or target_discount_percent is null
      or target_discount_percent < 20
      or target_discount_percent > 100
      or target_vat_registration not in ('not_configured', 'vat_registered', 'non_vat')
      or target_vat_rate is null
      or target_vat_rate < 0
      or target_vat_rate > 30
      or target_pwd_enabled is null
      or target_senior_citizen_enabled is null then
    raise exception 'Benefit policy values are invalid.';
  end if;

  update public.benefit_discount_policy
  set is_active = target_is_active,
      discount_percent = target_discount_percent,
      vat_registration = target_vat_registration,
      vat_rate = target_vat_rate,
      pwd_enabled = target_pwd_enabled,
      senior_citizen_enabled = target_senior_citizen_enabled,
      updated_by = (select auth.uid())
  where id;

  insert into public.audit_logs (actor_id, action, record_type, details)
  values (
    (select auth.uid()),
    'benefit_discount_policy_updated',
    'benefit_discount_policy',
    jsonb_build_object(
      'is_active', target_is_active,
      'discount_percent', target_discount_percent,
      'vat_registration', target_vat_registration,
      'vat_rate', target_vat_rate,
      'pwd_enabled', target_pwd_enabled,
      'senior_citizen_enabled', target_senior_citizen_enabled
    )
  );
end;
$$;

create or replace function public.create_benefit_discount_request(
  target_request_id uuid,
  target_order_id uuid,
  requested_benefit_type public.benefit_type,
  requested_items jsonb,
  uploaded_document_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_order public.orders%rowtype;
  request_item jsonb;
  order_item_id uuid;
  eligible_quantity integer;
  is_enabled boolean;
  new_request_id uuid;
begin
  if current_user_id is null or not public.is_active_account() then
    raise exception 'Sign in with an active account to request a benefit discount.'
      using errcode = '42501';
  end if;
  if target_request_id is null or target_order_id is null or requested_benefit_type is null then
    raise exception 'Choose an order, benefit type, and request key.';
  end if;
  if uploaded_document_path is null
      or length(uploaded_document_path) > 512
      or split_part(uploaded_document_path, '/', 1) <> current_user_id::text
      or split_part(uploaded_document_path, '/', 2) <> target_request_id::text
      or not exists (
        select 1 from storage.objects
        where bucket_id = 'benefit-documents'
          and name = uploaded_document_path
          and owner_id = current_user_id::text
      ) then
    raise exception 'Upload a private document under your own request folder.';
  end if;
  if requested_items is null or jsonb_typeof(requested_items) is distinct from 'array'
      or jsonb_array_length(requested_items) < 1
      or jsonb_array_length(requested_items) > 50 then
    raise exception 'Select between one and fifty eligible order lines.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(requested_items) as entry(value)
    where jsonb_typeof(entry.value) <> 'object'
      or jsonb_typeof(entry.value -> 'order_item_id') <> 'string'
      or jsonb_typeof(entry.value -> 'eligible_quantity') <> 'number'
      or (entry.value ->> 'eligible_quantity') !~ '^[0-9]+$'
  ) then
    raise exception 'One or more selected order lines are invalid.';
  end if;

  select case
    when requested_benefit_type = 'pwd' then pwd_enabled
    else senior_citizen_enabled
  end
  into is_enabled
  from public.benefit_discount_policy
  where id and is_active;
  if not found or not is_enabled then
    raise exception 'This benefit discount is currently unavailable.';
  end if;

  select * into current_order
  from public.orders
  where id = target_order_id
    and customer_id = current_user_id
  for update;
  if not found then
    raise exception 'This order is not available to your account.';
  end if;
  if current_order.promotion_id is not null or current_order.discount_total > 0 then
    raise exception 'Remove the promotion by choosing a non-promotional order before requesting this discount.';
  end if;
  if current_order.payment_status <> 'unpaid'
      or current_order.status in ('cancelled', 'completed') then
    raise exception 'A benefit discount must be requested on an unpaid, active order.';
  end if;

  insert into public.benefit_discount_requests (
    id, order_id, customer_id, branch_id, benefit_type, document_path
  )
  values (
    target_request_id, target_order_id, current_user_id, current_order.branch_id,
    requested_benefit_type, uploaded_document_path
  )
  returning id into new_request_id;

  for request_item in select entry.value from jsonb_array_elements(requested_items) as entry(value)
  loop
    begin
      order_item_id := (request_item ->> 'order_item_id')::uuid;
      eligible_quantity := (request_item ->> 'eligible_quantity')::integer;
    exception when invalid_text_representation then
      raise exception 'One or more selected order lines are invalid.';
    end;
    if eligible_quantity < 1 or not exists (
      select 1
      from public.order_items
      where id = order_item_id
        and order_id = target_order_id
        and quantity >= eligible_quantity
    ) then
      raise exception 'A selected quantity exceeds its order line or does not belong to this order.';
    end if;
    insert into public.benefit_discount_request_items (
      request_id, order_item_id, eligible_quantity
    )
    values (new_request_id, order_item_id, eligible_quantity);
  end loop;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    current_user_id, 'benefit_discount_requested', 'benefit_discount_request',
    new_request_id, current_order.branch_id,
    jsonb_build_object(
      'order_id', target_order_id,
      'benefit_type', requested_benefit_type,
      'selected_line_count', jsonb_array_length(requested_items)
    )
  );

  return new_request_id;
end;
$$;

create or replace function public.review_benefit_discount_request(
  target_request_id uuid,
  decision public.benefit_request_status,
  decision_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_request public.benefit_discount_requests%rowtype;
  current_order public.orders%rowtype;
  current_policy public.benefit_discount_policy%rowtype;
  request_item record;
  eligible_gross numeric(12, 2);
  eligible_net numeric(12, 2);
  line_discount numeric(12, 2);
  total_discount numeric(12, 2) := 0;
  vat_multiplier numeric(8, 4);
begin
  if decision not in ('approved', 'rejected') then
    raise exception 'Choose approve or reject.';
  end if;
  if decision_note is not null and length(decision_note) > 500 then
    raise exception 'Review notes cannot exceed 500 characters.';
  end if;

  select * into current_request
  from public.benefit_discount_requests
  where id = target_request_id
  for update;
  if not found then raise exception 'Benefit request not found.'; end if;

  if not public.is_active_account()
      or not public.can_access_branch(current_request.branch_id)
      or not public.has_permission(current_request.branch_id, 'promotions', 'approve') then
    raise exception 'You do not have permission to review this request.'
      using errcode = '42501';
  end if;
  if current_request.status <> 'pending' then
    raise exception 'This benefit request has already been reviewed.';
  end if;
  if decision = 'rejected'
      and (decision_note is null or length(btrim(decision_note)) < 3) then
    raise exception 'Provide a rejection reason of at least 3 characters.';
  end if;

  select * into current_order
  from public.orders
  where id = current_request.order_id
  for update;
  if not found then raise exception 'The related order no longer exists.'; end if;

  if decision = 'approved' then
    if current_request.document_path is null or not exists (
      select 1 from storage.objects
      where bucket_id = 'benefit-documents'
        and name = current_request.document_path
    ) then
      raise exception 'A private ID document must be available before approval.';
    end if;
    if current_order.promotion_id is not null or current_order.discount_total > 0 then
      raise exception 'This order already has a promotion; discounts cannot be stacked.';
    end if;
    if current_order.payment_status <> 'unpaid'
        or current_order.status in ('cancelled', 'completed') then
      raise exception 'Only unpaid, active orders can receive this discount.';
    end if;

    select * into current_policy
    from public.benefit_discount_policy
    where id and is_active
    for share;
    if not found then raise exception 'Benefit discount policy is inactive.'; end if;
    if current_policy.vat_registration = 'not_configured' then
      raise exception 'A Super Admin must configure the shop VAT registration before approving discounts.';
    end if;
    if (current_request.benefit_type = 'pwd' and not current_policy.pwd_enabled)
        or (current_request.benefit_type = 'senior_citizen' and not current_policy.senior_citizen_enabled) then
      raise exception 'This benefit type is disabled by the current policy.';
    end if;

    vat_multiplier := 1 + current_policy.vat_rate / 100;
    for request_item in
      select requested.order_item_id, requested.eligible_quantity,
             order_item.quantity as order_quantity,
             order_item.line_subtotal, order_item.discount_amount
      from public.benefit_discount_request_items as requested
      join public.order_items as order_item on order_item.id = requested.order_item_id
      where requested.request_id = target_request_id
      order by requested.order_item_id
      for update of order_item
    loop
      if request_item.eligible_quantity > request_item.order_quantity
          or request_item.discount_amount > 0 then
        raise exception 'A requested order line has changed since submission.';
      end if;
      eligible_gross := round(
        request_item.line_subtotal * request_item.eligible_quantity
        / request_item.order_quantity,
        2
      );
      if current_policy.vat_registration = 'vat_registered' then
        eligible_net := round(eligible_gross / vat_multiplier, 2);
        line_discount := eligible_gross
          - round(eligible_net * (1 - current_policy.discount_percent / 100), 2);
      else
        line_discount := round(eligible_gross * current_policy.discount_percent / 100, 2);
      end if;

      update public.order_items
      set discount_amount = discount_amount + line_discount,
          line_total = line_subtotal - discount_amount - line_discount
      where id = request_item.order_item_id;
      update public.benefit_discount_request_items
      set discount_amount = line_discount
      where request_id = target_request_id
        and order_item_id = request_item.order_item_id;
      total_discount := total_discount + line_discount;
    end loop;

    if total_discount <= 0 then
      raise exception 'The selected order lines do not produce an eligible discount.';
    end if;

    update public.orders
    set discount_total = discount_total + total_discount,
        total = total - total_discount
    where id = current_order.id;
    update public.payments
    set amount = current_order.total - total_discount
    where order_id = current_order.id and status = 'unpaid';
    update public.benefit_discount_requests
    set status = decision,
        discount_percent = current_policy.discount_percent,
        vat_registration = current_policy.vat_registration,
        vat_rate = current_policy.vat_rate,
        discount_total = total_discount,
        review_note = coalesce(btrim(decision_note), ''),
        reviewed_by = (select auth.uid()),
        reviewed_at = now()
    where id = target_request_id;
  else
    update public.benefit_discount_requests
    set status = decision,
        review_note = btrim(decision_note),
        reviewed_by = (select auth.uid()),
        reviewed_at = now()
    where id = target_request_id;
  end if;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    (select auth.uid()),
    case when decision = 'approved' then 'benefit_discount_approved' else 'benefit_discount_rejected' end,
    'benefit_discount_request',
    target_request_id,
    current_request.branch_id,
    jsonb_build_object(
      'order_id', current_order.id,
      'benefit_type', current_request.benefit_type,
      'discount_total', total_discount,
      'review_note', coalesce(btrim(decision_note), '')
    )
  );
end;
$$;

create or replace function public.clear_benefit_request_document(target_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_request public.benefit_discount_requests%rowtype;
begin
  select * into current_request
  from public.benefit_discount_requests
  where id = target_request_id
  for update;
  if not found then raise exception 'Benefit request not found.'; end if;

  if not public.is_active_account()
      or not public.can_access_branch(current_request.branch_id)
      or not public.has_permission(current_request.branch_id, 'promotions', 'approve') then
    raise exception 'You do not have permission to manage this document.'
      using errcode = '42501';
  end if;
  if current_request.document_path is null then
    raise exception 'This request has no stored document.';
  end if;

  update public.benefit_discount_requests
  set document_path = null
  where id = target_request_id;
  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    (select auth.uid()), 'benefit_document_reference_cleared',
    'benefit_discount_request', target_request_id, current_request.branch_id,
    jsonb_build_object('document_path_cleared', true)
  );
end;
$$;

revoke all on function public.admin_set_benefit_discount_policy(
  boolean, numeric, text, numeric, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.admin_set_benefit_discount_policy(
  boolean, numeric, text, numeric, boolean, boolean
) to authenticated;

revoke all on function public.create_benefit_discount_request(
  uuid, uuid, public.benefit_type, jsonb, text
) from public, anon, authenticated;
grant execute on function public.create_benefit_discount_request(
  uuid, uuid, public.benefit_type, jsonb, text
) to authenticated;

revoke all on function public.review_benefit_discount_request(
  uuid, public.benefit_request_status, text
) from public, anon, authenticated;
grant execute on function public.review_benefit_discount_request(
  uuid, public.benefit_request_status, text
) to authenticated;

revoke all on function public.clear_benefit_request_document(uuid)
  from public, anon, authenticated;
grant execute on function public.clear_benefit_request_document(uuid)
  to authenticated;


-- ============================================================================
-- Migration: 20261019006000_reporting_financials.sql
-- ============================================================================
create table public.branch_expenses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id) on delete restrict,
  occurred_on date not null,
  category text not null
    check (category in (
      'rent', 'utilities', 'payroll', 'maintenance', 'marketing',
      'supplies', 'taxes_and_fees', 'other'
    )),
  description text not null,
  amount numeric(12, 2) not null check (amount > 0),
  note text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  voided_by uuid references public.profiles (id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  check (length(btrim(description)) between 1 and 240),
  check (length(note) <= 500),
  check (void_reason is null or length(void_reason) between 3 and 500),
  check ((voided_at is null) = (void_reason is null))
);

create index branch_expenses_branch_date_idx
  on public.branch_expenses (branch_id, occurred_on desc, created_at desc, id desc);
create index orders_created_at_reporting_idx
  on public.orders (created_at desc, order_number desc);
create index orders_completed_created_at_reporting_idx
  on public.orders (created_at desc)
  where status = 'completed';
create index inventory_movements_order_id_idx
  on public.inventory_movements (order_id)
  where movement_type = 'order_consumption';

alter table public.branch_expenses enable row level security;

create policy "Authorized finance staff can view branch expenses"
on public.branch_expenses for select to authenticated
using (
  public.can_access_branch(branch_id)
  and public.has_permission(branch_id, 'financials', 'view')
);

revoke all on public.branch_expenses from anon, authenticated;
grant select on public.branch_expenses to authenticated;

create function public.snapshot_order_ingredient_cost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.movement_type = 'order_consumption' and new.unit_cost is null then
    select receipt.unit_cost into new.unit_cost
    from public.inventory_movements as receipt
    where receipt.branch_id = new.branch_id
      and receipt.ingredient_id = new.ingredient_id
      and receipt.movement_type = 'receipt'
      and receipt.unit_cost is not null
      and receipt.created_at <= new.created_at
    order by receipt.created_at desc, receipt.id desc
    limit 1;
  end if;
  return new;
end;
$$;

create trigger inventory_movements_snapshot_order_cost
before insert on public.inventory_movements
for each row execute function public.snapshot_order_ingredient_cost();

create function public.record_branch_expense(
  target_branch_id uuid,
  target_occurred_on date,
  target_category text,
  target_description text,
  target_amount numeric,
  target_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_expense_id uuid;
begin
  if not public.is_active_account()
      or not public.can_access_branch(target_branch_id)
      or not (
        public.has_permission(target_branch_id, 'financials', 'create')
        or public.has_permission(target_branch_id, 'financials', 'edit')
      ) then
    raise exception 'You do not have permission to record expenses for this branch.'
      using errcode = '42501';
  end if;
  if target_occurred_on is null
      or target_category is null
      or target_category not in (
        'rent', 'utilities', 'payroll', 'maintenance', 'marketing',
        'supplies', 'taxes_and_fees', 'other'
      )
      or target_description is null
      or length(btrim(target_description)) not between 1 and 240
      or target_amount is null or target_amount <= 0 or target_amount > 100000000
      or target_note is null or length(target_note) > 500 then
    raise exception 'Expense date, category, description, amount, or note is invalid.';
  end if;
  if not exists (select 1 from public.branches where id = target_branch_id) then
    raise exception 'The selected branch does not exist.';
  end if;

  insert into public.branch_expenses (
    branch_id, occurred_on, category, description, amount, note, created_by
  )
  values (
    target_branch_id, target_occurred_on, target_category,
    btrim(target_description), target_amount, btrim(target_note),
    (select auth.uid())
  )
  returning id into new_expense_id;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    (select auth.uid()), 'branch_expense_recorded', 'branch_expense',
    new_expense_id, target_branch_id,
    jsonb_build_object(
      'occurred_on', target_occurred_on,
      'category', target_category,
      'amount', target_amount
    )
  );
  return new_expense_id;
end;
$$;

create function public.void_branch_expense(target_expense_id uuid, target_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_expense public.branch_expenses%rowtype;
begin
  select * into current_expense
  from public.branch_expenses
  where id = target_expense_id
  for update;
  if not found then raise exception 'Expense record not found.'; end if;
  if not public.is_active_account()
      or not public.can_access_branch(current_expense.branch_id)
      or not public.has_permission(current_expense.branch_id, 'financials', 'edit') then
    raise exception 'You do not have permission to void expenses for this branch.'
      using errcode = '42501';
  end if;
  if current_expense.voided_at is not null then
    raise exception 'This expense has already been voided.';
  end if;
  if target_reason is null or length(btrim(target_reason)) not between 3 and 500 then
    raise exception 'Provide a void reason between 3 and 500 characters.';
  end if;

  update public.branch_expenses
  set voided_by = (select auth.uid()),
      voided_at = now(),
      void_reason = btrim(target_reason)
  where id = target_expense_id;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    (select auth.uid()), 'branch_expense_voided', 'branch_expense',
    target_expense_id, current_expense.branch_id,
    jsonb_build_object(
      'amount', current_expense.amount,
      'category', current_expense.category,
      'reason', btrim(target_reason)
    )
  );
end;
$$;

create function public.get_operational_report(
  target_branch_id uuid,
  start_date date,
  end_date date,
  page_offset integer default 0,
  page_size integer default 50
)
returns table (
  order_id uuid,
  order_number text,
  branch_name text,
  created_at timestamptz,
  status public.order_status,
  payment_status public.payment_status,
  customer_name text,
  fulfillment_method public.order_fulfillment_method,
  subtotal numeric,
  discount_total numeric,
  total numeric,
  items jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_active_account() then
    raise exception 'An active account is required to view reports.'
      using errcode = '42501';
  end if;
  if start_date is null or end_date is null or end_date < start_date
      or end_date - start_date > 365 then
    raise exception 'Choose a valid report period of no more than 366 days.';
  end if;
  if page_offset is null or page_offset < 0 or page_offset > 1000000
      or page_size is null or page_size < 1 or page_size > 250 then
    raise exception 'Report pagination values are invalid.';
  end if;
  if target_branch_id is null then
    if not public.has_role('super_admin') then
      raise exception 'Only a Super Admin can run an all-branch report.'
        using errcode = '42501';
    end if;
  elsif not public.can_access_branch(target_branch_id)
      or not public.has_permission(target_branch_id, 'reports', 'view') then
    raise exception 'You do not have permission to view reports for this branch.'
      using errcode = '42501';
  end if;

  return query
  select order_record.id,
         order_record.order_number,
         branch.name,
         order_record.created_at,
         order_record.status,
         order_record.payment_status,
         order_record.customer_name,
         order_record.fulfillment_method,
         order_record.subtotal,
         order_record.discount_total,
         order_record.total,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'product_name', order_item.product_name,
             'variant_name', order_item.variant_name,
             'quantity', order_item.quantity,
             'line_total', order_item.line_total
           ) order by order_item.created_at, order_item.id)
           from public.order_items as order_item
           where order_item.order_id = order_record.id
         ), '[]'::jsonb)
  from public.orders as order_record
  join public.branches as branch on branch.id = order_record.branch_id
  where order_record.created_at >= (start_date::timestamp at time zone 'Asia/Manila')
    and order_record.created_at < ((end_date + 1)::timestamp at time zone 'Asia/Manila')
    and (target_branch_id is null or order_record.branch_id = target_branch_id)
  order by order_record.created_at desc, order_record.order_number desc
  limit page_size
  offset page_offset;
end;
$$;

create function public.get_financial_report(
  target_branch_id uuid,
  start_date date,
  end_date date
)
returns table (
  completed_orders bigint,
  gross_sales numeric,
  discounts numeric,
  net_sales numeric,
  cost_of_goods numeric,
  uncosted_orders bigint,
  expenses numeric,
  estimated_profit numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_active_account() then
    raise exception 'An active account is required to view financial reports.'
      using errcode = '42501';
  end if;
  if start_date is null or end_date is null or end_date < start_date
      or end_date - start_date > 365 then
    raise exception 'Choose a valid report period of no more than 366 days.';
  end if;
  if target_branch_id is null then
    if not public.has_role('super_admin') then
      raise exception 'Only a Super Admin can run an all-branch financial report.'
        using errcode = '42501';
    end if;
  elsif not public.can_access_branch(target_branch_id)
      or not public.has_permission(target_branch_id, 'financials', 'view') then
    raise exception 'You do not have permission to view financial reports for this branch.'
      using errcode = '42501';
  end if;

  if (
    select count(*) from public.orders as order_record
    where order_record.status = 'completed'
      and order_record.created_at >= (start_date::timestamp at time zone 'Asia/Manila')
      and order_record.created_at < ((end_date + 1)::timestamp at time zone 'Asia/Manila')
      and (target_branch_id is null or order_record.branch_id = target_branch_id)
  ) > 10000 then
    raise exception 'This report contains more than 10,000 completed orders. Narrow the date range.';
  end if;

  return query
  with completed as (
    select order_record.id, order_record.subtotal, order_record.discount_total,
           order_record.total, order_record.created_at, order_record.branch_id
    from public.orders as order_record
    where order_record.status = 'completed'
      and order_record.created_at >= (start_date::timestamp at time zone 'Asia/Manila')
      and order_record.created_at < ((end_date + 1)::timestamp at time zone 'Asia/Manila')
      and (target_branch_id is null or order_record.branch_id = target_branch_id)
  ),
  cost_totals as (
    select completed.id,
           coalesce(sum(abs(movement.quantity_delta) * movement.unit_cost), 0) as cogs,
           count(*) filter (
             where (movement.order_id is not null and movement.unit_cost is null)
               or exists (
                 select 1 from public.order_items as order_item
                 where order_item.order_id = completed.id
                   and order_item.product_id is null
               )
               or (
                 exists (
                   select 1 from public.order_items as order_item
                   where order_item.order_id = completed.id
                     and order_item.product_id is not null
                 )
                 and not exists (
                   select 1 from public.inventory_movements as consumption
                   where consumption.order_id = completed.id
                     and consumption.movement_type = 'order_consumption'
                 )
               )
           ) as uncosted_movements
    from completed
    left join public.inventory_movements as movement
      on movement.order_id = completed.id
      and movement.movement_type = 'order_consumption'
    group by completed.id
  ),
  sales_totals as (
    select count(*) as order_count,
           coalesce(sum(completed.subtotal), 0) as gross_sales,
           coalesce(sum(completed.discount_total), 0) as discounts,
           coalesce(sum(completed.total), 0) as net_sales
    from completed
  ),
  cogs_totals as (
    select coalesce(sum(cost_totals.cogs), 0) as cogs,
           count(*) filter (where cost_totals.uncosted_movements > 0) as uncosted_orders
    from cost_totals
  ),
  expense_totals as (
    select coalesce(sum(expense.amount), 0) as expenses
    from public.branch_expenses as expense
    where expense.voided_at is null
      and expense.occurred_on between start_date and end_date
      and (target_branch_id is null or expense.branch_id = target_branch_id)
  )
  select sales_totals.order_count,
         sales_totals.gross_sales,
         sales_totals.discounts,
         sales_totals.net_sales,
         case when cogs_totals.uncosted_orders = 0 then cogs_totals.cogs else null end,
         cogs_totals.uncosted_orders,
         expense_totals.expenses,
         case when cogs_totals.uncosted_orders = 0
           then sales_totals.net_sales - cogs_totals.cogs - expense_totals.expenses
           else null
         end
  from sales_totals
  cross join cogs_totals
  cross join expense_totals;
end;
$$;

revoke all on function public.snapshot_order_ingredient_cost()
  from public, anon, authenticated;
revoke all on function public.record_branch_expense(uuid, date, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.record_branch_expense(uuid, date, text, text, numeric, text)
  to authenticated;
revoke all on function public.void_branch_expense(uuid, text)
  from public, anon, authenticated;
grant execute on function public.void_branch_expense(uuid, text)
  to authenticated;
revoke all on function public.get_operational_report(uuid, date, date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_operational_report(uuid, date, date, integer, integer)
  to authenticated;
revoke all on function public.get_financial_report(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.get_financial_report(uuid, date, date)
  to authenticated;


-- ============================================================================
-- Migration: 20261020000000_checkout_payments_and_branch_qr.sql
-- ============================================================================
alter table public.branches
  add column if not exists gcash_qr_path text;

create function public.audit_branch_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (
    actor_id, action, record_type, record_id, details
  )
  values (
    (select auth.uid()),
    case when tg_op = 'INSERT' then 'branch_created' else 'branch_updated' end,
    'branch',
    new.id,
    jsonb_build_object(
      'name', new.name,
      'is_active', new.is_active,
      'gcash_qr_configured', new.gcash_qr_path is not null
    )
  );
  return new;
end;
$$;

create trigger branches_audit_changes
after insert or update on public.branches
for each row execute function public.audit_branch_changes();

insert into public.payment_methods (
  code, name, instructions, settlement_type, provider, is_active
)
values (
  'gcash',
  'GCash',
  'Scan the QR code for your selected branch. Upload your payment proof from the order details; staff will verify it before marking the order paid.',
  'provider',
  'gcash',
  true
)
on conflict (code) do update
set name = excluded.name,
    instructions = excluded.instructions,
    settlement_type = excluded.settlement_type,
    provider = excluded.provider,
    is_active = excluded.is_active;

do $$
declare
  function_definition text;
  original_condition text := 'and settlement_type = ''pay_at_branch''';
  updated_condition text := 'and settlement_type in (''pay_at_branch'', ''provider'')';
begin
  function_definition := pg_get_functiondef(
    'public.create_customer_order(uuid, public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb)'::regprocedure
  );
  if position(original_condition in function_definition) = 0
      or position(updated_condition in function_definition) > 0 then
    raise exception 'Could not safely update online payment support in create_customer_order.';
  end if;
  execute replace(function_definition, original_condition, updated_condition);
end;
$$;

create table public.order_payment_proofs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete restrict,
  customer_id uuid not null references public.profiles (id) on delete restrict,
  branch_id uuid not null references public.branches (id) on delete restrict,
  document_path text not null check (length(document_path) between 1 and 512),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (review_note is null or length(review_note) <= 500)
);

create index order_payment_proofs_branch_status_idx
  on public.order_payment_proofs (branch_id, status, created_at desc);

alter table public.order_payment_proofs enable row level security;

create function public.guard_gcash_payment_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid'
      and old.status is distinct from new.status
      and new.payment_method_code = 'gcash'
      and not exists (
        select 1
        from public.order_payment_proofs
        where order_id = new.order_id
          and status = 'approved'
      ) then
    raise exception 'Verify the submitted GCash payment proof before marking this order paid.';
  end if;
  return new;
end;
$$;

create trigger payments_require_verified_gcash_proof
before update of status on public.payments
for each row execute function public.guard_gcash_payment_verification();

create policy "Customers and order managers can view payment proofs"
on public.order_payment_proofs for select to authenticated
using (
  customer_id = (select auth.uid())
  or (
    public.can_access_branch(branch_id)
    and public.has_permission(branch_id, 'orders', 'view')
  )
);

revoke all on public.order_payment_proofs from anon, authenticated;
grant select on public.order_payment_proofs to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branch-payment-qr',
  'branch-payment-qr',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Super admins can upload branch payment QR codes"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'branch-payment-qr'
  and public.has_role('super_admin')
);

create policy "Super admins can update branch payment QR codes"
on storage.objects for update to authenticated
using (bucket_id = 'branch-payment-qr' and public.has_role('super_admin'))
with check (bucket_id = 'branch-payment-qr' and public.has_role('super_admin'));

create policy "Super admins can delete branch payment QR codes"
on storage.objects for delete to authenticated
using (bucket_id = 'branch-payment-qr' and public.has_role('super_admin'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-payment-proofs',
  'order-payment-proofs',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Customers can upload their own order payment proof"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'order-payment-proofs'
  and public.is_active_account()
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Customers can replace their rejected order proof"
on storage.objects for delete to authenticated
using (
  bucket_id = 'order-payment-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Customers and assigned order managers can view payment proof files"
on storage.objects for select to authenticated
using (
  bucket_id = 'order-payment-proofs'
  and exists (
    select 1
    from public.order_payment_proofs as proof
    where proof.document_path = storage.objects.name
      and (
        proof.customer_id = (select auth.uid())
        or (
          public.can_access_branch(proof.branch_id)
          and public.has_permission(proof.branch_id, 'orders', 'view')
        )
      )
  )
);

create or replace function public.create_customer_order_with_benefit(
  target_branch_id uuid,
  fulfillment public.order_fulfillment_method,
  payment_method_id uuid,
  client_request_id uuid,
  customer_phone text,
  customer_note text,
  requested_promotion_id uuid,
  cart_items jsonb,
  target_benefit_request_id uuid default null,
  requested_benefit_type public.benefit_type default null,
  requested_benefit_items jsonb default null,
  uploaded_benefit_document_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_order_id uuid;
  benefit_item jsonb;
  order_item_id uuid;
  mapped_items jsonb := '[]'::jsonb;
  mapped_order_item_ids uuid[] := array[]::uuid[];
begin
  if (
    target_benefit_request_id is null
    and requested_benefit_type is null
    and requested_benefit_items is null
    and uploaded_benefit_document_path is null
  ) then
    return public.create_customer_order(
      target_branch_id, fulfillment, payment_method_id, client_request_id,
      customer_phone, customer_note, requested_promotion_id, cart_items
    );
  end if;
  if target_benefit_request_id is null
      or requested_benefit_type is null
      or requested_benefit_items is null
      or uploaded_benefit_document_path is null
      or requested_promotion_id is not null then
    raise exception 'Choose a benefit type, eligible items, and upload ID evidence. Benefit discounts cannot be combined with a promotion.';
  end if;

  created_order_id := public.create_customer_order(
    target_branch_id, fulfillment, payment_method_id, client_request_id,
    customer_phone, customer_note, requested_promotion_id, cart_items
  );

  if not exists (
    select 1 from public.benefit_discount_requests
    where id = target_benefit_request_id and order_id = created_order_id
  ) then
    for benefit_item in
      select entry.value from jsonb_array_elements(requested_benefit_items) as entry(value)
    loop
      select order_item.id into order_item_id
      from public.order_items as order_item
      where order_item.order_id = created_order_id
        and order_item.product_id = (benefit_item ->> 'product_id')::uuid
        and order_item.variant_id is not distinct from
          nullif(benefit_item ->> 'variant_id', '')::uuid
        and not (order_item.id = any(mapped_order_item_ids))
        and coalesce((
          select array_agg(addon.addon_id order by addon.addon_id)
          from public.order_item_addons as addon
          where addon.order_item_id = order_item.id
        ), array[]::uuid[]) = array(
          select addon.value::uuid
          from jsonb_array_elements_text(
            coalesce(benefit_item -> 'addon_ids', '[]'::jsonb)
          ) as addon(value)
          order by addon.value::uuid
        )
      limit 1;
      if order_item_id is null then
        raise exception 'A selected benefit item could not be matched to the submitted order.';
      end if;
      mapped_order_item_ids := array_append(mapped_order_item_ids, order_item_id);
      mapped_items := mapped_items || jsonb_build_array(jsonb_build_object(
        'order_item_id', order_item_id,
        'eligible_quantity', benefit_item -> 'eligible_quantity'
      ));
    end loop;

    perform public.create_benefit_discount_request(
      target_benefit_request_id,
      created_order_id,
      requested_benefit_type,
      mapped_items,
      uploaded_benefit_document_path
    );
  end if;
  return created_order_id;
end;
$$;

revoke all on function public.create_customer_order_with_benefit(
  uuid, public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb,
  uuid, public.benefit_type, jsonb, text
) from public, anon, authenticated;
grant execute on function public.create_customer_order_with_benefit(
  uuid, public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb,
  uuid, public.benefit_type, jsonb, text
) to authenticated;

create or replace function public.submit_order_payment_proof(
  target_order_id uuid,
  uploaded_document_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_order public.orders%rowtype;
  proof_id uuid;
  current_proof public.order_payment_proofs%rowtype;
begin
  if current_user_id is null or not public.is_active_account() then
    raise exception 'Sign in with an active account to submit payment proof.'
      using errcode = '42501';
  end if;

  select * into current_order
  from public.orders
  where id = target_order_id and customer_id = current_user_id
  for update;
  if not found then raise exception 'This order is not available to your account.'; end if;
  if current_order.payment_status <> 'unpaid'
      or current_order.status in ('cancelled', 'completed') then
    raise exception 'Payment proof can only be submitted for an active unpaid order.';
  end if;
  if exists (
    select 1 from public.benefit_discount_requests
    where order_id = target_order_id and status = 'pending'
  ) then
    raise exception 'Wait for staff to verify your benefit discount before paying the updated total.';
  end if;
  if not exists (
    select 1 from public.payments
    where order_id = target_order_id and payment_method_code = 'gcash'
  ) then
    raise exception 'This order does not use GCash payment.';
  end if;
  if uploaded_document_path is null
      or length(uploaded_document_path) > 512
      or split_part(uploaded_document_path, '/', 1) <> current_user_id::text
      or split_part(uploaded_document_path, '/', 2) <> target_order_id::text
      or not exists (
        select 1 from storage.objects
        where bucket_id = 'order-payment-proofs'
          and name = uploaded_document_path
          and owner_id = current_user_id::text
      ) then
    raise exception 'Upload a private payment proof under your own order folder.';
  end if;
  select * into current_proof
  from public.order_payment_proofs
  where order_id = target_order_id
  for update;
  if found then
    if current_proof.status <> 'rejected' then
      raise exception 'Payment proof has already been submitted for this order.';
    end if;
    update public.order_payment_proofs
    set document_path = uploaded_document_path,
        status = 'pending',
        review_note = null,
        reviewed_by = null,
        reviewed_at = null,
        created_at = now()
    where id = current_proof.id
    returning id into proof_id;
  else
    insert into public.order_payment_proofs (
      order_id, customer_id, branch_id, document_path
    )
    values (
      current_order.id, current_user_id, current_order.branch_id, uploaded_document_path
    )
    returning id into proof_id;
  end if;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    current_user_id, 'order_payment_proof_submitted', 'order_payment_proof',
    proof_id, current_order.branch_id,
    jsonb_build_object('order_id', current_order.id, 'payment_method', 'gcash')
  );
  return proof_id;
end;
$$;

create or replace function public.review_order_payment_proof(
  target_order_id uuid,
  decision text,
  decision_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_order public.orders%rowtype;
  current_proof public.order_payment_proofs%rowtype;
begin
  if decision not in ('approved', 'rejected') then
    raise exception 'Choose approve or reject.';
  end if;
  if decision_note is not null and length(decision_note) > 500 then
    raise exception 'Review notes cannot exceed 500 characters.';
  end if;

  select * into current_order
  from public.orders where id = target_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if not public.is_active_account()
      or not public.can_access_branch(current_order.branch_id)
      or not public.has_permission(current_order.branch_id, 'orders', 'edit') then
    raise exception 'You do not have permission to review this payment.'
      using errcode = '42501';
  end if;

  select * into current_proof
  from public.order_payment_proofs
  where order_id = target_order_id
  for update;
  if not found then raise exception 'No GCash payment proof has been submitted.'; end if;
  if current_proof.status <> 'pending' then
    raise exception 'This payment proof has already been reviewed.';
  end if;
  if decision = 'rejected'
      and (decision_note is null or length(btrim(decision_note)) < 3) then
    raise exception 'Provide a rejection reason of at least 3 characters.';
  end if;

  update public.order_payment_proofs
  set status = decision,
      review_note = nullif(btrim(decision_note), ''),
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = current_proof.id;

  if decision = 'approved' then
    perform public.record_order_payment(target_order_id);
  else
    insert into public.audit_logs (
      actor_id, action, record_type, record_id, branch_id, details
    )
    values (
      (select auth.uid()), 'order_payment_proof_rejected', 'order_payment_proof',
      current_proof.id, current_order.branch_id,
      jsonb_build_object('order_id', target_order_id, 'review_note', btrim(decision_note))
    );
  end if;
end;
$$;

revoke all on function public.submit_order_payment_proof(uuid, text)
  from public, anon, authenticated;
grant execute on function public.submit_order_payment_proof(uuid, text)
  to authenticated;
revoke all on function public.review_order_payment_proof(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.review_order_payment_proof(uuid, text, text)
  to authenticated;

-- ============================================================================
-- Migration: 20261020010000_gcash_checkout_receipt_and_reference.sql
-- ============================================================================
alter table public.order_payment_proofs
  add column if not exists reference_number text;

alter table public.order_payment_proofs
  drop constraint if exists order_payment_proofs_reference_number_check;

alter table public.order_payment_proofs
  add constraint order_payment_proofs_reference_number_check
  check (
    reference_number is null
    or length(btrim(reference_number)) between 4 and 50
  );

update public.payment_methods
set instructions = 'Scan the QR code for your selected branch. Enter the GCash reference number and upload the receipt at checkout. Staff will verify the payment from the order details.'
where code = 'gcash';

drop function if exists public.submit_order_payment_proof(uuid, text);

create or replace function public.submit_order_payment_proof(
  target_order_id uuid,
  uploaded_document_path text,
  payment_reference_number text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_order public.orders%rowtype;
  proof_id uuid;
  current_proof public.order_payment_proofs%rowtype;
begin
  if current_user_id is null or not public.is_active_account() then
    raise exception 'Sign in with an active account to submit payment proof.'
      using errcode = '42501';
  end if;

  if payment_reference_number is null
      or length(btrim(payment_reference_number)) not between 4 and 50 then
    raise exception 'Enter a GCash reference number between 4 and 50 characters.';
  end if;

  select * into current_order
  from public.orders
  where id = target_order_id and customer_id = current_user_id
  for update;
  if not found then raise exception 'This order is not available to your account.'; end if;
  if current_order.payment_status <> 'unpaid'
      or current_order.status in ('cancelled', 'completed') then
    raise exception 'Payment proof can only be submitted for an active unpaid order.';
  end if;
  if not exists (
    select 1 from public.payments
    where order_id = target_order_id and payment_method_code = 'gcash'
  ) then
    raise exception 'This order does not use GCash payment.';
  end if;
  if uploaded_document_path is null
      or length(uploaded_document_path) > 512
      or split_part(uploaded_document_path, '/', 1) <> current_user_id::text
      or split_part(uploaded_document_path, '/', 2) <> target_order_id::text
      or not exists (
        select 1 from storage.objects
        where bucket_id = 'order-payment-proofs'
          and name = uploaded_document_path
          and owner_id = current_user_id::text
      ) then
    raise exception 'Upload a private payment proof under your own order folder.';
  end if;

  select * into current_proof
  from public.order_payment_proofs
  where order_id = target_order_id
  for update;
  if found then
    if current_proof.status <> 'rejected' then
      raise exception 'Payment proof has already been submitted for this order.';
    end if;
    update public.order_payment_proofs
    set document_path = uploaded_document_path,
        reference_number = btrim(payment_reference_number),
        status = 'pending',
        review_note = null,
        reviewed_by = null,
        reviewed_at = null,
        created_at = now()
    where id = current_proof.id
    returning id into proof_id;
  else
    insert into public.order_payment_proofs (
      order_id, customer_id, branch_id, document_path, reference_number
    )
    values (
      current_order.id,
      current_user_id,
      current_order.branch_id,
      uploaded_document_path,
      btrim(payment_reference_number)
    )
    returning id into proof_id;
  end if;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    current_user_id, 'order_payment_proof_submitted', 'order_payment_proof',
    proof_id, current_order.branch_id,
    jsonb_build_object('order_id', current_order.id, 'payment_method', 'gcash')
  );
  return proof_id;
end;
$$;

create or replace function public.review_order_payment_proof(
  target_order_id uuid,
  decision text,
  decision_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_order public.orders%rowtype;
  current_proof public.order_payment_proofs%rowtype;
begin
  if decision not in ('approved', 'rejected') then
    raise exception 'Choose approve or reject.';
  end if;
  if decision_note is not null and length(decision_note) > 500 then
    raise exception 'Review notes cannot exceed 500 characters.';
  end if;

  select * into current_order
  from public.orders where id = target_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if not public.is_active_account()
      or not public.can_access_branch(current_order.branch_id)
      or not public.has_permission(current_order.branch_id, 'orders', 'edit') then
    raise exception 'You do not have permission to review this payment.'
      using errcode = '42501';
  end if;

  select * into current_proof
  from public.order_payment_proofs
  where order_id = target_order_id
  for update;
  if not found then raise exception 'No GCash payment proof has been submitted.'; end if;
  if current_proof.status <> 'pending' then
    raise exception 'This payment proof has already been reviewed.';
  end if;
  if decision = 'approved' and exists (
    select 1 from public.benefit_discount_requests
    where order_id = target_order_id and status = 'pending'
  ) then
    raise exception 'Verify the benefit discount before approving GCash payment.';
  end if;
  if decision = 'rejected'
      and (decision_note is null or length(btrim(decision_note)) < 3) then
    raise exception 'Provide a rejection reason of at least 3 characters.';
  end if;

  update public.order_payment_proofs
  set status = decision,
      review_note = nullif(btrim(decision_note), ''),
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = current_proof.id;

  if decision = 'approved' then
    perform public.record_order_payment(target_order_id);
  else
    insert into public.audit_logs (
      actor_id, action, record_type, record_id, branch_id, details
    )
    values (
      (select auth.uid()), 'order_payment_proof_rejected', 'order_payment_proof',
      current_proof.id, current_order.branch_id,
      jsonb_build_object('order_id', target_order_id, 'review_note', btrim(decision_note))
    );
  end if;
end;
$$;

revoke all on function public.submit_order_payment_proof(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_order_payment_proof(uuid, text, text)
  to authenticated;
revoke all on function public.review_order_payment_proof(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.review_order_payment_proof(uuid, text, text)
  to authenticated;

notify pgrst, 'reload schema';



-- ============================================================================
-- Migration: 20261020020000_delivery_profile_and_order_discounts.sql
-- ============================================================================
alter type public.order_fulfillment_method add value if not exists 'delivery';

alter table public.profiles
  add column if not exists address text;

grant update (address) on public.profiles to authenticated;

alter table public.branches
  add column if not exists delivery_enabled boolean not null default false,
  add column if not exists delivery_fee numeric(10, 2) not null default 0;

alter table public.branches
  drop constraint if exists branches_delivery_fee_check;

alter table public.branches
  add constraint branches_delivery_fee_check
  check (delivery_fee >= 0);

alter table public.orders
  add column if not exists delivery_address text,
  add column if not exists delivery_fee numeric(12, 2) not null default 0;

alter table public.orders
  drop constraint if exists orders_total_check;

alter table public.orders
  add constraint orders_total_check
  check (
    total >= 0
    and delivery_fee >= 0
    and total = subtotal - discount_total + delivery_fee
  );

drop function if exists public.create_customer_order_with_benefit(
  uuid, public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb,
  uuid, public.benefit_type, jsonb, text
);

revoke all on function public.create_customer_order(
  uuid, public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb
) from public, anon, authenticated;

create function public.create_customer_order_with_benefit(
  target_branch_id uuid,
  fulfillment public.order_fulfillment_method,
  payment_method_id uuid,
  client_request_id uuid,
  customer_phone text,
  customer_note text,
  requested_promotion_id uuid,
  cart_items jsonb,
  target_benefit_request_id uuid default null,
  requested_benefit_type public.benefit_type default null,
  requested_benefit_items jsonb default null,
  uploaded_benefit_document_path text default null,
  customer_delivery_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  created_order_id uuid;
  benefit_item jsonb;
  order_item_id uuid;
  mapped_items jsonb := '[]'::jsonb;
  mapped_order_item_ids uuid[] := array[]::uuid[];
  delivery_available boolean;
  configured_delivery_fee numeric(10, 2) := 0;
  normalized_delivery_address text;
  current_order public.orders%rowtype;
  is_replay boolean := false;
begin
  if current_user_id is null or client_request_id is null then
    raise exception 'Sign in and submit a valid order request.';
  end if;

  normalized_delivery_address := nullif(btrim(customer_delivery_address), '');
  if fulfillment = 'delivery' then
    if normalized_delivery_address is null
        or length(normalized_delivery_address) not between 8 and 500 then
      raise exception 'Enter a delivery address between 8 and 500 characters.';
    end if;
    select branches.delivery_enabled, branches.delivery_fee
    into delivery_available, configured_delivery_fee
    from public.branches
    where branches.id = target_branch_id
      and branches.is_active
    for share;
    if not found or not delivery_available then
      raise exception 'Delivery is not available from the selected branch.';
    end if;
  elsif normalized_delivery_address is not null then
    raise exception 'A delivery address can only be provided for delivery orders.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(current_user_id::text || ':' || client_request_id::text, 0)
  );

  select * into current_order
  from public.orders
  where customer_id = current_user_id
    and orders.client_request_id = create_customer_order_with_benefit.client_request_id;
  is_replay := found;
  if is_replay and (
    current_order.fulfillment_method is distinct from fulfillment
    or current_order.delivery_address is distinct from normalized_delivery_address
  ) then
    raise exception 'This order submission key was already used for different delivery details.';
  end if;

  if (
    target_benefit_request_id is null
    and requested_benefit_type is null
    and requested_benefit_items is null
    and uploaded_benefit_document_path is null
  ) then
    created_order_id := public.create_customer_order(
      target_branch_id, fulfillment, payment_method_id, client_request_id,
      customer_phone, customer_note, requested_promotion_id, cart_items
    );
  else
    if target_benefit_request_id is null
        or requested_benefit_type is null
        or requested_benefit_items is null
        or uploaded_benefit_document_path is null
        or requested_promotion_id is not null then
      raise exception 'Choose a benefit type, eligible items, and upload ID evidence. Benefit discounts cannot be combined with a promotion.';
    end if;

    created_order_id := public.create_customer_order(
      target_branch_id, fulfillment, payment_method_id, client_request_id,
      customer_phone, customer_note, requested_promotion_id, cart_items
    );

    if not exists (
      select 1 from public.benefit_discount_requests
      where id = target_benefit_request_id and order_id = created_order_id
    ) then
      for benefit_item in
        select entry.value from jsonb_array_elements(requested_benefit_items) as entry(value)
      loop
        select order_item.id into order_item_id
        from public.order_items as order_item
        where order_item.order_id = created_order_id
          and order_item.product_id = (benefit_item ->> 'product_id')::uuid
          and order_item.variant_id is not distinct from
            nullif(benefit_item ->> 'variant_id', '')::uuid
          and not (order_item.id = any(mapped_order_item_ids))
          and coalesce((
            select array_agg(addon.addon_id order by addon.addon_id)
            from public.order_item_addons as addon
            where addon.order_item_id = order_item.id
          ), array[]::uuid[]) = array(
            select addon.value::uuid
            from jsonb_array_elements_text(
              coalesce(benefit_item -> 'addon_ids', '[]'::jsonb)
            ) as addon(value)
            order by addon.value::uuid
          )
        limit 1;
        if order_item_id is null then
          raise exception 'A selected benefit item could not be matched to the submitted order.';
        end if;
        mapped_order_item_ids := array_append(mapped_order_item_ids, order_item_id);
        mapped_items := mapped_items || jsonb_build_array(jsonb_build_object(
          'order_item_id', order_item_id,
          'eligible_quantity', benefit_item -> 'eligible_quantity'
        ));
      end loop;

      perform public.create_benefit_discount_request(
        target_benefit_request_id,
        created_order_id,
        requested_benefit_type,
        mapped_items,
        uploaded_benefit_document_path
      );
    end if;
  end if;

  if not is_replay then
    update public.orders
    set delivery_address = normalized_delivery_address,
        delivery_fee = case when fulfillment = 'delivery' then configured_delivery_fee else 0 end,
        total = total + case when fulfillment = 'delivery' then configured_delivery_fee else 0 end
    where id = created_order_id;

    update public.payments
    set amount = amount + case when fulfillment = 'delivery' then configured_delivery_fee else 0 end
    where order_id = created_order_id;
  end if;

  return created_order_id;
end;
$$;

revoke all on function public.create_customer_order_with_benefit(
  uuid, public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb,
  uuid, public.benefit_type, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.create_customer_order_with_benefit(
  uuid, public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb,
  uuid, public.benefit_type, jsonb, text, text
) to authenticated;

notify pgrst, 'reload schema';


-- ============================================================================
-- Migration: 20261020030000_checkout_fulfillment_payment_rules.sql
-- ============================================================================
create or replace function public.enforce_customer_order_fulfillment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fulfillment_method not in ('pickup', 'delivery') then
    raise exception 'Choose pick-up or delivery for a customer order.';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_enforce_customer_fulfillment on public.orders;
create trigger orders_enforce_customer_fulfillment
before insert on public.orders
for each row execute function public.enforce_customer_order_fulfillment();

create or replace function public.enforce_fulfillment_payment_method()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  order_fulfillment public.order_fulfillment_method;
begin
  select fulfillment_method
  into order_fulfillment
  from public.orders
  where id = new.order_id;

  if not found then
    raise exception 'Payment must belong to an existing order.';
  end if;

  if order_fulfillment = 'delivery' and new.payment_method_code <> 'gcash' then
    raise exception 'Delivery orders require online GCash payment.';
  end if;

  if order_fulfillment = 'pickup'
      and new.payment_method_code not in ('cash_at_branch', 'gcash') then
    raise exception 'Pick-up orders can be paid by cash or GCash.';
  end if;

  return new;
end;
$$;

drop trigger if exists payments_enforce_fulfillment_method on public.payments;
create trigger payments_enforce_fulfillment_method
before insert or update of payment_method_code on public.payments
for each row execute function public.enforce_fulfillment_payment_method();

notify pgrst, 'reload schema';


-- ============================================================================
-- Migration: 20261021000000_branch_product_availability_only.sql
-- ============================================================================
do $$
declare
  order_definition text;
  status_definition text;
  stock_block_start integer;
  stock_block_end_marker integer;
  stock_block_end integer;
begin
  order_definition := pg_get_functiondef(
    'public.create_customer_order(uuid,public.order_fulfillment_method,uuid,uuid,text,text,uuid,jsonb)'::regprocedure
  );

  if position('item_stock public.branch_product_stock%rowtype' in order_definition) = 0
      or position('quantity_reserved = quantity_reserved + item_quantity' in order_definition) = 0 then
    raise exception 'Could not locate the expected product stock checks in create_customer_order.';
  end if;

  order_definition := replace(
    order_definition,
    $stock_declaration$  item_stock public.branch_product_stock%rowtype;
  requested_product_quantity integer;
$stock_declaration$,
    ''
  );
  order_definition := replace(
    order_definition,
    $stock_check$
    select * into item_stock
    from public.branch_product_stock
    where branch_id = target_branch_id
      and product_id = item_product_id
    for update;
    if item_stock.branch_id is null then
      raise exception 'A cart product does not have enough stock at the selected branch.';
    end if;
    select coalesce(sum((entry.value ->> 'quantity')::integer), 0)
      into requested_product_quantity
    from jsonb_array_elements(cart_items) as entry(value)
    where (entry.value ->> 'product_id')::uuid = item_product_id;
    if item_stock.quantity_on_hand - item_stock.quantity_reserved
        < requested_product_quantity then
      raise exception 'A cart product does not have enough stock at the selected branch.';
    end if;
$stock_check$,
    ''
  );
  order_definition := replace(
    order_definition,
    $stock_reservation$
    update public.branch_product_stock
    set quantity_reserved = quantity_reserved + item_quantity
    where branch_id = target_branch_id
      and product_id = item_product_id;
$stock_reservation$,
    ''
  );

  if position('branch_product_stock' in order_definition) > 0 then
    raise exception 'Product stock checks remain in create_customer_order.';
  end if;
  execute order_definition;

  status_definition := pg_get_functiondef(
    'public.update_order_status(uuid,public.order_status,text)'::regprocedure
  );
  if position('Reserved product stock could not be reconciled.' in status_definition) = 0 then
    raise exception 'Could not locate the expected product stock reconciliation in update_order_status.';
  end if;

  stock_block_start := strpos(
    status_definition,
    '  if next_status in (''cancelled'', ''completed'')'
  );
  if stock_block_start = 0 then
    raise exception 'Could not locate product stock reconciliation in update_order_status.';
  end if;

  stock_block_end_marker := strpos(
    substring(status_definition from stock_block_start),
    E'\n  if next_status = ''completed'' then\n    for recipe_stock in'
  );
  if stock_block_end_marker = 0 then
    stock_block_end_marker := strpos(
      substring(status_definition from stock_block_start),
      E'\n  if next_status = ''completed'' then'
    );
  end if;
  if stock_block_end_marker = 0 then
    stock_block_end_marker := strpos(
      substring(status_definition from stock_block_start),
      E'\n  update public.orders'
    );
  end if;
  stock_block_end := stock_block_start + stock_block_end_marker - 1;
  if stock_block_end_marker = 0 or stock_block_end <= stock_block_start
      or position(
        'branch_product_stock' in
        substring(status_definition from stock_block_start for stock_block_end - stock_block_start)
      ) = 0 then
    raise exception 'Could not isolate product stock reconciliation in update_order_status.';
  end if;

  status_definition := overlay(
    status_definition placing ''
    from stock_block_start
    for stock_block_end - stock_block_start
  );
  if position('branch_product_stock' in status_definition) > 0 then
    raise exception 'Product stock reconciliation remains in update_order_status.';
  end if;
  execute status_definition;
end;
$$;

-- ============================================================================
-- Migration: 20261021010000_order_cancellation_reason_ambiguity.sql
-- ============================================================================
do $$
declare
  status_definition text;
begin
  status_definition := pg_get_functiondef(
    'public.update_order_status(uuid,public.order_status,text)'::regprocedure
  );

  status_definition := replace(
    status_definition,
    'if cancellation_reason is null',
    'if $3 is null'
  );
  status_definition := replace(
    status_definition,
    'btrim(cancellation_reason)',
    'btrim($3)'
  );

  if position('if cancellation_reason is null' in status_definition) > 0
      or position('btrim(cancellation_reason)' in status_definition) > 0 then
    raise exception 'Ambiguous cancellation-reason references remain in update_order_status.';
  end if;

  execute status_definition;
end;
$$;


-- ============================================================================
-- Migration: 20261021020000_option_inventory_recipes.sql
-- ============================================================================
create table if not exists public.product_option_recipes (
  variant_id uuid references public.product_variants (id) on delete cascade,
  addon_id uuid references public.product_addons (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete restrict,
  quantity numeric(12, 4) not null check (quantity > 0),
  check ((variant_id is null) <> (addon_id is null))
);

create unique index if not exists product_option_recipes_variant_ingredient_idx
  on public.product_option_recipes (variant_id, ingredient_id)
  where variant_id is not null;
create unique index if not exists product_option_recipes_addon_ingredient_idx
  on public.product_option_recipes (addon_id, ingredient_id)
  where addon_id is not null;

alter table public.product_option_recipes enable row level security;

drop policy if exists "Authorized staff can view product option recipes"
  on public.product_option_recipes;
create policy "Authorized staff can view product option recipes"
on public.product_option_recipes for select to authenticated
using (public.has_role('super_admin') or public.is_active_account());

drop policy if exists "Super admins can manage product option recipes"
  on public.product_option_recipes;
create policy "Super admins can manage product option recipes"
on public.product_option_recipes for all to authenticated
using (public.has_role('super_admin'))
with check (public.has_role('super_admin'));

revoke all on public.product_option_recipes from anon, authenticated;
grant select on public.product_option_recipes to authenticated;

create or replace function public.admin_set_product_option_recipe(
  target_variant_id uuid,
  target_addon_id uuid,
  ingredient_ids uuid[],
  quantities numeric[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('super_admin') then
    raise exception 'Super Admin permission is required to manage recipes.'
      using errcode = '42501';
  end if;

  if (target_variant_id is null) = (target_addon_id is null)
      or cardinality(coalesce(ingredient_ids, array[]::uuid[]))
        <> cardinality(coalesce(quantities, array[]::numeric[]))
      or cardinality(coalesce(ingredient_ids, array[]::uuid[])) > 100 then
    raise exception 'Choose one product size or add-on and provide matching recipe quantities.';
  end if;

  if target_variant_id is not null and cardinality(coalesce(ingredient_ids, array[]::uuid[])) = 0 then
    raise exception 'Add at least one inventory item to the size recipe.';
  end if;

  if exists (
    select 1
    from unnest(coalesce(ingredient_ids, array[]::uuid[])) as ingredient(id)
    where id is null
  ) or exists (
    select 1
    from unnest(coalesce(quantities, array[]::numeric[])) as amount(value)
    where value is null or value <= 0
  ) then
    raise exception 'Recipe inventory items and quantities must be valid and positive.';
  end if;

  if cardinality(coalesce(ingredient_ids, array[]::uuid[])) <>
      (select count(distinct id)
       from unnest(coalesce(ingredient_ids, array[]::uuid[])) as ingredient(id)) then
    raise exception 'A recipe cannot include the same inventory item more than once.';
  end if;

  if exists (
    select 1
    from unnest(coalesce(ingredient_ids, array[]::uuid[])) as ingredient(id)
    left join public.ingredients on ingredients.id = ingredient.id
    where ingredients.id is null or not ingredients.is_active
  ) then
    raise exception 'A recipe inventory item is inactive or does not exist.';
  end if;

  if target_variant_id is not null and not exists (
    select 1 from public.product_variants
    where id = target_variant_id and is_active
  ) then
    raise exception 'The selected product size is inactive or does not exist.';
  end if;
  if target_addon_id is not null and not exists (
    select 1 from public.product_addons
    where id = target_addon_id and is_active
  ) then
    raise exception 'The selected add-on is inactive or does not exist.';
  end if;

  delete from public.product_option_recipes
  where (target_variant_id is not null and variant_id = target_variant_id)
     or (target_addon_id is not null and addon_id = target_addon_id);

  insert into public.product_option_recipes (
    variant_id, addon_id, ingredient_id, quantity
  )
  select target_variant_id, target_addon_id, ingredient.id, amount.value
  from unnest(coalesce(ingredient_ids, array[]::uuid[]))
       with ordinality as ingredient(id, position)
  join unnest(coalesce(quantities, array[]::numeric[]))
       with ordinality as amount(value, position)
    using (position);

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, details
  )
  values (
    (select auth.uid()),
    'product_option_recipe_updated',
    case when target_variant_id is not null then 'product_variant' else 'product_addon' end,
    coalesce(target_variant_id, target_addon_id),
    jsonb_build_object(
      'inventory_item_count', cardinality(coalesce(ingredient_ids, array[]::uuid[]))
    )
  );
end;
$$;

revoke all on function public.admin_set_product_option_recipe(uuid, uuid, uuid[], numeric[])
  from public, anon, authenticated;
grant execute on function public.admin_set_product_option_recipe(uuid, uuid, uuid[], numeric[])
  to authenticated;

do $$
declare
  status_definition text;
  completion_start integer;
  validation_end_marker integer;
  validation_end integer;
  consumption_start integer;
  consumption_end_marker integer;
  consumption_end integer;
  consumption_replace_length integer;
  has_consumption_block boolean;
begin
  status_definition := pg_get_functiondef(
    'public.update_order_status(uuid,public.order_status,text)'::regprocedure
  );

  completion_start := strpos(
    status_definition,
    E'\n  if next_status = ''completed'' then'
  );
  if completion_start = 0 then
    raise exception 'Could not locate the recipe validation in update_order_status.';
  end if;
  validation_end_marker := strpos(
    substring(status_definition from completion_start),
    E'\n  if next_status = ''completed'' then\n    for recipe_stock in'
  );
  if validation_end_marker = 0 then
    validation_end_marker := strpos(
      substring(status_definition from completion_start),
      E'\n  update public.orders'
    );
  end if;
  validation_end := completion_start + validation_end_marker - 1;
  if validation_end_marker = 0 or validation_end <= completion_start then
    raise exception 'Could not isolate the recipe validation in update_order_status.';
  end if;

  status_definition := overlay(
    status_definition placing $recipe_validation$
  if next_status = 'completed' then
    if exists (
      select 1
      from public.order_items as order_item
      where order_item.order_id = target_order_id
        and order_item.product_id is not null
        and (
          (
            order_item.variant_id is null
            and not exists (
              select 1 from public.product_recipes as recipe
              where recipe.product_id = order_item.product_id
            )
          )
          or (
            order_item.variant_id is not null
            and not exists (
              select 1 from public.product_option_recipes as recipe
              where recipe.variant_id = order_item.variant_id
            )
          )
        )
    ) then
      raise exception 'Configure an inventory recipe for every ordered product size before completing this order.';
    end if;

    for recipe_stock in
      select usage.ingredient_id,
             sum(usage.quantity_used)::numeric(14, 4) as quantity_used
      from (
        select recipe.ingredient_id,
               sum(recipe.quantity * order_item.quantity)::numeric(14, 4) as quantity_used
        from public.order_items as order_item
        join public.product_recipes as recipe
          on recipe.product_id = order_item.product_id
        where order_item.order_id = target_order_id
          and order_item.variant_id is null
        group by recipe.ingredient_id

        union all

        select recipe.ingredient_id,
               sum(recipe.quantity * order_item.quantity)::numeric(14, 4) as quantity_used
        from public.order_items as order_item
        join public.product_option_recipes as recipe
          on recipe.variant_id = order_item.variant_id
        where order_item.order_id = target_order_id
          and order_item.variant_id is not null
        group by recipe.ingredient_id

        union all

        select recipe.ingredient_id,
               sum(recipe.quantity * order_item.quantity)::numeric(14, 4) as quantity_used
        from public.order_items as order_item
        join public.order_item_addons as order_addon
          on order_addon.order_item_id = order_item.id
        join public.product_option_recipes as recipe
          on recipe.addon_id = order_addon.addon_id
        where order_item.order_id = target_order_id
        group by recipe.ingredient_id
      ) as usage
      group by usage.ingredient_id
      order by usage.ingredient_id
    loop
      perform 1 from public.branch_inventory
      where branch_id = current_order.branch_id
        and ingredient_id = recipe_stock.ingredient_id
      for update;
      if not found then
        raise exception 'Inventory is not configured for an item used by this order at the selected branch.';
      end if;

      if not exists (
        select 1 from public.branch_inventory
        where branch_id = current_order.branch_id
          and ingredient_id = recipe_stock.ingredient_id
          and quantity_on_hand >= recipe_stock.quantity_used
      ) then
        raise exception 'There is not enough branch inventory to complete this order.';
      end if;
    end loop;
  end if;
$recipe_validation$
    from completion_start
    for validation_end - completion_start
  );

  consumption_start := strpos(
    status_definition,
    E'\n  if next_status = ''completed'' then\n    for recipe_stock in'
  );
  has_consumption_block := consumption_start > 0;
  if consumption_start = 0 then
    consumption_start := strpos(status_definition, E'\n  update public.orders');
    if consumption_start = 0 then
      raise exception 'Could not locate inventory deduction insertion point in update_order_status.';
    end if;
    consumption_end := consumption_start;
    consumption_replace_length := 0;
  else
    consumption_end_marker := strpos(
      substring(status_definition from consumption_start),
      E'\n  update public.orders'
    );
    consumption_end := consumption_start + consumption_end_marker - 1;
    if consumption_end_marker = 0 or consumption_end <= consumption_start then
      raise exception 'Could not isolate inventory deduction in update_order_status.';
    end if;
    consumption_replace_length := consumption_end - consumption_start;
  end if;

  status_definition := overlay(
    status_definition placing $recipe_consumption$
  if next_status = 'completed' then
    for recipe_stock in
      select usage.ingredient_id,
             sum(usage.quantity_used)::numeric(14, 4) as quantity_used
      from (
        select recipe.ingredient_id,
               sum(recipe.quantity * order_item.quantity)::numeric(14, 4) as quantity_used
        from public.order_items as order_item
        join public.product_recipes as recipe
          on recipe.product_id = order_item.product_id
        where order_item.order_id = target_order_id
          and order_item.variant_id is null
        group by recipe.ingredient_id

        union all

        select recipe.ingredient_id,
               sum(recipe.quantity * order_item.quantity)::numeric(14, 4) as quantity_used
        from public.order_items as order_item
        join public.product_option_recipes as recipe
          on recipe.variant_id = order_item.variant_id
        where order_item.order_id = target_order_id
          and order_item.variant_id is not null
        group by recipe.ingredient_id

        union all

        select recipe.ingredient_id,
               sum(recipe.quantity * order_item.quantity)::numeric(14, 4) as quantity_used
        from public.order_items as order_item
        join public.order_item_addons as order_addon
          on order_addon.order_item_id = order_item.id
        join public.product_option_recipes as recipe
          on recipe.addon_id = order_addon.addon_id
        where order_item.order_id = target_order_id
        group by recipe.ingredient_id
      ) as usage
      group by usage.ingredient_id
      order by usage.ingredient_id
    loop
      perform 1 from public.branch_inventory
      where branch_id = current_order.branch_id
        and ingredient_id = recipe_stock.ingredient_id
      for update;
      if not found then
        raise exception 'Inventory is not configured for an item used by this order at the selected branch.';
      end if;

      update public.branch_inventory
      set quantity_on_hand = quantity_on_hand - recipe_stock.quantity_used
      where branch_id = current_order.branch_id
        and ingredient_id = recipe_stock.ingredient_id
        and quantity_on_hand >= recipe_stock.quantity_used;
      if not found then
        raise exception 'There is not enough branch inventory to complete this order.';
      end if;

      insert into public.inventory_movements (
        branch_id, ingredient_id, order_id, movement_type, quantity_delta,
        note, actor_id
      )
      values (
        current_order.branch_id, recipe_stock.ingredient_id, target_order_id,
        'order_consumption', -recipe_stock.quantity_used,
        'Consumed for order ' || current_order.order_number, (select auth.uid())
      );
    end loop;
  end if;
$recipe_consumption$
    from consumption_start
    for consumption_replace_length
  );

  if position('branch_product_stock' in status_definition) > 0 then
    raise exception 'Unexpected finished-product stock checks remain in update_order_status.';
  end if;
  execute status_definition;
end;
$$;

notify pgrst, 'reload schema';

-- ============================================================================
-- Migration: 20261021030000_payment_cost_reporting.sql
-- ============================================================================
create or replace function public.get_operational_report_with_payments(
  target_branch_id uuid,
  start_date date,
  end_date date,
  page_offset integer default 0,
  page_size integer default 50
)
returns table (
  order_id uuid,
  order_number text,
  branch_name text,
  created_at timestamptz,
  status public.order_status,
  payment_status public.payment_status,
  customer_name text,
  fulfillment_method public.order_fulfillment_method,
  subtotal numeric,
  discount_total numeric,
  total numeric,
  items jsonb,
  paid_amount numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select report.order_id,
         report.order_number,
         report.branch_name,
         report.created_at,
         report.status,
         report.payment_status,
         report.customer_name,
         report.fulfillment_method,
         report.subtotal,
         report.discount_total,
         report.total,
         report.items,
         case when payment.status = 'paid' then payment.amount else 0::numeric end
  from public.get_operational_report(
    target_branch_id, start_date, end_date, page_offset, page_size
  ) as report
  left join public.payments as payment on payment.order_id = report.order_id;
end;
$$;

create or replace function public.get_financial_report_with_payments(
  target_branch_id uuid,
  start_date date,
  end_date date
)
returns table (
  completed_orders bigint,
  gross_sales numeric,
  discounts numeric,
  net_sales numeric,
  cost_of_goods numeric,
  uncosted_orders bigint,
  expenses numeric,
  estimated_profit numeric,
  collected_sales numeric,
  paid_orders bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select financial.completed_orders,
         financial.gross_sales,
         financial.discounts,
         financial.net_sales,
         financial.cost_of_goods,
         financial.uncosted_orders,
         financial.expenses,
         financial.estimated_profit,
         coalesce(paid.total, 0)::numeric,
         coalesce(paid.order_count, 0)::bigint
  from public.get_financial_report(target_branch_id, start_date, end_date) as financial
  cross join lateral (
    select coalesce(sum(payment.amount), 0) as total,
           count(*) as order_count
    from public.payments as payment
    join public.orders as order_record on order_record.id = payment.order_id
    where payment.status = 'paid'
      and payment.updated_at >= (start_date::timestamp at time zone 'Asia/Manila')
      and payment.updated_at < ((end_date + 1)::timestamp at time zone 'Asia/Manila')
      and (target_branch_id is null or order_record.branch_id = target_branch_id)
  ) as paid;
end;
$$;

revoke all on function public.get_operational_report_with_payments(uuid, date, date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_operational_report_with_payments(uuid, date, date, integer, integer)
  to authenticated;
revoke all on function public.get_financial_report_with_payments(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.get_financial_report_with_payments(uuid, date, date)
  to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- Migration: 20261021040000_delete_inventory_item_with_history.sql
-- ============================================================================
create or replace function public.admin_delete_inventory_item(target_ingredient_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_ingredient public.ingredients%rowtype;
  deleted_product_recipes integer;
  deleted_option_recipes integer;
  deleted_branch_stock integer;
  deleted_movements integer;
begin
  if not public.is_active_account() or not public.has_role('super_admin') then
    raise exception 'Super Admin permission is required to delete an inventory item.'
      using errcode = '42501';
  end if;

  select * into current_ingredient
  from public.ingredients
  where id = target_ingredient_id
  for update;
  if not found then
    raise exception 'Inventory item not found.';
  end if;

  delete from public.product_recipes
  where ingredient_id = target_ingredient_id;
  get diagnostics deleted_product_recipes = row_count;

  delete from public.product_option_recipes
  where ingredient_id = target_ingredient_id;
  get diagnostics deleted_option_recipes = row_count;

  delete from public.branch_inventory
  where ingredient_id = target_ingredient_id;
  get diagnostics deleted_branch_stock = row_count;

  delete from public.inventory_movements
  where ingredient_id = target_ingredient_id;
  get diagnostics deleted_movements = row_count;

  delete from public.ingredients
  where id = target_ingredient_id;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, details
  )
  values (
    (select auth.uid()),
    'inventory_item_deleted_with_history',
    'ingredient',
    target_ingredient_id,
    jsonb_build_object(
      'name', current_ingredient.name,
      'unit', current_ingredient.unit,
      'deleted_product_recipes', deleted_product_recipes,
      'deleted_option_recipes', deleted_option_recipes,
      'deleted_branch_stock_rows', deleted_branch_stock,
      'deleted_movement_rows', deleted_movements
    )
  );
end;
$$;

revoke all on function public.admin_delete_inventory_item(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_delete_inventory_item(uuid)
  to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- Migration: 20261021050000_manual_inventory_closing.sql
-- ============================================================================
alter type public.inventory_movement_type add value if not exists 'manual_usage';

alter table public.branch_inventory
  add column if not exists low_stock_threshold numeric(14, 4) not null default 0
  check (low_stock_threshold >= 0);

create or replace function public.record_inventory_movement(
  target_branch_id uuid,
  target_ingredient_id uuid,
  movement public.inventory_movement_type,
  quantity_delta numeric,
  note text default '',
  unit_cost numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  movement_id uuid;
begin
  if not public.is_active_account()
      or not public.can_access_branch(target_branch_id)
      or not (
        public.has_permission(target_branch_id, 'inventory', 'create')
        or public.has_permission(target_branch_id, 'inventory', 'edit')
      ) then
    raise exception 'You do not have permission to record inventory movements.'
      using errcode = '42501';
  end if;

  if movement = 'order_consumption' then
    raise exception 'Order consumption is disabled. Record actual usage from Inventory after closing.';
  end if;

  if quantity_delta is null or quantity_delta = 0
      or (movement = 'receipt' and quantity_delta <= 0)
      or (movement in ('waste', 'manual_usage') and quantity_delta >= 0)
      or (movement = 'adjustment' and abs(quantity_delta) > 1000000) then
    raise exception 'Enter a valid non-zero quantity for this movement type.';
  end if;
  if movement = 'receipt' and (unit_cost is null or unit_cost < 0) then
    raise exception 'Enter the total purchase cost for every stock receipt.';
  end if;
  if note is not null and length(note) > 500 then
    raise exception 'Inventory notes cannot exceed 500 characters.';
  end if;
  if unit_cost is not null and unit_cost < 0 then
    raise exception 'Unit cost cannot be negative.';
  end if;

  perform 1 from public.branches
  where id = target_branch_id and is_active
  for share;
  if not found then
    raise exception 'The selected branch is inactive or does not exist.';
  end if;

  perform 1 from public.ingredients
  where id = target_ingredient_id and is_active
  for share;
  if not found then
    raise exception 'The selected inventory item is inactive or does not exist.';
  end if;

  insert into public.branch_inventory (branch_id, ingredient_id)
  values (target_branch_id, target_ingredient_id)
  on conflict (branch_id, ingredient_id) do nothing;

  update public.branch_inventory
  set quantity_on_hand = quantity_on_hand + quantity_delta
  where branch_id = target_branch_id
    and ingredient_id = target_ingredient_id
    and quantity_on_hand + quantity_delta >= 0;
  if not found then
    raise exception 'This movement would make inventory negative.';
  end if;

  insert into public.inventory_movements (
    branch_id, ingredient_id, movement_type, quantity_delta, unit_cost, note, actor_id
  )
  values (
    target_branch_id, target_ingredient_id, movement, quantity_delta,
    unit_cost, coalesce(btrim(note), ''), (select auth.uid())
  )
  returning id into movement_id;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    (select auth.uid()),
    'inventory_movement_recorded',
    'inventory_movement',
    movement_id,
    target_branch_id,
    jsonb_build_object(
      'ingredient_id', target_ingredient_id,
      'movement_type', movement,
      'quantity_delta', quantity_delta,
      'unit_cost', unit_cost,
      'note', coalesce(btrim(note), '')
    )
  );

  return movement_id;
end;
$$;

create or replace function public.admin_set_inventory_low_stock_threshold(
  target_branch_id uuid,
  target_ingredient_id uuid,
  target_threshold numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_active_account()
      or not public.can_access_branch(target_branch_id)
      or not public.has_permission(target_branch_id, 'inventory', 'edit') then
    raise exception 'You do not have permission to edit inventory settings for this branch.'
      using errcode = '42501';
  end if;

  if target_threshold is null or target_threshold < 0 or target_threshold > 100000000 then
    raise exception 'Enter a low-stock warning quantity of zero or more.';
  end if;

  perform 1 from public.branches
  where id = target_branch_id and is_active;
  if not found then
    raise exception 'The selected branch is inactive or does not exist.';
  end if;

  perform 1 from public.ingredients
  where id = target_ingredient_id and is_active;
  if not found then
    raise exception 'The selected inventory item is inactive or does not exist.';
  end if;

  insert into public.branch_inventory (
    branch_id, ingredient_id, low_stock_threshold
  )
  values (
    target_branch_id, target_ingredient_id, target_threshold
  )
  on conflict (branch_id, ingredient_id)
  do update set low_stock_threshold = excluded.low_stock_threshold;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    (select auth.uid()),
    'inventory_low_stock_threshold_updated',
    'ingredient',
    target_ingredient_id,
    target_branch_id,
    jsonb_build_object('low_stock_threshold', target_threshold)
  );
end;
$$;

revoke all on function public.admin_set_inventory_low_stock_threshold(uuid, uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.admin_set_inventory_low_stock_threshold(uuid, uuid, numeric)
  to authenticated;

create or replace function public.snapshot_order_ingredient_cost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.movement_type in ('order_consumption', 'manual_usage') and new.unit_cost is null then
    select receipt.unit_cost into new.unit_cost
    from public.inventory_movements as receipt
    where receipt.branch_id = new.branch_id
      and receipt.ingredient_id = new.ingredient_id
      and receipt.movement_type = 'receipt'
      and receipt.unit_cost is not null
      and receipt.created_at <= new.created_at
    order by receipt.created_at desc, receipt.id desc
    limit 1;
  end if;
  return new;
end;
$$;

do $$
declare
  status_definition text;
  completion_start integer;
  next_completion_start integer;
  validation_end_marker integer;
  validation_length integer;
  consumption_start integer;
  consumption_end_marker integer;
  consumption_length integer;
  order_update_position integer;
begin
  status_definition := pg_get_functiondef(
    'public.update_order_status(uuid,public.order_status,text)'::regprocedure
  );

  completion_start := strpos(
    status_definition,
    E'\n  if next_status = ''completed'' then'
  );
  if completion_start = 0 then
    raise exception 'Could not find inventory validation in update_order_status.';
  end if;

  next_completion_start := strpos(
    substring(status_definition from completion_start + 1),
    E'\n  if next_status = ''completed'' then'
  );
  if next_completion_start = 0 then
    raise exception 'Could not isolate both inventory blocks in update_order_status.';
  end if;
  next_completion_start := completion_start + next_completion_start;
  validation_end_marker := next_completion_start;
  if validation_end_marker <= completion_start then
    raise exception 'Could not isolate recipe validation in update_order_status.';
  end if;

  status_definition := overlay(
    status_definition placing ''
    from completion_start
    for validation_end_marker - completion_start
  );

  consumption_start := strpos(
    status_definition,
    E'\n  if next_status = ''completed'' then'
  );
  if consumption_start = 0 then
    raise exception 'Could not find automatic inventory deduction in update_order_status.';
  end if;
  order_update_position := strpos(
    substring(status_definition from consumption_start),
    E'\n  update public.orders'
  );
  if order_update_position = 0 then
    raise exception 'Could not isolate automatic inventory deduction in update_order_status.';
  end if;
  consumption_end_marker := consumption_start + order_update_position - 1;
  consumption_length := consumption_end_marker - consumption_start;
  if consumption_length <= 0 then
    raise exception 'Could not isolate automatic inventory deduction in update_order_status.';
  end if;

  status_definition := overlay(
    status_definition placing ''
    from consumption_start
    for consumption_length
  );

  if position('product_recipes' in status_definition) > 0
      or position('product_option_recipes' in status_definition) > 0
      or position('order_consumption' in status_definition) > 0 then
    raise exception 'Automatic ingredient inventory behavior remains in update_order_status.';
  end if;

  execute status_definition;
end;
$$;

create table if not exists public.inventory_legacy_cost_orders (
  order_id uuid primary key references public.orders(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade
);

alter table public.inventory_legacy_cost_orders enable row level security;
revoke all on table public.inventory_legacy_cost_orders from public, anon, authenticated;

create table if not exists public.inventory_manual_closing_settings (
  id boolean primary key default true check (id),
  activated_at timestamptz not null default now()
);

alter table public.inventory_manual_closing_settings enable row level security;
revoke all on table public.inventory_manual_closing_settings from public, anon, authenticated;

do $$
declare
  initialized boolean;
begin
  insert into public.inventory_manual_closing_settings (id)
  values (true)
  on conflict (id) do nothing
  returning true into initialized;

  if initialized then
    insert into public.inventory_legacy_cost_orders (order_id, branch_id)
    select order_record.id, order_record.branch_id
    from public.orders as order_record
    where order_record.status = 'completed';
  end if;
end;
$$;

drop function public.get_financial_report_with_payments(uuid, date, date);

create function public.get_financial_report_with_payments(
  target_branch_id uuid,
  start_date date,
  end_date date
)
returns table (
  completed_orders bigint,
  gross_sales numeric,
  discounts numeric,
  net_sales numeric,
  cost_of_goods numeric,
  uncosted_orders bigint,
  expenses numeric,
  estimated_profit numeric,
  collected_sales numeric,
  paid_orders bigint,
  inventory_purchases numeric,
  manual_usage_cost numeric,
  uncosted_manual_usage bigint,
  uncosted_inventory_purchases bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select financial.completed_orders,
         financial.gross_sales,
         financial.discounts,
         financial.net_sales,
         case
           when legacy.uncosted_orders > 0 or inventory.uncosted_usage > 0 then null
           else legacy.cost_of_goods + inventory.manual_usage_cost
         end,
         legacy.uncosted_orders,
         financial.expenses,
         case
           when legacy.uncosted_orders > 0 or inventory.uncosted_usage > 0 then null
           else financial.net_sales - legacy.cost_of_goods
             - inventory.manual_usage_cost - financial.expenses
         end,
         coalesce(paid.total, 0)::numeric,
         coalesce(paid.order_count, 0)::bigint,
         inventory.inventory_purchases,
         inventory.manual_usage_cost,
         inventory.uncosted_usage,
         inventory.uncosted_purchases
  from public.get_financial_report(target_branch_id, start_date, end_date) as financial
  cross join lateral (
    select coalesce(sum(legacy_order.cost_of_goods), 0)::numeric as cost_of_goods,
           count(*) filter (where legacy_order.uncosted_movements > 0)::bigint as uncosted_orders
    from (
      select order_record.id,
             coalesce(sum(abs(movement.quantity_delta) * movement.unit_cost), 0) as cost_of_goods,
             count(*) filter (
               where (movement.order_id is not null and movement.unit_cost is null)
                 or exists (
                   select 1 from public.order_items as order_item
                   where order_item.order_id = order_record.id
                     and order_item.product_id is null
                 )
                 or (
                   exists (
                     select 1 from public.order_items as order_item
                     where order_item.order_id = order_record.id
                       and order_item.product_id is not null
                   )
                   and not exists (
                     select 1 from public.inventory_movements as consumption
                     where consumption.order_id = order_record.id
                       and consumption.movement_type = 'order_consumption'
                   )
                 )
             ) as uncosted_movements
      from public.inventory_legacy_cost_orders as legacy_order
      join public.orders as order_record on order_record.id = legacy_order.order_id
      left join public.inventory_movements as movement
        on movement.order_id = order_record.id
        and movement.movement_type = 'order_consumption'
      where order_record.status = 'completed'
        and order_record.created_at >= (start_date::timestamp at time zone 'Asia/Manila')
        and order_record.created_at < ((end_date + 1)::timestamp at time zone 'Asia/Manila')
        and (target_branch_id is null or legacy_order.branch_id = target_branch_id)
      group by order_record.id
    ) as legacy_order
  ) as legacy
  cross join lateral (
    select coalesce(sum(abs(movement.quantity_delta) * movement.unit_cost) filter (
             where movement.movement_type = 'manual_usage'
           ), 0)::numeric as manual_usage_cost,
           count(*) filter (
             where movement.movement_type = 'manual_usage'
               and movement.unit_cost is null
           )::bigint as uncosted_usage,
           coalesce(sum(movement.quantity_delta * movement.unit_cost) filter (
             where movement.movement_type = 'receipt'
           ), 0)::numeric as inventory_purchases,
           count(*) filter (
             where movement.movement_type = 'receipt'
               and movement.unit_cost is null
           )::bigint as uncosted_purchases
    from public.inventory_movements as movement
    where movement.created_at >= (start_date::timestamp at time zone 'Asia/Manila')
      and movement.created_at < ((end_date + 1)::timestamp at time zone 'Asia/Manila')
      and (target_branch_id is null or movement.branch_id = target_branch_id)
  ) as inventory
  cross join lateral (
    select coalesce(sum(payment.amount), 0) as total,
           count(*) as order_count
    from public.payments as payment
    join public.orders as order_record on order_record.id = payment.order_id
    where payment.status = 'paid'
      and payment.updated_at >= (start_date::timestamp at time zone 'Asia/Manila')
      and payment.updated_at < ((end_date + 1)::timestamp at time zone 'Asia/Manila')
      and (target_branch_id is null or order_record.branch_id = target_branch_id)
  ) as paid;
end;
$$;

revoke all on function public.record_inventory_movement(
  uuid, uuid, public.inventory_movement_type, numeric, text, numeric
) from public, anon, authenticated;
grant execute on function public.record_inventory_movement(
  uuid, uuid, public.inventory_movement_type, numeric, text, numeric
) to authenticated;
revoke all on function public.get_financial_report_with_payments(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.get_financial_report_with_payments(uuid, date, date)
  to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- Migration: 20261021060000_manual_inventory_movement_constraint.sql
-- ============================================================================
do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select constraint_info.conname
    from pg_catalog.pg_constraint as constraint_info
    where constraint_info.conrelid = 'public.inventory_movements'::regclass
      and constraint_info.contype = 'c'
      and position('movement_type' in pg_catalog.pg_get_constraintdef(constraint_info.oid)) > 0
      and position('quantity_delta' in pg_catalog.pg_get_constraintdef(constraint_info.oid)) > 0
      and position('receipt' in pg_catalog.pg_get_constraintdef(constraint_info.oid)) > 0
      and position('waste' in pg_catalog.pg_get_constraintdef(constraint_info.oid)) > 0
  loop
    execute format(
      'alter table public.inventory_movements drop constraint %I',
      constraint_record.conname
    );
  end loop;
end;
$$;

alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_quantity_check;

alter table public.inventory_movements
  add constraint inventory_movements_movement_quantity_check
  check (
    (movement_type = 'receipt' and quantity_delta > 0)
    or (movement_type in ('waste', 'manual_usage', 'order_consumption') and quantity_delta < 0)
    or movement_type = 'adjustment'
  );

-- ============================================================================
-- Migration: 20261021070000_branch_variant_price_override.sql
-- ============================================================================
do $$
declare
  order_definition text;
  variant_price_assignment text := 'item_unit_price := item_variant.price;';
  adjusted_variant_price_assignment text :=
    'item_unit_price := greatest(0, item_variant.price + coalesce(item_availability.price_override, item_product.price) - item_product.price);';
  variant_price_query text :=
    'select price from public.product_variants';
  adjusted_variant_price_query text :=
    'select greatest(0, variant.price + coalesce(availability.price_override, product.price) - product.price)
                from public.product_variants as variant
                join public.products as product on product.id = variant.product_id
                left join public.branch_product_availability as availability
                  on availability.branch_id = target_branch_id
                  and availability.product_id = variant.product_id';
  before_assignment_count integer;
  before_query_count integer;
begin
  order_definition := pg_get_functiondef(
    'public.create_customer_order(uuid,public.order_fulfillment_method,uuid,uuid,text,text,uuid,jsonb)'::regprocedure
  );

  before_assignment_count := (
    length(order_definition)
    - length(replace(order_definition, variant_price_assignment, ''))
  ) / length(variant_price_assignment);
  before_query_count := (
    length(order_definition)
    - length(replace(order_definition, variant_price_query, ''))
  ) / length(variant_price_query);

  if before_assignment_count <> 2 or before_query_count <> 1 then
    raise exception 'Could not isolate branch variant price calculations in create_customer_order.';
  end if;

  order_definition := replace(
    order_definition,
    variant_price_assignment,
    adjusted_variant_price_assignment
  );
  order_definition := regexp_replace(
    order_definition,
    'select price from public[.]product_variants[[:space:]]+where id = [(]item ->> ''variant_id''[)]::uuid',
    adjusted_variant_price_query || E'\n                where variant.id = (item ->> ''variant_id'')::uuid'
  );

  if position(variant_price_assignment in order_definition) > 0
      or position(variant_price_query in order_definition) > 0 then
    raise exception 'Branch variant price updates were not applied to all order calculations.';
  end if;

  execute order_definition;
end;
$$;



-- ============================================================================
-- Migration: 20261021080000_branch_menu_option_settings.sql
-- ============================================================================
create table public.branch_product_variant_settings (
  branch_id uuid not null references public.branches(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  is_available boolean not null default true,
  price_override numeric(10, 2) check (price_override is null or price_override >= 0),
  updated_at timestamptz not null default now(),
  primary key (branch_id, variant_id)
);

create table public.branch_product_addon_settings (
  branch_id uuid not null references public.branches(id) on delete cascade,
  addon_id uuid not null references public.product_addons(id) on delete cascade,
  is_available boolean not null default true,
  price_override numeric(10, 2) check (price_override is null or price_override >= 0),
  updated_at timestamptz not null default now(),
  primary key (branch_id, addon_id)
);

create trigger branch_product_variant_settings_set_updated_at
before update on public.branch_product_variant_settings
for each row execute function public.set_updated_at();

create trigger branch_product_addon_settings_set_updated_at
before update on public.branch_product_addon_settings
for each row execute function public.set_updated_at();

alter table public.branch_product_variant_settings enable row level security;
alter table public.branch_product_addon_settings enable row level security;

create policy "Public can view available branch product variants"
on public.branch_product_variant_settings for select to anon, authenticated
using (
  exists (
    select 1
    from public.product_variants as variant
    join public.branch_product_availability as availability
      on availability.product_id = variant.product_id
      and availability.branch_id = branch_product_variant_settings.branch_id
      and availability.is_available
    join public.branches as branch
      on branch.id = availability.branch_id and branch.is_active
    join public.products as product
      on product.id = variant.product_id
      and product.is_published and product.is_available and product.archived_at is null
    where variant.id = branch_product_variant_settings.variant_id
  )
  or (
    public.can_access_branch(branch_id)
    and public.has_permission(branch_id, 'menu', 'view')
  )
);

create policy "Menu editors can manage branch product variants"
on public.branch_product_variant_settings for all to authenticated
using (
  public.can_access_branch(branch_id)
  and public.has_permission(branch_id, 'menu', 'edit')
)
with check (
  public.can_access_branch(branch_id)
  and public.has_permission(branch_id, 'menu', 'edit')
);

create policy "Public can view available branch product add-ons"
on public.branch_product_addon_settings for select to anon, authenticated
using (
  exists (
    select 1
    from public.product_addons as addon
    join public.branch_product_availability as availability
      on availability.product_id = addon.product_id
      and availability.branch_id = branch_product_addon_settings.branch_id
      and availability.is_available
    join public.branches as branch
      on branch.id = availability.branch_id and branch.is_active
    join public.products as product
      on product.id = addon.product_id
      and product.is_published and product.is_available and product.archived_at is null
    where addon.id = branch_product_addon_settings.addon_id
  )
  or (
    public.can_access_branch(branch_id)
    and public.has_permission(branch_id, 'menu', 'view')
  )
);

create policy "Menu editors can manage branch product add-ons"
on public.branch_product_addon_settings for all to authenticated
using (
  public.can_access_branch(branch_id)
  and public.has_permission(branch_id, 'menu', 'edit')
)
with check (
  public.can_access_branch(branch_id)
  and public.has_permission(branch_id, 'menu', 'edit')
);

revoke all on public.branch_product_variant_settings,
  public.branch_product_addon_settings from anon, authenticated;
grant select on public.branch_product_variant_settings,
  public.branch_product_addon_settings to anon, authenticated;
grant insert, update, delete on public.branch_product_variant_settings,
  public.branch_product_addon_settings to authenticated;

do $$
declare
  order_definition text;
  old_variant_price text :=
    'item_unit_price := greatest(0, item_variant.price + coalesce(item_availability.price_override, item_product.price) - item_product.price);';
  new_variant_price text :=
    'item_unit_price := greatest(0, coalesce(
      (select option_setting.price_override
       from public.branch_product_variant_settings as option_setting
       where option_setting.branch_id = target_branch_id
         and option_setting.variant_id = item_variant.id),
      item_variant.price + coalesce(item_availability.price_override, item_product.price)
        - item_product.price
    ));';
  old_addon_total text := 'item_addon_total := item_addon_total + addon_record.price;';
  new_addon_total text :=
    'item_addon_total := item_addon_total + coalesce(
      (select option_setting.price_override
       from public.branch_product_addon_settings as option_setting
       where option_setting.branch_id = target_branch_id
         and option_setting.addon_id = addon_record.id),
      addon_record.price
    );';
  promotion_variant_price_pattern text :=
    $pattern$select[[:space:]]+greatest[[:space:]]*[(][[:space:]]*0[[:space:]]*,[[:space:]]*variant[.]price[[:space:]]*[+][[:space:]]*coalesce[[:space:]]*[(][[:space:]]*availability[.]price_override[[:space:]]*,[[:space:]]*product[.]price[[:space:]]*[)][[:space:]]*-[[:space:]]*product[.]price[[:space:]]*[)]$pattern$;
  new_promotion_variant_price_expression text :=
    'select greatest(0, coalesce(
                  (select option_setting.price_override
                   from public.branch_product_variant_settings as option_setting
                   where option_setting.branch_id = target_branch_id
                     and option_setting.variant_id = variant.id),
                  variant.price + coalesce(availability.price_override, product.price) - product.price
                ))';
  old_promotion_addon_total text :=
    'select sum(addon.price)
              from public.product_addons as addon
              where addon.id in (
                select value::uuid
                from jsonb_array_elements_text(coalesce(item -> ''addon_ids'', ''[]''::jsonb))
              )';
  new_promotion_addon_total text :=
    'select sum(coalesce(option_setting.price_override, addon.price))
              from public.product_addons as addon
              left join public.branch_product_addon_settings as option_setting
                on option_setting.branch_id = target_branch_id
                and option_setting.addon_id = addon.id
              where addon.id in (
                select value::uuid
                from jsonb_array_elements_text(coalesce(item -> ''addon_ids'', ''[]''::jsonb))
              )
                and coalesce(option_setting.is_available, true)';
  old_addon_insert_price text :=
    'values (addon_id, addon_record.id, addon_record.name, addon_record.price);';
  new_addon_insert_price text :=
    'values (
        addon_id,
        addon_record.id,
        addon_record.name,
        coalesce(
          (select option_setting.price_override
           from public.branch_product_addon_settings as option_setting
           where option_setting.branch_id = target_branch_id
             and option_setting.addon_id = addon_record.id),
          addon_record.price
        )
      );';
  variant_locked_query_pattern text :=
    $pattern$from public[.]product_variants[[:space:]]+where[[:space:]]+id[[:space:]]*=[[:space:]]*item_variant_id[[:space:]]+and[[:space:]]+product_id[[:space:]]*=[[:space:]]*item_product_id[[:space:]]+and[[:space:]]+is_active[[:space:]]+for share;$pattern$;
  variant_order_query_pattern text :=
    $pattern$from public[.]product_variants[[:space:]]+where[[:space:]]+id[[:space:]]*=[[:space:]]*item_variant_id[[:space:]]+and[[:space:]]+product_id[[:space:]]*=[[:space:]]*item_product_id[[:space:]]+and[[:space:]]+is_active;$pattern$;
  addon_locked_query_pattern text :=
    $pattern$from public[.]product_addons[[:space:]]+where[[:space:]]+id[[:space:]]*=[[:space:]]*addon_id[[:space:]]+and[[:space:]]+product_id[[:space:]]*=[[:space:]]*item_product_id[[:space:]]+and[[:space:]]+is_active[[:space:]]+for share;$pattern$;
  addon_order_query_pattern text :=
    $pattern$from public[.]product_addons[[:space:]]+where[[:space:]]+id[[:space:]]*=[[:space:]]*addon_id[[:space:]]+and[[:space:]]+product_id[[:space:]]*=[[:space:]]*item_product_id[[:space:]]+and[[:space:]]+is_active;$pattern$;
  addon_snapshot_query_pattern text :=
    $pattern$from public[.]product_addons[[:space:]]+where[[:space:]]+id[[:space:]]*=[[:space:]]*addon_value::uuid[[:space:]]+and[[:space:]]+product_id[[:space:]]*=[[:space:]]*item_product_id[[:space:]]+and[[:space:]]+is_active;$pattern$;
  new_variant_locked_query text :=
    E'from public.product_variants\n      where id = item_variant_id\n        and product_id = item_product_id\n        and is_active\n        and coalesce((\n          select option_setting.is_available\n          from public.branch_product_variant_settings as option_setting\n          where option_setting.branch_id = target_branch_id\n            and option_setting.variant_id = item_variant_id\n        ), true)\n      for share;';
  new_variant_order_query text :=
    E'from public.product_variants\n      where id = item_variant_id\n        and product_id = item_product_id\n        and is_active\n        and coalesce((\n          select option_setting.is_available\n          from public.branch_product_variant_settings as option_setting\n          where option_setting.branch_id = target_branch_id\n            and option_setting.variant_id = item_variant_id\n        ), true);';
  new_addon_locked_query text :=
    E'from public.product_addons\n      where id = addon_id\n        and product_id = item_product_id\n        and is_active\n        and coalesce((\n          select option_setting.is_available\n          from public.branch_product_addon_settings as option_setting\n          where option_setting.branch_id = target_branch_id\n            and option_setting.addon_id = addon_id\n        ), true)\n      for share;';
  new_addon_order_query text :=
    E'from public.product_addons\n      where id = addon_id\n        and product_id = item_product_id\n        and is_active\n        and coalesce((\n          select option_setting.is_available\n          from public.branch_product_addon_settings as option_setting\n          where option_setting.branch_id = target_branch_id\n            and option_setting.addon_id = addon_id\n        ), true);';
  new_addon_snapshot_query text :=
    E'from public.product_addons\n      where id = addon_value::uuid\n        and product_id = item_product_id\n        and is_active\n        and coalesce((\n          select option_setting.is_available\n          from public.branch_product_addon_settings as option_setting\n          where option_setting.branch_id = target_branch_id\n            and option_setting.addon_id = addon_value::uuid\n        ), true);';
  variant_price_count integer;
  addon_total_count integer;
  variant_locked_query_count integer;
  variant_order_query_count integer;
  addon_locked_query_count integer;
  addon_order_query_count integer;
  addon_snapshot_query_count integer;
  promotion_variant_price_count integer;
  remaining_promotion_variant_price_count integer;
  promotion_addon_total_count integer;
  addon_insert_price_count integer;
  variant_availability_count integer;
  addon_availability_count integer;
begin
  order_definition := pg_get_functiondef(
    'public.create_customer_order(uuid,public.order_fulfillment_method,uuid,uuid,text,text,uuid,jsonb)'::regprocedure
  );

  variant_price_count := (
    length(order_definition) - length(replace(order_definition, old_variant_price, ''))
  ) / length(old_variant_price);
  addon_total_count := (
    length(order_definition) - length(replace(order_definition, old_addon_total, ''))
  ) / length(old_addon_total);
  select count(*) into variant_locked_query_count
  from regexp_matches(order_definition, variant_locked_query_pattern, 'g');
  select count(*) into variant_order_query_count
  from regexp_matches(order_definition, variant_order_query_pattern, 'g');
  select count(*) into addon_locked_query_count
  from regexp_matches(order_definition, addon_locked_query_pattern, 'g');
  select count(*) into addon_order_query_count
  from regexp_matches(order_definition, addon_order_query_pattern, 'g');
  select count(*) into addon_snapshot_query_count
  from regexp_matches(order_definition, addon_snapshot_query_pattern, 'g');
  select count(*) into promotion_variant_price_count
  from regexp_matches(order_definition, promotion_variant_price_pattern, 'g');
  promotion_addon_total_count := (
    length(order_definition)
    - length(replace(order_definition, old_promotion_addon_total, ''))
  ) / length(old_promotion_addon_total);
  addon_insert_price_count := (
    length(order_definition) - length(replace(order_definition, old_addon_insert_price, ''))
  ) / length(old_addon_insert_price);

  if variant_price_count <> 2
      or addon_total_count <> 2
      or variant_locked_query_count <> 1
      or variant_order_query_count <> 1
      or addon_locked_query_count <> 1
      or addon_order_query_count <> 1
      or addon_snapshot_query_count <> 1
      or promotion_variant_price_count <> 1
      or promotion_addon_total_count <> 1
      or addon_insert_price_count <> 1 then
    raise exception
      'Could not isolate branch option calculations (variant prices %, add-on totals %, locked variant %, variant order %, locked add-on %, add-on order %, add-on snapshot %, promotion variant %, promotion add-on %, saved add-on %).',
      variant_price_count,
      addon_total_count,
      variant_locked_query_count,
      variant_order_query_count,
      addon_locked_query_count,
      addon_order_query_count,
      addon_snapshot_query_count,
      promotion_variant_price_count,
      promotion_addon_total_count,
      addon_insert_price_count;
  end if;

  order_definition := replace(order_definition, old_variant_price, new_variant_price);
  order_definition := replace(order_definition, old_addon_total, new_addon_total);
  order_definition := regexp_replace(
    order_definition,
    promotion_variant_price_pattern,
    new_promotion_variant_price_expression,
    'g'
  );
  order_definition := replace(order_definition, old_promotion_addon_total, new_promotion_addon_total);
  order_definition := replace(order_definition, old_addon_insert_price, new_addon_insert_price);

  order_definition := regexp_replace(
    order_definition,
    variant_locked_query_pattern,
    new_variant_locked_query
  );
  order_definition := regexp_replace(
    order_definition,
    variant_order_query_pattern,
    new_variant_order_query
  );
  order_definition := regexp_replace(
    order_definition,
    addon_locked_query_pattern,
    new_addon_locked_query
  );
  order_definition := regexp_replace(
    order_definition,
    addon_order_query_pattern,
    new_addon_order_query
  );
  order_definition := regexp_replace(
    order_definition,
    addon_snapshot_query_pattern,
    new_addon_snapshot_query
  );

  variant_availability_count := (
    length(order_definition)
    - length(replace(order_definition, 'from public.branch_product_variant_settings as option_setting', ''))
  ) / length('from public.branch_product_variant_settings as option_setting');
  addon_availability_count := (
    length(order_definition)
    - length(replace(order_definition, 'from public.branch_product_addon_settings as option_setting', ''))
  ) / length('from public.branch_product_addon_settings as option_setting');
  select count(*) into remaining_promotion_variant_price_count
  from regexp_matches(order_definition, promotion_variant_price_pattern, 'g');
  if exists (
      select 1 from regexp_matches(order_definition, variant_locked_query_pattern, 'g')
      union all
      select 1 from regexp_matches(order_definition, variant_order_query_pattern, 'g')
      union all
      select 1 from regexp_matches(order_definition, addon_locked_query_pattern, 'g')
      union all
      select 1 from regexp_matches(order_definition, addon_order_query_pattern, 'g')
      union all
      select 1 from regexp_matches(order_definition, addon_snapshot_query_pattern, 'g')
  ) then
    raise exception 'Branch option availability checks were not applied to every checkout query.';
  end if;

  if position(old_variant_price in order_definition) > 0
      or position(old_addon_total in order_definition) > 0
      or remaining_promotion_variant_price_count <> 0
      or position(old_promotion_addon_total in order_definition) > 0
      or position(old_addon_insert_price in order_definition) > 0
      or variant_availability_count <> 5
      or addon_availability_count <> 6 then
    raise exception 'Branch-specific option price and availability updates were not fully applied.';
  end if;

  execute order_definition;
end;
$$;

-- ============================================================================
-- Migration: 20261021090000_fix_addon_id_ambiguity.sql
-- ============================================================================
-- Fix: column reference "addon_id" is ambiguous (error 42702)
--
-- The 20261021080000 migration patched create_customer_order to add
-- branch_product_addon_settings availability checks. The injected subqueries
-- contain `option_setting.addon_id = addon_id` which is ambiguous: "addon_id"
-- matches both the PL/pgSQL variable AND the table column.
--
-- Fix: replace bare `addon_id` with `addon_value::uuid` which is an equivalent
-- PL/pgSQL variable (addon_id := addon_value::uuid) that has no column namesake.
--
-- Also undo the previous broken fix that used create_customer_order.addon_id.

do $$
declare
  func_body text;
  ambiguous_count integer;
  broken_fix_count integer;
begin
  func_body := pg_get_functiondef(
    'public.create_customer_order(uuid,public.order_fulfillment_method,uuid,uuid,text,text,uuid,jsonb)'::regprocedure
  );

  -- First, undo any previous broken fix (create_customer_order.addon_id -> addon_id)
  broken_fix_count := (
    length(func_body) - length(replace(func_body, 'option_setting.addon_id = create_customer_order.addon_id', ''))
  ) / length('option_setting.addon_id = create_customer_order.addon_id');

  if broken_fix_count > 0 then
    raise notice 'Reverting % broken create_customer_order.addon_id reference(s)...', broken_fix_count;
    func_body := replace(
      func_body,
      'option_setting.addon_id = create_customer_order.addon_id',
      'option_setting.addon_id = addon_id'
    );
  end if;

  -- Count ambiguous occurrences
  ambiguous_count := (
    length(func_body) - length(replace(func_body, 'option_setting.addon_id = addon_id', ''))
  ) / length('option_setting.addon_id = addon_id');

  if ambiguous_count = 0 then
    raise notice 'No ambiguous addon_id references found – function may already be fixed.';
    return;
  end if;

  raise notice 'Found % ambiguous addon_id reference(s). Applying fix...', ambiguous_count;

  -- Replace ambiguous addon_id with addon_value::uuid (equivalent, unambiguous)
  func_body := replace(
    func_body,
    'option_setting.addon_id = addon_id',
    'option_setting.addon_id = addon_value::uuid'
  );

  -- Verify all ambiguous references were resolved
  ambiguous_count := (
    length(func_body) - length(replace(func_body, 'option_setting.addon_id = addon_id', ''))
  ) / length('option_setting.addon_id = addon_id');

  if ambiguous_count <> 0 then
    raise exception 'Failed to fix all ambiguous addon_id references (% remaining).', ambiguous_count;
  end if;

  execute func_body;

  raise notice 'Successfully fixed create_customer_order addon_id ambiguity.';
end;
$$;

notify pgrst, 'reload schema';

-- ============================================================================
-- Migration: 20261021100000_admin_email_access_invites.sql
-- ============================================================================
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

-- ============================================================================
-- Migration: 20261021110000_manual_gcash_payment_override.sql
-- ============================================================================
create table public.payment_manual_override_authorizations (
  transaction_id bigint not null,
  order_id uuid not null references public.orders (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  primary key (transaction_id, order_id)
);

alter table public.payment_manual_override_authorizations enable row level security;
revoke all on public.payment_manual_override_authorizations from public, anon, authenticated;

create or replace function public.guard_gcash_payment_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid'
      and old.status is distinct from new.status
      and new.payment_method_code = 'gcash'
      and not exists (
        select 1
        from public.payment_manual_override_authorizations as override_auth
        where override_auth.transaction_id = pg_catalog.txid_current()
          and override_auth.order_id = new.order_id
          and override_auth.actor_id = (select auth.uid())
      ) then
    if not exists (
      select 1
      from public.order_payment_proofs
      where order_id = new.order_id
        and status = 'approved'
    ) then
      raise exception 'Verify the submitted GCash payment proof before marking this order paid.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.record_manual_gcash_payment_override(
  target_order_id uuid,
  override_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_order public.orders%rowtype;
  normalized_reason text := btrim(override_reason);
begin
  select * into current_order
  from public.orders
  where id = target_order_id
  for update;
  if not found then
    raise exception 'Order not found.';
  end if;

  if not public.is_active_account()
      or not public.can_access_branch(current_order.branch_id)
      or not public.has_permission(current_order.branch_id, 'orders', 'edit') then
    raise exception 'You do not have permission to record this payment.'
      using errcode = '42501';
  end if;

  if current_order.status = 'cancelled' or current_order.payment_status <> 'unpaid' then
    raise exception 'Only unpaid, active orders can be marked paid.';
  end if;

  if normalized_reason is null or length(normalized_reason) not between 3 and 500 then
    raise exception 'Enter a manual override reason between 3 and 500 characters.';
  end if;

  if not exists (
    select 1
    from public.payments
    where order_id = target_order_id
      and payment_method_code = 'gcash'
      and status = 'unpaid'
  ) then
    raise exception 'Manual GCash override is only available for unpaid GCash orders.';
  end if;

  if exists (
    select 1
    from public.order_payment_proofs
    where order_id = target_order_id
  ) then
    raise exception 'Review the submitted GCash proof instead of using manual override.';
  end if;

  insert into public.payment_manual_override_authorizations (
    transaction_id,
    order_id,
    actor_id
  )
  values (pg_catalog.txid_current(), target_order_id, (select auth.uid()));

  perform public.record_order_payment(target_order_id);

  delete from public.payment_manual_override_authorizations
  where transaction_id = pg_catalog.txid_current()
    and order_id = target_order_id
    and actor_id = (select auth.uid());

  insert into public.audit_logs (
    actor_id,
    action,
    record_type,
    record_id,
    branch_id,
    details
  )
  values (
    (select auth.uid()),
    'order_payment_manual_override',
    'order',
    target_order_id,
    current_order.branch_id,
    jsonb_build_object(
      'amount', current_order.total,
      'payment_method', 'gcash',
      'payment_status', 'paid',
      'reason', normalized_reason
    )
  );
end;
$$;

revoke all on function public.record_manual_gcash_payment_override(uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_manual_gcash_payment_override(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
