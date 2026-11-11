import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { formatOrderDate } from '../src/features/orders/formatOrderDate.js'
import { validatePaymentReceipt } from '../src/features/orders/paymentReceipt.js'
import { formatOrderStatus } from '../src/features/orders/orderStatus.js'

const source = await readFile(new URL('../src/features/orders/orderData.js', import.meta.url), 'utf8')

function loadOrderData(response) {
  const calls = []
  const query = {}
  for (const method of ['from', 'select', 'order', 'eq', 'range', 'maybeSingle', 'rpc']) {
    query[method] = (...args) => {
      calls.push([method, ...args])
      return query
    }
  }
  query.then = (resolve, reject) => Promise.resolve(response).then(resolve, reject)
  const context = vm.createContext({
    getSupabaseClient: () => query,
    console: { error() {} },
  })
  vm.runInContext(
    source.replace(/^import .*\r?\n/, '').replaceAll('export async function', 'async function') +
      '\nthis.api = { getCustomerOrder, getCustomerOrders, createCustomerOrder, submitOrderPaymentProof }',
    context,
  )
  return { ...context.api, calls }
}

test('order details return the order directly, including its date and payment', async () => {
  const order = {
    id: 'order-1', created_at: '2026-11-09T05:00:00Z', status: 'pending',
    payment: { payment_method_name: 'Cash' },
  }
  const api = loadOrderData({ data: order, error: null })
  assert.equal(await api.getCustomerOrder(order.id), order)
  assert.ok(api.calls.some(([method, column, value]) => method === 'eq' && column === 'id' && value === order.id))
})

test('an unavailable order returns null so the page can show its empty state', async () => {
  const api = loadOrderData({ data: null, error: null })
  assert.equal(await api.getCustomerOrder('missing'), null)
})

test('history returns rows and the database total with the requested page', async () => {
  const orders = [{ id: 'order-1' }]
  const api = loadOrderData({ data: orders, count: 23, error: null })
  const result = await api.getCustomerOrders(1, 10)
  assert.equal(result.data, orders)
  assert.equal(result.count, 23)
  assert.ok(api.calls.some(([method, start, end]) => method === 'range' && start === 10 && end === 19))
  assert.ok(api.calls.some(([method, , options]) => method === 'select' && options.count === 'exact'))
})

test('database read errors reject instead of producing incomplete orders', async () => {
  const api = loadOrderData({ data: null, error: { message: 'Connection failed' } })
  await assert.rejects(api.getCustomerOrder('order-1'), /Could not load order details: Connection failed/)
  await assert.rejects(api.getCustomerOrders(), /Could not load your orders: Connection failed/)
})

test('checkout preserves actionable order type and payment rejection messages', async () => {
  for (const message of [
    'Choose Dine-in, Pick-up, or Delivery.',
    'Choose an active payment method configured for the store.',
    'Pick-up and delivery orders require an online QR payment method.',
    'All orders require an active e-payment method with a QR code.',
    'Delivery fee changed. Review the updated total. If you already paid, contact the store before submitting.',
  ]) {
    const api = loadOrderData({ data: null, error: { code: 'P0001', message: message.startsWith("Choose an active payment method") ? message.replace("the store", "this branch") : message } })
    await assert.rejects(api.createCustomerOrder({ items: [] }), (error) => error.message === message)
  }
})

test('checkout supplies a diagnostic code for unexpected database failures', async () => {
  const api = loadOrderData({ data: null, error: { code: '42702', message: 'Internal SQL detail' } })
  await assert.rejects(api.createCustomerOrder({ items: [] }), (error) =>
    error.message.includes('42702') && !error.message.includes('Internal SQL detail'))
})

test('missing and invalid dates do not crash rendering', () => {
  for (const value of [undefined, null, '', 'invalid']) {
    assert.equal(formatOrderDate(value), 'Date unavailable')
  }
  assert.notEqual(formatOrderDate('2026-11-09T05:00:00Z'), 'Date unavailable')
})

test('receipt submission no longer requires a typed payment reference', async () => {
  const api = loadOrderData({ data: 'proof-1', error: null })
  assert.equal(await api.submitOrderPaymentProof('order-1', 'customer/order-1/receipt.jpg'), 'proof-1')
  const call = api.calls.find(([method]) => method === 'rpc')
  assert.equal(call[1], 'submit_order_payment_proof')
  assert.equal(call[2].payment_reference_number, null)
})

test('receipt validation accepts JPEG and rejects PDFs, other formats and renamed files', async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
  await validatePaymentReceipt(new File([jpeg], 'receipt.jpeg', { type: 'image/jpeg' }))
  for (const file of [
    new File(['%PDF-1.7'], 'receipt.pdf', { type: 'application/pdf' }),
    new File(['PNG'], 'receipt.png', { type: 'image/png' }),
    new File(['%PDF-1.7'], 'renamed.jpg', { type: 'image/jpeg' }),
    new File([jpeg], 'receipt.pdf', { type: 'image/jpeg' }),
  ]) await assert.rejects(validatePaymentReceipt(file), /JPEG/)
  await assert.rejects(validatePaymentReceipt(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' })), /10 MB/)
})

test('order status labels use the requested preparing and ready wording', () => {
  assert.equal(formatOrderStatus('preparing'), 'Orders preparing')
  assert.equal(formatOrderStatus('ready'), 'Orders Ready')
  assert.equal(formatOrderStatus('completed'), 'Completed')
})

test('delivery checkout submits the displayed fee for a server-side price check', async () => {
  const api = loadOrderData({ data: 'order-1', error: null })
  await api.createCustomerOrder({ fulfillment: 'delivery', deliveryAddress: '123 Main Street', expectedDeliveryFee: 50, items: [] })
  const call = api.calls.find(([method]) => method === 'rpc')
  assert.equal(call[1], 'create_store_order')
  assert.equal(call[2].expected_delivery_fee, 50)
  assert.equal(call[2].customer_delivery_address, '123 Main Street')
})
