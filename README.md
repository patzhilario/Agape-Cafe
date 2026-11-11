# Agapé Café — single-store coffee shop system

This project is being implemented in the phases below. The current codebase
includes the Phase 1 foundation, Phase 2 authentication/access controls,
Phase 3 public site/menu, Phase 4 customer ordering, Phase 5 administration
and inventory, Phase 6 benefit discount validation, Phase 7 reporting and
financial monitoring, and Phase 8 checkout payments and store settings.
These workflows require the ordered migrations and configured Supabase
records; no fake menu, branch, customer, or sales data is used.

## Single-store ordering

Apply `supabase/migrations/20261111040000_single_store_orders.sql` once in
Supabase SQL Editor after the earlier migrations, then deploy the updated app.
New installations can run `supabase/AGAPE_CAFE_FULL_SETUP.sql` instead.
Do not rerun the full setup against an existing database.

The migration selects Calamba as the store and archives other locations,
including Batangas. Historical orders, payments, inventory and table references
remain intact. Staff assignments, module permissions and pending Staff invites
are moved to the store automatically.

Online orders support Dine-in, Pick-up and Delivery. Table numbers are no longer used. Table configuration, branch creation/deletion, branch selectors and the
Takeout order type are removed. New orders use `create_store_order`, which resolves
the store in the database and rejects Takeout, other locations and table numbers.
Store settings retain contact details, accepting-orders status, delivery and
payment-method/QR configuration. Disposable cups still work as inventory items.

## E-payment only

After the single-store migration, apply
`supabase/migrations/20261111050000_epayment_only.sql`, then deploy the frontend.
Cash methods are disabled; past payments remain in order history and reports.
All new online orders require an active e-payment method
with a receiving QR and uploaded JPEG receipt. No typed reference is required. Staff review the
receipt before confirming payment; selecting a method does not charge the customer
automatically.

In **Store settings > Add payment method**, enter any e-wallet or bank name
(for example GCash, Maya, MariBank or BDO), optional customer instructions and its
QR image. No provider credentials are needed for this manual QR receipt workflow.

## Online order types

Apply all migrations in order, including
`supabase/migrations/20261111080000_restore_online_order_choices.sql` after the
receipt/notification migration. This latest migration supersedes the earlier
delivery-only restriction and restores **Dine-in, Pick-up and Delivery**.
Takeout and table numbers remain disabled. Only Delivery requires a delivery
address; Dine-in and Pick-up submit no delivery address. All three types still use
e-payment and JPEG receipts without typed reference numbers. Ready notifications
say ready to serve, ready for pick-up, or ready for delivery according to the order.
Historical orders and notifications remain intact.

## JPEG receipts and customer notifications

Apply `supabase/migrations/20261111070000_receipts_and_order_notifications.sql`
after the earlier migrations, then deploy the updated app. Checkout and receipt
re-upload accept JPEG (.jpg/.jpeg) only, up to 10 MB. The browser checks the JPEG
header and storage restricts new files to image/jpeg; the submission RPC verifies
file ownership, extension and stored MIME type. Historical receipts remain readable.
Typed reference numbers are removed from the customer form; existing references
remain attached to past receipts.

Customer accounts show a notification bell and in-app alerts for rejected orders,
rejected payment receipts, preparing orders and ready orders. Rejection messages
include the staff reason and link to the order. Notifications are saved in the
database, scoped to the customer, and remain unread until acknowledged. The app
checks every 15 seconds while visible and on returning to the tab. These are
in-app notifications; no browser push or email delivery service is configured.
Order labels show **Orders preparing** and **Orders Ready**.

## Configurable delivery fee

Apply `supabase/migrations/20261111090000_configurable_delivery_fee.sql` after the
previous migrations and deploy the frontend. The migration starts the store at
free delivery. In **Admin > Store settings**, enable **Charge a delivery fee** and
enter a PHP amount (for example 50), or turn it off for free delivery.

