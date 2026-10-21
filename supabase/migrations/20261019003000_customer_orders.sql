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
