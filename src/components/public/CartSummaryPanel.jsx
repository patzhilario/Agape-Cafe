import {
  Alert,
  Box,
  Button,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { useCart } from '../../features/orders/useCart.js'
import { getCartItemKey } from '../../features/orders/cartUtils.js'
import { formatPrice } from '../../features/public/publicData.js'
import QuantityStepper from './QuantityStepper.jsx'

export default function CartSummaryPanel({ title = 'Your cart', onCheckout }) {
  const { items, subtotal, updateQuantity, removeItem } = useCart()
  const location = useLocation()

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2.5, position: { md: 'sticky' }, top: { md: 92 }, maxHeight: { md: 'calc(100vh - 112px)' }, overflowY: 'auto' }}
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">{title}</Typography>
          <Typography variant="body2" color="text.secondary">
            {items.reduce((sum, item) => sum + item.quantity, 0)} items
          </Typography>
        </Stack>
        {!items.length ? (
          <Alert severity="info">Add a menu item to start your order.</Alert>
        ) : (
          <>
            <Stack spacing={1.5} divider={<Divider flexItem />}>
              {items.map((item) => {
                const key = getCartItemKey(item)
                const basePrice = item.variantId ? item.variantPrice : item.productPrice
                const unitPrice = basePrice +
                  item.addons.reduce((sum, addon) => sum + addon.price, 0)
                return (
                  <Box key={key}>
                    <Stack spacing={0.75}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                          {item.productName}
                        </Typography>
                        {item.variantName && (
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ justifyContent: 'space-between', alignItems: 'baseline', mt: 0.5 }}
                          >
                            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                              Size: {item.variantName}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                              {formatPrice(basePrice)}
                            </Typography>
                          </Stack>
                        )}
                      </Box>
                      {item.addons.length > 0 && (
                        <Stack spacing={0.5}>
                          <Typography variant="caption" color="text.secondary" fontWeight={700}>
                            ADD-ONS
                          </Typography>
                          {item.addons.map((addon) => (
                            <Stack
                              key={addon.id}
                              direction="row"
                              spacing={1}
                              sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}
                            >
                              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                                {addon.name}
                              </Typography>
                              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                                {addon.price ? `${formatPrice(addon.price)} each` : 'Included'}
                              </Typography>
                            </Stack>
                          ))}
                        </Stack>
                      )}
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ justifyContent: 'space-between', alignItems: 'baseline', pt: 0.25 }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          {item.quantity} × {formatPrice(unitPrice)}
                        </Typography>
                        <Typography fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>
                          {formatPrice(unitPrice * item.quantity)}
                        </Typography>
                      </Stack>
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1 }}>
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
                      >
                        Remove
                      </Button>
                    </Stack>
                  </Box>
                )
              })}
            </Stack>
            <Divider />
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Typography fontWeight={700}>Subtotal</Typography>
              <Typography fontWeight={700}>{formatPrice(subtotal)}</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Taxes, promotions, and any approved benefit discount are confirmed at checkout.
            </Typography>
            <Button
              component={RouterLink}
              to="/customer/checkout"
              state={{ backgroundLocation: location }}
              variant="contained"
              fullWidth
              onClick={onCheckout}
            >
              Continue to checkout
            </Button>
          </>
        )}
      </Stack>
    </Paper>
  )
}
