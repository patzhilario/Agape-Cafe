begin;

-- Start with free delivery, preserving the previous checkout behavior.
-- Existing orders retain their saved delivery fees and totals.
update public.branches set delivery_fee = 0
where id = public.get_store_branch_id();

-- Remove the old zero-delivery total check, whose generated name can vary.
-- The current total = subtotal - discount_total + delivery_fee check remains.
do $$
declare
  legacy_constraint text;
begin
  for legacy_constraint in
    select conname from pg_constraint
    where conrelid = 'public.orders'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ~ '\mtotal\M'
      and pg_get_constraintdef(oid) ~ '\msubtotal\M'
      and pg_get_constraintdef(oid) ~ '\mdiscount_total\M'
      and pg_get_constraintdef(oid) !~ '\mdelivery_fee\M'
  loop
    execute format('alter table public.orders drop constraint %I', legacy_constraint);
  end loop;
end;
$$;

drop function public.create_store_order(
  public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb,
  uuid, public.benefit_type, jsonb, text, text
);

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
  customer_delivery_address text default null,
  expected_delivery_fee numeric default null
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
  configured_delivery_fee numeric(10, 2);
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

  if client_request_id is null then
    raise exception 'Sign in and submit a valid order request.';
  end if;
  -- Serialize retries before checking for the saved order and current fee.
  perform pg_advisory_xact_lock(
    hashtextextended(current_user_id::text || ':' || client_request_id::text, 0)
  );

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

  if not is_replay and fulfillment = 'delivery' then
    select branch.delivery_fee into configured_delivery_fee
    from public.branches as branch
    where branch.id = target_branch_id and branch.is_active
    for share;
    if not found then
      raise exception 'This branch is not accepting orders.';
    end if;
    if expected_delivery_fee is null or expected_delivery_fee is distinct from configured_delivery_fee then
      raise exception 'Delivery fee changed. Review the updated total. If you already paid, contact the store before submitting.';
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

  return created_order_id;
end;
$$;

revoke all on function public.create_store_order(
  public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb,
  uuid, public.benefit_type, jsonb, text, text, numeric
) from public, anon, authenticated;
grant execute on function public.create_store_order(
  public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb,
  uuid, public.benefit_type, jsonb, text, text, numeric
) to authenticated;

notify pgrst, 'reload schema';
commit;
