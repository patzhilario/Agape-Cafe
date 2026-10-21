create table public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  note text not null check (length(btrim(note)) between 3 and 500),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index payment_refunds_payment_created_idx
  on public.payment_refunds(payment_id, created_at desc, id desc);

alter table public.payment_refunds enable row level security;
revoke all on public.payment_refunds from public, anon, authenticated;

create function public.get_report_payment_transactions(
  target_branch_id uuid,
  target_payment_method_code text,
  start_date date,
  end_date date,
  page_offset integer default 0,
  page_size integer default 50
)
returns table (
  payment_id uuid,
  branch_id uuid,
  branch_name text,
  order_id uuid,
  order_number text,
  customer_name text,
  order_status public.order_status,
  fulfillment_method public.order_fulfillment_method,
  subtotal numeric,
  discount_total numeric,
  total numeric,
  items jsonb,
  payment_method_code text,
  payment_method_name text,
  amount numeric,
  status public.payment_status,
  created_at timestamptz,
  updated_at timestamptz,
  refund_count bigint,
  refund_amount numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_active_account() then
    raise exception 'An active account is required to view payment reports.'
      using errcode = '42501';
  end if;
  if start_date is null or end_date is null or end_date < start_date
      or end_date - start_date > 365 then
    raise exception 'Choose a valid report period of no more than 366 days.';
  end if;
  if page_offset is null or page_offset < 0 or page_offset > 1000000
      or page_size is null or page_size < 1 or page_size > 250 then
    raise exception 'Report pagination values are invalid.';
  end if;
  if target_branch_id is null then
    if not public.has_role('super_admin') then
      raise exception 'Only a Super Admin can run an all-branch payment report.'
        using errcode = '42501';
    end if;
  elsif not public.can_access_branch(target_branch_id)
      or not public.has_permission(target_branch_id, 'financials', 'view')
      or not public.has_permission(target_branch_id, 'reports', 'view') then
    raise exception 'You do not have permission to view payments for this branch.'
      using errcode = '42501';
  end if;

  return query
  select payment.id,
         branch.id,
         branch.name,
         order_record.id,
         order_record.order_number,
         order_record.customer_name,
         order_record.status,
         order_record.fulfillment_method,
         order_record.subtotal,
         order_record.discount_total,
         order_record.total,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'product_name', order_item.product_name,
             'variant_name', order_item.variant_name,
             'quantity', order_item.quantity,
             'line_total', order_item.line_total
           ) order by order_item.created_at, order_item.id)
           from public.order_items as order_item
           where order_item.order_id = order_record.id
         ), '[]'::jsonb),
         payment.payment_method_code,
         payment.payment_method_name,
         payment.amount,
         payment.status,
         payment.created_at,
         payment.updated_at,
         refund_totals.refund_count,
         refund_totals.refund_amount
  from public.payments as payment
  join public.orders as order_record on order_record.id = payment.order_id
  join public.branches as branch on branch.id = order_record.branch_id
  cross join lateral (
    select count(*)::bigint as refund_count,
           coalesce(sum(refund.amount), 0)::numeric as refund_amount
    from public.payment_refunds as refund
    where refund.payment_id = payment.id
  ) as refund_totals
  where payment.status in ('paid', 'refunded', 'partially_refunded')
    and payment.updated_at >= (start_date::timestamp at time zone 'Asia/Manila')
    and payment.updated_at < ((end_date + 1)::timestamp at time zone 'Asia/Manila')
    and (target_branch_id is null or order_record.branch_id = target_branch_id)
    and (
      target_payment_method_code is null
      or payment.payment_method_code = target_payment_method_code
    )
  order by payment.updated_at desc, payment.id desc
  limit page_size
  offset page_offset;
end;
$$;

