# Current database layout

The repository's schema contains **33 current tables in `public`** after
`20261111120000_clean_public_schema.sql`. Before cleanup it contained 44.
Select `public` in the schema viewer to inspect the current application model.
Custom tables added outside these migrations are not removed automatically.

The cleanup removes ten obsolete functions, two retired columns and one redundant
trigger. It does not delete orders, receipts, payments, refunds, accounts,
inventory movements or audit history.

## Apply to an existing project

1. Apply all earlier migrations through `20261111110000_pos_counter_checkout.sql`.
2. Run `audit_schema_cleanup.sql` to inspect the live database metadata.
3. Run `migrations/20261111120000_clean_public_schema.sql` once.
4. Deploy the updated frontend and run the audit again.

Do not rerun the full setup on an existing project. A new project can use
`AGAPE_CAFE_FULL_SETUP.sql`, which includes the cleanup last. Keep the Supabase
API exposed schemas restricted to application APIs; do not expose `app_private`
or `app_archive`. Both schemas revoke access from `anon` and `authenticated`.

The migration is transactional. An unknown function/view dependency or a database
dependency that prevents an explicit drop stops the cleanup, with no partial
changes. It uses no `CASCADE`. Investigate the reported dependency instead of
forcing the drop.

## Public: current application data

| Area | Tables |
| --- | --- |
| Accounts and access (6) | `profiles`, `user_roles`, `user_branch_assignments`, `user_permissions`, `modules`, `permissions` |
| Store and menu (8) | `branches`, `categories`, `products`, `product_variants`, `product_addons`, `branch_product_availability`, `branch_product_variant_settings`, `branch_product_addon_settings` |
| Orders and payments (8) | `orders`, `order_items`, `order_item_addons`, `payments`, `payment_methods`, `order_payment_proofs`, `payment_refunds`, `customer_notifications` |
| Offers and benefits (6) | `promotions`, `promotion_products`, `promotion_redemptions`, `benefit_discount_policy`, `benefit_discount_requests`, `benefit_discount_request_items` |
| Inventory and expenses (4) | `ingredients`, `branch_inventory`, `inventory_movements`, `branch_expenses` |
| Audit (1) | `audit_logs` |

Names containing `branch` still back the **single store's** menu, inventory and
staff permissions. They are used by active code and cannot simply be dropped.
Inactive location rows preserve existing order/inventory references; they do not
reintroduce branch management. The `app_role` enum has Admin, Staff and Customer.

The old `takeout` fulfillment enum label remains readable for historical orders.
New orders accept only Dine-in, Pick-up and Delivery, enforced in the database.
Removing an enum label by reclassifying historical orders would change history.

Benefit requests and their items still support historical customer discounts,
staff review and order/payment guards. Private receipt/benefit storage buckets
are also still needed. Empty tables are not automatically obsolete.

## app_private: active backend-only data (5 tables)

| Table | Why it remains |
| --- | --- |
| `store_settings` | Resolves the canonical single store for RPCs and constraints. |
| `pending_user_access` | Keeps Admin/Staff invites until the invited person signs up. |
| `payment_manual_override_authorizations` | Transaction-scoped authorization for verified QR payment handling. |
| `pos_checkout_authorizations` | Prevents online customers from using the POS-only cash path. |
| `pos_benefit_verifications` | Restricted in-person beneficiary/ID verification records. |

Public RPCs and the signup trigger continue to work through security-definer
functions. Function signatures and execution grants remain unchanged. These
tables are implementation details; the frontend does not query them directly.

## app_archive: preserved legacy data (7 tables)

| Table | Why it is archived |
| --- | --- |
| `branch_dining_tables` | Retired table-number configuration. |
| `branch_product_stock` | Old stock reservation model, superseded by current inventory workflow. |
| `product_recipes` | Retired recipe configuration. Existing references are retained. |
| `product_option_recipes` | Retired option recipe configuration. Existing references are retained. |
| `inventory_legacy_cost_orders` | Preserves the inventory cutover's historical financial calculations. |
| `inventory_manual_closing_settings` | Records when manual closing was enabled. |
| `retired_fields` | Exact old order/table assignments and branch-level GCash QR paths removed from public columns. |

Historical financial reporting and protected inventory deletion use the archived
records where necessary. Legacy GCash paths are also backfilled into existing
GCash payment methods, so historical payment images are not lost.

## Removed public functions

`create_customer_order_with_table`, `get_available_dining_tables`,
`delete_branch_dining_table`, `guard_order_dining_table_assignment`,
`create_pos_order`, `admin_set_product_recipe`, `admin_set_product_option_recipe`,
`get_payment_method_transactions`, `record_manual_gcash_payment_override`, and
the redundant `enforce_customer_order_fulfillment` trigger function.

Current callers use `create_store_order`, `complete_pos_sale`, current reporting
RPCs and `record_manual_provider_payment_override`. The internal shared pricing
functions, current order/financial report functions and security helpers remain
because current RPCs depend on them. Supabase-managed `auth`, `storage`, extension
and platform objects are outside this cleanup.
