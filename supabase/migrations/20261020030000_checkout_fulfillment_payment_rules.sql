create or replace function public.enforce_customer_order_fulfillment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fulfillment_method not in ('pickup', 'delivery') then
    raise exception 'Choose pick-up or delivery for a customer order.';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_enforce_customer_fulfillment on public.orders;
create trigger orders_enforce_customer_fulfillment
before insert on public.orders
for each row execute function public.enforce_customer_order_fulfillment();

create or replace function public.enforce_fulfillment_payment_method()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  order_fulfillment public.order_fulfillment_method;
begin
  select fulfillment_method
  into order_fulfillment
  from public.orders
  where id = new.order_id;

  if not found then
    raise exception 'Payment must belong to an existing order.';
  end if;

  if order_fulfillment = 'delivery' and new.payment_method_code <> 'gcash' then
    raise exception 'Delivery orders require online GCash payment.';
  end if;

  if order_fulfillment = 'pickup'
      and new.payment_method_code not in ('cash_at_branch', 'gcash') then
    raise exception 'Pick-up orders can be paid by cash or GCash.';
  end if;

  return new;
end;
$$;

drop trigger if exists payments_enforce_fulfillment_method on public.payments;
create trigger payments_enforce_fulfillment_method
before insert or update of payment_method_code on public.payments
for each row execute function public.enforce_fulfillment_payment_method();

notify pgrst, 'reload schema';
