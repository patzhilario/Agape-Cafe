begin;

create table public.store_settings (
  singleton boolean primary key default true check (singleton),
  branch_id uuid not null unique references public.branches(id) on delete restrict
);
alter table public.store_settings enable row level security;
create policy "Everyone can read the store location"
on public.store_settings for select to anon, authenticated using (true);
revoke all on public.store_settings from public, anon, authenticated;
grant select on public.store_settings to anon, authenticated;

do $$
declare
  selected_store uuid;
begin
  select id into selected_store
  from public.branches
  where name ilike '%calamba%'
  order by is_active desc, created_at, id
  limit 1;

  if selected_store is null then
    select id into selected_store
    from public.branches
    where name not ilike '%batangas%'
    order by is_active desc, created_at, id
    limit 1;
  end if;

  if selected_store is null then
    insert into public.branches (name, address, is_active)
    values ('Agape Cafe', '', true)
    returning id into selected_store;
  end if;

  insert into public.store_settings (branch_id) values (selected_store);
end;
$$;

create function public.get_store_branch_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select branch_id from public.store_settings where singleton;
$$;
revoke all on function public.get_store_branch_id() from public, anon, authenticated;
grant execute on function public.get_store_branch_id() to anon, authenticated;

create function public.get_store_branch()
returns setof public.branches
language sql stable security definer set search_path = ''
as $$
  select branch.* from public.branches as branch
  where branch.id = public.get_store_branch_id();
$$;
revoke all on function public.get_store_branch() from public, anon, authenticated;
grant execute on function public.get_store_branch() to anon, authenticated;

-- Archive the other locations. Historical orders and inventory retain their references.
update public.branches
set is_active = (id = public.get_store_branch_id());

alter table public.branches add constraint branches_single_active_store
check (not is_active or id = public.get_store_branch_id());

revoke insert, delete on public.branches from authenticated;
drop policy if exists "Super admins can manage branches" on public.branches;
create policy "Admins can update the store"
on public.branches for update to authenticated
using (id = public.get_store_branch_id() and public.has_role('admin'))
with check (id = public.get_store_branch_id() and public.has_role('admin'));

lock table public.user_roles, public.user_branch_assignments,
  public.user_permissions, public.pending_user_access in share row exclusive mode;

insert into public.user_branch_assignments (user_id, branch_id)
select distinct user_id, public.get_store_branch_id()
from public.user_roles where role = 'staff'
on conflict (user_id, branch_id) do nothing;

insert into public.user_permissions (user_id, branch_id, permission_id, granted_by)
select permission.user_id, public.get_store_branch_id(),
  permission.permission_id, permission.granted_by
from public.user_permissions as permission
join public.user_branch_assignments as assignment
  on assignment.user_id = permission.user_id
  and assignment.branch_id = public.get_store_branch_id()
where permission.branch_id <> public.get_store_branch_id()
on conflict (user_id, branch_id, permission_id) do nothing;

delete from public.user_branch_assignments
where branch_id <> public.get_store_branch_id();

update public.pending_user_access
set branch_ids = array[public.get_store_branch_id()]
where role = 'staff';

-- Access management always assigns Staff to the one store.
do $$
declare
  definition text;
begin
  for definition in
    select pg_get_functiondef(p.oid)
    from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('admin_set_staff_access', 'admin_invite_user_access')
  loop
    definition := replace(definition,
      'requested_branches uuid[] := coalesce(branch_ids, array[]::uuid[]);',
      'requested_branches uuid[] := case when new_role = ''staff'' then array[public.get_store_branch_id()] else array[]::uuid[] end;');
    execute definition;
  end loop;
end;
$$;

-- Retire dining-table configuration and retain only its historical references.
update public.branch_dining_tables set is_active = false, deleted_at = coalesce(deleted_at, now());
drop trigger if exists orders_guard_dining_table_assignment on public.orders;
drop index if exists public.orders_one_active_dine_in_order_per_table;
revoke all on public.branch_dining_tables from anon, authenticated;
revoke all on function public.get_available_dining_tables(uuid) from public, anon, authenticated;
revoke all on function public.delete_branch_dining_table(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_customer_order_with_table(
  uuid, public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb,
  uuid, public.benefit_type, jsonb, text, text, uuid
) from public, anon, authenticated;

create function public.enforce_store_order()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.branch_id is distinct from public.get_store_branch_id() then
      raise exception 'Orders must belong to the store.';
    end if;
    if new.fulfillment_method not in ('dine_in', 'pickup', 'delivery') then
      raise exception 'Choose Dine-in, Pick-up, or Delivery.';
    end if;
    if new.dining_table_id is not null then
      raise exception 'Table numbers are no longer used.';
    end if;
  else
    if new.branch_id is distinct from old.branch_id
      and new.branch_id is distinct from public.get_store_branch_id() then
      raise exception 'Orders must belong to the store.';
    end if;
    if new.fulfillment_method is distinct from old.fulfillment_method
      and new.fulfillment_method not in ('dine_in', 'pickup', 'delivery') then
      raise exception 'Choose Dine-in, Pick-up, or Delivery.';
    end if;
    if new.dining_table_id is distinct from old.dining_table_id
      and new.dining_table_id is not null then
      raise exception 'Table numbers are no longer used.';
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_enforce_store
before insert or update of branch_id, fulfillment_method, dining_table_id
on public.orders for each row execute function public.enforce_store_order();

create or replace function public.create_store_order(
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
  target_branch_id uuid := public.get_store_branch_id();
  current_order public.orders%rowtype;
  created_order_id uuid;
  is_replay boolean := false;
  legacy_delivery_fee numeric(12, 2) := 0;
begin
  if current_user_id is null or not public.is_active_account() then
    raise exception 'Sign in with an active account to place an order.'
      using errcode = '42501';
  end if;

  if fulfillment is null or fulfillment not in ('dine_in', 'pickup', 'delivery') then
    raise exception 'Choose Dine-in, Pick-up, or Delivery.';
  end if;
  if target_benefit_request_id is not null and fulfillment <> 'dine_in' then
    raise exception 'Benefit discounts are available for Dine-in orders.';
  end if;

  select * into current_order
  from public.orders
  where customer_id = current_user_id
    and orders.client_request_id = create_store_order.client_request_id
  for update;
  is_replay := found;

  if is_replay and (
    current_order.branch_id is distinct from target_branch_id
    or current_order.fulfillment_method is distinct from fulfillment
    or current_order.delivery_address is distinct from nullif(btrim(customer_delivery_address), '')
  ) then
    raise exception 'This order submission key was already used for different fulfillment details.';
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

  if not is_replay and fulfillment = 'delivery' then
    select delivery_fee into legacy_delivery_fee
    from public.orders
    where id = created_order_id
    for update;

    if coalesce(legacy_delivery_fee, 0) > 0 then
      update public.orders
      set total = total - legacy_delivery_fee,
          delivery_fee = 0
      where id = created_order_id;

      update public.payments
      set amount = amount - legacy_delivery_fee
      where order_id = created_order_id;
    end if;
  end if;

  return created_order_id;
end;
$$;

revoke all on function public.create_store_order(
  public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb,
  uuid, public.benefit_type, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.create_store_order(
  public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb,
  uuid, public.benefit_type, jsonb, text, text
) to authenticated;

notify pgrst, 'reload schema';
commit;
