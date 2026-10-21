alter table public.branches
  add column if not exists gcash_qr_path text;

create function public.audit_branch_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (
    actor_id, action, record_type, record_id, details
  )
  values (
    (select auth.uid()),
    case when tg_op = 'INSERT' then 'branch_created' else 'branch_updated' end,
    'branch',
    new.id,
    jsonb_build_object(
      'name', new.name,
      'is_active', new.is_active,
      'gcash_qr_configured', new.gcash_qr_path is not null
    )
  );
  return new;
end;
$$;

create trigger branches_audit_changes
after insert or update on public.branches
for each row execute function public.audit_branch_changes();

insert into public.payment_methods (
  code, name, instructions, settlement_type, provider, is_active
)
values (
  'gcash',
  'GCash',
  'Scan the QR code for your selected branch. Upload your payment proof from the order details; staff will verify it before marking the order paid.',
  'provider',
  'gcash',
  true
)
on conflict (code) do update
set name = excluded.name,
    instructions = excluded.instructions,
    settlement_type = excluded.settlement_type,
    provider = excluded.provider,
    is_active = excluded.is_active;

do $$
declare
  function_definition text;
  original_condition text := 'and settlement_type = ''pay_at_branch''';
  updated_condition text := 'and settlement_type in (''pay_at_branch'', ''provider'')';
begin
  function_definition := pg_get_functiondef(
    'public.create_customer_order(uuid, public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb)'::regprocedure
  );
  if position(original_condition in function_definition) = 0
      or position(updated_condition in function_definition) > 0 then
    raise exception 'Could not safely update online payment support in create_customer_order.';
  end if;
  execute replace(function_definition, original_condition, updated_condition);
end;
$$;

create table public.order_payment_proofs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete restrict,
  customer_id uuid not null references public.profiles (id) on delete restrict,
  branch_id uuid not null references public.branches (id) on delete restrict,
  document_path text not null check (length(document_path) between 1 and 512),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (review_note is null or length(review_note) <= 500)
);

create index order_payment_proofs_branch_status_idx
  on public.order_payment_proofs (branch_id, status, created_at desc);

alter table public.order_payment_proofs enable row level security;

create function public.guard_gcash_payment_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid'
      and old.status is distinct from new.status
      and new.payment_method_code = 'gcash'
      and not exists (
        select 1
        from public.order_payment_proofs
        where order_id = new.order_id
          and status = 'approved'
      ) then
    raise exception 'Verify the submitted GCash payment proof before marking this order paid.';
  end if;
  return new;
end;
$$;

create trigger payments_require_verified_gcash_proof
before update of status on public.payments
for each row execute function public.guard_gcash_payment_verification();

create policy "Customers and order managers can view payment proofs"
on public.order_payment_proofs for select to authenticated
using (
  customer_id = (select auth.uid())
  or (
    public.can_access_branch(branch_id)
    and public.has_permission(branch_id, 'orders', 'view')
  )
);

revoke all on public.order_payment_proofs from anon, authenticated;
grant select on public.order_payment_proofs to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branch-payment-qr',
  'branch-payment-qr',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Super admins can upload branch payment QR codes"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'branch-payment-qr'
  and public.has_role('super_admin')
);

create policy "Super admins can update branch payment QR codes"
on storage.objects for update to authenticated
using (bucket_id = 'branch-payment-qr' and public.has_role('super_admin'))
with check (bucket_id = 'branch-payment-qr' and public.has_role('super_admin'));

