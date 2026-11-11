begin;

-- This is a forward-only cleanup after the integrated POS migration.
-- No business rows are deleted, and no DROP ... CASCADE is used.
do $$
declare unexpected text;
begin
  if to_regprocedure('public.complete_pos_sale(text,text,public.order_fulfillment_method,uuid,uuid,jsonb,numeric,numeric,numeric,boolean,text,uuid,public.benefit_type,text,text,boolean)') is null then
    raise exception 'Apply all migrations through 20261111110000_pos_counter_checkout.sql before schema cleanup.';
  end if;
  select string_agg(p.proname, ', ' order by p.proname) into unexpected
  from pg_proc as p join pg_namespace as n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and p.prosrc ~ '\m(branch_dining_tables|branch_product_stock|product_recipes|product_option_recipes|inventory_legacy_cost_orders|inventory_manual_closing_settings|store_settings|pending_user_access|payment_manual_override_authorizations|pos_checkout_authorizations|pos_benefit_verifications|dining_table_id|gcash_qr_path)\M'
    and p.proname <> all(array[
      'admin_delete_inventory_item','admin_delete_user_account','admin_invite_user_access',
      'admin_set_product_option_recipe','admin_set_product_recipe','complete_pos_sale',
      'create_customer_order_with_table','create_pos_order','delete_branch_dining_table',
      'enforce_fulfillment_payment_method','get_available_dining_tables',
      'get_financial_report_with_payments','get_store_branch_id',
      'guard_gcash_payment_verification','guard_order_dining_table_assignment',
      'handle_new_auth_user','record_manual_gcash_payment_override',
      'record_manual_provider_payment_override','audit_branch_changes','enforce_store_order'
    ]);
  if unexpected is not null then
    raise exception 'Cleanup stopped: additional function dependencies require review: %', unexpected;
  end if;
  select string_agg(distinct format('%I.%I',view_schema.nspname,view_relation.relname), ', ')
  into unexpected
  from pg_depend as dependency
  join pg_rewrite as rewrite on dependency.classid='pg_rewrite'::regclass and rewrite.oid=dependency.objid
  join pg_class as view_relation on view_relation.oid=rewrite.ev_class and view_relation.relkind in ('v','m')
  join pg_namespace as view_schema on view_schema.oid=view_relation.relnamespace
  join pg_class as target on dependency.refclassid='pg_class'::regclass and target.oid=dependency.refobjid
  join pg_namespace as target_schema on target_schema.oid=target.relnamespace
  left join pg_attribute as column_record on column_record.attrelid=target.oid and column_record.attnum=dependency.refobjsubid
  where target_schema.nspname='public' and (
    target.relname=any(array['branch_dining_tables','branch_product_stock','product_recipes','product_option_recipes','inventory_legacy_cost_orders','inventory_manual_closing_settings','store_settings','pending_user_access','payment_manual_override_authorizations','pos_checkout_authorizations','pos_benefit_verifications'])
    or (target.relname='orders' and column_record.attname='dining_table_id')
    or (target.relname='branches' and column_record.attname='gcash_qr_path')
  );
  if unexpected is not null then
    raise exception 'Cleanup stopped: view dependencies require review: %', unexpected;
  end if;
end;
$$;

create schema if not exists app_archive;
create schema if not exists app_private;
revoke all on schema app_archive, app_private from public, anon, authenticated;

create table app_archive.retired_fields (
  source_table text not null check (source_table in ('orders','branches')),
  record_id uuid not null,
  fields jsonb not null,
  archived_at timestamptz not null default now(),
  primary key(source_table,record_id)
);
alter table app_archive.retired_fields enable row level security;
revoke all on app_archive.retired_fields from public, anon, authenticated;

-- Retain the exact old table assignment and QR path before removing columns.
insert into app_archive.retired_fields(source_table,record_id,fields)
select 'orders',id,jsonb_build_object('dining_table_id',dining_table_id)
from public.orders where dining_table_id is not null;
insert into app_archive.retired_fields(source_table,record_id,fields)
select 'branches',id,jsonb_build_object('gcash_qr_path',gcash_qr_path)
from public.branches where gcash_qr_path is not null;

-- Keep legacy GCash images usable through the current payment-method model.
update public.payment_methods as method
set qr_code_path=branch.gcash_qr_path
from public.branches as branch
where method.branch_id=branch.id and method.code='gcash'
  and method.qr_code_path is null and branch.gcash_qr_path is not null;

drop function public.create_customer_order_with_table(
  uuid,public.order_fulfillment_method,uuid,uuid,text,text,uuid,jsonb,
  uuid,public.benefit_type,jsonb,text,text,uuid
);
drop function public.get_available_dining_tables(uuid);
drop function public.delete_branch_dining_table(uuid,uuid);
drop trigger if exists orders_guard_dining_table_assignment on public.orders;
drop function public.guard_order_dining_table_assignment();
drop policy if exists "Customers and staff can view available dining tables" on public.branch_dining_tables;
drop function public.create_pos_order(text,text,public.order_fulfillment_method,uuid,uuid,jsonb,text,numeric,text,boolean);
drop function public.admin_set_product_recipe(uuid,uuid[],numeric[]);
drop function public.admin_set_product_option_recipe(uuid,uuid,uuid[],numeric[]);
drop function public.get_payment_method_transactions(uuid,date,date,integer,integer);
drop function public.record_manual_gcash_payment_override(uuid,text);

