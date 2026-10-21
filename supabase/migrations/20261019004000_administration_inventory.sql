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
