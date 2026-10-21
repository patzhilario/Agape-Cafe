create table if not exists public.product_option_recipes (
  variant_id uuid references public.product_variants (id) on delete cascade,
  addon_id uuid references public.product_addons (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete restrict,
  quantity numeric(12, 4) not null check (quantity > 0),
  check ((variant_id is null) <> (addon_id is null))
);

create unique index if not exists product_option_recipes_variant_ingredient_idx
  on public.product_option_recipes (variant_id, ingredient_id)
  where variant_id is not null;
create unique index if not exists product_option_recipes_addon_ingredient_idx
  on public.product_option_recipes (addon_id, ingredient_id)
  where addon_id is not null;

alter table public.product_option_recipes enable row level security;

drop policy if exists "Authorized staff can view product option recipes"
  on public.product_option_recipes;
create policy "Authorized staff can view product option recipes"
on public.product_option_recipes for select to authenticated
using (public.has_role('super_admin') or public.is_active_account());

drop policy if exists "Super admins can manage product option recipes"
  on public.product_option_recipes;
create policy "Super admins can manage product option recipes"
on public.product_option_recipes for all to authenticated
using (public.has_role('super_admin'))
with check (public.has_role('super_admin'));

revoke all on public.product_option_recipes from anon, authenticated;
grant select on public.product_option_recipes to authenticated;

create or replace function public.admin_set_product_option_recipe(
  target_variant_id uuid,
  target_addon_id uuid,
  ingredient_ids uuid[],
  quantities numeric[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('super_admin') then
    raise exception 'Super Admin permission is required to manage recipes.'
      using errcode = '42501';
  end if;

  if (target_variant_id is null) = (target_addon_id is null)
      or cardinality(coalesce(ingredient_ids, array[]::uuid[]))
        <> cardinality(coalesce(quantities, array[]::numeric[]))
      or cardinality(coalesce(ingredient_ids, array[]::uuid[])) > 100 then
    raise exception 'Choose one product size or add-on and provide matching recipe quantities.';
  end if;

  if target_variant_id is not null and cardinality(coalesce(ingredient_ids, array[]::uuid[])) = 0 then
    raise exception 'Add at least one inventory item to the size recipe.';
  end if;

  if exists (
    select 1
    from unnest(coalesce(ingredient_ids, array[]::uuid[])) as ingredient(id)
    where id is null
  ) or exists (
    select 1
    from unnest(coalesce(quantities, array[]::numeric[])) as amount(value)
    where value is null or value <= 0
  ) then
    raise exception 'Recipe inventory items and quantities must be valid and positive.';
  end if;

  if cardinality(coalesce(ingredient_ids, array[]::uuid[])) <>
      (select count(distinct id)
       from unnest(coalesce(ingredient_ids, array[]::uuid[])) as ingredient(id)) then
    raise exception 'A recipe cannot include the same inventory item more than once.';
  end if;

  if exists (
    select 1
    from unnest(coalesce(ingredient_ids, array[]::uuid[])) as ingredient(id)
    left join public.ingredients on ingredients.id = ingredient.id
    where ingredients.id is null or not ingredients.is_active
  ) then
    raise exception 'A recipe inventory item is inactive or does not exist.';
  end if;

  if target_variant_id is not null and not exists (
    select 1 from public.product_variants
    where id = target_variant_id and is_active
  ) then
    raise exception 'The selected product size is inactive or does not exist.';
  end if;
  if target_addon_id is not null and not exists (
    select 1 from public.product_addons
    where id = target_addon_id and is_active
  ) then
    raise exception 'The selected add-on is inactive or does not exist.';
  end if;

  delete from public.product_option_recipes
  where (target_variant_id is not null and variant_id = target_variant_id)
     or (target_addon_id is not null and addon_id = target_addon_id);

  insert into public.product_option_recipes (
    variant_id, addon_id, ingredient_id, quantity
  )
  select target_variant_id, target_addon_id, ingredient.id, amount.value
  from unnest(coalesce(ingredient_ids, array[]::uuid[]))
       with ordinality as ingredient(id, position)
  join unnest(coalesce(quantities, array[]::numeric[]))
       with ordinality as amount(value, position)
    using (position);

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, details
  )
  values (
    (select auth.uid()),
    'product_option_recipe_updated',
    case when target_variant_id is not null then 'product_variant' else 'product_addon' end,
    coalesce(target_variant_id, target_addon_id),
    jsonb_build_object(
      'inventory_item_count', cardinality(coalesce(ingredient_ids, array[]::uuid[]))
    )
  );
end;
$$;

revoke all on function public.admin_set_product_option_recipe(uuid, uuid, uuid[], numeric[])
  from public, anon, authenticated;
grant execute on function public.admin_set_product_option_recipe(uuid, uuid, uuid[], numeric[])
  to authenticated;

do $$
declare
  status_definition text;
  completion_start integer;
  validation_end_marker integer;
  validation_end integer;
  consumption_start integer;
  consumption_end_marker integer;
  consumption_end integer;
  consumption_replace_length integer;
  has_consumption_block boolean;
begin
  status_definition := pg_get_functiondef(
    'public.update_order_status(uuid,public.order_status,text)'::regprocedure
  );

  completion_start := strpos(
    status_definition,
    E'\n  if next_status = ''completed'' then'
  );
  if completion_start = 0 then
    raise exception 'Could not locate the recipe validation in update_order_status.';
  end if;
  validation_end_marker := strpos(
    substring(status_definition from completion_start),
    E'\n  if next_status = ''completed'' then\n    for recipe_stock in'
  );
  if validation_end_marker = 0 then
    validation_end_marker := strpos(
      substring(status_definition from completion_start),
      E'\n  update public.orders'
    );
  end if;
  validation_end := completion_start + validation_end_marker - 1;
  if validation_end_marker = 0 or validation_end <= completion_start then
    raise exception 'Could not isolate the recipe validation in update_order_status.';
  end if;

  status_definition := overlay(
    status_definition placing $recipe_validation$
  if next_status = 'completed' then
    if exists (
      select 1
      from public.order_items as order_item
      where order_item.order_id = target_order_id
        and order_item.product_id is not null
        and (
          (
            order_item.variant_id is null
            and not exists (
              select 1 from public.product_recipes as recipe
              where recipe.product_id = order_item.product_id
            )
          )
          or (
            order_item.variant_id is not null
            and not exists (
              select 1 from public.product_option_recipes as recipe
              where recipe.variant_id = order_item.variant_id
            )
          )
        )
    ) then
      raise exception 'Configure an inventory recipe for every ordered product size before completing this order.';
    end if;

    for recipe_stock in
      select usage.ingredient_id,
             sum(usage.quantity_used)::numeric(14, 4) as quantity_used
      from (
        select recipe.ingredient_id,
               sum(recipe.quantity * order_item.quantity)::numeric(14, 4) as quantity_used
        from public.order_items as order_item
        join public.product_recipes as recipe
          on recipe.product_id = order_item.product_id
        where order_item.order_id = target_order_id
          and order_item.variant_id is null
        group by recipe.ingredient_id

        union all

        select recipe.ingredient_id,
               sum(recipe.quantity * order_item.quantity)::numeric(14, 4) as quantity_used
        from public.order_items as order_item
        join public.product_option_recipes as recipe
          on recipe.variant_id = order_item.variant_id
        where order_item.order_id = target_order_id
          and order_item.variant_id is not null
        group by recipe.ingredient_id

        union all

        select recipe.ingredient_id,
               sum(recipe.quantity * order_item.quantity)::numeric(14, 4) as quantity_used
        from public.order_items as order_item
        join public.order_item_addons as order_addon
          on order_addon.order_item_id = order_item.id
        join public.product_option_recipes as recipe
          on recipe.addon_id = order_addon.addon_id
        where order_item.order_id = target_order_id
        group by recipe.ingredient_id
      ) as usage
      group by usage.ingredient_id
      order by usage.ingredient_id
    loop
      perform 1 from public.branch_inventory
      where branch_id = current_order.branch_id
        and ingredient_id = recipe_stock.ingredient_id
      for update;
      if not found then
        raise exception 'Inventory is not configured for an item used by this order at the selected branch.';
      end if;

      if not exists (
        select 1 from public.branch_inventory
        where branch_id = current_order.branch_id
          and ingredient_id = recipe_stock.ingredient_id
          and quantity_on_hand >= recipe_stock.quantity_used
      ) then
        raise exception 'There is not enough branch inventory to complete this order.';
      end if;
    end loop;
  end if;
$recipe_validation$
    from completion_start
    for validation_end - completion_start
  );

  consumption_start := strpos(
    status_definition,
    E'\n  if next_status = ''completed'' then\n    for recipe_stock in'
  );
  has_consumption_block := consumption_start > 0;
  if consumption_start = 0 then
    consumption_start := strpos(status_definition, E'\n  update public.orders');
    if consumption_start = 0 then
      raise exception 'Could not locate inventory deduction insertion point in update_order_status.';
    end if;
    consumption_end := consumption_start;
    consumption_replace_length := 0;
  else
    consumption_end_marker := strpos(
      substring(status_definition from consumption_start),
      E'\n  update public.orders'
    );
    consumption_end := consumption_start + consumption_end_marker - 1;
    if consumption_end_marker = 0 or consumption_end <= consumption_start then
      raise exception 'Could not isolate inventory deduction in update_order_status.';
    end if;
    consumption_replace_length := consumption_end - consumption_start;
  end if;

  status_definition := overlay(
    status_definition placing $recipe_consumption$
  if next_status = 'completed' then
    for recipe_stock in
      select usage.ingredient_id,
             sum(usage.quantity_used)::numeric(14, 4) as quantity_used
      from (
        select recipe.ingredient_id,
               sum(recipe.quantity * order_item.quantity)::numeric(14, 4) as quantity_used
        from public.order_items as order_item
        join public.product_recipes as recipe
          on recipe.product_id = order_item.product_id
        where order_item.order_id = target_order_id
          and order_item.variant_id is null
        group by recipe.ingredient_id

        union all

        select recipe.ingredient_id,
               sum(recipe.quantity * order_item.quantity)::numeric(14, 4) as quantity_used
        from public.order_items as order_item
        join public.product_option_recipes as recipe
          on recipe.variant_id = order_item.variant_id
        where order_item.order_id = target_order_id
          and order_item.variant_id is not null
        group by recipe.ingredient_id

        union all

        select recipe.ingredient_id,
               sum(recipe.quantity * order_item.quantity)::numeric(14, 4) as quantity_used
        from public.order_items as order_item
        join public.order_item_addons as order_addon
          on order_addon.order_item_id = order_item.id
        join public.product_option_recipes as recipe
          on recipe.addon_id = order_addon.addon_id
        where order_item.order_id = target_order_id
        group by recipe.ingredient_id
      ) as usage
      group by usage.ingredient_id
      order by usage.ingredient_id
    loop
      perform 1 from public.branch_inventory
      where branch_id = current_order.branch_id
        and ingredient_id = recipe_stock.ingredient_id
      for update;
      if not found then
        raise exception 'Inventory is not configured for an item used by this order at the selected branch.';
      end if;

      update public.branch_inventory
      set quantity_on_hand = quantity_on_hand - recipe_stock.quantity_used
      where branch_id = current_order.branch_id
        and ingredient_id = recipe_stock.ingredient_id
        and quantity_on_hand >= recipe_stock.quantity_used;
      if not found then
        raise exception 'There is not enough branch inventory to complete this order.';
      end if;

      insert into public.inventory_movements (
        branch_id, ingredient_id, order_id, movement_type, quantity_delta,
        note, actor_id
      )
      values (
        current_order.branch_id, recipe_stock.ingredient_id, target_order_id,
        'order_consumption', -recipe_stock.quantity_used,
        'Consumed for order ' || current_order.order_number, (select auth.uid())
      );
    end loop;
  end if;
$recipe_consumption$
    from consumption_start
    for consumption_replace_length
  );

  if position('branch_product_stock' in status_definition) > 0 then
    raise exception 'Unexpected finished-product stock checks remain in update_order_status.';
  end if;
  execute status_definition;
end;
$$;

notify pgrst, 'reload schema';
