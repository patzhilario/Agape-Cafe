export function getCartItemKey(item) {
  return [
    item.productId,
    item.variantId || '',
    item.servingType || '',
    ...[...item.addons.map((addon) => addon.id)].sort(),
  ].join(':')
}
