import { useState } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import {
  Alert,
  Box,
  Button,
  Checkbox,
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
import QuantityStepper from './QuantityStepper.jsx'
import { formatPrice } from '../../features/public/publicData.js'

export default function ProductOptionsDrawer({ product, onAdd, onClose }) {
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
      setErrorMessage('Choose a size first.')
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
        addons: selectedAddons.map(({ id, name, price }) => ({ id, name, price })),
        quantity,
        categoryType: product.category?.type || 'other',
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
            Make it yours by choosing a size and any extras.
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
                  <Typography variant="h6" fontWeight={700}>Choose a size</Typography>
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
              This item has one size. Base price: {formatPrice(product.price)}.
            </Alert>
          )}

          {product.addons.length > 0 && (
            <Box>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.25 }}
              >
                <Box>
                  <Typography variant="h6" fontWeight={700}>Add something extra</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Optional · choose as many as you like
                  </Typography>
                </Box>
                {!!selectedAddons.length && (
                  <Typography variant="caption" color="primary" fontWeight={700}>
                    {selectedAddons.length} selected
                  </Typography>
                )}
              </Stack>
              <Stack spacing={1}>
                {product.addons.map((addon) => {
                  const selected = addonIds.includes(addon.id)
                  return (
                    <Paper
                      key={addon.id}
                      variant="outlined"
                      sx={{
                        borderRadius: 2.5,
                        borderColor: selected ? 'primary.main' : 'divider',
                        bgcolor: selected ? 'rgba(91, 57, 39, 0.05)' : 'background.paper',
                        transition: 'background-color 150ms ease, border-color 150ms ease',
                      }}
                    >
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={selected}
                            onChange={(event) => {
                              setAddonIds((current) => (
                                event.target.checked
                                  ? [...current, addon.id]
                                  : current.filter((id) => id !== addon.id)
                              ))
                            }}
                          />
                        }
                        label={
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
                          >
                            <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                              {addon.name}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap', pr: 1 }}>
                              {addon.price ? `+${formatPrice(addon.price)}` : 'Included'}
                            </Typography>
                          </Stack>
                        }
                        sx={{ m: 0, width: '100%', minHeight: 56, pl: 0.5, pr: 0.5 }}
                      />
                    </Paper>
                  )
                })}
              </Stack>
            </Box>
          )}

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
          {product.variants.length > 0 && !variant ? 'Choose a size to continue' : 'Add to cart'}
        </Button>
      </Stack>
    </Drawer>
  )
}
