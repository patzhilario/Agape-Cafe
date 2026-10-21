do $$
declare
  order_definition text;
  variant_price_assignment text := 'item_unit_price := item_variant.price;';
  adjusted_variant_price_assignment text :=
    'item_unit_price := greatest(0, item_variant.price + coalesce(item_availability.price_override, item_product.price) - item_product.price);';
  variant_price_query text :=
    'select price from public.product_variants';
  adjusted_variant_price_query text :=
    'select greatest(0, variant.price + coalesce(availability.price_override, product.price) - product.price)
                from public.product_variants as variant
                join public.products as product on product.id = variant.product_id
                left join public.branch_product_availability as availability
                  on availability.branch_id = target_branch_id
                  and availability.product_id = variant.product_id';
  before_assignment_count integer;
  before_query_count integer;
begin
  order_definition := pg_get_functiondef(
    'public.create_customer_order(uuid,public.order_fulfillment_method,uuid,uuid,text,text,uuid,jsonb)'::regprocedure
  );

  before_assignment_count := (
    length(order_definition)
    - length(replace(order_definition, variant_price_assignment, ''))
  ) / length(variant_price_assignment);
  before_query_count := (
    length(order_definition)
    - length(replace(order_definition, variant_price_query, ''))
  ) / length(variant_price_query);

  if before_assignment_count <> 2 or before_query_count <> 1 then
    raise exception 'Could not isolate branch variant price calculations in create_customer_order.';
  end if;

  order_definition := replace(
    order_definition,
    variant_price_assignment,
    adjusted_variant_price_assignment
  );
  order_definition := regexp_replace(
    order_definition,
    'select price from public[.]product_variants[[:space:]]+where id = [(]item ->> ''variant_id''[)]::uuid',
    adjusted_variant_price_query || E'\n                where variant.id = (item ->> ''variant_id'')::uuid'
  );

  if position(variant_price_assignment in order_definition) > 0
      or position(variant_price_query in order_definition) > 0 then
    raise exception 'Branch variant price updates were not applied to all order calculations.';
  end if;

  execute order_definition;
end;
$$;
