create or replace function public.admin_delete_inventory_item(target_ingredient_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_ingredient public.ingredients%rowtype;
  deleted_product_recipes integer;
  deleted_option_recipes integer;
  deleted_branch_stock integer;
  deleted_movements integer;
begin
  if not public.is_active_account() or not public.has_role('super_admin') then
    raise exception 'Super Admin permission is required to delete an inventory item.'
      using errcode = '42501';
  end if;

  select * into current_ingredient
  from public.ingredients
  where id = target_ingredient_id
  for update;
  if not found then
    raise exception 'Inventory item not found.';
  end if;

  delete from public.product_recipes
  where ingredient_id = target_ingredient_id;
  get diagnostics deleted_product_recipes = row_count;

  delete from public.product_option_recipes
  where ingredient_id = target_ingredient_id;
  get diagnostics deleted_option_recipes = row_count;

  delete from public.branch_inventory
  where ingredient_id = target_ingredient_id;
  get diagnostics deleted_branch_stock = row_count;

  delete from public.inventory_movements
  where ingredient_id = target_ingredient_id;
  get diagnostics deleted_movements = row_count;

  delete from public.ingredients
  where id = target_ingredient_id;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, details
  )
  values (
    (select auth.uid()),
    'inventory_item_deleted_with_history',
    'ingredient',
    target_ingredient_id,
    jsonb_build_object(
      'name', current_ingredient.name,
      'unit', current_ingredient.unit,
      'deleted_product_recipes', deleted_product_recipes,
      'deleted_option_recipes', deleted_option_recipes,
      'deleted_branch_stock_rows', deleted_branch_stock,
      'deleted_movement_rows', deleted_movements
    )
  );
end;
$$;

revoke all on function public.admin_delete_inventory_item(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_delete_inventory_item(uuid)
  to authenticated;

notify pgrst, 'reload schema';
