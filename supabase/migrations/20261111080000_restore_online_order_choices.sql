begin;

-- Restore the three online fulfillment choices, keeping the store/table rules.
create or replace function public.enforce_store_order()
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

do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.create_store_order(public.order_fulfillment_method,uuid,uuid,text,text,uuid,jsonb,uuid,public.benefit_type,jsonb,text,text)'::regprocedure)
  into definition;
  definition := replace(definition,
    'if fulfillment is distinct from ''delivery''::public.order_fulfillment_method then',
    'if fulfillment is null or fulfillment not in (''dine_in'', ''pickup'', ''delivery'') then');
  definition := replace(definition, 'Only delivery orders are available.',
    'Choose Dine-in, Pick-up, or Delivery.');
  execute definition;

  select pg_get_functiondef('public.notify_customer_order_update()'::regprocedure)
  into definition;
  definition := replace(definition, ''' is ready for delivery.'';',
    ''' is ready'' || case new.fulfillment_method when ''delivery'' then '' for delivery'' when ''pickup'' then '' for pick-up'' else '' to serve'' end || ''.'';');
  execute definition;
end;
$$;

notify pgrst, 'reload schema';
commit;
