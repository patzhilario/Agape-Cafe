create table public.payment_manual_override_authorizations (
  transaction_id bigint not null,
  order_id uuid not null references public.orders (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  primary key (transaction_id, order_id)
);

alter table public.payment_manual_override_authorizations enable row level security;
revoke all on public.payment_manual_override_authorizations from public, anon, authenticated;

create or replace function public.guard_gcash_payment_verification()
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
        from public.payment_manual_override_authorizations as override_auth
        where override_auth.transaction_id = pg_catalog.txid_current()
          and override_auth.order_id = new.order_id
          and override_auth.actor_id = (select auth.uid())
      ) then
    if not exists (
      select 1
      from public.order_payment_proofs
      where order_id = new.order_id
        and status = 'approved'
    ) then
      raise exception 'Verify the submitted GCash payment proof before marking this order paid.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.record_manual_gcash_payment_override(
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
  normalized_reason text := btrim(override_reason);
begin
  select * into current_order
  from public.orders
  where id = target_order_id
  for update;
  if not found then
    raise exception 'Order not found.';
  end if;

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

  if not exists (
    select 1
    from public.payments
    where order_id = target_order_id
      and payment_method_code = 'gcash'
      and status = 'unpaid'
  ) then
    raise exception 'Manual GCash override is only available for unpaid GCash orders.';
  end if;

  if exists (
    select 1
    from public.order_payment_proofs
    where order_id = target_order_id
  ) then
    raise exception 'Review the submitted GCash proof instead of using manual override.';
  end if;

  insert into public.payment_manual_override_authorizations (
    transaction_id,
    order_id,
    actor_id
  )
  values (pg_catalog.txid_current(), target_order_id, (select auth.uid()));

  perform public.record_order_payment(target_order_id);

  delete from public.payment_manual_override_authorizations
  where transaction_id = pg_catalog.txid_current()
    and order_id = target_order_id
    and actor_id = (select auth.uid());

  insert into public.audit_logs (
    actor_id,
    action,
    record_type,
    record_id,
    branch_id,
    details
  )
  values (
    (select auth.uid()),
    'order_payment_manual_override',
    'order',
    target_order_id,
    current_order.branch_id,
    jsonb_build_object(
      'amount', current_order.total,
      'payment_method', 'gcash',
      'payment_status', 'paid',
      'reason', normalized_reason
    )
  );
end;
$$;

revoke all on function public.record_manual_gcash_payment_override(uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_manual_gcash_payment_override(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