Only Delivery orders receive this fee. Checkout shows it separately and includes
it in the total; the saved order, payment amount and order receipt retain the same
fee. Dine-in and Pick-up remain at zero delivery fee. Promotions reduce product
charges, not the delivery fee. Existing orders keep their original amounts when
the Admin changes the rate. The server checks the quoted fee, rejects stale quotes
and serializes retries so the fee is charged once. After a fee change, checkout
refreshes the rate and asks the customer to review the total/payment before retrying.
This replaces the earlier separate-booking-fee wording in checkout.

## Staff POS and printable receipts

Apply the POS migrations in order, including
`supabase/migrations/20261111100000_staff_pos.sql` and then
`supabase/migrations/20261111110000_pos_counter_checkout.sql`, and deploy the app.
The latter replaces the earlier upload-and-redirect POS flow.

**Workspace > POS** keeps the entire sale on one screen. The menu shows six items
per page, with page controls; search/category changes reset to the first page.
Menu cards constrain long names and categories within their bounds. Tapping a product adds
its first available variant directly to the basket. **Options** edits size, add-ons
and flavors inline. Customer name/phone are optional for Dine-in and Pick-up;
Delivery requires contact details and includes the configured delivery fee.

Staff need **Orders view + create + edit** to take payment. POS supports **Cash**
with cash received/change, or an enabled **QR method** confirmed by the cashier
against the store account. POS no longer requires a receipt image upload. Online
checkout remains e-payment-only and still requires a JPEG payment receipt. A
private database transaction authorization prevents using POS cash for online
orders. Completed counter payments are recorded as paid, move the order to
confirmed, and are audited. Retrying the same request cannot duplicate the sale.

Discounts are applied at the counter. Configured promotions are available except
those requiring per-customer account limits. PWD/Senior benefits require
**Promotions approve** permission, the active configured benefit policy, verified
in-person ID/name, and eligible quantities (at most one drink and one food). The
server computes discounts from its policy and current prices; discount types
cannot be stacked. ID details are stored in a restricted verification table.
Delivery fees are excluded from discounts. Stale totals must be reviewed before
payment completes.

**Pay & print receipt** opens the browser print dialog after saving payment,
without navigating away or opening another tab. The receipt preview, reprint,
80mm/A4 paper controls and **Start next sale** stay inside POS. Cash receipts show
amount paid, cash received and change; discounted receipts show the reduction.
Printing can be disabled for a sale via **Print after payment**.

Existing customer/staff order details also offer **Print receipt** through the
shared `/receipt/:orderId` route. Receipt access follows order RLS. Printed output
contains only the receipt, with no site navigation or QR code. Match paper size
in the printer dialog and disable browser headers/footers when needed.

## Current schema cleanup

Run `supabase/audit_schema_cleanup.sql` to inspect the live schema without changing
records. After all earlier migrations, apply
`supabase/migrations/20261111120000_clean_public_schema.sql` once, then deploy the
frontend. The repository's expected public schema shrinks from 44 to 33 tables.
Six legacy tables move to `app_archive`; five backend/security tables move to
`app_private`. Ten unused functions and two obsolete columns are removed.
Historical table assignments and branch-level QR paths are preserved in
`app_archive.retired_fields`. Financial reporting, signup/invites and current
order/POS/payment rules continue through the same public RPCs.

See [the schema guide](supabase/SCHEMA_GUIDE.md) for the complete table inventory,
required objects and migration order. Do not expose the private/archive schemas
to the API or rerun the full setup on an existing database. The cleanup is
transactional and stops on unreviewed function/view dependencies; it uses no CASCADE.
The full setup includes this cleanup last for new installations. Initial Admin
provisioning should be run after all current migrations.

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
- An Admin-only access management RPC that atomically updates roles,
  branch assignments, and module permissions while recording an audit event.

