import {
  Alert,
  Box,
  Button,
  Divider,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined'
import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { useCart } from '../../features/orders/useCart.js'
import { getCartItemKey } from '../../features/orders/cartUtils.js'
import { formatPrice } from '../../features/public/publicData.js'
import QuantityStepper from './QuantityStepper.jsx'

export default function CartSummaryPanel({ title = 'Your cart', onCheckout, onClose }) {
  const { items, subtotal, totalQuantity, updateQuantity, removeItem } = useCart()
  const location = useLocation()

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: 'center', justifyContent: 'space-between', px: 2.5, py: 2, flexShrink: 0 }}
      >
        <Box>
          <Typography variant="overline" color="primary" sx={{ letterSpacing: 1.5 }}>
            Agapé Café
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
            <Typography variant="h5" fontWeight={700}>{title}</Typography>
            <Typography variant="body2" color="text.secondary">
              {totalQuantity} {totalQuantity === 1 ? 'item' : 'items'}
            </Typography>
          </Stack>
        </Box>
        <IconButton aria-label="Close cart" onClick={onClose} edge="end">
          <CloseIcon />
        </IconButton>
      </Stack>
      <Divider />

      {!items.length ? (
        <Stack
          spacing={2}
          sx={{ flex: 1, alignItems: 'center', justifyContent: 'center', px: 3, textAlign: 'center' }}
        >
          <ShoppingBagOutlinedIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
          <Box>
            <Typography variant="h6">Your cart is waiting</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Pick something you love from the menu and it will show up here.
            </Typography>
          </Box>
          <Button component={RouterLink} to="/menu" variant="contained" onClick={onClose}>
            Browse the menu
          </Button>
        </Stack>
      ) : (
        <>
          <Stack
            spacing={1.5}
            sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2.5, py: 2 }}
          >
            {items.map((item) => {
              const key = getCartItemKey(item)
              const basePrice = item.variantId ? item.variantPrice : item.productPrice
              const addonsTotal = item.addons.reduce((sum, addon) => sum + addon.price, 0)
              const unitPrice = basePrice + addonsTotal

              return (
                <Paper
                  key={key}
                  variant="outlined"
                  sx={{ p: 1.75, borderRadius: 2.5, borderColor: 'divider' }}
                >
                  <Stack spacing={1.25}>
                    <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'space-between' }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
                          {item.productName}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                          {item.variantName ? `Size: ${item.variantName}` : 'Regular'}
                        </Typography>
                      </Box>
                      <Typography fontWeight={700} sx={{ whiteSpace: 'nowrap' }}>
                        {formatPrice(unitPrice * item.quantity)}
                      </Typography>
                    </Stack>
                    {item.addons.length > 0 && (
                      <Stack spacing={0.5}>
                        {item.addons.map((addon) => (
                          <Stack key={addon.id} direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
                            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                              + {addon.name}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                              {addon.price ? `${formatPrice(addon.price)} each` : 'Included'}
                            </Typography>
                          </Stack>
                        ))}
                      </Stack>
                    )}
                    <Divider />
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
                    >
                      <QuantityStepper
                        value={item.quantity}
                        max={Math.min(20, item.maxQuantity || 20)}
                        label={`quantity for ${item.productName}`}
                        onChange={(quantity) => updateQuantity(key, quantity)}
                      />
                      <Button
                        size="small"
                        color="inherit"
                        startIcon={<DeleteOutlineIcon />}
                        aria-label={`Remove ${item.productName} from cart`}
                        onClick={() => removeItem(key)}
                        sx={{ color: 'text.secondary', minWidth: 0 }}
                      >
                        Remove
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              )
            })}
          </Stack>
          <Divider />
          <Stack spacing={1.5} sx={{ px: 2.5, py: 2.25, flexShrink: 0 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography fontWeight={700}>Subtotal</Typography>
              <Typography variant="h6" fontWeight={700}>{formatPrice(subtotal)}</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Taxes, promotions, and any approved benefit discount are confirmed at checkout.
            </Typography>
            <Alert severity="info" sx={{ py: 0 }}>
              Final pricing is confirmed when you place your order.
            </Alert>
            <Button
              component={RouterLink}
              to="/customer/checkout"
              state={{ backgroundLocation: location }}
              variant="contained"
              size="large"
              fullWidth
              onClick={onCheckout}
              sx={{ py: 1.25 }}
            >
              Continue to checkout
            </Button>
          </Stack>
        </>
      )}
    </Box>
  )
}
