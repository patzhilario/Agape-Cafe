import { useState } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import {
  Alert,
  Box,
  Button,
  Divider,
  Drawer,
  FormControl,
  FormControlLabel,
  IconButton,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined'
import ProductExtras from './ProductExtras.jsx'
import { getVariantLabel } from '../../features/public/menuOptions.js'
import QuantityStepper from './QuantityStepper.jsx'
import { formatPrice } from '../../features/public/publicData.js'

export default function ProductOptionsDrawer({ product, onAdd, onClose }) {
  const variantLabel = getVariantLabel(product.category?.type)
  const isDrink = product.category?.type === 'drink'
  const [servingType, setServingType] = useState('glass')
  const [variantId, setVariantId] = useState('')
  const [addonIds, setAddonIds] = useState([])
  const [quantity, setQuantity] = useState(1)
  const [errorMessage, setErrorMessage] = useState('')
  const variant = product.variants.find((option) => option.id === variantId)
  const selectedAddons = product.addons.filter((addon) => addonIds.includes(addon.id))
  const unitPrice = (variant?.price ?? product.price) +
    selectedAddons.reduce((total, addon) => total + addon.price, 0)

  function addProductToCart() {
    setErrorMessage('')
    if (product.variants.length && !variant) {
      setErrorMessage(`Choose a ${variantLabel.toLowerCase()} first.`)
      return
    }
    try {
      onAdd({
        productId: product.id,
        productName: product.name,
        productPrice: product.price,
        variantId: variant?.id || '',
        variantName: variant?.name || '',
        variantPrice: variant?.price ?? product.price,
        addons: selectedAddons.map(({ id, name, price, option_kind }) => ({ id, name, price, option_kind })),
        quantity,
        categoryType: product.category?.type || 'other',
        servingType: isDrink ? servingType : null,
      })
    } catch (error) {
      console.error('Unable to add the configured product to the cart.', error)
      setErrorMessage(error.message)
    }
  }

  return (
    <Drawer
      anchor="right"
      open
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: { xs: '100vw', sm: 420, md: 460 },
            maxWidth: '100vw',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          },
        },
      }}
    >
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: 'flex-start', justifyContent: 'space-between', px: 2.5, py: 2 }}
      >
        <Box sx={{ minWidth: 0, pt: 0.25 }}>
          <Typography variant="overline" color="primary" sx={{ letterSpacing: 1.5 }}>
            Customize your order
          </Typography>
          <Typography variant="h5" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
            {product.name}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Choose your options and any extras.
          </Typography>
        </Box>
        <IconButton aria-label="Close item options" onClick={onClose} edge="end">
          <CloseIcon />
        </IconButton>
      </Stack>
      <Divider />

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2.5, py: 2.5 }}>
        <Stack spacing={2.5}>
          {product.variants.length > 0 ? (
            <FormControl required>
              <Stack spacing={1.25}>
                <Box>
                  <Typography variant="h6" fontWeight={700}>Choose a {variantLabel.toLowerCase()}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Select one option to continue.
                  </Typography>
                </Box>
                <RadioGroup
                  name={`product-size-${product.id}`}
                  value={variantId}
                  onChange={(event) => {
                    setVariantId(event.target.value)
                    setErrorMessage('')
                  }}
                  sx={{ gap: 1 }}
                >
                  {product.variants.map((option) => {
                    const selected = option.id === variantId
                    return (
                      <Paper
                        key={option.id}
                        variant="outlined"
                        sx={{
                          borderRadius: 2.5,
                          borderColor: selected ? 'primary.main' : 'divider',
                          bgcolor: selected ? 'rgba(91, 57, 39, 0.05)' : 'background.paper',
                          transition: 'background-color 150ms ease, border-color 150ms ease',
                        }}
                      >
                        <FormControlLabel
                          value={option.id}
                          control={<Radio />}
                          label={
                            <Stack
                              direction="row"
                              spacing={1}
                              sx={{ alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
                            >
                              <Typography fontWeight={600}>{option.name}</Typography>
                              <Typography fontWeight={700} sx={{ whiteSpace: 'nowrap', pr: 1 }}>
                                {formatPrice(option.price)}
                              </Typography>
                            </Stack>
                          }
                          sx={{ m: 0, width: '100%', minHeight: 56, pl: 0.5, pr: 0.5 }}
                        />
                      </Paper>
                    )
                  })}
                </RadioGroup>
              </Stack>
            </FormControl>
          ) : (
            <Alert severity="info">
              Base price: {formatPrice(product.price)}.
            </Alert>
          )}
 
          {isDrink && (
            <FormControl required>
              <Stack spacing={1.25}>
                <Box>
                  <Typography variant="h6" fontWeight={700}>Serving container (for Dine-in)</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Choose whether you prefer glass or a takeout cup.
                  </Typography>
                </Box>
                <RadioGroup
                  row
                  name={`product-serving-${product.id}`}
                  value={servingType}
                  onChange={(event) => setServingType(event.target.value)}
                  sx={{ gap: 1 }}
                >
                  {[
                    { value: 'glass', label: 'Glass / Mug', subtitle: 'Eco-friendly (Dine-in)' },
                    { value: 'cup', label: 'Takeout Cup', subtitle: 'Disposable cup' },
                  ].map((option) => {
                    const selected = option.value === servingType
                    return (
                      <Paper
                        key={option.value}
                        variant="outlined"
                        sx={{
                          flex: 1,
                          borderRadius: 2.5,
                          p: 1.5,
                          borderColor: selected ? 'primary.main' : 'divider',
                          bgcolor: selected ? 'rgba(91, 57, 39, 0.05)' : 'background.paper',
                          cursor: 'pointer',
                          transition: 'border-color 150ms ease',
                        }}
                        onClick={() => setServingType(option.value)}
                      >
                        <FormControlLabel
                          value={option.value}
                          control={<Radio />}
                          label={
                            <Box>
                              <Typography fontWeight={600} variant="body2">{option.label}</Typography>
                              <Typography variant="caption" color="text.secondary">{option.subtitle}</Typography>
                            </Box>
                          }
                          sx={{ m: 0 }}
                        />
                      </Paper>
                    )
                  })}
                </RadioGroup>
              </Stack>
            </FormControl>
          )}

          <ProductExtras options={product.addons} selectedIds={addonIds} onChange={setAddonIds} />

          <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2.5 }}>
            <Stack
              direction="row"
              spacing={2}
              sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
            >
              <Box>
                <Typography variant="body2" color="text.secondary">Quantity</Typography>
                <QuantityStepper value={quantity} onChange={setQuantity} />
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="body2" color="text.secondary">
                  {quantity} × {formatPrice(unitPrice)}
                </Typography>
                <Typography variant="h6" color="primary.dark" fontWeight={800}>
                  {formatPrice(unitPrice * quantity)}
                </Typography>
              </Box>
            </Stack>
          </Paper>
        </Stack>
      </Box>

      <Divider />
      <Stack spacing={1.25} sx={{ px: 2.5, py: 2, pb: 'max(16px, env(safe-area-inset-bottom))', flexShrink: 0 }}>
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        <Button
          variant="contained"
          size="large"
          fullWidth
          onClick={addProductToCart}
          disabled={product.variants.length > 0 && !variant}
          startIcon={<ShoppingBagOutlinedIcon />}
          sx={{ minHeight: 52, borderRadius: 2.5 }}
        >
          {product.variants.length > 0 && !variant ? `Choose a ${variantLabel.toLowerCase()} to continue` : 'Add to cart'}
        </Button>
      </Stack>
    </Drawer>
  )
}
