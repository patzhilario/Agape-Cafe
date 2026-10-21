drop function public.get_report_payment_transactions(uuid, text, date, date, integer, integer);

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
  refund_amount numeric,
  order_created_at timestamptz
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
         refund_totals.refund_amount,
         order_record.created_at
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
    and order_record.created_at >= (start_date::timestamp at time zone 'Asia/Manila')
    and order_record.created_at < ((end_date + 1)::timestamp at time zone 'Asia/Manila')
    and (target_branch_id is null or order_record.branch_id = target_branch_id)
    and (
      target_payment_method_code is null
      or payment.payment_method_code = target_payment_method_code
    )
  order by order_record.created_at desc, payment.id desc
  limit page_size
  offset page_offset;
end;
$$;

revoke all on function public.get_report_payment_transactions(uuid, text, date, date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_report_payment_transactions(uuid, text, date, date, integer, integer)
  to authenticated;

notify pgrst, 'reload schema';
