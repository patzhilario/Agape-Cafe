import { getSupabaseClient } from '../../lib/supabaseClient.js'

export async function getAvailablePaymentMethods() {
  const { data, error } = await getSupabaseClient()
    .from('payment_methods')
    .select('id, code, name, instructions, settlement_type')
    .eq('is_active', true)
    .order('name')

  if (error) throw new Error(`Could not load payment options: ${error.message}`)
  return data
}

export async function getEligiblePromotions(productIds) {
  const { data, error } = await getSupabaseClient()
    .from('promotions')
    .select(
      'id, name, description, terms, discount_type, discount_value, max_discount, minimum_purchase, starts_at, ends_at, promotion_products(product_id)',
    )
    .eq('is_active', true)
    .lte('starts_at', new Date().toISOString())
    .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
    .order('ends_at', { ascending: true, nullsFirst: false })

  if (error) throw new Error(`Could not load available promotions: ${error.message}`)
  const cartProductIds = new Set(productIds)
  return data.filter((promotion) => {
    const targetedProductIds = promotion.promotion_products.map(({ product_id }) => product_id)
    return !targetedProductIds.length || targetedProductIds.some((id) => cartProductIds.has(id))
  })
}

export async function createCustomerOrder({
  branchId,
  fulfillment,
  paymentMethodId,
  requestId,
  phone,
  note,
  deliveryAddress,
  promotionId,
  items,
  benefitRequest,
}) {
  const cartItems = items.map((item) => ({
    product_id: item.productId,
    variant_id: item.variantId || null,
    addon_ids: item.addons.map((addon) => addon.id),
    quantity: item.quantity,
  }))
  const { data, error } = await getSupabaseClient().rpc('create_customer_order_with_benefit', {
    target_branch_id: branchId,
    fulfillment,
    payment_method_id: paymentMethodId,
    client_request_id: requestId,
    customer_phone: phone,
    customer_note: note,
    customer_delivery_address: deliveryAddress || null,
    requested_promotion_id: promotionId || null,
    cart_items: cartItems,
    target_benefit_request_id: benefitRequest?.requestId || null,
    requested_benefit_type: benefitRequest?.benefitType || null,
    requested_benefit_items: benefitRequest?.items.map((item) => ({
      product_id: item.productId,
      variant_id: item.variantId || null,
      addon_ids: item.addonIds,
      eligible_quantity: item.quantity,
    })) || null,
    uploaded_benefit_document_path: benefitRequest?.documentPath || null,
  })

  if (error) {
    console.error('Order submission was rejected by the database.', error)
    throw new Error(mapOrderError(error.message))
  }
  return data
}

export async function getCustomerOrders(page = 0, pageSize = 25) {
  const { data, error } = await getSupabaseClient()
    .from('orders')
    .select(`
      id, order_number, branch_id, customer_name, customer_phone,
      fulfillment_method, customer_note, delivery_address, delivery_fee, status, payment_status,
      subtotal, discount_total, total, created_at,
      branch:branches(name),
      items:order_items(
        id, product_name, product_sku, variant_name, quantity,
        unit_price, line_subtotal, discount_amount, line_total,
        addons:order_item_addons(addon_name, unit_price)
      ),
      payment:payments(payment_method_code, payment_method_name, amount, status),
      payment_proof:order_payment_proofs(id, status, document_path, reference_number, review_note),
      benefit_request:benefit_discount_requests(id, benefit_type, status, document_path, review_note, discount_total)
    `)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (error) throw new Error(`Could not load your orders: ${error.message}`)
  return data
}

export async function getCustomerOrder(orderId) {
  const { data, error } = await getSupabaseClient()
    .from('orders')
    .select(`
      id, order_number, branch_id, customer_name, customer_email, customer_phone,
      fulfillment_method, customer_note, delivery_address, delivery_fee, status, payment_status,
      subtotal, discount_total, total, promotion_id, created_at, cancellation_reason,
      branch:branches(name, address, phone, gcash_qr_path),
      items:order_items(
        id, product_name, product_sku, variant_name, quantity,
        unit_price, line_subtotal, discount_amount, line_total,
        addons:order_item_addons(addon_name, unit_price)
      ),
      payment:payments(payment_method_code, payment_method_name, amount, status),
      payment_proof:order_payment_proofs(id, status, document_path, reference_number, review_note)
    `)
    .eq('id', orderId)
    .maybeSingle()

  if (error) throw new Error(`Could not load order details: ${error.message}`)
  return data
}

export async function submitOrderPaymentProof(orderId, documentPath, referenceNumber) {
  const { data, error } = await getSupabaseClient().rpc('submit_order_payment_proof', {
    target_order_id: orderId,
    uploaded_document_path: documentPath,
    payment_reference_number: referenceNumber,
  })
  if (error) throw new Error(`Could not submit GCash payment proof: ${error.message}`)
  return data
}

export async function reviewOrderPaymentProof(orderId, decision, note = '') {
  const { error } = await getSupabaseClient().rpc('review_order_payment_proof', {
    target_order_id: orderId,
    decision,
    decision_note: note,
  })
  if (error) throw new Error(`Could not review GCash payment proof: ${error.message}`)
}

export async function getOrderPaymentProofUrl(path) {
  const { data, error } = await getSupabaseClient()
    .storage
    .from('order-payment-proofs')
    .createSignedUrl(path, 60)
  if (error) throw new Error(`Could not open private payment proof: ${error.message}`)
  return data.signedUrl
}

function mapOrderError(message) {
  const knownErrors = [
    'Sign in to place an order.',
    'This account is not active.',
    'Enter a valid contact phone number.',
    'Order notes cannot exceed 500 characters.',
    'Your cart must contain between 1 and 50 items.',
    'One or more cart items are invalid.',
    'Choose a branch, fulfillment method, and payment method.',
    'This branch is not accepting orders.',
    'This payment method is not currently available.',
    'A cart product is no longer available.',
    'A cart product is not available at the selected branch.',
    'A cart product does not have enough stock at the selected branch.',
    'Choose a size for each configured product.',
    'A selected product size is no longer available.',
    'A selected add-on is no longer available.',
    'An add-on cannot be selected more than once for the same item.',
    'This promotion is no longer active.',
    'This promotion has reached its usage limit.',
    'You have reached this promotion usage limit.',
    'Your order does not meet this promotion minimum purchase.',
    'This promotion does not apply to the products in your cart.',
    'Choose a benefit type, eligible items, and upload ID evidence.',
    'Benefit discounts cannot be combined with a promotion.',
    'A selected benefit item could not be matched to the submitted order.',
    'This benefit discount is currently unavailable.',
    'A selected quantity exceeds its order line or does not belong to this order.',
    'An eligible quantity must be a whole number.',
    'Select between one and fifty eligible order lines.',
    'One or more selected order lines are invalid.',
    'Upload a private document under your own request folder.',
    'A benefit discount must be requested on an unpaid, active order.',
  ]
  const matchingError = knownErrors.find((known) => message.includes(known))
  if (matchingError) return matchingError
  return 'We could not place the order. Please refresh the menu and try again.'
}
