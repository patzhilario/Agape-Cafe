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
