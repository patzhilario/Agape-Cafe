create or replace function public.get_operational_report_with_payments(
  target_branch_id uuid,
  start_date date,
  end_date date,
  page_offset integer default 0,
  page_size integer default 50
)
returns table (
  order_id uuid,
  order_number text,
  branch_name text,
  created_at timestamptz,
  status public.order_status,
  payment_status public.payment_status,
  customer_name text,
  fulfillment_method public.order_fulfillment_method,
  subtotal numeric,
  discount_total numeric,
  total numeric,
  items jsonb,
  paid_amount numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select report.order_id,
         report.order_number,
         report.branch_name,
         report.created_at,
         report.status,
         report.payment_status,
         report.customer_name,
         report.fulfillment_method,
         report.subtotal,
         report.discount_total,
         report.total,
         report.items,
         case when payment.status = 'paid' then payment.amount else 0::numeric end
  from public.get_operational_report(
    target_branch_id, start_date, end_date, page_offset, page_size
  ) as report
  left join public.payments as payment on payment.order_id = report.order_id;
end;
$$;

create or replace function public.get_financial_report_with_payments(
  target_branch_id uuid,
  start_date date,
  end_date date
)
returns table (
  completed_orders bigint,
  gross_sales numeric,
  discounts numeric,
  net_sales numeric,
  cost_of_goods numeric,
  uncosted_orders bigint,
  expenses numeric,
  estimated_profit numeric,
  collected_sales numeric,
  paid_orders bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select financial.completed_orders,
         financial.gross_sales,
         financial.discounts,
         financial.net_sales,
         financial.cost_of_goods,
         financial.uncosted_orders,
         financial.expenses,
         financial.estimated_profit,
         coalesce(paid.total, 0)::numeric,
         coalesce(paid.order_count, 0)::bigint
  from public.get_financial_report(target_branch_id, start_date, end_date) as financial
  cross join lateral (
    select coalesce(sum(payment.amount), 0) as total,
           count(*) as order_count
    from public.payments as payment
    join public.orders as order_record on order_record.id = payment.order_id
    where payment.status = 'paid'
      and payment.updated_at >= (start_date::timestamp at time zone 'Asia/Manila')
      and payment.updated_at < ((end_date + 1)::timestamp at time zone 'Asia/Manila')
      and (target_branch_id is null or order_record.branch_id = target_branch_id)
  ) as paid;
end;
$$;

revoke all on function public.get_operational_report_with_payments(uuid, date, date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_operational_report_with_payments(uuid, date, date, integer, integer)
  to authenticated;
revoke all on function public.get_financial_report_with_payments(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.get_financial_report_with_payments(uuid, date, date)
  to authenticated;

notify pgrst, 'reload schema';