All exposed tables have RLS enabled. Role grants cannot be created by ordinary
users; only a database operator or a trusted Admin operation can grant
administrative roles. The initial Admin must be provisioned by a trusted
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
   Implemented; a live Supabase project and authentication configuration are still
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
   Implemented; requires the Phase 6 migration and Admin VAT-policy setup.
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
Migration 16 allows Admins to permanently delete an inventory item
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
lets Admins add an account by email, name, and role before registration.
For a new account, the selected role and any branch permissions are applied
when the user signs up with the invited email; an existing account
is updated immediately. Apply migration 21 and then migration 22 to an
existing project that has applied migration 20, or apply migration 22 if
migration 21 is already installed. The initial `ADMIN_EMAIL` setting is
for provisioning the first Admin.

Migration 23 adds an audited manual override for recording GCash payments
verified outside the submitted-proof workflow; staff must enter a reason.
Apply it after migrations 21 and 22 on an existing project.

Migration 24 adds an optional Google Maps share link to each branch. Apply it
after migration 23 on an existing project so Staff can save map links
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

Migration 30 makes payment methods branch-specific. Admins can enable,
deactivate, or add cash and online QR methods for each branch. Customers can
choose any enabled online QR method for delivery; submitted receipts still
require staff review. Apply it after migration 29 on existing projects.

Migration 31 adds Dine-in, Take-out, Pick-up, and Delivery checkout flows.
Pick-up and Delivery require online QR payment; Dine-in and Take-out support
online QR or payment at the branch. Dine-in tables are configured per branch
and held by an active order until staff completes or cancels it. PWD/Senior
discount requests are restricted to Dine-in and Take-out. The delivery
rider/booking fee is paid by the customer directly through the booking service
and is excluded from the café order total. Apply it after migration 30 on
existing projects. This migration is safe to re-run if some objects were
already created by a previous incomplete attempt.

Migration 32 adds drink serving type to order items and deducts takeout cups
from branch inventory when an order is completed. Apply it after migration 31
on existing projects; order screens require this column to load.

Migration 33 adds Admin account deletion. Accounts linked to retained
order or financial records can still be permanently deleted; their profile
links are cleared while the business history is retained. Apply it after
migration 32 on existing projects.

Migration 34 (`20261106000000_product_flavor_options.sql`) adds a separate
Flavors section to product options. Apply it after migration 33 and before
deploying the updated frontend; menu queries require the new `option_kind`
column. In the catalog editor, use **Add flavor** and leave the price blank
for no extra charge. Paid flavors use the existing add-on checkout pricing,
branch overrides, inventory recipes, and saved order details. Drink variants
are labeled Size; food variants are labeled Meal set.

Apply `20261111000000_simplify_account_roles.sql` after the November 9
dining-table migration and before deploying the updated frontend. Account roles
are Admin, Staff, and Customer. Existing Super Admin accounts become Admin and
Branch Admin accounts become Staff. The migration also converts pending invites
and preserves branch assignments and permissions.

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

Set `ADMIN_EMAIL` in `.env` to the email that will receive initial
Admin access. Copy the same email into `target_email` in
`supabase/provision_initial_admin.sql` and run that file once in the
Supabase SQL Editor; the user does not need to exist or have signed in yet.
The script saves a pending invite so that signing up with the invited email creates the profile with the Admin role. If the account already exists, the script grants the role immediately. No
service-role key is needed in the app or `.env`. The combined full setup
contains only the schema migrations and does not assign an Admin.

The migrations have not been applied to a live project in this workspace.
Checkout requires published products, active branches, and branch product
availability; finished-product quantities are not checked. In Inventory,
create shared inventory items with their stock units (for example `pcs`,
`pack`, `g`, or `ml`), then record branch restocks and actual usage manually.
Restocks record their total purchase cost; usage records use the latest
available receipt cost for estimated COGS. Set a low-stock threshold per item
and branch to enable warnings. Orders do not change ingredient inventory.
Units are labels only; the app does not convert between units.
Admins can rename items, archive items to hide them from new stock
updates while preserving history, or permanently delete items with linked
history. Units cannot be changed after an item is used in stock.
Customers can choose pick-up or delivery: pick-up supports cash or
GCash, while delivery requires GCash. Admins
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
until an Admin selects the business VAT-registration status. Approval
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

