do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select constraint_info.conname
    from pg_catalog.pg_constraint as constraint_info
    where constraint_info.conrelid = 'public.inventory_movements'::regclass
      and constraint_info.contype = 'c'
      and position('movement_type' in pg_catalog.pg_get_constraintdef(constraint_info.oid)) > 0
      and position('quantity_delta' in pg_catalog.pg_get_constraintdef(constraint_info.oid)) > 0
      and position('receipt' in pg_catalog.pg_get_constraintdef(constraint_info.oid)) > 0
      and position('waste' in pg_catalog.pg_get_constraintdef(constraint_info.oid)) > 0
  loop
    execute format(
      'alter table public.inventory_movements drop constraint %I',
      constraint_record.conname
    );
  end loop;
end;
$$;

alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_quantity_check;

alter table public.inventory_movements
  add constraint inventory_movements_movement_quantity_check
  check (
    (movement_type = 'receipt' and quantity_delta > 0)
    or (movement_type in ('waste', 'manual_usage', 'order_consumption') and quantity_delta < 0)
    or movement_type = 'adjustment'
  );
