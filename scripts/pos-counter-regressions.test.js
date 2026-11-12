import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultPOSItem, mergePOSItems, estimatePOSDiscount, posUnitPrice, limitPOSBenefitItems } from '../src/features/administration/posUtils.js'

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

test('PWD and Senior discounts cover only one food unit and one drink unit across the basket', () => {
  const drink = { ...defaultPOSItem(product), quantity: 3, eligibleQuantity: 3 }
  const food = { ...drink, productId: 'cake', categoryType: 'food', variantId: '', productPrice: 80 }
  const items = [drink, { ...drink, productId: 'tea' }, food, { ...food, productId: 'bread' },
    { ...food, productId: 'merch', categoryType: 'other' }]
  assert.deepEqual(limitPOSBenefitItems(items).map((item) => item.eligibleQuantity), [1, 0, 1, 0, 0])
  assert.equal(estimatePOSDiscount(items, 'pwd', policy), 38.4)
  assert.equal(estimatePOSDiscount(items, 'senior_citizen', policy), 38.4)
  assert.equal(items[0].eligibleQuantity, 3)
})

test('merging selected basket lines never discounts multiple units or different variants of the same category', () => {
  const drink = { ...defaultPOSItem(product), eligibleQuantity: 1 }
  const basket = mergePOSItems([drink, drink, { ...drink, variantId: 'large' }])
  assert.deepEqual(basket.map((item) => [item.quantity, item.eligibleQuantity]), [[2, 1], [1, 0]])
  assert.equal(estimatePOSDiscount(basket, 'pwd', policy), 22.4)
})

test('removing a benefit selection allows choosing another item of that category', () => {
  const drink = { ...defaultPOSItem(product), eligibleQuantity: 0 }
  const second = { ...drink, productId: 'tea', eligibleQuantity: 1 }
  assert.deepEqual(mergePOSItems([drink, second]).map((item) => item.eligibleQuantity), [0, 1])
})
