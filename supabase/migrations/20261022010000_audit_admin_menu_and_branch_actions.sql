-- 20261022010000_audit_admin_menu_and_branch_actions.sql
-- Trigger functions to log all admin and staff changes to menu products, categories, and branch availability

create or replace function public.audit_category_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is not null then
    insert into public.audit_logs (
      actor_id, action, record_type, record_id, details
    )
    values (
      actor,
      case
        when tg_op = 'INSERT' then 'category_created'
        when tg_op = 'DELETE' then 'category_deleted'
        else 'category_updated'
      end,
      'category',
      case when tg_op = 'DELETE' then old.id else new.id end,
      case
        when tg_op = 'DELETE' then jsonb_build_object('name', old.name)
        when tg_op = 'INSERT' then jsonb_build_object('name', new.name, 'is_published', new.is_published)
        else jsonb_build_object(
          'name', new.name,
          'previous_name', old.name,
          'is_published', new.is_published,
          'previous_published', old.is_published
        )
      end
    );
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists categories_audit_changes on public.categories;
create trigger categories_audit_changes
after insert or update or delete on public.categories
for each row execute function public.audit_category_changes();

create or replace function public.audit_product_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is not null then
    insert into public.audit_logs (
      actor_id, action, record_type, record_id, details
    )
    values (
      actor,
      case
        when tg_op = 'INSERT' then 'product_created'
        when tg_op = 'DELETE' then 'product_deleted'
        else 'product_updated'
      end,
      'product',
      case when tg_op = 'DELETE' then old.id else new.id end,
      case
        when tg_op = 'DELETE' then jsonb_build_object('name', old.name, 'sku', old.sku)
        when tg_op = 'INSERT' then jsonb_build_object('name', new.name, 'sku', new.sku, 'price', new.price, 'is_published', new.is_published)
        else jsonb_build_object(
          'name', new.name,
          'price', new.price,
          'previous_price', old.price,
          'is_published', new.is_published,
          'previous_published', old.is_published,
          'is_featured', new.is_featured
        )
      end
    );
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists products_audit_changes on public.products;
create trigger products_audit_changes
after insert or update or delete on public.products
for each row execute function public.audit_product_changes();

create or replace function public.audit_branch_product_availability_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  prod_name text;
begin
  if actor is not null then
    select name into prod_name from public.products where id = coalesce(new.product_id, old.product_id);
    insert into public.audit_logs (
      actor_id, action, record_type, record_id, branch_id, details
    )
    values (
      actor,
      case
        when tg_op = 'INSERT' then 'branch_menu_item_configured'
        when tg_op = 'DELETE' then 'branch_menu_item_removed'
        else 'branch_menu_item_updated'
      end,
      'branch_menu',
      coalesce(new.product_id, old.product_id),
      coalesce(new.branch_id, old.branch_id),
      case
        when tg_op = 'DELETE' then jsonb_build_object('product_name', prod_name)
        when tg_op = 'INSERT' then jsonb_build_object(
          'product_name', prod_name,
          'is_available', new.is_available,
          'price_override', new.price_override
        )
        else jsonb_build_object(
          'product_name', prod_name,
          'is_available', new.is_available,
          'previous_available', old.is_available,
          'price_override', new.price_override,
          'previous_price_override', old.price_override
        )
      end
    );
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists branch_product_availability_audit on public.branch_product_availability;
create trigger branch_product_availability_audit
after insert or update or delete on public.branch_product_availability
for each row execute function public.audit_branch_product_availability_changes();

-- Allow branch_admins and staff to view audit logs for their assigned branch(es)
drop policy if exists "Super admins can view audit logs" on public.audit_logs;
drop policy if exists "Users can view audit logs" on public.audit_logs;

create policy "Users can view audit logs"
on public.audit_logs for select to authenticated
using (
  public.has_role('super_admin')
  or (
    branch_id is not null
    and public.can_access_branch(branch_id)
  )
);

notify pgrst, 'reload schema';
