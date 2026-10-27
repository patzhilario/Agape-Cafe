import { getSupabaseClient } from '../../lib/supabaseClient.js'

const PUBLIC_DATA_CACHE_TTL_MS = 60_000
const publicDataCache = new Map()
const pendingPublicData = new Map()

function getPublicProductsCacheKey({ branchId, featured, limit, productId } = {}) {
  return `products:${JSON.stringify({
    branchId: branchId || '',
    featured: Boolean(featured),
    limit: limit || null,
    productId: productId || '',
  })}`
}

function getCachedPublicData(key) {
  const cached = publicDataCache.get(key)
  if (!cached) return undefined
  if (cached.expiresAt <= Date.now()) {
    publicDataCache.delete(key)
    return undefined
  }
  return cached.value
}

function loadPublicData(key, loader) {
  const cached = getCachedPublicData(key)
  if (cached !== undefined) return Promise.resolve(cached)

  const pending = pendingPublicData.get(key)
  if (pending) return pending

  const request = Promise.resolve()
    .then(loader)
    .then((value) => {
      publicDataCache.set(key, {
        value,
        expiresAt: Date.now() + PUBLIC_DATA_CACHE_TTL_MS,
      })
      return value
    })
    .finally(() => {
      if (pendingPublicData.get(key) === request) pendingPublicData.delete(key)
    })

  pendingPublicData.set(key, request)
  return request
}

export function getCachedPublicProducts(options) {
  return getCachedPublicData(getPublicProductsCacheKey(options))
}

export function getCachedPublicCategories() {
  return getCachedPublicData('categories')
}

export function getCachedPublicBranches() {
  return getCachedPublicData('branches')
}

export function getCachedPublicPromotions() {
  return getCachedPublicData('promotions')
}

export function publicImageUrl(path) {
  if (!path) return ''
  return getSupabaseClient().storage.from('menu-images').getPublicUrl(path).data.publicUrl
}

function productSelection() {
  return `
    id,
    name,
    sku,
    description,
    image_path,
    price,
    is_featured,
    is_best_seller,
    category:categories(name, slug, type),
    product_variants(id, name, price, sort_order, is_active),
    product_addons(id, name, price, sort_order, is_active)
  `
}

function normalizeProduct(
  product,
  priceOverride = null,
  branchVariantSettings = new Map(),
  branchAddonSettings = new Map(),
) {
  const price = Number(priceOverride ?? product.price)
  const variantPriceAdjustment = price - Number(product.price)
  const variants = (product.product_variants || [])
    .filter((variant) => variant.is_active)
    .filter((variant) => branchVariantSettings.get(variant.id)?.is_available !== false)
    .sort((first, second) => first.sort_order - second.sort_order)
  const addons = (product.product_addons || [])
    .filter((addon) => addon.is_active)
    .filter((addon) => branchAddonSettings.get(addon.id)?.is_available !== false)
    .sort((first, second) => first.sort_order - second.sort_order)

  if (variants.length === 0 &&
      (product.product_variants || []).some((variant) => variant.is_active)) {
    return null
  }

  return {
    ...product,
    price,
    variants: variants.map((variant) => ({
      ...variant,
      price: Number(
        branchVariantSettings.get(variant.id)?.price_override ??
        Math.max(0, Number(variant.price) + variantPriceAdjustment),
      ),
    })),
    addons: addons.map((addon) => ({
      ...addon,
      price: Number(branchAddonSettings.get(addon.id)?.price_override ?? addon.price),
    })),
    imageUrl: publicImageUrl(product.image_path),
  }
}

