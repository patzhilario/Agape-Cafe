begin;

-- Counter sales do not collect a customer phone number, including deliveries.
-- The shared checkout engine still validates its internal contact placeholder.
create or replace function public.complete_pos_sale(
  guest_name text, guest_phone text, fulfillment public.order_fulfillment_method,
  method_id uuid, request_id uuid, cart_items jsonb, quoted_total numeric,
  expected_delivery_fee numeric, cash_tendered numeric default null,
  qr_verified boolean default false, delivery_address text default null,
  promotion_id uuid default null, benefit public.benefit_type default null,
  beneficiary_name text default null, beneficiary_id text default null,
  id_verified boolean default false
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  cashier uuid := (select auth.uid());
  store_id uuid := public.get_store_branch_id();
  method public.payment_methods%rowtype;
  policy public.benefit_discount_policy%rowtype;
  previous_order public.orders%rowtype;
  created_id uuid;
  fingerprint text;
  contact_phone text;
  entry jsonb;
  eligible integer;
  line_record public.order_items%rowtype;
  category_type text;
  food_count integer := 0;
  drink_count integer := 0;
  gross numeric;
  net numeric;
  reduction numeric;
  discount_amount numeric := 0;
  final_total numeric;
begin
  if cashier is null or not public.is_active_account() or not (
    public.has_role('admin') or (public.has_role('staff')
      and public.has_permission(store_id,'orders','view')
      and public.has_permission(store_id,'orders','create')
      and public.has_permission(store_id,'orders','edit'))
  ) then raise exception 'Orders view, create and edit permissions are required to take POS payments.' using errcode = '42501'; end if;
  if request_id is null then raise exception 'Submit a valid POS request.'; end if;
  if length(coalesce(btrim(guest_name), '')) > 120 then raise exception 'Customer name cannot exceed 120 characters.'; end if;
  if nullif(btrim(guest_phone), '') is not null and btrim(guest_phone) !~ '^[+()0-9 .-]{7,40}$' then raise exception 'Enter a valid contact phone.'; end if;
  if benefit is not null and complete_pos_sale.promotion_id is not null then raise exception 'Choose a promotion or a PWD/Senior benefit, not both.'; end if;
  fingerprint := md5(jsonb_build_object('name',btrim(guest_name),'phone',btrim(guest_phone),
    'fulfillment',fulfillment,'method',method_id,'items',cart_items,'total',quoted_total,
    'fee',expected_delivery_fee,'cash',cash_tendered,'qr',qr_verified,
    'address',nullif(btrim(delivery_address),''),'promotion',complete_pos_sale.promotion_id,'benefit',benefit,
    'beneficiary',btrim(beneficiary_name),'id',btrim(beneficiary_id),'verified',id_verified)::text);
  perform pg_advisory_xact_lock(hashtextextended(cashier::text || ':' || request_id::text,0));
  select * into previous_order from public.orders where cashier_id=cashier and client_request_id=request_id and order_source='pos' for update;
  if found then
    if previous_order.pos_request_fingerprint is distinct from fingerprint then raise exception 'This POS request was already used for different sale details.'; end if;
    return previous_order.id;
  end if;
  if exists(select 1 from public.orders where customer_id=cashier and client_request_id=request_id) then raise exception 'This request was already used for another order.'; end if;
  select * into method from public.payment_methods where id=method_id and branch_id=store_id and is_active for share;
  if not found or not (method.settlement_type='provider' or method.code='pos_cash') then raise exception 'Choose an active POS payment method.'; end if;
  if method.settlement_type='provider' and not coalesce(qr_verified,false) then raise exception 'Verify the QR payment against the store account before completing the sale.'; end if;
  if complete_pos_sale.promotion_id is not null and exists(select 1 from public.promotions where id=complete_pos_sale.promotion_id and max_uses_per_customer is not null) then
    raise exception 'This promotion requires a customer account. Choose another promotion.';
  end if;
  if cart_items is null or jsonb_typeof(cart_items)<>'array' or jsonb_array_length(cart_items) not between 1 and 50 then raise exception 'Add between 1 and 50 configured items.'; end if;
  if exists(select 1 from jsonb_array_elements(cart_items) as item
    group by item->>'product_id', item->>'variant_id',
      (select array_agg(value order by value) from jsonb_array_elements_text(item->'addon_ids'))
    having count(*)>1) then raise exception 'Combine identical configured items before payment.'; end if;

  if benefit is not null then
    if not public.has_permission(store_id,'promotions','approve') then raise exception 'Promotions approve permission is required for a PWD/Senior discount.' using errcode='42501'; end if;
    if not coalesce(id_verified,false) or length(coalesce(btrim(beneficiary_name),'')) not between 1 and 120
      or length(coalesce(btrim(beneficiary_id),'')) not between 3 and 80 then raise exception 'Check the customer ID in person and record the beneficiary name and ID number.'; end if;
    select * into policy from public.benefit_discount_policy where id and is_active for share;
    if not found or policy.vat_registration='not_configured' then raise exception 'Configure and activate the benefit policy before applying this discount.'; end if;
    if (benefit='pwd' and not policy.pwd_enabled) or (benefit='senior_citizen' and not policy.senior_citizen_enabled) then raise exception 'This benefit type is disabled.'; end if;
  end if;
  select coalesce(nullif(btrim(guest_phone),''),nullif(phone,''),'0000000') into contact_phone from public.profiles where id=cashier;
  insert into public.pos_checkout_authorizations values(pg_catalog.txid_current(),cashier,request_id);
  created_id := public.create_store_order(fulfillment,method_id,request_id,contact_phone,'',complete_pos_sale.promotion_id,cart_items,
    null,null,null,null,delivery_address,expected_delivery_fee);
  update public.orders set customer_id=null,customer_name=coalesce(nullif(btrim(guest_name),''),'Walk-in customer'),
    customer_phone=coalesce(btrim(guest_phone),''),customer_email=null,order_source='pos',cashier_id=cashier,
    pos_request_fingerprint=fingerprint,pos_discount_type=case when benefit is not null then benefit::text when complete_pos_sale.promotion_id is not null then 'promotion' end,
    pos_discount_percent=case when benefit is not null then policy.discount_percent end
  where id=created_id;

  if benefit is not null then
    for entry in select value from jsonb_array_elements(cart_items) loop
      if coalesce(entry->>'eligible_quantity','0') !~ '^[0-9]{1,2}$' then raise exception 'Eligible quantities must be whole numbers.'; end if;
      eligible := coalesce(entry->>'eligible_quantity','0')::integer;
      if eligible=0 then continue; end if;
      select item.* into strict line_record from public.order_items as item
      where item.order_id=created_id and item.product_id=(entry->>'product_id')::uuid
        and item.variant_id is not distinct from nullif(entry->>'variant_id','')::uuid
        and coalesce((select array_agg(addon_id order by addon_id) from public.order_item_addons where order_item_id=item.id),array[]::uuid[])
          =array(select value::uuid from jsonb_array_elements_text(entry->'addon_ids') order by value::uuid)
      for update;
      if eligible>line_record.quantity then raise exception 'Eligible quantity exceeds the order quantity.'; end if;
      select category.type into category_type from public.products as product join public.categories as category on category.id=product.category_id where product.id=line_record.product_id;
      if category_type='drink' then drink_count:=drink_count+eligible;
      elsif category_type='food' then food_count:=food_count+eligible;
      else raise exception 'Only drink and food items are eligible for this benefit.'; end if;
      if drink_count>1 or food_count>1 then raise exception 'Select at most one drink and one food for the beneficiary.'; end if;
      gross:=round(line_record.line_subtotal*eligible/line_record.quantity,2);
      if policy.vat_registration='vat_registered' then
        net:=round(gross/(1+policy.vat_rate/100),2);
        reduction:=gross-round(net*(1-policy.discount_percent/100),2);
      else reduction:=round(gross*policy.discount_percent/100,2); end if;
      update public.order_items set discount_amount=reduction,line_total=line_subtotal-reduction where id=line_record.id;
      discount_amount:=discount_amount+reduction;
    end loop;
    if discount_amount<=0 then raise exception 'Select an eligible drink or food quantity for the beneficiary.'; end if;
    update public.orders set discount_total=discount_amount,total=subtotal-discount_amount+delivery_fee where id=created_id;
    update public.payments set amount=amount-discount_amount where order_id=created_id;
    insert into public.pos_benefit_verifications(order_id,branch_id,beneficiary_name,beneficiary_id,benefit_type,vat_registration,vat_rate,discount_percent,verified_by)
    values(created_id,store_id,btrim(beneficiary_name),btrim(beneficiary_id),benefit,policy.vat_registration,policy.vat_rate,policy.discount_percent,cashier);
  end if;
  select total,discount_total into final_total,discount_amount from public.orders where id=created_id;
  if quoted_total is null or quoted_total is distinct from final_total then raise exception 'The total changed. Refresh prices and discounts, then review the amount before payment.'; end if;
  if method.code='pos_cash' then
    if cash_tendered is null or cash_tendered<final_total or cash_tendered<>round(cash_tendered,2) or cash_tendered>9999999999.99 then raise exception 'Enter cash received covering the total, with at most two decimal places.'; end if;
    update public.orders set cash_received=cash_tendered,cash_change=cash_tendered-final_total where id=created_id;
    perform public.record_order_payment(created_id);
  else
    perform public.record_manual_provider_payment_override(created_id,'QR payment checked in person at POS by cashier.');
  end if;
  perform public.update_order_status(created_id,'confirmed',null);
  delete from public.pos_checkout_authorizations as pos_auth where pos_auth.transaction_id=pg_catalog.txid_current() and pos_auth.cashier_id=cashier and pos_auth.request_id=complete_pos_sale.request_id;
  insert into public.audit_logs(actor_id,branch_id,action,record_type,record_id,details)
  values(cashier,store_id,'pos_sale_completed','order',created_id,jsonb_build_object('method',method.name,'total',final_total,'discount',discount_amount,'benefit',benefit,'promotion',complete_pos_sale.promotion_id));
  return created_id;
end;
$$;
notify pgrst, 'reload schema';
commit;

