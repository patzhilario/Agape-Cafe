create type public.benefit_type as enum ('pwd', 'senior_citizen');
create type public.benefit_request_status as enum ('pending', 'approved', 'rejected');

create table public.benefit_discount_policy (
  id boolean primary key default true check (id),
  is_active boolean not null default true,
  discount_percent numeric(5, 2) not null default 20
    check (discount_percent >= 20 and discount_percent <= 100),
  vat_registration text not null default 'not_configured'
    check (vat_registration in ('not_configured', 'vat_registered', 'non_vat')),
  vat_rate numeric(5, 2) not null default 12
    check (vat_rate >= 0 and vat_rate <= 30),
  pwd_enabled boolean not null default true,
  senior_citizen_enabled boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.benefit_discount_policy (id) values (true)
on conflict (id) do nothing;

create table public.benefit_discount_requests (
  id uuid primary key,
  order_id uuid not null unique references public.orders (id) on delete restrict,
  customer_id uuid not null references public.profiles (id) on delete restrict,
  branch_id uuid not null references public.branches (id) on delete restrict,
  benefit_type public.benefit_type not null,
  status public.benefit_request_status not null default 'pending',
  document_path text,
  discount_percent numeric(5, 2),
  vat_registration text,
  vat_rate numeric(5, 2),
  discount_total numeric(12, 2) not null default 0 check (discount_total >= 0),
  review_note text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (document_path is null or length(document_path) between 1 and 512),
  check (review_note is null or length(review_note) <= 500)
);

create table public.benefit_discount_request_items (
  request_id uuid not null references public.benefit_discount_requests (id) on delete restrict,
  order_item_id uuid not null references public.order_items (id) on delete restrict,
  eligible_quantity integer not null check (eligible_quantity > 0),
  discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),
  primary key (request_id, order_item_id)
);

create index benefit_requests_branch_status_created_idx
  on public.benefit_discount_requests (branch_id, status, created_at desc);
create index benefit_requests_customer_created_idx
  on public.benefit_discount_requests (customer_id, created_at desc);

create trigger benefit_discount_policy_set_updated_at
before update on public.benefit_discount_policy
for each row execute function public.set_updated_at();

create trigger benefit_discount_requests_set_updated_at
before update on public.benefit_discount_requests
for each row execute function public.set_updated_at();

create function public.guard_order_with_pending_benefit_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('completed', 'cancelled')
      and old.status is distinct from new.status
      and exists (
        select 1 from public.benefit_discount_requests
        where order_id = old.id and status = 'pending'
      ) then
    raise exception 'Review or reject the pending benefit discount request before completing or cancelling this order.';
  end if;
  return new;
end;
$$;

create trigger orders_guard_pending_benefit_request
before update of status on public.orders
for each row execute function public.guard_order_with_pending_benefit_request();

create or replace function public.record_order_payment(target_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_order public.orders%rowtype;
begin
  select * into current_order
  from public.orders
  where id = target_order_id
  for update;
  if not found then raise exception 'Order not found.'; end if;

  if not public.is_active_account()
      or not public.can_access_branch(current_order.branch_id)
      or not public.has_permission(current_order.branch_id, 'orders', 'edit') then
    raise exception 'You do not have permission to record this payment.'
      using errcode = '42501';
  end if;

  if current_order.status = 'cancelled' or current_order.payment_status <> 'unpaid' then
    raise exception 'Only unpaid, active orders can be marked paid.';
  end if;
  if exists (
    select 1 from public.benefit_discount_requests
    where order_id = target_order_id and status = 'pending'
  ) then
    raise exception 'Review or reject the pending benefit request before collecting payment.';
  end if;

  update public.payments
  set status = 'paid'
  where order_id = target_order_id and status = 'unpaid';
  if not found then raise exception 'The order payment record could not be updated.'; end if;

  update public.orders set payment_status = 'paid' where id = target_order_id;
  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    (select auth.uid()), 'order_payment_recorded', 'order', target_order_id,
    current_order.branch_id,
    jsonb_build_object('amount', current_order.total, 'payment_status', 'paid')
  );
