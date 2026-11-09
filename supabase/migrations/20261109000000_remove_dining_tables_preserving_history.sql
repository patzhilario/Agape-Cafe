-- Remove tables from service without breaking historical order references.
alter table public.branch_dining_tables
  add column if not exists deleted_at timestamptz;

alter table public.branch_dining_tables
  add constraint branch_dining_tables_removed_inactive
  check (deleted_at is null or not is_active);

drop index if exists public.branch_dining_tables_branch_label_key;
create unique index branch_dining_tables_branch_label_key
  on public.branch_dining_tables(branch_id, lower(label))
  where deleted_at is null;

create or replace function public.delete_branch_dining_table(
  target_table_id uuid,
  target_branch_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('super_admin') then
    raise exception 'Only super admins can remove dining tables.';
  end if;

  -- Checkout locks the same row before assigning a table.
  perform id
  from public.branch_dining_tables
  where id = target_table_id
    and branch_id = target_branch_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'This dining table no longer exists. Refresh the page and try again.';
  end if;

  if exists (
    select 1 from public.orders
    where dining_table_id = target_table_id
      and status not in ('completed', 'cancelled')
  ) then
    raise exception 'This table has an ongoing order. Complete or cancel the order before deleting the table.';
  end if;

  update public.branch_dining_tables
  set is_active = false, deleted_at = now()
  where id = target_table_id;
end;
$$;

revoke all on function public.delete_branch_dining_table(uuid, uuid) from public, anon;
grant execute on function public.delete_branch_dining_table(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
