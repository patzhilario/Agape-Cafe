create function public.get_product_sales_report(
  target_branch_id uuid,
  start_date date,
  end_date date,
  target_grouping text,
  page_offset integer default 0,
  page_size integer default 50
)
returns table (
  period_start date,
  product_id uuid,
  product_name text,
  category_name text,
  units_sold bigint,
  order_count bigint,
  gross_sales numeric,
  net_sales numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_active_account() then
    raise exception 'An active account is required to view product sales reports.'
      using errcode = '42501';
  end if;
  if start_date is null or end_date is null or end_date < start_date
      or end_date - start_date > 3650 then
    raise exception 'Choose a valid product sales period of no more than 10 years.';
  end if;
  if target_grouping is null or target_grouping not in ('day', 'month', 'year') then
    raise exception 'Choose day, month, or year grouping.';
  end if;
  if page_offset is null or page_offset < 0 or page_offset > 1000000
      or page_size is null or page_size < 1 or page_size > 250 then
    raise exception 'Report pagination values are invalid.';
  end if;
  if target_branch_id is null then
    if not public.has_role('super_admin') then
      raise exception 'Only a Super Admin can run an all-branch product sales report.'
        using errcode = '42501';
    end if;
  elsif not public.can_access_branch(target_branch_id)
      or not public.has_permission(target_branch_id, 'reports', 'view') then
    raise exception 'You do not have permission to view product sales for this branch.'
      using errcode = '42501';
  end if;

  if (
    select count(*)
    from (
      select date_trunc(
               target_grouping,
               order_record.created_at at time zone 'Asia/Manila'
             )::date as period_start,
             item.product_id,
             item.product_name,
             coalesce(category.name, 'Uncategorized') as category_name
      from public.orders as order_record
      join public.order_items as item on item.order_id = order_record.id
      left join public.products as product on product.id = item.product_id
      left join public.categories as category on category.id = product.category_id
      where order_record.status = 'completed'
        and order_record.created_at >= (start_date::timestamp at time zone 'Asia/Manila')
        and order_record.created_at < ((end_date + 1)::timestamp at time zone 'Asia/Manila')
        and (target_branch_id is null or order_record.branch_id = target_branch_id)
      group by 1, 2, 3, 4
    ) as grouped_sales
  ) > 10000 then
    raise exception 'This report contains more than 10,000 product rows. Narrow the date range or change grouping.';
  end if;

  return query
  select date_trunc(
           target_grouping,
           order_record.created_at at time zone 'Asia/Manila'
         )::date,
         item.product_id,
         item.product_name,
         coalesce(category.name, 'Uncategorized'),
         sum(item.quantity)::bigint,
         count(distinct order_record.id)::bigint,
         coalesce(sum(item.line_subtotal), 0)::numeric,
         coalesce(sum(item.line_total), 0)::numeric
  from public.orders as order_record
  join public.order_items as item on item.order_id = order_record.id
  left join public.products as product on product.id = item.product_id
  left join public.categories as category on category.id = product.category_id
  where order_record.status = 'completed'
    and order_record.created_at >= (start_date::timestamp at time zone 'Asia/Manila')
    and order_record.created_at < ((end_date + 1)::timestamp at time zone 'Asia/Manila')
    and (target_branch_id is null or order_record.branch_id = target_branch_id)
  group by 1, 2, 3, 4
  order by 1 desc, 5 desc, 3
  limit page_size
  offset page_offset;
end;
$$;

revoke all on function public.get_product_sales_report(uuid, date, date, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_product_sales_report(uuid, date, date, text, integer, integer)
  to authenticated;

notify pgrst, 'reload schema';