end;
$$;

alter table public.benefit_discount_policy enable row level security;
alter table public.benefit_discount_requests enable row level security;
alter table public.benefit_discount_request_items enable row level security;

create policy "Authenticated users can read benefit discount policy"
on public.benefit_discount_policy for select to authenticated
using (public.is_active_account());

create policy "Customers and assigned approvers can view benefit requests"
on public.benefit_discount_requests for select to authenticated
using (
  customer_id = (select auth.uid())
  or (
    public.can_access_branch(branch_id)
    and public.has_permission(branch_id, 'promotions', 'approve')
  )
);

create policy "Customers and assigned approvers can view benefit request items"
on public.benefit_discount_request_items for select to authenticated
using (
  exists (
    select 1
    from public.benefit_discount_requests as request
    where request.id = benefit_discount_request_items.request_id
      and (
        request.customer_id = (select auth.uid())
        or (
          public.can_access_branch(request.branch_id)
          and public.has_permission(request.branch_id, 'promotions', 'approve')
        )
      )
  )
);

revoke all on public.benefit_discount_policy, public.benefit_discount_requests,
  public.benefit_discount_request_items from anon, authenticated;
grant select on public.benefit_discount_policy, public.benefit_discount_requests,
  public.benefit_discount_request_items to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'benefit-documents',
  'benefit-documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Customers can upload their own benefit evidence"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'benefit-documents'
  and public.is_active_account()
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Assigned benefit approvers can view evidence"
on storage.objects for select to authenticated
using (
  bucket_id = 'benefit-documents'
  and exists (
    select 1
    from public.benefit_discount_requests as request
    where request.document_path = storage.objects.name
      and (
        public.has_role('super_admin')
        or (
          public.can_access_branch(request.branch_id)
          and public.has_permission(request.branch_id, 'promotions', 'approve')
        )
      )
  )
);

create policy "Assigned benefit approvers can delete evidence"
on storage.objects for delete to authenticated
using (
  bucket_id = 'benefit-documents'
  and (
    exists (
      select 1
      from public.benefit_discount_requests as request
      where request.document_path = storage.objects.name
        and (
          public.has_role('super_admin')
          or (
            public.can_access_branch(request.branch_id)
            and public.has_permission(request.branch_id, 'promotions', 'approve')
          )
        )
    )
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and not exists (
        select 1
        from public.benefit_discount_requests as request
        where request.document_path = storage.objects.name
      )
    )
  )
);