create policy "Super admins can delete branch payment QR codes"
on storage.objects for delete to authenticated
using (bucket_id = 'branch-payment-qr' and public.has_role('super_admin'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-payment-proofs',
  'order-payment-proofs',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Customers can upload their own order payment proof"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'order-payment-proofs'
  and public.is_active_account()
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Customers can replace their rejected order proof"
on storage.objects for delete to authenticated
using (
  bucket_id = 'order-payment-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Customers and assigned order managers can view payment proof files"
on storage.objects for select to authenticated
using (
  bucket_id = 'order-payment-proofs'
  and exists (
    select 1
    from public.order_payment_proofs as proof
    where proof.document_path = storage.objects.name
      and (
        proof.customer_id = (select auth.uid())
        or (
          public.can_access_branch(proof.branch_id)
          and public.has_permission(proof.branch_id, 'orders', 'view')
        )
      )
  )
);

create or replace function public.create_customer_order_with_benefit(
  target_branch_id uuid,
  fulfillment public.order_fulfillment_method,
  payment_method_id uuid,
  client_request_id uuid,
  customer_phone text,
  customer_note text,
  requested_promotion_id uuid,
  cart_items jsonb,
  target_benefit_request_id uuid default null,
  requested_benefit_type public.benefit_type default null,
  requested_benefit_items jsonb default null,
  uploaded_benefit_document_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_order_id uuid;
  benefit_item jsonb;
  order_item_id uuid;
  mapped_items jsonb := '[]'::jsonb;
  mapped_order_item_ids uuid[] := array[]::uuid[];
begin
  if (
    target_benefit_request_id is null
    and requested_benefit_type is null
    and requested_benefit_items is null
    and uploaded_benefit_document_path is null
  ) then
    return public.create_customer_order(
      target_branch_id, fulfillment, payment_method_id, client_request_id,
      customer_phone, customer_note, requested_promotion_id, cart_items
    );
  end if;
  if target_benefit_request_id is null
      or requested_benefit_type is null
      or requested_benefit_items is null
      or uploaded_benefit_document_path is null
      or requested_promotion_id is not null then
    raise exception 'Choose a benefit type, eligible items, and upload ID evidence. Benefit discounts cannot be combined with a promotion.';
  end if;

  created_order_id := public.create_customer_order(
    target_branch_id, fulfillment, payment_method_id, client_request_id,
    customer_phone, customer_note, requested_promotion_id, cart_items
  );

  if not exists (
    select 1 from public.benefit_discount_requests
    where id = target_benefit_request_id and order_id = created_order_id
  ) then
    for benefit_item in
      select entry.value from jsonb_array_elements(requested_benefit_items) as entry(value)
    loop
      select order_item.id into order_item_id
      from public.order_items as order_item
      where order_item.order_id = created_order_id
        and order_item.product_id = (benefit_item ->> 'product_id')::uuid
        and order_item.variant_id is not distinct from
          nullif(benefit_item ->> 'variant_id', '')::uuid
        and not (order_item.id = any(mapped_order_item_ids))
        and coalesce((
          select array_agg(addon.addon_id order by addon.addon_id)
          from public.order_item_addons as addon
          where addon.order_item_id = order_item.id
        ), array[]::uuid[]) = array(
          select addon.value::uuid
          from jsonb_array_elements_text(
            coalesce(benefit_item -> 'addon_ids', '[]'::jsonb)
          ) as addon(value)
          order by addon.value::uuid
        )
      limit 1;
      if order_item_id is null then
        raise exception 'A selected benefit item could not be matched to the submitted order.';
      end if;
      mapped_order_item_ids := array_append(mapped_order_item_ids, order_item_id);
      mapped_items := mapped_items || jsonb_build_array(jsonb_build_object(
        'order_item_id', order_item_id,
        'eligible_quantity', benefit_item -> 'eligible_quantity'
      ));
    end loop;

    perform public.create_benefit_discount_request(
      target_benefit_request_id,
      created_order_id,
      requested_benefit_type,
      mapped_items,
      uploaded_benefit_document_path
    );
  end if;
  return created_order_id;
end;
$$;

revoke all on function public.create_customer_order_with_benefit(
  uuid, public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb,
  uuid, public.benefit_type, jsonb, text
) from public, anon, authenticated;
grant execute on function public.create_customer_order_with_benefit(
  uuid, public.order_fulfillment_method, uuid, uuid, text, text, uuid, jsonb,
  uuid, public.benefit_type, jsonb, text
) to authenticated;

create or replace function public.submit_order_payment_proof(
  target_order_id uuid,
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
  proof_id uuid;
  current_proof public.order_payment_proofs%rowtype;
begin
  if current_user_id is null or not public.is_active_account() then
    raise exception 'Sign in with an active account to submit payment proof.'
      using errcode = '42501';
  end if;

  select * into current_order
  from public.orders
  where id = target_order_id and customer_id = current_user_id
  for update;
  if not found then raise exception 'This order is not available to your account.'; end if;
  if current_order.payment_status <> 'unpaid'
      or current_order.status in ('cancelled', 'completed') then
    raise exception 'Payment proof can only be submitted for an active unpaid order.';
  end if;
  if exists (
    select 1 from public.benefit_discount_requests
    where order_id = target_order_id and status = 'pending'
  ) then
    raise exception 'Wait for staff to verify your benefit discount before paying the updated total.';
  end if;
  if not exists (
    select 1 from public.payments
    where order_id = target_order_id and payment_method_code = 'gcash'
  ) then
    raise exception 'This order does not use GCash payment.';
  end if;
  if uploaded_document_path is null
      or length(uploaded_document_path) > 512
      or split_part(uploaded_document_path, '/', 1) <> current_user_id::text
      or split_part(uploaded_document_path, '/', 2) <> target_order_id::text
      or not exists (
        select 1 from storage.objects
        where bucket_id = 'order-payment-proofs'
          and name = uploaded_document_path
          and owner_id = current_user_id::text
      ) then
    raise exception 'Upload a private payment proof under your own order folder.';
  end if;
  select * into current_proof
  from public.order_payment_proofs
  where order_id = target_order_id
  for update;
  if found then
    if current_proof.status <> 'rejected' then
      raise exception 'Payment proof has already been submitted for this order.';
    end if;
    update public.order_payment_proofs
    set document_path = uploaded_document_path,
        status = 'pending',
        review_note = null,
        reviewed_by = null,
        reviewed_at = null,
        created_at = now()
    where id = current_proof.id
    returning id into proof_id;
  else
    insert into public.order_payment_proofs (
      order_id, customer_id, branch_id, document_path
    )
    values (
      current_order.id, current_user_id, current_order.branch_id, uploaded_document_path
    )
    returning id into proof_id;
  end if;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    current_user_id, 'order_payment_proof_submitted', 'order_payment_proof',
    proof_id, current_order.branch_id,
    jsonb_build_object('order_id', current_order.id, 'payment_method', 'gcash')
  );
  return proof_id;
end;
$$;

create or replace function public.review_order_payment_proof(
  target_order_id uuid,
  decision text,
  decision_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_order public.orders%rowtype;
  current_proof public.order_payment_proofs%rowtype;
begin
  if decision not in ('approved', 'rejected') then
    raise exception 'Choose approve or reject.';
  end if;
  if decision_note is not null and length(decision_note) > 500 then
    raise exception 'Review notes cannot exceed 500 characters.';
  end if;

  select * into current_order
  from public.orders where id = target_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if not public.is_active_account()
      or not public.can_access_branch(current_order.branch_id)
      or not public.has_permission(current_order.branch_id, 'orders', 'edit') then
    raise exception 'You do not have permission to review this payment.'
      using errcode = '42501';
  end if;

  select * into current_proof
  from public.order_payment_proofs
  where order_id = target_order_id
  for update;
  if not found then raise exception 'No GCash payment proof has been submitted.'; end if;
  if current_proof.status <> 'pending' then
    raise exception 'This payment proof has already been reviewed.';
  end if;
  if decision = 'rejected'
      and (decision_note is null or length(btrim(decision_note)) < 3) then
    raise exception 'Provide a rejection reason of at least 3 characters.';
  end if;

  update public.order_payment_proofs
  set status = decision,
      review_note = nullif(btrim(decision_note), ''),
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = current_proof.id;

  if decision = 'approved' then
    perform public.record_order_payment(target_order_id);
  else
    insert into public.audit_logs (
      actor_id, action, record_type, record_id, branch_id, details
    )
    values (
      (select auth.uid()), 'order_payment_proof_rejected', 'order_payment_proof',
      current_proof.id, current_order.branch_id,
      jsonb_build_object('order_id', target_order_id, 'review_note', btrim(decision_note))
    );
  end if;
end;
$$;

revoke all on function public.submit_order_payment_proof(uuid, text)
  from public, anon, authenticated;
grant execute on function public.submit_order_payment_proof(uuid, text)
  to authenticated;
revoke all on function public.review_order_payment_proof(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.review_order_payment_proof(uuid, text, text)
  to authenticated;

notify pgrst, 'reload schema';
