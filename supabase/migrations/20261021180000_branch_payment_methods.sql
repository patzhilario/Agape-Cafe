alter table public.payment_methods
  add column branch_id uuid references public.branches(id) on delete cascade,
  add column qr_code_path text;

alter table public.payment_methods
  drop constraint if exists payment_methods_code_key;

create unique index payment_methods_branch_code_key
  on public.payment_methods(branch_id, code)
  where branch_id is not null;

insert into public.payment_methods (
  branch_id,
  code,
  name,
  instructions,
  settlement_type,
  provider,
  is_active,
  qr_code_path
)
select branch.id,
       method.code,
       case when method.code = 'cash_at_branch' then 'Cash' else method.name end,
       case when method.code = 'cash_at_branch'
         then 'Pay cash at this branch. Staff will record the payment.'
         else method.instructions
       end,
       method.settlement_type,
       method.provider,
       method.is_active and (
         method.settlement_type = 'pay_at_branch'
         or branch.gcash_qr_path is not null
       ),
       case when method.code = 'gcash' then branch.gcash_qr_path else null end
from public.branches as branch
cross join public.payment_methods as method
where method.branch_id is null
  and method.code in ('cash_at_branch', 'gcash')
on conflict (branch_id, code) where branch_id is not null
do update set
  name = excluded.name,
  instructions = excluded.instructions,
  settlement_type = excluded.settlement_type,
  provider = excluded.provider,
  is_active = excluded.is_active,
  qr_code_path = excluded.qr_code_path;

update public.payment_methods
set is_active = false
where branch_id is null;

drop policy if exists "Anyone can view active payment methods" on public.payment_methods;
create policy "Anyone can view active branch payment methods"
on public.payment_methods for select to anon, authenticated
using (
  (is_active and branch_id is not null and exists (
    select 1 from public.branches as branch
    where branch.id = payment_methods.branch_id and branch.is_active
  ))
  or exists (
    select 1
    from public.payments as payment
    join public.orders as order_record on order_record.id = payment.order_id
    where payment.payment_method_id = payment_methods.id
      and (
        order_record.customer_id = (select auth.uid())
        or (
          public.can_access_branch(order_record.branch_id)
          and public.has_permission(order_record.branch_id, 'orders', 'view')
        )
      )
  )
  or public.has_role('super_admin')
);

create or replace function public.enforce_fulfillment_payment_method()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  order_fulfillment public.order_fulfillment_method;
  order_branch_id uuid;
  method_branch_id uuid;
  method_settlement_type text;
  method_is_active boolean;
  method_qr_path text;
begin
  select order_record.fulfillment_method, order_record.branch_id
  into order_fulfillment, order_branch_id
  from public.orders as order_record
  where order_record.id = new.order_id;

  if not found then
    raise exception 'Payment must belong to an existing order.';
  end if;

  select payment_method.branch_id,
         payment_method.settlement_type,
         payment_method.is_active,
         payment_method.qr_code_path
  into method_branch_id,
       method_settlement_type,
       method_is_active,
       method_qr_path
  from public.payment_methods as payment_method
  where payment_method.id = new.payment_method_id;

  if not found
      or method_branch_id is distinct from order_branch_id
      or not method_is_active then
    raise exception 'Choose an active payment method configured for this branch.';
  end if;

  if order_fulfillment = 'delivery'
      and (method_settlement_type <> 'provider' or method_qr_path is null) then
    raise exception 'Delivery orders require an enabled online QR payment method.';
  end if;

  return new;
end;
$$;

drop trigger if exists payments_enforce_fulfillment_method on public.payments;
create trigger payments_enforce_fulfillment_method
before insert or update of payment_method_id, payment_method_code on public.payments
for each row execute function public.enforce_fulfillment_payment_method();

create or replace function public.guard_gcash_payment_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid'
      and old.status is distinct from new.status
      and exists (
        select 1
        from public.payment_methods as method
        where method.id = new.payment_method_id
          and method.settlement_type = 'provider'
      )
      and not exists (
        select 1
        from public.payment_manual_override_authorizations as override_auth
        where override_auth.transaction_id = pg_catalog.txid_current()
          and override_auth.order_id = new.order_id
          and override_auth.actor_id = (select auth.uid())
      )
      and not exists (
        select 1 from public.order_payment_proofs
        where order_id = new.order_id and status = 'approved'
      ) then
    raise exception 'Verify the submitted payment proof before marking this online payment as paid.';
  end if;
  return new;
