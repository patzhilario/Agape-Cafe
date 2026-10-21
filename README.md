# Agapé Café — multi-branch coffee shop system

This project is being implemented in the phases below. The current codebase
includes the Phase 1 foundation, Phase 2 authentication/access controls,
Phase 3 public site/menu, Phase 4 customer ordering, Phase 5 administration
and inventory, Phase 6 benefit discount validation, Phase 7 reporting and
financial monitoring, and Phase 8 checkout payments and branch management.
These workflows require the ordered migrations and configured Supabase
records; no fake menu, branch, customer, or sales data is used.

## Proposed project structure

```text
src/
  app/                 Application routes and shared MUI theme
  components/          Shared responsive layout and reusable UI
  pages/               Route-level screens
  lib/                 Supabase client and shared service utilities
  features/             Domain features
    auth/
    public/
    orders/
    discounts/
    inventory/
    administration/
    reporting/
supabase/
  migrations/          Versioned PostgreSQL schema, functions, and RLS
  functions/            Trusted Edge Functions for sensitive operations
```

JavaScript is used throughout the frontend. Domain-specific Supabase queries
will live with their features rather than being embedded in page components.
Trusted calculations and state transitions (order totals, product availability,
payments, and protected discount decisions) will run through database RPCs or
Edge Functions—not browser-supplied totals or a service-role key.

## Database and security architecture

The first migration creates:

- `profiles`, tied to Supabase Auth users, with editable profile fields kept
  separate from role assignments and account activation.
- `user_roles`, with a trigger granting new accounts the `customer` role.
- `branches` and `user_branch_assignments` for branch-scoped access.
- `modules`, `permissions`, and `user_permissions` for branch-level action
  grants.
- `is_active_account`, `has_role`, `can_access_branch`, and `has_permission`
  database helpers, plus initial row-level security policies.
- A Super Admin-only access management RPC that atomically updates roles,
  branch assignments, and module permissions while recording an audit event.

All exposed tables have RLS enabled. Role grants cannot be created by ordinary
users; only a database operator or a trusted Super Admin operation can grant
administrative roles. The initial Super Admin must be provisioned by a trusted
operator after that person signs up. Public visitors can read active branch
details only. The browser will use only the Supabase publishable/anon key;
privileged keys must never be put in `VITE_*` variables.

The Phase 4 migration adds orders, payment snapshots, sellable-stock
reservations, and audited order creation/status functions. The Phase 5
migration adds branch ingredient inventory, auditable stock movements, branch
order/payment controls, and management screens for menu availability and
promotions. The Phase 6 migration adds PWD/Senior Citizen
requests, private evidence storage, configurable benefit policy, staff review,
and auditable discount application. The Phase 7 migration adds branch-scoped
reports and exports, expense records, and estimated profit monitoring.

## Delivery plan

1. **Foundation** — React/Vite, MUI, routes, Supabase client configuration,
   shared layout, and initial database/RLS migration. Complete.
2. **Authentication and permissions** — Google OAuth, callback/session
   handling, profile lifecycle, role and branch permission workflows.
   Implemented; a live Supabase project and Google OAuth credentials are still
   required to exercise sign-in.
3. **Public site and menu** — database-backed landing page, searchable and
   category/branch-filtered product catalog, product details, promotions,
   active branch information, and public menu image storage. Complete;
   requires the Phase 3 migration and published Supabase records.
4. **Customer ordering** — branch-aware cart, server-validated checkout,
   order history, and fulfillment/payment states. Implemented; requires the
   Phase 4 migration and configured branch stock records.
5. **Administration and inventory** — protected branch/admin operations,
   product and order management, manual stock tracking, and promotions.
   Implemented; requires the Phase 5 migration, staff permission assignments,
   and configured menu/ingredient records.
6. **PWD and Senior Citizen validation** — private uploads, item-specific
   requests, staff verification, configurable policy, and audited decisions.
   Implemented; requires the Phase 6 migration and Super Admin VAT-policy setup.
7. **Reporting and financial monitoring** — order exports, operating
   expenses, and cost-aware profit estimates. Implemented; requires the
   Phase 7 migration and branch reports/financials permissions.
8. **Testing and deployment** — permission and workflow tests, production
   Supabase configuration, and Vercel deployment.

## Local setup