create or replace function public.admin_set_benefit_discount_policy(
  target_is_active boolean,
  target_discount_percent numeric,
  target_vat_registration text,
  target_vat_rate numeric,
  target_pwd_enabled boolean,
  target_senior_citizen_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('super_admin') then
    raise exception 'Super Admin permission is required to change benefit policy.'
      using errcode = '42501';
  end if;
  if target_is_active is null
      or target_discount_percent is null
      or target_discount_percent < 20
      or target_discount_percent > 100
      or target_vat_registration not in ('not_configured', 'vat_registered', 'non_vat')
      or target_vat_rate is null
      or target_vat_rate < 0
      or target_vat_rate > 30
      or target_pwd_enabled is null
      or target_senior_citizen_enabled is null then
    raise exception 'Benefit policy values are invalid.';
  end if;

  update public.benefit_discount_policy
  set is_active = target_is_active,
      discount_percent = target_discount_percent,
      vat_registration = target_vat_registration,
      vat_rate = target_vat_rate,
      pwd_enabled = target_pwd_enabled,
      senior_citizen_enabled = target_senior_citizen_enabled,
      updated_by = (select auth.uid())
  where id;

  insert into public.audit_logs (actor_id, action, record_type, details)
  values (
    (select auth.uid()),
    'benefit_discount_policy_updated',
    'benefit_discount_policy',
    jsonb_build_object(
      'is_active', target_is_active,
      'discount_percent', target_discount_percent,
      'vat_registration', target_vat_registration,
      'vat_rate', target_vat_rate,
      'pwd_enabled', target_pwd_enabled,
      'senior_citizen_enabled', target_senior_citizen_enabled
    )
  );
end;
$$;

create or replace function public.create_benefit_discount_request(
  target_request_id uuid,
  target_order_id uuid,
  requested_benefit_type public.benefit_type,
  requested_items jsonb,
  uploaded_document_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_order public.orders%rowtype;
  request_item jsonb;
  order_item_id uuid;
  eligible_quantity integer;
  is_enabled boolean;
  new_request_id uuid;
begin
  if current_user_id is null or not public.is_active_account() then
    raise exception 'Sign in with an active account to request a benefit discount.'
      using errcode = '42501';
  end if;
  if target_request_id is null or target_order_id is null or requested_benefit_type is null then
    raise exception 'Choose an order, benefit type, and request key.';
  end if;
  if uploaded_document_path is null
      or length(uploaded_document_path) > 512
      or split_part(uploaded_document_path, '/', 1) <> current_user_id::text
      or split_part(uploaded_document_path, '/', 2) <> target_request_id::text
      or not exists (
        select 1 from storage.objects
        where bucket_id = 'benefit-documents'
          and name = uploaded_document_path
          and owner_id = current_user_id::text
      ) then
    raise exception 'Upload a private document under your own request folder.';
  end if;
  if requested_items is null or jsonb_typeof(requested_items) is distinct from 'array'
      or jsonb_array_length(requested_items) < 1
      or jsonb_array_length(requested_items) > 50 then
    raise exception 'Select between one and fifty eligible order lines.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(requested_items) as entry(value)
    where jsonb_typeof(entry.value) <> 'object'
      or jsonb_typeof(entry.value -> 'order_item_id') <> 'string'
      or jsonb_typeof(entry.value -> 'eligible_quantity') <> 'number'
      or (entry.value ->> 'eligible_quantity') !~ '^[0-9]+$'
  ) then
    raise exception 'One or more selected order lines are invalid.';
  end if;

  select case
    when requested_benefit_type = 'pwd' then pwd_enabled
    else senior_citizen_enabled
  end
  into is_enabled
  from public.benefit_discount_policy
  where id and is_active;
  if not found or not is_enabled then
    raise exception 'This benefit discount is currently unavailable.';
  end if;

  select * into current_order
  from public.orders
  where id = target_order_id
    and customer_id = current_user_id
  for update;
  if not found then
    raise exception 'This order is not available to your account.';
  end if;
  if current_order.promotion_id is not null or current_order.discount_total > 0 then
    raise exception 'Remove the promotion by choosing a non-promotional order before requesting this discount.';
  end if;
  if current_order.payment_status <> 'unpaid'
      or current_order.status in ('cancelled', 'completed') then
    raise exception 'A benefit discount must be requested on an unpaid, active order.';
  end if;

  insert into public.benefit_discount_requests (
    id, order_id, customer_id, branch_id, benefit_type, document_path
  )
  values (
    target_request_id, target_order_id, current_user_id, current_order.branch_id,
    requested_benefit_type, uploaded_document_path
  )
  returning id into new_request_id;

  for request_item in select entry.value from jsonb_array_elements(requested_items) as entry(value)
  loop
    begin
      order_item_id := (request_item ->> 'order_item_id')::uuid;
      eligible_quantity := (request_item ->> 'eligible_quantity')::integer;
    exception when invalid_text_representation then
      raise exception 'One or more selected order lines are invalid.';
    end;
    if eligible_quantity < 1 or not exists (
      select 1
      from public.order_items
      where id = order_item_id
        and order_id = target_order_id
        and quantity >= eligible_quantity
    ) then
      raise exception 'A selected quantity exceeds its order line or does not belong to this order.';
    end if;
    insert into public.benefit_discount_request_items (
      request_id, order_item_id, eligible_quantity
    )
    values (new_request_id, order_item_id, eligible_quantity);
  end loop;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    current_user_id, 'benefit_discount_requested', 'benefit_discount_request',
    new_request_id, current_order.branch_id,
    jsonb_build_object(
      'order_id', target_order_id,
      'benefit_type', requested_benefit_type,
      'selected_line_count', jsonb_array_length(requested_items)
    )
  );

  return new_request_id;