end;
$$;

create or replace function public.record_manual_provider_payment_override(
  target_order_id uuid,
  override_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_order public.orders%rowtype;
  current_payment public.payments%rowtype;
  normalized_reason text := btrim(override_reason);
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
  if normalized_reason is null or length(normalized_reason) not between 3 and 500 then
    raise exception 'Enter a manual override reason between 3 and 500 characters.';
  end if;

  select payment.* into current_payment
  from public.payments as payment
  join public.payment_methods as method on method.id = payment.payment_method_id
  where payment.order_id = target_order_id
    and payment.status = 'unpaid'
    and method.settlement_type = 'provider'
  for update of payment;
  if not found then
    raise exception 'Manual override is only available for unpaid online payment orders.';
  end if;
  if exists (
    select 1 from public.order_payment_proofs
    where order_id = target_order_id
  ) then
    raise exception 'Review the submitted payment proof instead of using a manual override.';
  end if;

  insert into public.payment_manual_override_authorizations (
    transaction_id, order_id, actor_id
  )
  values (pg_catalog.txid_current(), target_order_id, (select auth.uid()));

  perform public.record_order_payment(target_order_id);

  delete from public.payment_manual_override_authorizations
  where transaction_id = pg_catalog.txid_current()
    and order_id = target_order_id
    and actor_id = (select auth.uid());

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    (select auth.uid()),
    'order_payment_manual_override',
    'order',
    target_order_id,
    current_order.branch_id,
    jsonb_build_object(
      'amount', current_order.total,
      'payment_method', current_payment.payment_method_code,
      'payment_status', 'paid',
      'reason', normalized_reason
    )
  );
end;
$$;

revoke all on function public.record_manual_provider_payment_override(uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_manual_provider_payment_override(uuid, text)
  to authenticated;

create or replace function public.submit_order_payment_proof(
  target_order_id uuid,
  uploaded_document_path text,
  payment_reference_number text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_order public.orders%rowtype;
  current_payment public.payments%rowtype;
  current_method public.payment_methods%rowtype;
  proof_id uuid;
  current_proof public.order_payment_proofs%rowtype;
begin
  if current_user_id is null or not public.is_active_account() then
    raise exception 'Sign in with an active account to submit payment proof.'
      using errcode = '42501';
  end if;
  if payment_reference_number is null
      or length(btrim(payment_reference_number)) not between 4 and 50 then
    raise exception 'Enter a payment reference number between 4 and 50 characters.';
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

  select payment.* into current_payment
  from public.payments as payment
  where payment.order_id = target_order_id;
  if not found then raise exception 'Payment transaction not found.'; end if;

  select method.* into current_method
  from public.payment_methods as method
  where method.id = current_payment.payment_method_id;
  if not found or current_method.settlement_type <> 'provider' then
    raise exception 'This order does not use an online payment method.';
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
        reference_number = btrim(payment_reference_number),
        status = 'pending',
        review_note = null,
        reviewed_by = null,
        reviewed_at = null,
        created_at = now()
    where id = current_proof.id
    returning id into proof_id;
  else
    insert into public.order_payment_proofs (
      order_id, customer_id, branch_id, document_path, reference_number
    )
    values (
      current_order.id, current_user_id, current_order.branch_id,
      uploaded_document_path, btrim(payment_reference_number)
    )
    returning id into proof_id;
  end if;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    current_user_id, 'order_payment_proof_submitted', 'order_payment_proof',
    proof_id, current_order.branch_id,
    jsonb_build_object(
      'order_id', current_order.id,
      'payment_method', current_payment.payment_method_code
    )
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
  if not found then raise exception 'No payment proof has been submitted.'; end if;
  if current_proof.status <> 'pending' then
    raise exception 'This payment proof has already been reviewed.';
  end if;
  if decision = 'approved' and exists (
    select 1 from public.benefit_discount_requests
    where order_id = target_order_id and status = 'pending'
  ) then
    raise exception 'Verify the benefit discount before approving payment.';
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

revoke all on function public.submit_order_payment_proof(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_order_payment_proof(uuid, text, text)
  to authenticated;
revoke all on function public.review_order_payment_proof(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.review_order_payment_proof(uuid, text, text)
  to authenticated;

notify pgrst, 'reload schema';
