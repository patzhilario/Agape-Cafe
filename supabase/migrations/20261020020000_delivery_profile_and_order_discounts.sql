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
