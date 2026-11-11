import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultPOSItem, mergePOSItems, estimatePOSDiscount, posUnitPrice } from '../src/features/administration/posUtils.js'

const product = { id: 'coffee', name: 'Coffee', price: 100, category: { type: 'drink' }, variants: [{ id: 'regular', name: 'Regular', price: 112 }], addons: [] }
const policy = { is_active: true, vat_registration: 'non_vat', vat_rate: 12, discount_percent: 20 }

test('a menu tap immediately produces a complete default POS item', () => {
  const item = defaultPOSItem(product)
  assert.equal(item.quantity, 1)
  assert.equal(item.variantId, 'regular')
  assert.equal(item.servingType, 'cup')
  assert.equal(posUnitPrice(item), 112)
})

test('repeated taps combine identical configurations and preserve different options', () => {
  const item = defaultPOSItem(product)
  const basket = mergePOSItems([item, item, { ...item, addons: [{ id: 'shot', price: 20 }] }])
  assert.equal(basket.length, 2)
  assert.equal(basket[0].quantity, 2)
  assert.equal(posUnitPrice(basket[1]), 132)
  assert.throws(() => mergePOSItems([{ ...item, quantity: 20 }, item]), /20 units/)
})

test('benefit estimates cover only the selected eligible quantity', () => {
  const item = { ...defaultPOSItem(product), quantity: 3, eligibleQuantity: 1 }
  assert.equal(estimatePOSDiscount([item], 'pwd', policy), 22.4)
  assert.equal(estimatePOSDiscount([item], 'senior_citizen', { ...policy, vat_registration: 'vat_registered' }), 32)
  assert.equal(estimatePOSDiscount([item], 'pwd', { ...policy, vat_registration: 'not_configured' }), 0)
})

test('promotions respect eligible products, minimum spend and discount caps', () => {
  const item = defaultPOSItem(product)
  const promotion = { discount_type: 'percentage', discount_value: 20, minimum_purchase: 100, max_discount: 15, promotion_products: [{ product_id: 'coffee' }] }
  assert.equal(estimatePOSDiscount([item], 'promotion', null, promotion), 15)
  assert.equal(estimatePOSDiscount([item], 'promotion', null, { ...promotion, minimum_purchase: 200 }), 0)
  assert.equal(estimatePOSDiscount([item], 'promotion', null, { ...promotion, promotion_products: [{ product_id: 'other' }] }), 0)
})