-- The stricter store guard already covers fulfillment validation.
drop trigger orders_enforce_customer_fulfillment on public.orders;
drop function public.enforce_customer_order_fulfillment();
drop trigger orders_enforce_store on public.orders;
create or replace function public.enforce_store_order()
returns trigger language plpgsql set search_path=''
as $$
begin
  if tg_op='INSERT' then
    if new.branch_id is distinct from public.get_store_branch_id() then
      raise exception 'Orders must belong to the store.';
    end if;
    if new.fulfillment_method not in ('dine_in','pickup','delivery') then
      raise exception 'Choose Dine-in, Pick-up, or Delivery.';
    end if;
  else
    if new.branch_id is distinct from old.branch_id and new.branch_id is distinct from public.get_store_branch_id() then
      raise exception 'Orders must belong to the store.';
    end if;
    if new.fulfillment_method is distinct from old.fulfillment_method and new.fulfillment_method not in ('dine_in','pickup','delivery') then
      raise exception 'Choose Dine-in, Pick-up, or Delivery.';
    end if;
  end if;
  return new;
end;
$$;
create trigger orders_enforce_store
before insert or update of branch_id,fulfillment_method on public.orders
for each row execute function public.enforce_store_order();
alter table public.orders drop column dining_table_id;

create or replace function public.audit_branch_changes()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.audit_logs(actor_id,action,record_type,record_id,details)
  values((select auth.uid()),case when tg_op='INSERT' then 'branch_created' else 'branch_updated' end,
    'branch',new.id,jsonb_build_object('name',new.name,'is_active',new.is_active,
      'delivery_enabled',new.delivery_enabled,'delivery_fee',new.delivery_fee));
  return new;
end;
$$;
alter table public.branches drop column gcash_qr_path;

-- Retired configuration and inventory-cutover history are outside the API schema.
alter table public.branch_dining_tables set schema app_archive;
alter table public.branch_product_stock set schema app_archive;
alter table public.product_recipes set schema app_archive;
alter table public.product_option_recipes set schema app_archive;
alter table public.inventory_legacy_cost_orders set schema app_archive;
alter table public.inventory_manual_closing_settings set schema app_archive;
revoke all on all tables in schema app_archive from public,anon,authenticated;
revoke all on all sequences in schema app_archive from public,anon,authenticated;

-- These are active implementation/security tables, not obsolete data.
alter table public.store_settings set schema app_private;
alter table public.pending_user_access set schema app_private;
alter table public.payment_manual_override_authorizations set schema app_private;
alter table public.pos_checkout_authorizations set schema app_private;
alter table public.pos_benefit_verifications set schema app_private;
revoke all on all tables in schema app_private from public,anon,authenticated;
revoke all on all sequences in schema app_private from public,anon,authenticated;

-- Preserve public RPC signatures/ACLs while redirecting their internal queries.
-- PostgreSQL updates FK dependencies automatically when a table changes schema.
do $$
declare definition text; target text;
begin
  for definition in
    select pg_get_functiondef(p.oid) from pg_proc as p join pg_namespace as n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and p.proname=any(array[
      'admin_delete_inventory_item','admin_delete_user_account','admin_invite_user_access',
      'complete_pos_sale','enforce_fulfillment_payment_method','get_financial_report_with_payments',
      'get_store_branch_id','guard_gcash_payment_verification','handle_new_auth_user',
      'record_manual_provider_payment_override'
    ])
  loop
    foreach target in array array['product_recipes','product_option_recipes','inventory_legacy_cost_orders'] loop
      definition:=replace(definition,'public.'||target,'app_archive.'||target);
    end loop;
    foreach target in array array['store_settings','pending_user_access','payment_manual_override_authorizations','pos_checkout_authorizations','pos_benefit_verifications'] loop
      definition:=replace(definition,'public.'||target,'app_private.'||target);
    end loop;
    execute definition;
  end loop;
end;
$$;

do $$
declare unresolved text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into unresolved
  from pg_proc as p join pg_namespace as n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and (
    p.prosrc ~ '\mpublic\.(branch_dining_tables|branch_product_stock|product_recipes|product_option_recipes|inventory_legacy_cost_orders|inventory_manual_closing_settings|store_settings|pending_user_access|payment_manual_override_authorizations|pos_checkout_authorizations|pos_benefit_verifications)\M'
    or p.prosrc ~ '\m(dining_table_id|gcash_qr_path)\M'
  );
  if unresolved is not null then
    raise exception 'Cleanup stopped: unresolved legacy references in functions: %', unresolved;
  end if;
end;
$$;

comment on schema app_archive is 'Retired configuration and historical cutover data; not exposed to the app API.';
comment on schema app_private is 'Active backend-only configuration and security records; use public RPCs.';
comment on table public.branches is 'Store location records. Store settings select the single operational location; inactive locations preserve historical references.';

notify pgrst,'reload schema';
commit;
