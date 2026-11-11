import { getSupabaseClient } from '../../lib/supabaseClient.js'
import { getStoreBranchId } from '../public/publicData.js'

function unwrap({ data, error }, action) {
  if (error) throw new Error(`${action}: ${error.message}`)
  return data
}

export async function getBenefitPolicy() {
  return unwrap(
    await getSupabaseClient()
      .from('benefit_discount_policy')
      .select('is_active, discount_percent, vat_registration, vat_rate, pwd_enabled, senior_citizen_enabled')
      .eq('id', true)
      .single(),
    'Could not load benefit discount policy',
  )
}

export async function saveBenefitPolicy(policy) {
  return unwrap(
    await getSupabaseClient().rpc('admin_set_benefit_discount_policy', {
      target_is_active: policy.is_active,
      target_discount_percent: Number(policy.discount_percent),
      target_vat_registration: policy.vat_registration,
      target_vat_rate: Number(policy.vat_rate),
      target_pwd_enabled: policy.pwd_enabled,
      target_senior_citizen_enabled: policy.senior_citizen_enabled,
    }),
    'Could not save benefit discount policy',
  )
}

export async function submitBenefitRequest({
  requestId,
  orderId,
  benefitType,
  items,
  documentPath,
}) {
  return unwrap(
    await getSupabaseClient().rpc('create_benefit_discount_request', {
      target_request_id: requestId,
      target_order_id: orderId,
      requested_benefit_type: benefitType,
      requested_items: items.map((item) => ({
        order_item_id: item.orderItemId,
        eligible_quantity: item.quantity,
      })),
      uploaded_document_path: documentPath,
    }),
    'Could not submit benefit discount request',
  )
}

export async function getCustomerBenefitRequest(orderId) {
  const { data, error } = await getSupabaseClient()
    .from('benefit_discount_requests')
    .select(`
      id, benefit_type, status, discount_percent, discount_total, review_note,
      reviewed_at, created_at,
      items:benefit_discount_request_items(order_item_id, eligible_quantity, discount_amount)
    `)
    .eq('order_id', orderId)
    .maybeSingle()
  if (error) throw new Error(`Could not load benefit request: ${error.message}`)
  return data
}

export async function getApproverBenefitRequests(branchId, page = 0, pageSize = 25) {
  branchId = branchId || await getStoreBranchId()
  let query = getSupabaseClient()
    .from('benefit_discount_requests')
    .select(`
      id, order_id, branch_id, benefit_type, status, document_path, discount_total,
      review_note, created_at, reviewed_at,
      branch:branches(name),
      order:orders(order_number, customer_name, payment_status, status, total),
      items:benefit_discount_request_items(
        order_item_id, eligible_quantity, discount_amount,
        order_item:order_items(product_name, variant_name, quantity, line_total)
      )
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)
  if (branchId) query = query.eq('branch_id', branchId)
  const { data, error, count } = await query
  if (error) throw new Error(`Could not load benefit requests: ${error.message}`)
  return { data, count: count ?? 0 }
}

export async function reviewBenefitRequest(requestId, decision, note) {
  return unwrap(
    await getSupabaseClient().rpc('review_benefit_discount_request', {
      target_request_id: requestId,
      decision,
      decision_note: note,
    }),
    'Could not review benefit request',
  )
}

export async function clearBenefitDocumentReference(requestId) {
  return unwrap(
    await getSupabaseClient().rpc('clear_benefit_request_document', {
      target_request_id: requestId,
    }),
    'Could not update the benefit document record',
  )
}

export async function getBenefitDocumentUrl(path) {
  const { data, error } = await getSupabaseClient()
    .storage
    .from('benefit-documents')
    .createSignedUrl(path, 60)
  if (error) throw new Error(`Could not open the private ID document: ${error.message}`)
  return data.signedUrl
}

export async function deleteBenefitDocument(path) {
  return unwrap(
    await getSupabaseClient().storage.from('benefit-documents').remove([path]),
    'Could not delete the private ID document',
  )
}
