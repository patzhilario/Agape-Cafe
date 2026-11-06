export function getVariantLabel(categoryType) {
  if (categoryType === 'drink') return 'Size'
  if (categoryType === 'food') return 'Meal set'
  return 'Option'
}

export function getExtraGroups(options) {
  return [
    { kind: 'addon', title: 'Add-ons', options: options.filter((option) => option.option_kind !== 'flavor') },
    { kind: 'flavor', title: 'Flavors', options: options.filter((option) => option.option_kind === 'flavor') },
  ].filter((group) => group.options.length > 0)
}
