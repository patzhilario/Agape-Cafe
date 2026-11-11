import { getSupabaseClient } from '../../lib/supabaseClient.js'

export async function getOrderReceipt(orderId) {
  const { data, error } = await getSupabaseClient().from('orders').select(`
    id, order_number, order_source, customer_name, customer_phone, fulfillment_method,
    delivery_address, delivery_fee, subtotal, discount_total, total, status, payment_status, created_at,
    cash_received, cash_change, pos_discount_type, pos_discount_percent,
    branch:branches(name, address, phone, email),
    cashier:profiles!orders_cashier_id_fkey(display_name),
    items:order_items(id, product_name, variant_name, quantity, unit_price, line_subtotal,
      discount_amount, line_total, addons:order_item_addons(addon_name, unit_price)),
    payment:payments(payment_method_name, amount, status),
    payment_proof:order_payment_proofs(status, reference_number)
  `).eq('id', orderId).maybeSingle()
  if (error) throw new Error(`Could not load receipt: ${error.message}`)
  return data
}
