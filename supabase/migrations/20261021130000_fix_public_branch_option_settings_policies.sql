drop policy if exists "Public can view available branch product variants"
  on public.branch_product_variant_settings;

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
);

create policy "Assigned staff can view branch product variants"
on public.branch_product_variant_settings for select to authenticated
using (
  public.can_access_branch(branch_id)
  and public.has_permission(branch_id, 'menu', 'view')
);

drop policy if exists "Public can view available branch product add-ons"
  on public.branch_product_addon_settings;

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
);

create policy "Assigned staff can view branch product add-ons"
on public.branch_product_addon_settings for select to authenticated
using (
  public.can_access_branch(branch_id)
  and public.has_permission(branch_id, 'menu', 'view')
);
