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
