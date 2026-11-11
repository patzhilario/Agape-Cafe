begin;

update storage.buckets
set allowed_mime_types = array['image/jpeg'], file_size_limit = 10485760
where id = 'order-payment-proofs';

-- Reference typing is optional; JPEG ownership and receipt checks remain required.
create or replace function public.submit_order_payment_proof(
  target_order_id uuid,
  uploaded_document_path text,
  payment_reference_number text default null
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
  if payment_reference_number is not null
      and length(btrim(payment_reference_number)) not between 4 and 50 then
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

  if uploaded_document_path is null or uploaded_document_path !~* '\.jpe?g$' then
    raise exception 'Upload a JPEG (.jpg or .jpeg) payment receipt only.';
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
          and metadata ->> 'mimetype' = 'image/jpeg'
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

create table public.customer_notifications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null check (event_type in ('order_rejected', 'payment_rejected', 'order_preparing', 'order_ready')),
  title text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index customer_notifications_unread_idx
  on public.customer_notifications(customer_id, created_at desc, id desc)
  where read_at is null;
alter table public.customer_notifications enable row level security;
revoke all on public.customer_notifications from public, anon, authenticated;
grant select on public.customer_notifications to authenticated;
create policy "Customers can read their own notifications"
on public.customer_notifications for select to authenticated
using (customer_id = (select auth.uid()) and public.is_active_account());

create function public.mark_customer_notification_read(target_notification_id uuid default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_active_account() then
    raise exception 'Sign in with an active account.' using errcode = '42501';
  end if;
  update public.customer_notifications
  set read_at = now()
  where customer_id = (select auth.uid()) and read_at is null
    and (target_notification_id is null or id = target_notification_id);
end;
$$;
revoke all on function public.mark_customer_notification_read(uuid) from public, anon, authenticated;
grant execute on function public.mark_customer_notification_read(uuid) to authenticated;

create function public.notify_customer_order_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  order_record public.orders%rowtype;
  event_name text;
  notification_title text;
  notification_message text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if tg_table_name = 'orders' then
    order_record := new;
    if new.status = 'cancelled' then
      event_name := 'order_rejected';
      notification_title := 'Order rejected';
      notification_message := 'Your order ' || new.order_number || ' was rejected. Reason: ' ||
        coalesce(nullif(btrim(new.cancellation_reason), ''), 'Please contact the store for details.');
    elsif new.status = 'preparing' then
      event_name := 'order_preparing';
      notification_title := 'Orders preparing';
      notification_message := 'Your order ' || new.order_number || ' is being prepared.';
    elsif new.status = 'ready' then
      event_name := 'order_ready';
      notification_title := 'Orders Ready';
      notification_message := 'Your order ' || new.order_number || ' is ready for delivery.';
    else
      return new;
    end if;
  else
    if new.status <> 'rejected' then return new; end if;
    select * into order_record from public.orders where id = new.order_id;
    event_name := 'payment_rejected';
    notification_title := 'Payment receipt rejected';
    notification_message := 'The receipt for order ' || order_record.order_number ||
      ' was rejected. Reason: ' || coalesce(nullif(btrim(new.review_note), ''), 'Please upload a new JPEG receipt.');
  end if;
  insert into public.customer_notifications(customer_id, order_id, event_type, title, message)
  values(order_record.customer_id, order_record.id, event_name, notification_title, notification_message);
  return new;
end;
$$;
revoke all on function public.notify_customer_order_update() from public, anon, authenticated;
create trigger orders_notify_customer
  after update of status on public.orders
  for each row execute function public.notify_customer_order_update();
create trigger order_payment_proofs_notify_customer
  after update of status on public.order_payment_proofs
  for each row execute function public.notify_customer_order_update();

notify pgrst, 'reload schema';
commit;
