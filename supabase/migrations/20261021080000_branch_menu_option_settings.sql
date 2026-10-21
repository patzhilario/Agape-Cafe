create table public.branch_product_variant_settings (
  branch_id uuid not null references public.branches(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  is_available boolean not null default true,
  price_override numeric(10, 2) check (price_override is null or price_override >= 0),
  updated_at timestamptz not null default now(),
  primary key (branch_id, variant_id)
);

create table public.branch_product_addon_settings (
  branch_id uuid not null references public.branches(id) on delete cascade,
  addon_id uuid not null references public.product_addons(id) on delete cascade,
  is_available boolean not null default true,
  price_override numeric(10, 2) check (price_override is null or price_override >= 0),
  updated_at timestamptz not null default now(),
  primary key (branch_id, addon_id)
);

create trigger branch_product_variant_settings_set_updated_at
before update on public.branch_product_variant_settings
for each row execute function public.set_updated_at();

create trigger branch_product_addon_settings_set_updated_at
before update on public.branch_product_addon_settings
for each row execute function public.set_updated_at();

alter table public.branch_product_variant_settings enable row level security;
alter table public.branch_product_addon_settings enable row level security;

create policy "Public can view available branch product variants"
on public.branch_product_variant_settings for select to anon, authenticated
using (
  exists (
    select 1
    from public.product_variants as variant
    join public.branch_product_availability as availability
      on availability.product_id = variant.product_id
      and availability.branch_id = branch_product_variant_settings.branch_id
      and availability.is_available
    join public.branches as branch
      on branch.id = availability.branch_id and branch.is_active
    join public.products as product
      on product.id = variant.product_id
      and product.is_published and product.is_available and product.archived_at is null
    where variant.id = branch_product_variant_settings.variant_id
  )
  or (
    public.can_access_branch(branch_id)
    and public.has_permission(branch_id, 'menu', 'view')
  )
);

create policy "Menu editors can manage branch product variants"
on public.branch_product_variant_settings for all to authenticated
using (
  public.can_access_branch(branch_id)
  and public.has_permission(branch_id, 'menu', 'edit')
)
with check (
  public.can_access_branch(branch_id)
  and public.has_permission(branch_id, 'menu', 'edit')
);

create policy "Public can view available branch product add-ons"
on public.branch_product_addon_settings for select to anon, authenticated
using (
  exists (
    select 1
    from public.product_addons as addon
    join public.branch_product_availability as availability
      on availability.product_id = addon.product_id
      and availability.branch_id = branch_product_addon_settings.branch_id
      and availability.is_available
    join public.branches as branch
      on branch.id = availability.branch_id and branch.is_active
    join public.products as product
      on product.id = addon.product_id
      and product.is_published and product.is_available and product.archived_at is null
    where addon.id = branch_product_addon_settings.addon_id
  )
  or (
    public.can_access_branch(branch_id)
    and public.has_permission(branch_id, 'menu', 'view')
  )
);

create policy "Menu editors can manage branch product add-ons"
on public.branch_product_addon_settings for all to authenticated
using (
  public.can_access_branch(branch_id)
  and public.has_permission(branch_id, 'menu', 'edit')
)
with check (
  public.can_access_branch(branch_id)
  and public.has_permission(branch_id, 'menu', 'edit')
);

revoke all on public.branch_product_variant_settings,
  public.branch_product_addon_settings from anon, authenticated;
grant select on public.branch_product_variant_settings,
  public.branch_product_addon_settings to anon, authenticated;
grant insert, update, delete on public.branch_product_variant_settings,
  public.branch_product_addon_settings to authenticated;

do $$
declare
  order_definition text;
  old_variant_price text :=
    'item_unit_price := greatest(0, item_variant.price + coalesce(item_availability.price_override, item_product.price) - item_product.price);';
  new_variant_price text :=
    'item_unit_price := greatest(0, coalesce(
      (select option_setting.price_override
       from public.branch_product_variant_settings as option_setting
       where option_setting.branch_id = target_branch_id
         and option_setting.variant_id = item_variant.id),
      item_variant.price + coalesce(item_availability.price_override, item_product.price)
        - item_product.price
    ));';
  old_addon_total text := 'item_addon_total := item_addon_total + addon_record.price;';
  new_addon_total text :=
    'item_addon_total := item_addon_total + coalesce(
      (select option_setting.price_override
       from public.branch_product_addon_settings as option_setting
       where option_setting.branch_id = target_branch_id
         and option_setting.addon_id = addon_record.id),
      addon_record.price
    );';
  promotion_variant_price_pattern text :=
    $pattern$select[[:space:]]+greatest[[:space:]]*[(][[:space:]]*0[[:space:]]*,[[:space:]]*variant[.]price[[:space:]]*[+][[:space:]]*coalesce[[:space:]]*[(][[:space:]]*availability[.]price_override[[:space:]]*,[[:space:]]*product[.]price[[:space:]]*[)][[:space:]]*-[[:space:]]*product[.]price[[:space:]]*[)]$pattern$;
  new_promotion_variant_price_expression text :=
    'select greatest(0, coalesce(
                  (select option_setting.price_override
                   from public.branch_product_variant_settings as option_setting
                   where option_setting.branch_id = target_branch_id
                     and option_setting.variant_id = variant.id),
                  variant.price + coalesce(availability.price_override, product.price) - product.price
                ))';
  old_promotion_addon_total text :=
    'select sum(addon.price)
              from public.product_addons as addon
              where addon.id in (
                select value::uuid
                from jsonb_array_elements_text(coalesce(item -> ''addon_ids'', ''[]''::jsonb))
              )';
  new_promotion_addon_total text :=
    'select sum(coalesce(option_setting.price_override, addon.price))
              from public.product_addons as addon
              left join public.branch_product_addon_settings as option_setting
                on option_setting.branch_id = target_branch_id
                and option_setting.addon_id = addon.id
              where addon.id in (
                select value::uuid
                from jsonb_array_elements_text(coalesce(item -> ''addon_ids'', ''[]''::jsonb))
              )
                and coalesce(option_setting.is_available, true)';
  old_addon_insert_price text :=
    'values (addon_id, addon_record.id, addon_record.name, addon_record.price);';
  new_addon_insert_price text :=
    'values (
        addon_id,
        addon_record.id,
        addon_record.name,
        coalesce(
          (select option_setting.price_override
           from public.branch_product_addon_settings as option_setting
           where option_setting.branch_id = target_branch_id
             and option_setting.addon_id = addon_record.id),
          addon_record.price
        )
      );';
  variant_locked_query_pattern text :=
    $pattern$from public[.]product_variants[[:space:]]+where[[:space:]]+id[[:space:]]*=[[:space:]]*item_variant_id[[:space:]]+and[[:space:]]+product_id[[:space:]]*=[[:space:]]*item_product_id[[:space:]]+and[[:space:]]+is_active[[:space:]]+for share;$pattern$;
  variant_order_query_pattern text :=
    $pattern$from public[.]product_variants[[:space:]]+where[[:space:]]+id[[:space:]]*=[[:space:]]*item_variant_id[[:space:]]+and[[:space:]]+product_id[[:space:]]*=[[:space:]]*item_product_id[[:space:]]+and[[:space:]]+is_active;$pattern$;
  addon_locked_query_pattern text :=
    $pattern$from public[.]product_addons[[:space:]]+where[[:space:]]+id[[:space:]]*=[[:space:]]*addon_id[[:space:]]+and[[:space:]]+product_id[[:space:]]*=[[:space:]]*item_product_id[[:space:]]+and[[:space:]]+is_active[[:space:]]+for share;$pattern$;
  addon_order_query_pattern text :=
    $pattern$from public[.]product_addons[[:space:]]+where[[:space:]]+id[[:space:]]*=[[:space:]]*addon_id[[:space:]]+and[[:space:]]+product_id[[:space:]]*=[[:space:]]*item_product_id[[:space:]]+and[[:space:]]+is_active;$pattern$;
  addon_snapshot_query_pattern text :=
    $pattern$from public[.]product_addons[[:space:]]+where[[:space:]]+id[[:space:]]*=[[:space:]]*addon_value::uuid[[:space:]]+and[[:space:]]+product_id[[:space:]]*=[[:space:]]*item_product_id[[:space:]]+and[[:space:]]+is_active;$pattern$;
  new_variant_locked_query text :=
    E'from public.product_variants\n      where id = item_variant_id\n        and product_id = item_product_id\n        and is_active\n        and coalesce((\n          select option_setting.is_available\n          from public.branch_product_variant_settings as option_setting\n          where option_setting.branch_id = target_branch_id\n            and option_setting.variant_id = item_variant_id\n        ), true)\n      for share;';
  new_variant_order_query text :=
    E'from public.product_variants\n      where id = item_variant_id\n        and product_id = item_product_id\n        and is_active\n        and coalesce((\n          select option_setting.is_available\n          from public.branch_product_variant_settings as option_setting\n          where option_setting.branch_id = target_branch_id\n            and option_setting.variant_id = item_variant_id\n        ), true);';
  new_addon_locked_query text :=
    E'from public.product_addons\n      where id = addon_id\n        and product_id = item_product_id\n        and is_active\n        and coalesce((\n          select option_setting.is_available\n          from public.branch_product_addon_settings as option_setting\n          where option_setting.branch_id = target_branch_id\n            and option_setting.addon_id = addon_id\n        ), true)\n      for share;';
  new_addon_order_query text :=
    E'from public.product_addons\n      where id = addon_id\n        and product_id = item_product_id\n        and is_active\n        and coalesce((\n          select option_setting.is_available\n          from public.branch_product_addon_settings as option_setting\n          where option_setting.branch_id = target_branch_id\n            and option_setting.addon_id = addon_id\n        ), true);';
  new_addon_snapshot_query text :=
    E'from public.product_addons\n      where id = addon_value::uuid\n        and product_id = item_product_id\n        and is_active\n        and coalesce((\n          select option_setting.is_available\n          from public.branch_product_addon_settings as option_setting\n          where option_setting.branch_id = target_branch_id\n            and option_setting.addon_id = addon_value::uuid\n        ), true);';
  variant_price_count integer;
  addon_total_count integer;
  variant_locked_query_count integer;
  variant_order_query_count integer;
  addon_locked_query_count integer;
  addon_order_query_count integer;
  addon_snapshot_query_count integer;
  promotion_variant_price_count integer;
  remaining_promotion_variant_price_count integer;
  promotion_addon_total_count integer;
  addon_insert_price_count integer;
  variant_availability_count integer;
  addon_availability_count integer;
