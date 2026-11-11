begin;

alter table public.orders
  alter column customer_id drop not null,
  add column order_source text not null default 'online' check (order_source in ('online', 'pos')),
  add column cashier_id uuid references public.profiles(id) on delete restrict,
  add column pos_request_fingerprint text,
  add constraint orders_source_identity_check check (
    (order_source = 'online' and customer_id is not null and cashier_id is null)
    or (order_source = 'pos' and customer_id is null and cashier_id is not null)
  );
create unique index orders_pos_request_key on public.orders(cashier_id, client_request_id)
where order_source = 'pos';

-- Walk-in orders have no customer account to notify. Online notifications stay intact.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.notify_customer_order_update()'::regprocedure) into definition;
  definition := replace(definition,
    '  insert into public.customer_notifications(',
    '  if order_record.customer_id is null then return new; end if;
  insert into public.customer_notifications(');
  execute definition;
end;
$$;

create function public.create_pos_order(
  guest_name text,
  guest_phone text,
  fulfillment public.order_fulfillment_method,
  method_id uuid,
  request_id uuid,
  cart_items jsonb,
  receipt_path text,
  expected_delivery_fee numeric,
  delivery_address text default null,
  mark_paid boolean default false
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  cashier uuid := (select auth.uid());
  store_id uuid := public.get_store_branch_id();
  created_id uuid;
  previous_order public.orders%rowtype;
  fingerprint text;
begin
  if cashier is null or not public.is_active_account()
    or not (public.has_role('admin') or (
      public.has_role('staff')
      and public.has_permission(store_id, 'orders', 'view')
      and public.has_permission(store_id, 'orders', 'create')
    )) then
    raise exception 'Staff need Orders view and create permission to use POS.' using errcode = '42501';
  end if;
  if mark_paid and not public.has_permission(store_id, 'orders', 'edit') then
    raise exception 'Orders edit permission is required to verify a payment.' using errcode = '42501';
  end if;
  if guest_name is null or length(btrim(guest_name)) not between 1 and 120 then
    raise exception 'Enter a customer name between 1 and 120 characters.';
  end if;
  if request_id is null then raise exception 'Submit a valid POS request.'; end if;
  if fulfillment is null or fulfillment not in ('dine_in', 'pickup', 'delivery') then
    raise exception 'Choose Dine-in, Pick-up, or Delivery.';
  end if;

  fingerprint := md5(jsonb_build_object(
    'name', btrim(guest_name), 'phone', btrim(guest_phone), 'fulfillment', fulfillment,
    'method', method_id, 'items', cart_items, 'receipt', receipt_path,
    'fee', expected_delivery_fee, 'address', nullif(btrim(delivery_address), ''), 'paid', mark_paid
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(cashier::text || ':' || request_id::text, 0));
  select * into previous_order from public.orders
  where cashier_id = cashier and client_request_id = request_id and order_source = 'pos'
  for update;
  if found then
    if previous_order.pos_request_fingerprint is distinct from fingerprint then
      raise exception 'This POS request was already used for different sale details.';
    end if;
    return previous_order.id;
  end if;
  if exists (select 1 from public.orders where customer_id = cashier and client_request_id = request_id) then
    raise exception 'This request was already used for an online order.';
  end if;

  if receipt_path is null or receipt_path !~* '\.jpe?g$'
    or split_part(receipt_path, '/', 1) <> cashier::text
    or split_part(receipt_path, '/', 2) <> request_id::text
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'order-payment-proofs' and name = receipt_path
        and owner_id = cashier::text and metadata ->> 'mimetype' = 'image/jpeg'
    ) then
    raise exception 'Upload a JPEG receipt under your own POS sale folder.';
  end if;

  -- Reuse the same server pricing, stock reservation, fee and e-payment checks.
  created_id := public.create_store_order(
    fulfillment, method_id, request_id, guest_phone, '', null, cart_items,
    null, null, null, null, delivery_address, expected_delivery_fee
  );
  update public.orders
  set customer_id = null, customer_name = btrim(guest_name), customer_email = null,
      order_source = 'pos', cashier_id = cashier, pos_request_fingerprint = fingerprint
  where id = created_id;
  insert into public.order_payment_proofs(
    order_id, customer_id, branch_id, document_path, status
  ) values(created_id, cashier, store_id, receipt_path, 'pending');
  if mark_paid then
    perform public.review_order_payment_proof(created_id, 'approved', 'Payment verified at POS.');
  end if;
  insert into public.audit_logs(actor_id, branch_id, action, record_type, record_id, details)
  values(cashier, store_id, 'pos_order_created', 'order', created_id,
    jsonb_build_object('customer_name', btrim(guest_name), 'payment_verified', mark_paid));
  return created_id;
end;
$$;
revoke all on function public.create_pos_order(
  text, text, public.order_fulfillment_method, uuid, uuid, jsonb, text, numeric, text, boolean
) from public, anon, authenticated;
grant execute on function public.create_pos_order(
  text, text, public.order_fulfillment_method, uuid, uuid, jsonb, text, numeric, text, boolean
) to authenticated;

notify pgrst, 'reload schema';
commit;