create function public.get_payment_refund_history(target_payment_id uuid)
returns table (
  refund_id uuid,
  amount numeric,
  note text,
  created_at timestamptz,
  created_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payment_branch_id uuid;
begin
  if not public.is_active_account() then
    raise exception 'An active account is required to view refund history.'
      using errcode = '42501';
  end if;

  select order_record.branch_id into payment_branch_id
  from public.payments as payment
  join public.orders as order_record on order_record.id = payment.order_id
  where payment.id = target_payment_id;
  if not found then raise exception 'Payment transaction not found.'; end if;

  if not public.can_access_branch(payment_branch_id)
      or not public.has_permission(payment_branch_id, 'financials', 'view')
      or not public.has_permission(payment_branch_id, 'reports', 'view') then
    raise exception 'You do not have permission to view refund history for this branch.'
      using errcode = '42501';
  end if;

  return query
  select refund.id,
         refund.amount,
         refund.note,
         refund.created_at,
         profile.display_name
  from public.payment_refunds as refund
  join public.profiles as profile on profile.id = refund.created_by
  where refund.payment_id = target_payment_id
  order by refund.created_at desc, refund.id desc;
end;
$$;

create function public.record_payment_refund(
  target_payment_id uuid,
  target_amount numeric,
  target_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_payment public.payments%rowtype;
  current_branch_id uuid;
  refunded_amount numeric;
  refund_id uuid;
begin
  if not public.is_active_account() then
    raise exception 'An active account is required to record a refund.'
      using errcode = '42501';
  end if;

  select payment.* into current_payment
  from public.payments as payment
  where payment.id = target_payment_id
  for update;
  if not found then raise exception 'Payment transaction not found.'; end if;

  select order_record.branch_id into current_branch_id
  from public.orders as order_record
  where order_record.id = current_payment.order_id;

  if not public.can_access_branch(current_branch_id)
      or not public.has_permission(current_branch_id, 'financials', 'edit')
      or not public.has_permission(current_branch_id, 'reports', 'view') then
    raise exception 'You do not have permission to record refunds for this branch.'
      using errcode = '42501';
  end if;
  if current_payment.status not in ('paid', 'partially_refunded') then
    raise exception 'Only paid transactions can be refunded.';
  end if;
  if target_amount is null or target_amount <= 0 or target_amount > current_payment.amount then
    raise exception 'Enter a refund amount greater than zero and no more than the payment amount.';
  end if;
  if target_note is null or length(btrim(target_note)) not between 3 and 500 then
    raise exception 'Enter a refund note between 3 and 500 characters.';
  end if;

  select coalesce(sum(refund.amount), 0) into refunded_amount
  from public.payment_refunds as refund
  where refund.payment_id = target_payment_id;
  if refunded_amount + target_amount > current_payment.amount then
    raise exception 'The refund amount exceeds the remaining refundable balance.';
  end if;

  insert into public.payment_refunds (
    payment_id, amount, note, created_by
  )
  values (
    target_payment_id, target_amount, btrim(target_note), (select auth.uid())
  )
  returning id into refund_id;

  insert into public.audit_logs (
    actor_id, action, record_type, record_id, branch_id, details
  )
  values (
    (select auth.uid()),
    'payment_refund_recorded',
    'payment',
    target_payment_id,
    current_branch_id,
    jsonb_build_object(
      'refund_id', refund_id,
      'amount', target_amount,
      'note', btrim(target_note)
    )
  );

  return refund_id;
end;
$$;

revoke all on function public.get_report_payment_transactions(uuid, text, date, date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_report_payment_transactions(uuid, text, date, date, integer, integer)
  to authenticated;
revoke all on function public.get_payment_refund_history(uuid)
  from public, anon, authenticated;
grant execute on function public.get_payment_refund_history(uuid)
  to authenticated;
revoke all on function public.record_payment_refund(uuid, numeric, text)
  from public, anon, authenticated;
grant execute on function public.record_payment_refund(uuid, numeric, text)
  to authenticated;

notify pgrst, 'reload schema';