end;
$$;

create or replace function public.review_benefit_discount_request(
  target_request_id uuid,
  decision public.benefit_request_status,
  decision_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_request public.benefit_discount_requests%rowtype;
  current_order public.orders%rowtype;
  current_policy public.benefit_discount_policy%rowtype;
  request_item record;
  eligible_gross numeric(12, 2);
  eligible_net numeric(12, 2);
  line_discount numeric(12, 2);
  total_discount numeric(12, 2) := 0;
  vat_multiplier numeric(8, 4);
begin
  if decision not in ('approved', 'rejected') then
    raise exception 'Choose approve or reject.';
  end if;
  if decision_note is not null and length(decision_note) > 500 then
    raise exception 'Review notes cannot exceed 500 characters.';
  end if;

  select * into current_request
  from public.benefit_discount_requests
  where id = target_request_id
  for update;
  if not found then raise exception 'Benefit request not found.'; end if;

  if not public.is_active_account()
      or not public.can_access_branch(current_request.branch_id)
      or not public.has_permission(current_request.branch_id, 'promotions', 'approve') then
    raise exception 'You do not have permission to review this request.'
      using errcode = '42501';
  end if;
  if current_request.status <> 'pending' then
    raise exception 'This benefit request has already been reviewed.';
  end if;
  if decision = 'rejected'
      and (decision_note is null or length(btrim(decision_note)) < 3) then
    raise exception 'Provide a rejection reason of at least 3 characters.';
  end if;

  select * into current_order
  from public.orders
  where id = current_request.order_id
  for update;
  if not found then raise exception 'The related order no longer exists.'; end if;

  if decision = 'approved' then
    if current_request.document_path is null or not exists (
      select 1 from storage.objects
      where bucket_id = 'benefit-documents'
        and name = current_request.document_path
    ) then
      raise exception 'A private ID document must be available before approval.';
    end if;
    if current_order.promotion_id is not null or current_order.discount_total > 0 then
      raise exception 'This order already has a promotion; discounts cannot be stacked.';
    end if;
    if current_order.payment_status <> 'unpaid'
        or current_order.status in ('cancelled', 'completed') then
      raise exception 'Only unpaid, active orders can receive this discount.';
    end if;

    select * into current_policy
    from public.benefit_discount_policy
    where id and is_active
    for share;
    if not found then raise exception 'Benefit discount policy is inactive.'; end if;
    if current_policy.vat_registration = 'not_configured' then
      raise exception 'A Super Admin must configure the shop VAT registration before approving discounts.';
    end if;
    if (current_request.benefit_type = 'pwd' and not current_policy.pwd_enabled)
        or (current_request.benefit_type = 'senior_citizen' and not current_policy.senior_citizen_enabled) then
      raise exception 'This benefit type is disabled by the current policy.';
    end if;

    vat_multiplier := 1 + current_policy.vat_rate / 100;
    for request_item in
      select requested.order_item_id, requested.eligible_quantity,
             order_item.quantity as order_quantity,
             order_item.line_subtotal, order_item.discount_amount
      from public.benefit_discount_request_items as requested
      join public.order_items as order_item on order_item.id = requested.order_item_id
      where requested.request_id = target_request_id
      order by requested.order_item_id
      for update of order_item
    loop
      if request_item.eligible_quantity > request_item.order_quantity
          or request_item.discount_amount > 0 then
        raise exception 'A requested order line has changed since submission.';
      end if;
      eligible_gross := round(
        request_item.line_subtotal * request_item.eligible_quantity
        / request_item.order_quantity,
        2
      );
      if current_policy.vat_registration = 'vat_registered' then
        eligible_net := round(eligible_gross / vat_multiplier, 2);
        line_discount := eligible_gross
          - round(eligible_net * (1 - current_policy.discount_percent / 100), 2);
      else
        line_discount := round(eligible_gross * current_policy.discount_percent / 100, 2);
      end if;

      update public.order_items
      set discount_amount = discount_amount + line_discount,
          line_total = line_subtotal - discount_amount - line_discount
      where id = request_item.order_item_id;
      update public.benefit_discount_request_items
      set discount_amount = line_discount
      where request_id = target_request_id
        and order_item_id = request_item.order_item_id;
      total_discount := total_discount + line_discount;
    end loop;

    if total_discount <= 0 then
      raise exception 'The selected order lines do not produce an eligible discount.';
    end if;

    update public.orders
    set discount_total = discount_total + total_discount,
        total = total - total_discount
    where id = current_order.id;
    update public.payments
    set amount = current_order.total - total_discount
    where order_id = current_order.id and status = 'unpaid';
    update public.benefit_discount_requests
    set status = decision,
        discount_percent = current_policy.discount_percent,
        vat_registration = current_policy.vat_registration,
        vat_rate = current_policy.vat_rate,
        discount_total = total_discount,
        review_note = coalesce(btrim(decision_note), ''),
        reviewed_by = (select auth.uid()),
        reviewed_at = now()
    where id = target_request_id;
  else
    update public.benefit_discount_requests
    set status = decision,
        review_note = btrim(decision_note),
        reviewed_by = (select auth.uid()),
        reviewed_at = now()
    where id = target_request_id;
  end if;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    (select auth.uid()),
    case when decision = 'approved' then 'benefit_discount_approved' else 'benefit_discount_rejected' end,
    'benefit_discount_request',
    target_request_id,
    current_request.branch_id,
    jsonb_build_object(
      'order_id', current_order.id,
      'benefit_type', current_request.benefit_type,
      'discount_total', total_discount,
      'review_note', coalesce(btrim(decision_note), '')
    )
  );
