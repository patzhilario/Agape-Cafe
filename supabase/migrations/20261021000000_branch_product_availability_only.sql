do $$
declare
  order_definition text;
  status_definition text;
  stock_block_start integer;
  stock_block_end_marker integer;
  stock_block_end integer;
begin
  order_definition := pg_get_functiondef(
    'public.create_customer_order(uuid,public.order_fulfillment_method,uuid,uuid,text,text,uuid,jsonb)'::regprocedure
  );

  if position('item_stock public.branch_product_stock%rowtype' in order_definition) = 0
      or position('quantity_reserved = quantity_reserved + item_quantity' in order_definition) = 0 then
    raise exception 'Could not locate the expected product stock checks in create_customer_order.';
  end if;

  order_definition := replace(
    order_definition,
    $stock_declaration$  item_stock public.branch_product_stock%rowtype;
  requested_product_quantity integer;
$stock_declaration$,
    ''
  );
  order_definition := replace(
    order_definition,
    $stock_check$
    select * into item_stock
    from public.branch_product_stock
    where branch_id = target_branch_id
      and product_id = item_product_id
    for update;
    if item_stock.branch_id is null then
      raise exception 'A cart product does not have enough stock at the selected branch.';
    end if;
    select coalesce(sum((entry.value ->> 'quantity')::integer), 0)
      into requested_product_quantity
    from jsonb_array_elements(cart_items) as entry(value)
    where (entry.value ->> 'product_id')::uuid = item_product_id;
    if item_stock.quantity_on_hand - item_stock.quantity_reserved
        < requested_product_quantity then
      raise exception 'A cart product does not have enough stock at the selected branch.';
    end if;
$stock_check$,
    ''
  );
  order_definition := replace(
    order_definition,
    $stock_reservation$
    update public.branch_product_stock
    set quantity_reserved = quantity_reserved + item_quantity
    where branch_id = target_branch_id
      and product_id = item_product_id;
$stock_reservation$,
    ''
  );

  if position('branch_product_stock' in order_definition) > 0 then
    raise exception 'Product stock checks remain in create_customer_order.';
  end if;
  execute order_definition;

  status_definition := pg_get_functiondef(
    'public.update_order_status(uuid,public.order_status,text)'::regprocedure
  );
  if position('Reserved product stock could not be reconciled.' in status_definition) = 0 then
    raise exception 'Could not locate the expected product stock reconciliation in update_order_status.';
  end if;

  stock_block_start := strpos(
    status_definition,
    '  if next_status in (''cancelled'', ''completed'')'
  );
  if stock_block_start = 0 then
    raise exception 'Could not locate product stock reconciliation in update_order_status.';
  end if;

  stock_block_end_marker := strpos(
    substring(status_definition from stock_block_start),
    E'\n  if next_status = ''completed'' then\n    for recipe_stock in'
  );
  if stock_block_end_marker = 0 then
    stock_block_end_marker := strpos(
      substring(status_definition from stock_block_start),
      E'\n  if next_status = ''completed'' then'
    );
  end if;
  if stock_block_end_marker = 0 then
    stock_block_end_marker := strpos(
      substring(status_definition from stock_block_start),
      E'\n  update public.orders'
    );
  end if;
  stock_block_end := stock_block_start + stock_block_end_marker - 1;
  if stock_block_end_marker = 0 or stock_block_end <= stock_block_start
      or position(
        'branch_product_stock' in
        substring(status_definition from stock_block_start for stock_block_end - stock_block_start)
      ) = 0 then
    raise exception 'Could not isolate product stock reconciliation in update_order_status.';
  end if;

  status_definition := overlay(
    status_definition placing ''
    from stock_block_start
    for stock_block_end - stock_block_start
  );
  if position('branch_product_stock' in status_definition) > 0 then
    raise exception 'Product stock reconciliation remains in update_order_status.';
  end if;
  execute status_definition;
end;
$$;
