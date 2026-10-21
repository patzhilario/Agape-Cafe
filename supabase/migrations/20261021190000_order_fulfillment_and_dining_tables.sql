alter table public.orders
  add column dining_table_id uuid;

create table public.branch_dining_tables (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 40),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index branch_dining_tables_branch_label_key
  on public.branch_dining_tables(branch_id, lower(label));

alter table public.orders
  add constraint orders_dining_table_id_fkey
  foreign key (dining_table_id) references public.branch_dining_tables(id)
  on delete restrict;

create unique index orders_one_active_dine_in_order_per_table
  on public.orders(dining_table_id)
  where dining_table_id is not null
    and status not in ('cancelled', 'completed');

alter table public.branch_dining_tables enable row level security;

create policy "Customers and staff can view available dining tables"
on public.branch_dining_tables for select to authenticated
using (
  is_active
  or public.has_role('super_admin')
  or exists (
    select 1 from public.orders as order_record
    where order_record.dining_table_id = branch_dining_tables.id
      and (
        order_record.customer_id = (select auth.uid())
        or (
          public.can_access_branch(order_record.branch_id)
          and public.has_permission(order_record.branch_id, 'orders', 'view')
        )
      )
  )
);

create policy "Super admins can manage branch dining tables"
on public.branch_dining_tables for all to authenticated
using (public.has_role('super_admin'))
with check (public.has_role('super_admin'));

grant select, insert, update, delete on public.branch_dining_tables to authenticated;

