import assert from 'node:assert/strict'
import test from 'node:test'
import { canPrintOrderReceipt } from '../src/features/orders/receiptEligibility.js'

test('online receipts require admin acceptance even when payment is already paid or verified', () => {
  for (const payment_status of ['unpaid', 'pending', 'paid']) {
    assert.equal(canPrintOrderReceipt({ order_source: 'online', status: 'pending', payment_status, payment_proof: [{ status: 'approved' }] }), false)
  }
})

test('online receipts remain available throughout accepted order fulfillment', () => {
  for (const status of ['confirmed', 'preparing', 'ready', 'completed']) {
    assert.equal(canPrintOrderReceipt({ order_source: 'online', status }), true)
    assert.equal(canPrintOrderReceipt({ status }), true)
  }
})

test('missing, cancelled, and unknown online orders cannot produce receipts', () => {
  for (const order of [null, undefined, {}, { status: 'cancelled' }, { status: 'unknown' }]) {
    assert.equal(canPrintOrderReceipt(order), false)
  }
})

test('POS receipts retain their existing availability', () => {
  assert.equal(canPrintOrderReceipt({ order_source: 'pos', status: 'confirmed' }), true)
  assert.equal(canPrintOrderReceipt({ order_source: 'pos', status: 'pending' }), true)
})