Requirements: Node.js 20.19+ or 22.12+ and npm.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env` to the
Supabase project's URL and publishable/anon key. These are public client
configuration values; never add a service-role key to the frontend.

For a new Supabase project, run the combined SQL file once in the Supabase SQL
Editor:

`supabase/AGAPE_CAFE_FULL_SETUP.sql` contains the ordered schema migrations.
Use that file instead of uploading the individual files below; do not run both
the combined script and the migrations. For Supabase CLI workflows, the
individual files remain available under `supabase/migrations/`:

1. `20261019000000_foundation.sql`
2. `20261019001000_auth_permissions.sql`
3. `20261019002000_public_menu.sql`
4. `20261019003000_customer_orders.sql`
5. `20261019004000_administration_inventory.sql`
6. `20261019005000_benefit_discounts.sql`
7. `20261019006000_reporting_financials.sql`
8. `20261020000000_checkout_payments_and_branch_qr.sql`
9. `20261020010000_gcash_checkout_receipt_and_reference.sql`
10. `20261020020000_delivery_profile_and_order_discounts.sql`
11. `20261020030000_checkout_fulfillment_payment_rules.sql`
12. `20261021000000_branch_product_availability_only.sql`
13. `20261021010000_order_cancellation_reason_ambiguity.sql`
14. `20261021020000_option_inventory_recipes.sql`
15. `20261021030000_payment_cost_reporting.sql`
16. `20261021040000_delete_inventory_item_with_history.sql`
17. `20261021050000_manual_inventory_closing.sql`
18. `20261021060000_manual_inventory_movement_constraint.sql`
19. `20261021070000_branch_variant_price_override.sql`
20. `20261021080000_branch_menu_option_settings.sql`

For a project that already has the first seven migrations, apply migration 8
once, then migrations 9 through 20, in the SQL Editor. For a project that has
already applied migration 8, apply migrations 9 through 20. For a project that
has already applied migration 9, apply migrations 10 through 20. For a project
that has already applied migration 10, apply migrations 11 through 20. For a
project that has already applied migration 11, apply migrations 12 through 20.
For a project that has already applied migration 12, apply migrations 13
through 20. For a project that has already applied migration 13, apply
migrations 14 through 20. For a project that has already applied migration 14,
apply migrations 15 through 20. For a project that has already applied
migration 15, apply migrations 16 through 20. For a project that has already
applied migration 16, apply migrations 17 through 20. For a project that has
already applied migration 17, apply migrations 18 through 20. For a project
that has already applied migration 18, apply migrations 19 and 20. For a
project that has already applied migration 19, apply only migration 20. Do not
rerun the combined fresh-setup file on an already-migrated project.

If the app reports that the `orders` to `order_payment_proofs` relationship is
missing from the schema cache after migration 8 has succeeded, reload the
PostgREST schema with `NOTIFY pgrst, 'reload schema';` in the SQL Editor, then
refresh the app. If the `order_payment_proofs` table is missing, apply migration
8 first; a schema reload alone cannot create it. Migration 9 adds GCash
reference numbers and enables receipt upload during checkout. Migration 10
adds customer delivery addresses, per-branch delivery fees, and editable
customer profile addresses. Migration 11 limits customer fulfillment to
pick-up or delivery, permits cash or GCash for pick-up, and requires GCash for
delivery. Migration 12 removes numeric finished-product stock checks and relies
on the existing per-branch Available switch in Menu; ingredient inventory and
recipe tracking remain separate. Migration 13 fixes order cancellation by disambiguating the cancellation reason
parameter from the orders table column in both validation and stored values.
Migration 14 adds inventory recipes for each product size and optional add-ons.
Migration 17 changes this workflow: completing an order no longer deducts
ingredients. Staff record restocks and actual usage manually in Inventory,
usually after closing. The UI retains old recipe records for reference, but
they are no longer required to complete orders.
Migration 15 adds paid amounts and payment-date totals to operational and
financial reporting. Reports show collected payments separately from completed
sales. Migration 17 adds costed manual usage and restock-purchase totals;
purchase spending is shown separately from usage cost to avoid double-counting.
Recorded branch expenses are also included in financial summaries.
Migration 16 allows Super Admins to permanently delete an inventory item
together with its branch stock, recipes, and movement history. Such a deletion
is recorded in the audit log, but removes that item's ingredient costs from
historical financial estimates.

Migration 17 adds a per-branch low-stock threshold, manual closing usage
records, total restock cost entry, and inventory purchase/usage reporting.
Existing completed orders are snapshotted to preserve their historical
order-based cost estimates; orders completed after migration use manual usage
costs instead. Apply migration 17 to existing projects after migration 16.
Migration 18 updates the inventory movement quantity constraint to allow
negative `manual_usage` rows. If manual usage fails with a
`inventory_movements_check` constraint error, apply migration 18 after
migration 17.
Migration 19 makes a branch's product price override adjust all configured
size prices by the same difference, preserving each size's catalog price
difference. For example, if the catalog base is ₱100 and a size is ₱120,
setting the branch base to ₱110 makes that size ₱130.
Migration 20 gives branch menu editors controls for branch-specific size and
add-on availability and prices while preserving the shared product catalog.
Public menus and server-validated checkout use those overrides, including
promotion totals; checkout continues requiring a size whenever the catalog
defines active sizes, even if every size is disabled for a branch.

Migration 21 repairs ambiguous add-on references in checkout. Migration 22
lets Super Admins add an account by email, name, and role before registration.
For a new account, the selected role and any branch permissions are applied
when the user first signs in with that same Google email; an existing account
is updated immediately. Apply migration 21 and then migration 22 to an
existing project that has applied migration 20, or apply migration 22 if
migration 21 is already installed. The initial `SUPER_ADMIN_EMAIL` setting is
still only for provisioning the first Super Admin.

Migration 23 adds an audited manual override for recording GCash payments
verified outside the submitted-proof workflow; staff must enter a reason.
Apply it after migrations 21 and 22 on an existing project.

Migration 24 adds an optional Google Maps share link to each branch. Apply it
after migration 23 on an existing project so branch admins can save map links
and visitors can open an embedded branch map.

Migration 25 fixes public reads of branch-specific menu size and add-on
settings by separating anonymous visibility from authenticated staff access.
Apply it after migration 24 on existing projects.

Migration 26 adds the initial payment method report RPC. Apply it after
migration 25 on existing projects.

Migration 27 adds paginated payment transaction reporting and audited refund
records. Refund entries record refunds already issued outside the system; they
do not initiate transfers. Users need Financials edit permission to record one,
and each refund requires a note. Apply it after migration 26.

Migration 28 adds a product sales report for completed orders, grouped by day,
month, or year, with branch and date filters. Apply it after migration 27.

Migration 29 aligns payment-report date filters and day/month/year totals with
the order creation date, matching Product Sales. The payment update timestamp
remains available separately in transaction details. Apply it after migration
28 on existing projects.

Migration 30 makes payment methods branch-specific. Super Admins can enable,
deactivate, or add cash and online QR methods for each branch. Customers can
choose any enabled online QR method for delivery; submitted receipts still
require staff review. Apply it after migration 29 on existing projects.

The foundation migration also creates customer profiles and roles for any
Supabase Auth users that already exist when the schema is installed. If the
full setup was already installed before that backfill was added, run
`supabase/repair_existing_auth_accounts.sql` once in the SQL Editor instead of
rerunning the full setup.

If an already-installed project returns `permission denied for function
has_role` while loading public products or promotions, run
`supabase/fix_public_menu_permissions.sql` once in the SQL Editor. The
foundation migration in the combined setup grants this function to the
anonymous database role so public read policies can evaluate it safely.

Set `SUPER_ADMIN_EMAIL` in `.env` to the Google email that will receive initial
Super Admin access. Copy the same email into `target_email` in
`supabase/provision_initial_super_admin.sql` and run that file once in the
Supabase SQL Editor; the user does not need to exist or have signed in yet.
The script saves the email and updates the Auth trigger so that the first
matching Google sign-in creates the profile with the Super Admin role. If the
account already exists, the script grants the role immediately. No
service-role key is needed in the app or `.env`. The combined full setup
contains only the schema migrations and does not assign a Super Admin.

The migrations have not been applied to a live project in this workspace.
Checkout requires published products, active branches, and branch product
availability; finished-product quantities are not checked. In Inventory,
create shared inventory items with their stock units (for example `pcs`,
`pack`, `g`, or `ml`), then record branch restocks and actual usage manually.
Restocks record their total purchase cost; usage records use the latest
available receipt cost for estimated COGS. Set a low-stock threshold per item
and branch to enable warnings. Orders do not change ingredient inventory.
Units are labels only; the app does not convert between units.
Super Admins can rename items, archive items to hide them from new stock
updates while preserving history, or permanently delete items with linked
history. Units cannot be changed after an item is used in stock.
Customers can choose pick-up or delivery: pick-up supports cash or
GCash, while delivery requires GCash. Super Admins
configure a public GCash QR image per branch; GCash checkout requires a
reference number and a private receipt upload unless a benefit discount is
pending verification. In that case the customer submits the order first and
uploads proof after staff approves the ID and final total. Assigned order
managers verify the proof and reference from the order queue before payment is
marked paid. Delivery is independently enabled per branch and priced by that
branch; it is disabled by default. Any rider or booking fee is paid separately
by the customer to the delivery service and is not included in the café order
total.

Phase 6 defaults the benefit percentage to 20%, but approvals are blocked
until a Super Admin selects the business VAT-registration status. Approval
applies the configured percentage to selected item quantities and removes the
configured VAT component for VAT-registered businesses. Promotions and
statutory benefit discounts cannot be stacked. Review current tax and
accounting treatment with the business accountant before enabling the policy.
Evidence is stored in a private bucket; assigned branch approvers can access
it, and it is retained until an approver manually deletes it. A pending
request must be reviewed or rejected before staff can collect payment,
complete, or cancel the order.
Customers can request an eligible discount during checkout, before order
submission; the order and request are created together. Payment-proof
documents are also private and limited to 10 MB.
Legal references: [Republic Act 9994](https://lawphil.net/statutes/repacts/ra2010/ra_9994_2010.html)
and [Republic Act 10754](https://lawphil.net/statutes/repacts/ra2016/ra_10754_2016.html).

Phase 7 reports include order activity and CSV exports. Financial summaries
use legacy completed-order costs, manually recorded inventory usage, and
non-voided branch expenses. Profit remains unavailable when required cost
history is incomplete. Restock purchase spending is reported separately from
cost of actual usage to avoid double-counting. These figures are operational
estimates, not accounting statements. Expenses are branch-specific; voiding
requires a reason and preserves the record for audit history. Reports and
financial records require their respective branch permissions.

Product photos are stored in Supabase Storage rather than database rows. The
admin uploader converts them to WebP, caps dimensions at 1,200 px and output
size at 600 KB, and uses versioned paths for long-lived browser caching.
Product and admin route code is loaded on demand; menu-card photos are lazy
loaded. Inventory movement history is limited to the latest 50 records.
Paginated lists start at 10 rows and can be changed to 15, 20, or 50 rows per
page. CSV exports fetch the selected date range in bounded batches only after
an explicit export action, up to 10,000 rows. These controls limit rows sent
to the browser during normal browsing; aggregate financial summaries still
process the full selected period.
There are no database realtime subscriptions in the app. Private customer
benefit-ID evidence remains at its original image quality (up to 10 MB) to
preserve legibility; the app does not currently offer customer profile-photo
uploads.

For Google sign-in, enable the Google provider in Supabase Auth, configure its
OAuth client credentials in the Supabase dashboard, and allow the callback URL
shown by Supabase (`https://<project-ref>.supabase.co/auth/v1/callback`). Add
local and production app URLs to Supabase Auth's redirect URL allowlist; the
app redirects to `/auth/callback`. Provision the first `super_admin` role
using the Supabase SQL editor after that administrator signs in once.

## Vercel deployment

Import this repository into Vercel and keep the project root at the repository
root. Vercel detects Vite automatically; the production build command is
`npm run build` and the output directory is `dist`. The root `vercel.json`
rewrites app routes to `index.html`, so direct links and browser refreshes work
for React Router routes.

Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Vercel environment
variables for the environments you deploy. In Supabase Auth URL configuration,
set the production site URL and add the production domain (including
`https://<your-domain>/auth/callback`) to the redirect URL allowlist. Redeploy
after changing environment variables.

## Current limitations

- The public landing page, menu, product detail, branch, about, and contact
  pages are implemented, but menu and branch data will remain empty until
  published Supabase records exist.
- The order, administration, benefit discount, reporting, checkout-payment,
  and branch-management migrations have not been exercised against a live
  Supabase/PostgreSQL project. Apply and validate all seventeen migrations,
  assign branch permissions, and configure real menu, stock, branch QR codes,
  and inventory purchase costs before recording usage.
- Google sign-in and deployment still require their configuration and
  remaining planned work.
- Deployment remains future work.