### Sign-up and login

Apply `20261111010000_email_password_signup.sql` after the role migration.
Then apply `20261111020000_signup_identity_fields.sql`. The Sign Up button
opens a form requiring a unique username, first name, last name, email,
password, and phone number. MI is optional. Usernames use 3 to 30 letters,
numbers, periods, or underscores, starting with a letter or number, and are
stored in lowercase. Existing profiles keep their names and can continue
using email login. Pending staff and admin invitations apply to the invited
email.

After a successful sign-up awaiting email verification, the app returns to the
login page with the email prefilled, a verification reminder and a resend option.

Deploy the username login function with
`supabase functions deploy sign-in-with-username --project-ref <project-ref>`.
The function uses Supabase's built-in server environment variables
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
Only this server function resolves usernames to email addresses. The browser
receives session tokens after a successful password check. Email login goes
directly through Supabase Auth.

Running the SQL setup or deploying the frontend does not deploy Edge Functions.
If email login works but username login returns `404 NOT_FOUND` / `Requested
function was not found`, deploy `sign-in-with-username` to the same project as
`VITE_SUPABASE_URL` using the command above. Keep `verify_jwt = false` for this
function in `supabase/config.toml`, since login requests have no user session yet.
The login form reports an unavailable username service separately from invalid
credentials and allows customers to use their email while deployment is pending.

Apply `20261111030000_customer_profile_settings.sql` to allow customers to
edit their username and name fields through Account settings. Existing profile
RLS still limits account access. Settings include phone, delivery address,
email verification status, and a password change form with confirmation.
Supabase can request the current password or a reauthentication email code
according to its configured password security policy. Users can also open
the existing email password-reset flow from this page.

The database blocks creation of Google-only accounts. Verification links are
sent to the registered email address, including Gmail inboxes.

In Supabase Auth, enable the Email provider, allow new sign-ups, and keep
**Confirm email** enabled so account holders verify ownership before signing
in. Set the minimum password length to at least 8 characters. Configure
custom SMTP for confirmation and password recovery messages to customer
addresses, with a sender address owned by the caf?. Allow
`/auth/callback` and `/auth/update-password` on each app origin in the Auth
redirect URL allowlist, including their `next` query parameter.

For Google One Tap, enable the Google provider in Supabase, add each app
origin to the Google OAuth web client's authorized JavaScript origins, and
set that same web client ID in the Supabase Google provider and as
`VITE_GOOGLE_CLIENT_ID` in local and deployment environments. In Google Cloud,
open the matching OAuth web client and add `http://localhost` and the local
app origin (for example `http://localhost:5173`) to **Authorized JavaScript
origins**. Add the deployed app origin there as well. Use the scheme, hostname,
and actual port without a page path. If the console reports that the origin
is not allowed, compare these entries with `window.location.origin`. Google on the sign-up page fills first name, last name, and email. Google on the
login page signs in an existing account with a matching verified email.
Existing Google-only users can use **Set or reset password** to add a password
to the same account.

## Vercel deployment

Import this repository into Vercel and keep the project root at the repository
root. Vercel detects Vite automatically; the production build command is
`npm run build` and the output directory is `dist`. The root `vercel.json`
rewrites app routes to `index.html`, so direct links and browser refreshes work
for React Router routes. It also requires browsers to revalidate app files, so
they don't keep using an outdated build after a deployment. If a page still
fails to render, the app shows a reload option instead of a blank screen.

Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Vercel environment
variables for the environments you deploy. In Supabase Auth URL configuration,
set the production site URL and add the production domain (including
`https://<your-domain>/auth/callback`) to the redirect URL allowlist. Redeploy
after changing environment variables.

## Current limitations

- Live email, Google sign-in and payment QR setup require the configured Supabase
  project and provider credentials.
- Single-store migrations and order rules have been checked locally. Apply the
  migration to the live project and deploy the frontend together before use.
- Published menu, stock and payment-method records are required for checkout.
