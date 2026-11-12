export function canPrintOrderReceipt(order) {
  if (!order) return false
  if (order.order_source === 'pos') return true
  return ['confirmed', 'preparing', 'ready', 'completed'].includes(order.status)
}

export const RECEIPT_UNAVAILABLE_MESSAGE = 'Online order receipts are available only after the admin accepts the order. Pending and cancelled orders cannot be printed.'