async function loadPublicProducts({ branchId, featured, limit, productId } = {}) {
  const supabase = getSupabaseClient()
  let availabilityByProduct = new Map()

  if (branchId) {
    const { data, error } = await supabase
      .from('branch_product_availability')
      .select('product_id, price_override')
      .eq('branch_id', branchId)
      .eq('is_available', true)

    if (error) throw new Error(`Could not load this branch's menu: ${error.message}`)
    availabilityByProduct = new Map(
      data.map((availability) => [availability.product_id, availability.price_override]),
    )

    if (!availabilityByProduct.size) return []
  }

  let query = supabase
    .from('products')
    .select(productSelection())
    .eq('is_published', true)
    .eq('is_available', true)
    .is('archived_at', null)
    .order('sort_order')
    .order('name')

  if (featured) query = query.eq('is_featured', true)
  if (productId) query = query.eq('id', productId)
  if (branchId) query = query.in('id', [...availabilityByProduct.keys()])
  if (limit) query = query.limit(limit)

  const { data, error } = await query
  if (error) throw new Error(`Could not load the public menu: ${error.message}`)

  let branchVariantSettings = new Map()
  let branchAddonSettings = new Map()
  if (branchId && data.length) {
    const variantIds = data.flatMap((product) =>
      (product.product_variants || []).map((variant) => variant.id),
    )
    const addonIds = data.flatMap((product) =>
      (product.product_addons || []).map((addon) => addon.id),
    )
    const [variantSettingsResult, addonSettingsResult] = await Promise.all([
      variantIds.length
        ? supabase.from('branch_product_variant_settings')
          .select('variant_id, is_available, price_override')
          .eq('branch_id', branchId)
          .in('variant_id', variantIds)
        : Promise.resolve({ data: [], error: null }),
      addonIds.length
        ? supabase.from('branch_product_addon_settings')
          .select('addon_id, is_available, price_override')
          .eq('branch_id', branchId)
          .in('addon_id', addonIds)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (variantSettingsResult.error) {
      throw new Error(`Could not load branch size settings: ${variantSettingsResult.error.message}`)
    }
    if (addonSettingsResult.error) {
      throw new Error(`Could not load branch add-on settings: ${addonSettingsResult.error.message}`)
    }
    branchVariantSettings = new Map(
      variantSettingsResult.data.map((setting) => [setting.variant_id, setting]),
    )
    branchAddonSettings = new Map(
      addonSettingsResult.data.map((setting) => [setting.addon_id, setting]),
    )
  }

  return data.map((product) => normalizeProduct(
    product,
    availabilityByProduct.get(product.id),
    branchVariantSettings,
    branchAddonSettings,
  )).filter(Boolean)
}

export function getPublicProducts(options = {}) {
  return loadPublicData(getPublicProductsCacheKey(options), () => loadPublicProducts(options))
}

export async function getPublicProduct(productId, branchId) {
  const products = await getPublicProducts({ productId, branchId })
  return products[0] || null
}

export function getPublicCategories() {
  return loadPublicData('categories', async () => {
    const { data, error } = await getSupabaseClient()
      .from('categories')
      .select('id, name, slug, description, sort_order')
      .eq('is_published', true)
      .order('sort_order')
      .order('name')

    if (error) throw new Error(`Could not load menu categories: ${error.message}`)
    return data
  })
}

export function getPublicBranches() {
  return loadPublicData('branches', async () => {
    const { data, error } = await getSupabaseClient()
      .from('branches')
      .select('id, name, address, map_url, phone, email, operating_hours, gcash_qr_path, delivery_enabled, delivery_fee')
      .eq('is_active', true)
      .order('name')

    if (error) throw new Error(`Could not load active branches: ${error.message}`)
    return data
  })
}

export function getPublicPromotions() {
  return loadPublicData('promotions', async () => {
    const { data, error } = await getSupabaseClient()
      .from('promotions')
      .select(
        'id, name, description, terms, discount_type, discount_value, max_discount, minimum_purchase, starts_at, ends_at',
      )
      .eq('is_active', true)
      .lte('starts_at', new Date().toISOString())
      .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
      .order('ends_at', { ascending: true, nullsFirst: false })

    if (error) throw new Error(`Could not load current promotions: ${error.message}`)
    return data
  })
}

export function formatPrice(value) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 2,
  }).format(Number(value))
}

export function formatOperatingHours(hours) {
  if (!hours || typeof hours !== 'object' || Array.isArray(hours)) return ''
  return Object.entries(hours)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([day, value]) => `${day}: ${value}`)
    .join(' · ')
}
