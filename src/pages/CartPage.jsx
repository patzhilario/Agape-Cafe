import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Container,
  Stack,
  Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined'
import QuantityStepper from '../components/public/QuantityStepper.jsx'
import { getCachedPublicBranches, getPublicBranches } from '../features/public/publicData.js'
import { formatPrice } from '../features/public/publicData.js'
import { useCart } from '../features/orders/useCart.js'
import { getCartItemKey } from '../features/orders/cartUtils.js'
import { PublicDataError, PublicLoading, SupabaseSetupNotice } from '../components/public/PublicDataState.jsx'

const hasSupabaseConfig =
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY)

export default function CartPage() {
  const { items, branchId, subtotal, updateQuantity, removeItem } = useCart()
  const cachedBranches = getCachedPublicBranches()
  const [isLoading, setIsLoading] = useState(hasSupabaseConfig && cachedBranches === undefined)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!hasSupabaseConfig) return undefined
    let active = true
    getPublicBranches()
      .catch((error) => {
        console.error('Unable to load store for the cart.', error)
        if (active) setErrorMessage(error.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <Container maxWidth="md" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="primary">
            Agapé Café
          </Typography>
          <Typography variant="h1">Your cart</Typography>
        </Box>
        {!hasSupabaseConfig && <SupabaseSetupNotice />}
        {errorMessage && <PublicDataError message={errorMessage} />}
        {isLoading ? (
          <PublicLoading label="Loading store…" />
        ) : items.length === 0 ? (
          <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
            <Typography color="text.secondary">Your cart is empty.</Typography>
            <Button component={RouterLink} to="/menu" variant="contained">
              Browse the menu
            </Button>
          </Stack>
        ) : (
          <>
            {items.map((item) => {
              const itemKey = getCartItemKey(item)
              const unitPrice =
                (item.variantId ? item.variantPrice : item.productPrice) +
                item.addons.reduce((total, addon) => total + addon.price, 0)
              return (
                <Stack
                  key={itemKey}
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={2}
                  sx={{
                    justifyContent: 'space-between',
                    alignItems: { xs: 'stretch', sm: 'center' },
                    p: 2,
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 2,
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6">{item.productName}</Typography>
                    {item.variantName && (
                      <Typography variant="body2" color="text.secondary">
                        {item.variantName}
                      </Typography>
                    )}
                    {!!item.addons.length && (
                      <Typography variant="body2" color="text.secondary">
                        Extras: {item.addons.map((addon) => addon.name).join(', ')}
                      </Typography>
                    )}
                    <Typography variant="body2" color="text.secondary">
                      {formatPrice(unitPrice)} each · estimated item total{' '}
                      {formatPrice(unitPrice * item.quantity)}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <QuantityStepper
                      value={item.quantity}
                      label={`quantity for ${item.productName}`}
                      onChange={(quantity) => updateQuantity(itemKey, quantity)}
                    />
                    <Button
                      aria-label={`Remove ${item.productName} from cart`}
                      onClick={() => removeItem(itemKey)}
                      color="inherit"
                      size="small"
                    >
                      <DeleteOutlineIcon fontSize="small" />
                      Remove
                    </Button>
                  </Stack>
                </Stack>
              )
            })}
            <Alert severity="info">
              Prices shown are estimates. The final price and stock availability
              are checked securely when you submit the order.
            </Alert>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
            >
              <Typography variant="h6">
                Estimated subtotal: {formatPrice(subtotal)}
              </Typography>
              <Button
                component={RouterLink}
                to="/customer/checkout"
                variant="contained"
                disabled={!branchId}
              >
                Continue to checkout
              </Button>
            </Stack>
          </>
        )}
      </Stack>
    </Container>
  )
}
