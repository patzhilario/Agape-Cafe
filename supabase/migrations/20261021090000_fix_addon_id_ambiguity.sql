-- Fix: column reference "addon_id" is ambiguous (error 42702)
--
-- The 20261021080000 migration patched create_customer_order to add
-- branch_product_addon_settings availability checks. The injected subqueries
-- contain `option_setting.addon_id = addon_id` which is ambiguous: "addon_id"
-- matches both the PL/pgSQL variable AND the table column.
--
-- Fix: replace bare `addon_id` with `addon_value::uuid` which is an equivalent
-- PL/pgSQL variable (addon_id := addon_value::uuid) that has no column namesake.
--
-- Also undo the previous broken fix that used create_customer_order.addon_id.

do $$
declare
  func_body text;
  ambiguous_count integer;
  broken_fix_count integer;
begin
  func_body := pg_get_functiondef(
    'public.create_customer_order(uuid,public.order_fulfillment_method,uuid,uuid,text,text,uuid,jsonb)'::regprocedure
  );

  -- First, undo any previous broken fix (create_customer_order.addon_id -> addon_id)
  broken_fix_count := (
    length(func_body) - length(replace(func_body, 'option_setting.addon_id = create_customer_order.addon_id', ''))
  ) / length('option_setting.addon_id = create_customer_order.addon_id');

  if broken_fix_count > 0 then
    raise notice 'Reverting % broken create_customer_order.addon_id reference(s)...', broken_fix_count;
    func_body := replace(
      func_body,
      'option_setting.addon_id = create_customer_order.addon_id',
      'option_setting.addon_id = addon_id'
    );
  end if;

  -- Count ambiguous occurrences
  ambiguous_count := (
    length(func_body) - length(replace(func_body, 'option_setting.addon_id = addon_id', ''))
  ) / length('option_setting.addon_id = addon_id');

  if ambiguous_count = 0 then
    raise notice 'No ambiguous addon_id references found – function may already be fixed.';
    return;
  end if;

  raise notice 'Found % ambiguous addon_id reference(s). Applying fix...', ambiguous_count;

  -- Replace ambiguous addon_id with addon_value::uuid (equivalent, unambiguous)
  func_body := replace(
    func_body,
    'option_setting.addon_id = addon_id',
    'option_setting.addon_id = addon_value::uuid'
  );

  -- Verify all ambiguous references were resolved
  ambiguous_count := (
    length(func_body) - length(replace(func_body, 'option_setting.addon_id = addon_id', ''))
  ) / length('option_setting.addon_id = addon_id');

  if ambiguous_count <> 0 then
    raise exception 'Failed to fix all ambiguous addon_id references (% remaining).', ambiguous_count;
  end if;

  execute func_body;

  raise notice 'Successfully fixed create_customer_order addon_id ambiguity.';
end;
$$;

notify pgrst, 'reload schema';
