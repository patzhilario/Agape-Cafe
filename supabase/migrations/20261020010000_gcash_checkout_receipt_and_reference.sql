alter table public.order_payment_proofs
  add column if not exists reference_number text;

alter table public.order_payment_proofs
  drop constraint if exists order_payment_proofs_reference_number_check;

alter table public.order_payment_proofs
  add constraint order_payment_proofs_reference_number_check
  check (
    reference_number is null
    or length(btrim(reference_number)) between 4 and 50
  );

update public.payment_methods
set instructions = 'Scan the QR code for your selected branch. Enter the GCash reference number and upload the receipt at checkout. Staff will verify the payment from the order details.'
where code = 'gcash';

drop function if exists public.submit_order_payment_proof(uuid, text);

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
  proof_id uuid;
  current_proof public.order_payment_proofs%rowtype;
begin
  if current_user_id is null or not public.is_active_account() then
    raise exception 'Sign in with an active account to submit payment proof.'
      using errcode = '42501';
  end if;

  if payment_reference_number is null
      or length(btrim(payment_reference_number)) not between 4 and 50 then
    raise exception 'Enter a GCash reference number between 4 and 50 characters.';
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
      current_order.id,
      current_user_id,
      current_order.branch_id,
      uploaded_document_path,
      btrim(payment_reference_number)
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
  if decision = 'approved' and exists (
    select 1 from public.benefit_discount_requests
    where order_id = target_order_id and status = 'pending'
  ) then
    raise exception 'Verify the benefit discount before approving GCash payment.';
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
