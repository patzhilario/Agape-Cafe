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
