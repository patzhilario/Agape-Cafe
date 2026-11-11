import { getCartItemKey } from '../orders/cartUtils.js'

export const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100
export const posUnitPrice = (item) => (item.variantId ? item.variantPrice : item.productPrice) + item.addons.reduce((sum, addon) => sum + addon.price, 0)

export function defaultPOSItem(product) {
  const variant = product.variants[0]
  return {
    productId: product.id, productName: product.name, productPrice: product.price,
    variantId: variant?.id || '', variantName: variant?.name || '', variantPrice: variant?.price ?? product.price,
    addons: [], quantity: 1, categoryType: product.category?.type || 'other',
    servingType: product.category?.type === 'drink' ? 'cup' : null, eligibleQuantity: 0,
  }
}

export function mergePOSItems(items) {
  const merged = new Map()
  for (const item of items) {
    const key = getCartItemKey(item)
    const existing = merged.get(key)
    if (!existing) merged.set(key, { ...item })
    else {
      existing.quantity += item.quantity
      existing.eligibleQuantity = Math.min(existing.quantity, existing.eligibleQuantity + item.eligibleQuantity)
    }
  }
  if (merged.size > 50 || [...merged.values()].some((item) => item.quantity > 20)) throw new Error('Each configured item can have up to 20 units, across at most 50 order lines.')
  return [...merged.values()]
}

export function estimatePOSDiscount(items, discountType, policy, promotion) {
  if (discountType === 'pwd' || discountType === 'senior_citizen') {
    if (!policy?.is_active || policy.vat_registration === 'not_configured') return 0
    return roundMoney(items.reduce((sum, item) => {
      const eligible = Math.min(item.quantity, item.eligibleQuantity || 0)
      const gross = roundMoney(posUnitPrice(item) * eligible)
      const net = roundMoney(gross / (1 + Number(policy.vat_rate) / 100))
      return sum + (policy.vat_registration === 'vat_registered'
        ? gross - roundMoney(net * (1 - Number(policy.discount_percent) / 100))
        : roundMoney(gross * Number(policy.discount_percent) / 100))
    }, 0))
  }
  if (discountType !== 'promotion' || !promotion) return 0
  const subtotal = items.reduce((sum, item) => sum + posUnitPrice(item) * item.quantity, 0)
  if (subtotal < Number(promotion.minimum_purchase)) return 0
  const eligible = items.reduce((sum, item) => {
    const targets = promotion.promotion_products || []
    return sum + (!targets.length || targets.some((target) => target.product_id === item.productId) ? posUnitPrice(item) * item.quantity : 0)
  }, 0)
  const amount = promotion.discount_type === 'percentage' ? roundMoney(eligible * Number(promotion.discount_value) / 100) : Math.min(eligible, Number(promotion.discount_value))
  return Math.min(eligible, promotion.max_discount == null ? amount : Math.min(amount, Number(promotion.max_discount)))
}
