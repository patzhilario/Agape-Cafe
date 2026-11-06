-- Flavors share add-on pricing, branch overrides, inventory recipes and order
-- snapshots so the existing server-side checkout validates every paid selection.
alter table public.product_addons
  add column option_kind text not null default 'addon'
  check (option_kind in ('addon', 'flavor'));

comment on column public.product_addons.option_kind is
  'Customer-facing option group. Both add-ons and flavors use additive pricing.';

notify pgrst, 'reload schema';