begin
  order_definition := pg_get_functiondef(
    'public.create_customer_order(uuid,public.order_fulfillment_method,uuid,uuid,text,text,uuid,jsonb)'::regprocedure
  );

  variant_price_count := (
    length(order_definition) - length(replace(order_definition, old_variant_price, ''))
  ) / length(old_variant_price);
  addon_total_count := (
    length(order_definition) - length(replace(order_definition, old_addon_total, ''))
  ) / length(old_addon_total);
  select count(*) into variant_locked_query_count
  from regexp_matches(order_definition, variant_locked_query_pattern, 'g');
  select count(*) into variant_order_query_count
  from regexp_matches(order_definition, variant_order_query_pattern, 'g');
  select count(*) into addon_locked_query_count
  from regexp_matches(order_definition, addon_locked_query_pattern, 'g');
  select count(*) into addon_order_query_count
  from regexp_matches(order_definition, addon_order_query_pattern, 'g');
  select count(*) into addon_snapshot_query_count
  from regexp_matches(order_definition, addon_snapshot_query_pattern, 'g');
  select count(*) into promotion_variant_price_count
  from regexp_matches(order_definition, promotion_variant_price_pattern, 'g');
  promotion_addon_total_count := (
    length(order_definition)
    - length(replace(order_definition, old_promotion_addon_total, ''))
  ) / length(old_promotion_addon_total);
  addon_insert_price_count := (
    length(order_definition) - length(replace(order_definition, old_addon_insert_price, ''))
  ) / length(old_addon_insert_price);

  if variant_price_count <> 2
      or addon_total_count <> 2
      or variant_locked_query_count <> 1
      or variant_order_query_count <> 1
      or addon_locked_query_count <> 1
      or addon_order_query_count <> 1
      or addon_snapshot_query_count <> 1
      or promotion_variant_price_count <> 1
      or promotion_addon_total_count <> 1
      or addon_insert_price_count <> 1 then
    raise exception
      'Could not isolate branch option calculations (variant prices %, add-on totals %, locked variant %, variant order %, locked add-on %, add-on order %, add-on snapshot %, promotion variant %, promotion add-on %, saved add-on %).',
      variant_price_count,
      addon_total_count,
      variant_locked_query_count,
      variant_order_query_count,
      addon_locked_query_count,
      addon_order_query_count,
      addon_snapshot_query_count,
      promotion_variant_price_count,
      promotion_addon_total_count,
      addon_insert_price_count;
  end if;

  order_definition := replace(order_definition, old_variant_price, new_variant_price);
  order_definition := replace(order_definition, old_addon_total, new_addon_total);
  order_definition := regexp_replace(
    order_definition,
    promotion_variant_price_pattern,
    new_promotion_variant_price_expression,
    'g'
  );
  order_definition := replace(order_definition, old_promotion_addon_total, new_promotion_addon_total);
  order_definition := replace(order_definition, old_addon_insert_price, new_addon_insert_price);

  order_definition := regexp_replace(
    order_definition,
    variant_locked_query_pattern,
    new_variant_locked_query
  );
  order_definition := regexp_replace(
    order_definition,
    variant_order_query_pattern,
    new_variant_order_query
  );
  order_definition := regexp_replace(
    order_definition,
    addon_locked_query_pattern,
    new_addon_locked_query
  );
  order_definition := regexp_replace(
    order_definition,
    addon_order_query_pattern,
    new_addon_order_query
  );
  order_definition := regexp_replace(
    order_definition,
    addon_snapshot_query_pattern,
    new_addon_snapshot_query
  );

  variant_availability_count := (
    length(order_definition)
    - length(replace(order_definition, 'from public.branch_product_variant_settings as option_setting', ''))
  ) / length('from public.branch_product_variant_settings as option_setting');
  addon_availability_count := (
    length(order_definition)
    - length(replace(order_definition, 'from public.branch_product_addon_settings as option_setting', ''))
  ) / length('from public.branch_product_addon_settings as option_setting');
  select count(*) into remaining_promotion_variant_price_count
  from regexp_matches(order_definition, promotion_variant_price_pattern, 'g');
  if exists (
      select 1 from regexp_matches(order_definition, variant_locked_query_pattern, 'g')
      union all
      select 1 from regexp_matches(order_definition, variant_order_query_pattern, 'g')
      union all
      select 1 from regexp_matches(order_definition, addon_locked_query_pattern, 'g')
      union all
      select 1 from regexp_matches(order_definition, addon_order_query_pattern, 'g')
      union all
      select 1 from regexp_matches(order_definition, addon_snapshot_query_pattern, 'g')
  ) then
    raise exception 'Branch option availability checks were not applied to every checkout query.';
  end if;

  if position(old_variant_price in order_definition) > 0
      or position(old_addon_total in order_definition) > 0
      or remaining_promotion_variant_price_count <> 0
      or position(old_promotion_addon_total in order_definition) > 0
      or position(old_addon_insert_price in order_definition) > 0
      or variant_availability_count <> 5
      or addon_availability_count <> 6 then
    raise exception 'Branch-specific option price and availability updates were not fully applied.';
  end if;

  execute order_definition;
end;
$$;
