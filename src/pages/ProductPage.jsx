import { useEffect, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  Checkbox,
  Container,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CoffeeOutlinedIcon from '@mui/icons-material/CoffeeOutlined'
import {
  formatPrice,
  getPublicProduct,
} from '../features/public/publicData.js'
import { useCart } from '../features/orders/useCart.js'
import {
  EmptyPublicState,
  PublicDataError,
  PublicLoading,
  SupabaseSetupNotice,
} from '../components/public/PublicDataState.jsx'

const hasSupabaseConfig =
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY)

export default function ProductPage() {
  const { productId } = useParams()
  const { addItem, branchId } = useCart()
  const [loadedProduct, setLoadedProduct] = useState({ id: null, value: null })
  const [loadError, setLoadError] = useState({ id: null, message: '' })
  const [variantSelection, setVariantSelection] = useState({ productId: '', value: '' })
  const [addonSelection, setAddonSelection] = useState({ productId: '', values: [] })
  const [cartMessage, setCartMessage] = useState({ productId: '', severity: '', text: '' })

  useEffect(() => {
    if (!hasSupabaseConfig) return undefined
    let active = true
    getPublicProduct(productId, branchId)
      .then((loadedProduct) => {
        if (active) {
          setLoadedProduct({ id: productId, value: loadedProduct })
          setLoadError({ id: productId, message: '' })
        }
      })
      .catch((error) => {
        console.error('Unable to load the public product detail.', error)
        if (active) setLoadError({ id: productId, message: error.message })
      })
    return () => {
      active = false
    }
  }, [productId, branchId])

  const product = loadedProduct.id === productId ? loadedProduct.value : null
  const errorMessage = loadError.id === productId ? loadError.message : ''
  const isLoading =
    hasSupabaseConfig && loadedProduct.id !== productId && loadError.id !== productId
  const selectedVariantId =
    variantSelection.productId === productId ? variantSelection.value : ''
  const selectedAddonIds =
    addonSelection.productId === productId ? addonSelection.values : []
  const visibleCartMessage = cartMessage.productId === productId ? cartMessage : null
  const selectedVariant = product?.variants.find((variant) => variant.id === selectedVariantId)
  const selectedAddons = product?.addons.filter((addon) => selectedAddonIds.includes(addon.id)) || []
  const selectedUnitPrice =
    (selectedVariant?.price ?? product?.price ?? 0) +
    selectedAddons.reduce((total, addon) => total + addon.price, 0)

  function addProductToCart() {
    setCartMessage({ productId, severity: '', text: '' })
    if (product.variants.length > 0 && !selectedVariant) {
      setCartMessage({
        productId,
        severity: 'warning',
        text: 'Choose a size before adding this item.',
      })
      return
    }

    try {
      addItem({
        productId: product.id,
        productName: product.name,
        productPrice: product.price,
        variantId: selectedVariant?.id || '',
        variantName: selectedVariant?.name || '',
        variantPrice: selectedVariant?.price ?? product.price,
        addons: selectedAddons.map((addon) => ({
          id: addon.id,
          name: addon.name,
          price: addon.price,
        })),
        quantity: 1,
        categoryType: product.category?.type || 'other',
      })
      setCartMessage({ productId, severity: 'success', text: 'Added to your cart.' })
    } catch (error) {
      setCartMessage({ productId, severity: 'error', text: error.message })
    }
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 4, md: 7 } }}>
      <Stack spacing={3}>
        <Button
          component={RouterLink}
          to="/menu"
          startIcon={<ArrowBackIcon />}
          sx={{ alignSelf: 'flex-start' }}
        >
          Back to menu
        </Button>
        {!hasSupabaseConfig && <SupabaseSetupNotice />}
        {errorMessage && <PublicDataError message={errorMessage} />}
        {!hasSupabaseConfig ? null : isLoading ? (
          <PublicLoading label="Loading product details…" />
        ) : !product ? (
          <EmptyPublicState>
            This product is not available or has not been published.
          </EmptyPublicState>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
              gap: { xs: 3, md: 6 },
              alignItems: 'start',
            }}
          >
            <Paper
              variant="outlined"
              sx={{
                aspectRatio: '1 / 1',
                bgcolor: '#eee7dd',
                display: 'grid',
                placeItems: 'center',
                overflow: 'hidden',
              }}
            >
              {product.imageUrl ? (
                <Box
                  component="img"
                  src={product.imageUrl}
                  alt={product.name}
                  decoding="async"
                  sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <CoffeeOutlinedIcon aria-hidden="true" sx={{ fontSize: 90, color: 'primary.light' }} />
              )}
            </Paper>
            <Stack spacing={2.5}>
              {product.category?.name && (
                <Typography variant="overline" color="primary">
                  {product.category.name}
                </Typography>
              )}
              <Typography variant="h1">{product.name}</Typography>
              {product.description && (
                <Typography color="text.secondary">{product.description}</Typography>
              )}
              {product.is_best_seller && (
                <Chip label="Best seller" sx={{ alignSelf: 'flex-start' }} />
              )}
              <Typography variant="h5" color="primary.dark" fontWeight={700}>
                {product.variants.length
                  ? `From ${formatPrice(Math.min(...product.variants.map((variant) => variant.price)))}`
                  : formatPrice(product.price)}
              </Typography>
              {product.variants.length > 0 && (
                <FormControl required fullWidth>
                  <InputLabel id="product-size-label">Size</InputLabel>
                  <Select
                    labelId="product-size-label"
                    label="Size"
                    value={selectedVariantId}
                    onChange={(event) =>
                      setVariantSelection({ productId, value: event.target.value })
                    }
                  >
                    <MenuItem value="" disabled>
                      Choose a size
                    </MenuItem>
                    {product.variants.map((variant) => (
                      <MenuItem key={variant.id} value={variant.id}>
                        {variant.name} · {formatPrice(variant.price)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              {product.addons.length > 0 && (
                <>
                  <Divider />
                  <Box>
                    <Typography variant="h6" gutterBottom>
                      Add-ons
                    </Typography>
                    <Stack spacing={0.5}>
                      {product.addons.map((addon) => (
                        <FormControlLabel
                          key={addon.id}
                          control={
                            <Checkbox
                              checked={selectedAddonIds.includes(addon.id)}
                              onChange={(event) =>
                                setAddonSelection((current) => {
                                  const selected =
                                    current.productId === productId ? current.values : []
                                  return {
                                    productId,
                                    values: event.target.checked
                                      ? [...selected, addon.id]
                                      : selected.filter((id) => id !== addon.id),
                                  }
                                })
                              }
                            />
                          }
                          label={`${addon.name} · ${
                            addon.price === 0 ? 'Included' : `+${formatPrice(addon.price)}`
                          }`}
                        />
                      ))}
                    </Stack>
                  </Box>
                </>
              )}
              <Typography variant="h6">
                Item price: {formatPrice(selectedUnitPrice)}
              </Typography>
              {visibleCartMessage?.text && (
                <Alert severity={visibleCartMessage.severity}>{visibleCartMessage.text}</Alert>
              )}
              <Button
                variant="contained"
                size="large"
                onClick={addProductToCart}
                disabled={product.variants.length > 0 && !selectedVariant}
              >
                Add to cart
              </Button>
              <Typography variant="body2" color="text.secondary">
                {branchId
                  ? 'Prices reflect the selected branch. Availability and totals are rechecked when you place your order.'
                  : 'Choose a branch from the menu to see its availability and pricing. Final totals are rechecked when you place your order.'}
              </Typography>
            </Stack>
          </Box>
        )}
      </Stack>
    </Container>
  )
}
