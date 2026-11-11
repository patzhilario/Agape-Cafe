-- READ ONLY. Run before and after the cleanup migration in Supabase SQL Editor.
-- Reports schema metadata only, never customer/payment/ID values.

select
  to_regprocedure('public.complete_pos_sale(text,text,public.order_fulfillment_method,uuid,uuid,jsonb,numeric,numeric,numeric,boolean,text,uuid,public.benefit_type,text,text,boolean)') is not null as pos_migrations_ready,
  to_regclass('app_private.store_settings') is not null as cleanup_applied;

select n.nspname as schema_name, count(*) as table_count
from pg_class as c join pg_namespace as n on n.oid=c.relnamespace
where n.nspname in ('public','app_private','app_archive') and c.relkind in ('r','p')
group by n.nspname order by n.nspname;

select n.nspname as schema_name,c.relname as table_name,
  case
    when n.nspname='app_archive' then 'Retained historical data'
    when n.nspname='app_private' then 'Active backend-only table'
    when c.relname=any(array['branch_dining_tables','branch_product_stock','product_recipes','product_option_recipes','inventory_legacy_cost_orders','inventory_manual_closing_settings']) then 'Cleanup candidate: archive, retain rows'
    when c.relname=any(array['store_settings','pending_user_access','payment_manual_override_authorizations','pos_checkout_authorizations','pos_benefit_verifications']) then 'Cleanup candidate: private backend schema'
    when c.relname=any(array['audit_logs','benefit_discount_policy','benefit_discount_request_items','benefit_discount_requests','branch_expenses','branch_inventory','branch_product_addon_settings','branch_product_availability','branch_product_variant_settings','branches','categories','customer_notifications','ingredients','inventory_movements','modules','order_item_addons','order_items','order_payment_proofs','orders','payment_methods','payment_refunds','payments','permissions','product_addons','product_variants','products','profiles','promotion_products','promotion_redemptions','promotions','user_branch_assignments','user_permissions','user_roles']) then 'Required by current app'
    else 'Additional table: review separately, not automatically removed'
  end as classification,
  c.relrowsecurity as rls_enabled,
  nullif(c.reltuples,-1)::bigint as approximate_rows
from pg_class as c join pg_namespace as n on n.oid=c.relnamespace
where n.nspname in ('public','app_private','app_archive') and c.relkind in ('r','p')
order by n.nspname,c.relname;

select p.proname as obsolete_function,pg_get_function_identity_arguments(p.oid) as signature
from pg_proc as p join pg_namespace as n on n.oid=p.pronamespace
where n.nspname='public' and p.proname=any(array[
  'create_customer_order_with_table','get_available_dining_tables','delete_branch_dining_table',
  'guard_order_dining_table_assignment','create_pos_order','admin_set_product_recipe',
  'admin_set_product_option_recipe','get_payment_method_transactions',
  'record_manual_gcash_payment_override','enforce_customer_order_fulfillment'
]) order by p.proname;

select table_schema,table_name,column_name
from information_schema.columns
where table_schema='public' and (
  (table_name='orders' and column_name='dining_table_id')
  or (table_name='branches' and column_name='gcash_qr_path')
);

-- No authenticated/anonymous table grants should remain in the private schemas.
select table_schema,table_name,grantee,privilege_type
from information_schema.table_privileges
where table_schema in ('app_private','app_archive')
  and grantee in ('anon','authenticated','PUBLIC')
order by table_schema,table_name,grantee;

-- Extra view dependencies require review before cleanup.
select view_schema,view_name,table_schema,table_name,column_name
from information_schema.view_column_usage
where table_schema='public' and (
  table_name=any(array['branch_dining_tables','branch_product_stock','product_recipes','product_option_recipes','inventory_legacy_cost_orders','inventory_manual_closing_settings','store_settings','pending_user_access','payment_manual_override_authorizations','pos_checkout_authorizations','pos_benefit_verifications'])
  or (table_name='orders' and column_name='dining_table_id')
  or (table_name='branches' and column_name='gcash_qr_path')
)
order by view_schema,view_name;
