import { getSupabaseClient } from '../../lib/supabaseClient.js'

function relationshipArray(value) {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

export async function getAdminBranches(account) {
  const { data, error } = await getSupabaseClient()
    .from('branches')
    .select('id, name, is_active')
    .order('name')
  if (error) throw new Error(`Could not load branches: ${error.message}`)
  if (account?.roles.includes('super_admin')) return data
  const assignedIds = new Set(account?.branchAssignments.map(({ branch_id }) => branch_id) || [])
  return data.filter((branch) => assignedIds.has(branch.id))
}

export async function getOrders(branchId, page = 0, pageSize = 50) {
  let query = getSupabaseClient()
    .from('orders')
    .select(`
      id, order_number, branch_id, customer_name, customer_phone,
      fulfillment_method, dining_table:branch_dining_tables(label), customer_note, delivery_address, delivery_fee, status, payment_status,
      subtotal, discount_total, total, created_at, cancellation_reason,
      branch:branches(name),
      items:order_items(
        id, product_name, variant_name, quantity, line_total,
        addons:order_item_addons(addon_name, unit_price)
      ),
      payment:payments(
        payment_method_code, payment_method_name, amount, status,
        method:payment_methods(settlement_type)
      ),
      payment_proof:order_payment_proofs(id, status, document_path, reference_number, review_note),
      benefit_request:benefit_discount_requests(
        id, benefit_type, status, discount_total, review_note, document_path,
        items:benefit_discount_request_items(
          order_item_id, eligible_quantity, discount_amount,
          order_item:order_items(product_name, variant_name, quantity)
        )
      )
    `)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)
  if (branchId) query = query.eq('branch_id', branchId)
  const { data, error } = await query
  if (error) throw new Error(`Could not load orders: ${error.message}`)
  return data.map((order) => ({
    ...order,
    payment: relationshipArray(order.payment),
    payment_proof: relationshipArray(order.payment_proof),
    benefit_request: relationshipArray(order.benefit_request),
  }))
}

export async function updateOrderStatus(orderId, status, cancellationReason = null) {
  const { error } = await getSupabaseClient().rpc('update_order_status', {
    target_order_id: orderId,
    next_status: status,
    cancellation_reason: cancellationReason,
  })
  if (error) throw new Error(error.message)
}

export async function recordOrderPayment(orderId) {
  const { error } = await getSupabaseClient().rpc('record_order_payment', {
    target_order_id: orderId,
  })
  if (error) throw new Error(error.message)
}

export async function recordManualGcashPaymentOverride(orderId, reason) {
  const { error } = await getSupabaseClient().rpc('record_manual_gcash_payment_override', {
    target_order_id: orderId,
    override_reason: reason,
  })
  if (error) throw new Error(error.message)
}

export async function recordManualProviderPaymentOverride(orderId, reason) {
  const { error } = await getSupabaseClient().rpc('record_manual_provider_payment_override', {
    target_order_id: orderId,
    override_reason: reason,
  })
  if (error) throw new Error(error.message)
}
