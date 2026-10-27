-- Migration: Support cup vs glass selection for drinks and automatic cup inventory deduction

-- 1. Ensure "Cups (Takeout/Disposable)" exists in ingredients
insert into public.ingredients (name, unit, is_active)
values ('Cups (Takeout/Disposable)', 'pcs', true)
on conflict (name) do update
set is_active = true, unit = 'pcs';

-- 2. Add serving_type column to order_items ('cup', 'glass', or null for food/other)
alter table public.order_items
  add column if not exists serving_type text check (serving_type in ('cup', 'glass'));

comment on column public.order_items.serving_type is
  'Specifies the beverage container chosen: "cup" (disposable cup) or "glass" (dine-in glassware).';

-- 3. Trigger on orders when completed: automatically deduct disposable cups used
create or replace function public.deduct_cup_inventory_on_order_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cup_ingredient_id uuid;
  total_cups_used integer;
  current_stock numeric;
begin
  -- Only trigger when transitioning to 'completed'
  if new.status = 'completed' and old.status is distinct from new.status then
    -- Count cups used:
    -- A) Drinks explicitly marked with serving_type = 'cup'
    -- B) Drinks in takeout, pickup, or delivery where serving_type was not set (default takeout container)
    select coalesce(sum(oi.quantity), 0) into total_cups_used
    from public.order_items oi
    left join public.products p on p.id = oi.product_id
    left join public.categories c on c.id = p.category_id
    where oi.order_id = new.id
      and (
        oi.serving_type = 'cup'
        or (
          oi.serving_type is null
          and c.type = 'drink'
          and new.fulfillment_method in ('takeout', 'pickup', 'delivery')
        )
      );

    if total_cups_used > 0 then
      -- Get the cup ingredient id
      select id into cup_ingredient_id
      from public.ingredients
      where name = 'Cups (Takeout/Disposable)'
      limit 1;

      if cup_ingredient_id is not null then
        -- Ensure branch_inventory row exists
        insert into public.branch_inventory (branch_id, ingredient_id, quantity_on_hand)
        values (new.branch_id, cup_ingredient_id, 0)
        on conflict (branch_id, ingredient_id) do nothing;

        -- Update quantity_on_hand (decrease by total_cups_used, but never below 0)
        update public.branch_inventory
        set quantity_on_hand = greatest(0, quantity_on_hand - total_cups_used)
        where branch_id = new.branch_id
          and ingredient_id = cup_ingredient_id;

        -- Record inventory movement
        insert into public.inventory_movements (
          branch_id,
          ingredient_id,
          order_id,
          movement_type,
          quantity_delta,
          note,
          actor_id
        )
        values (
          new.branch_id,
          cup_ingredient_id,
          new.id,
          'order_consumption',
          -total_cups_used,
          'Consumed ' || total_cups_used || ' cup(s) for order ' || new.order_number,
          (select auth.uid())
        );
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_deduct_cup_inventory on public.orders;
create trigger orders_deduct_cup_inventory
  after update of status on public.orders
  for each row
  execute function public.deduct_cup_inventory_on_order_completed();

notify pgrst, 'reload schema';