end;
$$;

create or replace function public.clear_benefit_request_document(target_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_request public.benefit_discount_requests%rowtype;
begin
  select * into current_request
  from public.benefit_discount_requests
  where id = target_request_id
  for update;
  if not found then raise exception 'Benefit request not found.'; end if;

  if not public.is_active_account()
      or not public.can_access_branch(current_request.branch_id)
      or not public.has_permission(current_request.branch_id, 'promotions', 'approve') then
    raise exception 'You do not have permission to manage this document.'
      using errcode = '42501';
  end if;
  if current_request.document_path is null then
    raise exception 'This request has no stored document.';
  end if;

  update public.benefit_discount_requests
  set document_path = null
  where id = target_request_id;
  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    (select auth.uid()), 'benefit_document_reference_cleared',
    'benefit_discount_request', target_request_id, current_request.branch_id,
    jsonb_build_object('document_path_cleared', true)
  );
end;
$$;

revoke all on function public.admin_set_benefit_discount_policy(
  boolean, numeric, text, numeric, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.admin_set_benefit_discount_policy(
  boolean, numeric, text, numeric, boolean, boolean
) to authenticated;

revoke all on function public.create_benefit_discount_request(
  uuid, uuid, public.benefit_type, jsonb, text
) from public, anon, authenticated;
grant execute on function public.create_benefit_discount_request(
  uuid, uuid, public.benefit_type, jsonb, text
) to authenticated;

revoke all on function public.review_benefit_discount_request(
  uuid, public.benefit_request_status, text
) from public, anon, authenticated;
grant execute on function public.review_benefit_discount_request(
  uuid, public.benefit_request_status, text
) to authenticated;

revoke all on function public.clear_benefit_request_document(uuid)
  from public, anon, authenticated;
grant execute on function public.clear_benefit_request_document(uuid)
  to authenticated;