create or replace function public.get_available_dining_tables(target_branch_id uuid)
returns table (id uuid, label text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_active_account() then
    raise exception 'Sign in with an active account to view available tables.'
      using errcode = '42501';
  end if;

  return query
  select dining_table.id, dining_table.label
  from public.branch_dining_tables as dining_table
  join public.branches as branch on branch.id = dining_table.branch_id
  where dining_table.branch_id = target_branch_id
    and dining_table.is_active
    and branch.is_active
    and not exists (
      select 1 from public.orders as order_record
      where order_record.dining_table_id = dining_table.id
        and order_record.status not in ('cancelled', 'completed')
    )
  order by dining_table.label;
end;
$$;

revoke all on function public.get_available_dining_tables(uuid)
  from public, anon, authenticated;
grant execute on function public.get_available_dining_tables(uuid)
  to authenticated;

create or replace function public.create_customer_order_with_table(
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
  customer_delivery_address text default null,
  target_dining_table_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_order public.orders%rowtype;
  created_order_id uuid;
  is_replay boolean := false;
begin
  if current_user_id is null or not public.is_active_account() then
    raise exception 'Sign in with an active account to place an order.'
      using errcode = '42501';
  end if;

  if fulfillment = 'dine_in' and target_dining_table_id is null then
    raise exception 'Choose your dine-in table.';
  end if;
  if fulfillment <> 'dine_in' and target_dining_table_id is not null then
    raise exception 'A dining table can only be selected for dine-in orders.';
  end if;
  if target_benefit_request_id is not null
      and fulfillment not in ('dine_in', 'takeout') then
    raise exception 'PWD and Senior Citizen discounts are only available for orders placed at the café.';
  end if;

  select * into current_order
  from public.orders
  where customer_id = current_user_id
    and orders.client_request_id = create_customer_order_with_table.client_request_id
  for update;
  is_replay := found;

  if is_replay and (
    current_order.fulfillment_method is distinct from fulfillment
    or current_order.delivery_address is distinct from nullif(btrim(customer_delivery_address), '')
    or current_order.dining_table_id is distinct from target_dining_table_id
  ) then
    raise exception 'This order submission key was already used for different fulfillment details.';
  end if;

  if not is_replay and fulfillment = 'dine_in' then
    perform dining_table.id
    from public.branch_dining_tables as dining_table
    join public.branches as branch on branch.id = dining_table.branch_id
    where dining_table.id = target_dining_table_id
      and dining_table.branch_id = target_branch_id
      and dining_table.is_active
      and branch.is_active
    for update of dining_table;

    if not found then
      raise exception 'That table is unavailable. Refresh the table list and choose another.';
    end if;
    if exists (
      select 1 from public.orders as order_record
      where order_record.dining_table_id = target_dining_table_id
        and order_record.status not in ('cancelled', 'completed')
    ) then
      raise exception 'That table has just been reserved. Refresh the table list and choose another.';
    end if;
  end if;

  created_order_id := public.create_customer_order_with_benefit(
    target_branch_id,
    fulfillment,
    payment_method_id,
    client_request_id,
    customer_phone,
    customer_note,
    requested_promotion_id,
    cart_items,
    target_benefit_request_id,
    requested_benefit_type,
    requested_benefit_items,
    uploaded_benefit_document_path,
    customer_delivery_address
  );

  if not is_replay and fulfillment = 'dine_in' then
    update public.orders
    set dining_table_id = target_dining_table_id
    where id = created_order_id;
  end if;

  return created_order_id;
end;
$$;

revoke all on function public.create_customer_order_with_table(
  uuid, public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb,
  uuid, public.benefit_type, jsonb, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.create_customer_order_with_table(
  uuid, public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb,
  uuid, public.benefit_type, jsonb, text, text, uuid
) to authenticated;

revoke all on function public.create_customer_order_with_benefit(
  uuid, public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb,
  uuid, public.benefit_type, jsonb, text, text
) from public, anon, authenticated;

create or replace function public.guard_order_with_pending_benefit_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed'
      and old.status is distinct from new.status
      and exists (
        select 1 from public.benefit_discount_requests
        where order_id = old.id and status = 'pending'
      ) then
    raise exception 'Review or reject the pending benefit discount request before completing this order.';
  end if;

  if new.status = 'cancelled'
      and old.status is distinct from new.status then
    with rejected as (
    update public.benefit_discount_requests
    set status = 'rejected',
        review_note = 'Order was voided before benefit verification.',
        reviewed_by = (select auth.uid()),
        reviewed_at = now()
    where order_id = old.id and status = 'pending'
    returning id, branch_id
    )
    insert into public.audit_logs (
      actor_id, action, record_type, record_id, branch_id, details
    )
    select
      (select auth.uid()),
      'benefit_discount_auto_rejected',
      'benefit_discount_request',
      rejected.id,
      rejected.branch_id,
      jsonb_build_object(
        'order_id', old.id,
        'reason', 'Order was voided before benefit verification.'
      )
    from rejected;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_customer_order_fulfillment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fulfillment_method not in ('dine_in', 'takeout', 'pickup', 'delivery') then
    raise exception 'Choose a supported order type.';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_fulfillment_payment_method()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  order_fulfillment public.order_fulfillment_method;
  order_branch_id uuid;
  method_branch_id uuid;
  method_settlement_type text;
  method_is_active boolean;
  method_qr_path text;
begin
  select order_record.fulfillment_method, order_record.branch_id
  into order_fulfillment, order_branch_id
  from public.orders as order_record
  where order_record.id = new.order_id;
  if not found then
    raise exception 'Payment must belong to an existing order.';
  end if;

  select payment_method.branch_id,
         payment_method.settlement_type,
         payment_method.is_active,
         payment_method.qr_code_path
  into method_branch_id,
       method_settlement_type,
       method_is_active,
       method_qr_path
  from public.payment_methods as payment_method
  where payment_method.id = new.payment_method_id;

  if not found
      or method_branch_id is distinct from order_branch_id
      or not method_is_active then
    raise exception 'Choose an active payment method configured for this branch.';
  end if;

  if method_settlement_type = 'provider' and method_qr_path is null then
    raise exception 'This online payment method does not have a QR code configured.';
  end if;

  if order_fulfillment in ('pickup', 'delivery')
      and (method_settlement_type <> 'provider' or method_qr_path is null) then
    raise exception 'Pick-up and delivery orders require an online QR payment method.';
  end if;

  if order_fulfillment not in ('dine_in', 'takeout', 'pickup', 'delivery') then
    raise exception 'Choose a supported order type.';
  end if;

  return new;
end;
$$;

create or replace function public.guard_order_dining_table_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.dining_table_id is not null and not exists (
    select 1
    from public.branch_dining_tables as dining_table
    where dining_table.id = new.dining_table_id
      and dining_table.branch_id = new.branch_id
      and new.fulfillment_method = 'dine_in'
  ) then
    raise exception 'Choose a table configured for this branch and dine-in order.';
  end if;
  return new;
end;
$$;

create trigger orders_guard_dining_table_assignment
before update of dining_table_id, branch_id, fulfillment_method on public.orders
for each row execute function public.guard_order_dining_table_assignment();

drop trigger if exists payments_enforce_fulfillment_method on public.payments;
create trigger payments_enforce_fulfillment_method
before insert or update of payment_method_id, payment_method_code on public.payments
for each row execute function public.enforce_fulfillment_payment_method();

create or replace function public.guard_onsite_benefit_discount_order()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.orders as order_record
    where order_record.id = new.order_id
      and order_record.fulfillment_method in ('dine_in', 'takeout')
  ) then
    raise exception 'PWD and Senior Citizen discounts are only available for orders placed at the café.';
  end if;
  return new;
end;
$$;

drop trigger if exists benefit_discount_requests_onsite_only
  on public.benefit_discount_requests;
create trigger benefit_discount_requests_onsite_only
before insert or update of order_id on public.benefit_discount_requests
for each row execute function public.guard_onsite_benefit_discount_order();

notify pgrst, 'reload schema';
