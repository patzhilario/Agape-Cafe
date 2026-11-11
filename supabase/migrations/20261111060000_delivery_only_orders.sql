begin;

update public.branches
set delivery_enabled = true
where id = public.get_store_branch_id();

alter table public.branches add constraint store_delivery_required
check (id <> public.get_store_branch_id() or delivery_enabled);

create or replace function public.enforce_store_order()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.branch_id is distinct from public.get_store_branch_id() then
      raise exception 'Orders must belong to the store.';
    end if;
    if new.fulfillment_method is distinct from 'delivery'::public.order_fulfillment_method then
      raise exception 'Only delivery orders are available.';
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
      and new.fulfillment_method is distinct from 'delivery'::public.order_fulfillment_method then
      raise exception 'Only delivery orders are available.';
    end if;
    if new.dining_table_id is distinct from old.dining_table_id
      and new.dining_table_id is not null then
      raise exception 'Table numbers are no longer used.';
    end if;
  end if;
  return new;
end;
$$;

-- Preserve the RPC signature, validation, totals and retry behavior.
do $$
declare
  definition text;
  previous_validation text := 'if fulfillment is null or fulfillment not in (''dine_in'', ''pickup'', ''delivery'') then';
begin
  select pg_get_functiondef(oid) into definition
  from pg_proc
  where oid = 'public.create_store_order(public.order_fulfillment_method,uuid,uuid,text,text,uuid,jsonb,uuid,public.benefit_type,jsonb,text,text)'::regprocedure;
  if position(previous_validation in definition) = 0 then
    raise exception 'The single-store checkout migration must be applied before delivery-only ordering.';
  end if;
  definition := replace(definition, previous_validation,
    'if fulfillment is distinct from ''delivery''::public.order_fulfillment_method then');
  definition := replace(definition, 'Choose Dine-in, Pick-up, or Delivery.',
    'Only delivery orders are available.');
  execute definition;
end;
$$;

-- Delivery drinks use disposable cups, including carts saved before this change.
create function public.set_delivery_drink_container()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.orders as order_record
    join public.products as product on product.id = new.product_id
    join public.categories as category on category.id = product.category_id
    where order_record.id = new.order_id
      and order_record.fulfillment_method = 'delivery'
      and category.type = 'drink'
  ) then
    new.serving_type := 'cup';
  end if;
  return new;
end;
$$;
revoke all on function public.set_delivery_drink_container() from public, anon, authenticated;
create trigger order_items_delivery_container
before insert on public.order_items
for each row execute function public.set_delivery_drink_container();

notify pgrst, 'reload schema';
commit;
