import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { formatOrderDate } from '../src/features/orders/formatOrderDate.js'

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
      '\nthis.api = { getCustomerOrder, getCustomerOrders, createCustomerOrder }',
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

test('checkout preserves actionable table and payment rejection messages', async () => {
  for (const message of [
    'That table has just been reserved. Refresh the table list and choose another.',
    'Choose an active payment method configured for this branch.',
    'Pick-up and delivery orders require an online QR payment method.',
  ]) {
    const api = loadOrderData({ data: null, error: { code: 'P0001', message } })
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
