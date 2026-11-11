begin;

-- Keep historical payment references, but retire cash and unconfigured methods.
update public.payment_methods
set is_active = false
where settlement_type <> 'provider'
   or nullif(btrim(qr_code_path), '') is null;

alter table public.payment_methods
  add constraint payment_methods_active_epayment_only
  check (
    not is_active
    or (settlement_type = 'provider' and nullif(btrim(qr_code_path), '') is not null)
  );

-- This guard covers every order type and every API that creates a payment.
-- Status-only updates to historical payments remain possible.
create or replace function public.enforce_fulfillment_payment_method()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  order_branch_id uuid;
begin
  select branch_id into order_branch_id
  from public.orders where id = new.order_id;
  if not found then
    raise exception 'Payment must belong to an existing order.';
  end if;

  if not exists (
    select 1 from public.payment_methods as method
    where method.id = new.payment_method_id
      and method.branch_id = order_branch_id
      and method.is_active
      and method.settlement_type = 'provider'
      and nullif(btrim(method.qr_code_path), '') is not null
  ) then
    raise exception 'All orders require an active e-payment method with a QR code.';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
commit;
