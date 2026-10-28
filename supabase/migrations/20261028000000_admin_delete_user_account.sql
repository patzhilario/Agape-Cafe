alter table public.orders
  alter column customer_id drop not null;
alter table public.orders
  drop constraint orders_customer_id_fkey,
  add constraint orders_customer_id_fkey
    foreign key (customer_id) references public.profiles(id) on delete set null;

alter table public.promotion_redemptions
  alter column customer_id drop not null;
alter table public.promotion_redemptions
  drop constraint promotion_redemptions_customer_id_fkey,
  add constraint promotion_redemptions_customer_id_fkey
    foreign key (customer_id) references public.profiles(id) on delete set null;

alter table public.order_payment_proofs
  alter column customer_id drop not null;
alter table public.order_payment_proofs
  drop constraint order_payment_proofs_customer_id_fkey,
  add constraint order_payment_proofs_customer_id_fkey
    foreign key (customer_id) references public.profiles(id) on delete set null;

alter table public.benefit_discount_requests
  alter column customer_id drop not null;
alter table public.benefit_discount_requests
  drop constraint benefit_discount_requests_customer_id_fkey,
  add constraint benefit_discount_requests_customer_id_fkey
    foreign key (customer_id) references public.profiles(id) on delete set null;

alter table public.payment_refunds
  alter column created_by drop not null;
alter table public.payment_refunds
  drop constraint payment_refunds_created_by_fkey,
  add constraint payment_refunds_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;

create or replace function public.admin_delete_user_account(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
  super_admin_count bigint;
begin
  if not public.has_role('super_admin') then
    raise exception 'Super Admin permission is required.' using errcode = '42501';
  end if;

  if target_user_id = (select auth.uid()) then
    raise exception 'You cannot delete your own account.' using errcode = '42501';
  end if;

  select email into target_email
  from public.profiles
  where id = target_user_id;

  if not found then
    raise exception 'The selected account does not exist.';
  end if;

  if exists (
    select 1
    from public.user_roles
    where user_id = target_user_id and role = 'super_admin'
  ) then
    perform 1
    from public.user_roles
    where role = 'super_admin'
    order by user_id
    for update;

    select count(*) into super_admin_count
    from public.user_roles
    where role = 'super_admin';

    if super_admin_count <= 1 then
      raise exception 'The last Super Admin cannot be deleted.';
    end if;
  end if;

  delete from public.pending_user_access
  where email = lower(target_email);

  delete from auth.users
  where id = target_user_id;

  insert into public.audit_logs (actor_id, action, record_type, record_id, details)
  values (
    (select auth.uid()),
    'account_deleted',
    'profile',
    target_user_id,
    jsonb_build_object('email', target_email)
  );
end;
$$;

revoke all on function public.admin_delete_user_account(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_delete_user_account(uuid)
  to authenticated;

notify pgrst, 'reload schema';
