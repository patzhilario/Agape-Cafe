import { useState } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Drawer,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material'
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
            width: { xs: '100vw', sm: 360 },
            maxWidth: '100vw',
            boxSizing: 'border-box',
            p: 2,
          },
        },
      }}
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h6">{product.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              Choose size and add-ons. The price updates with your selections.
            </Typography>
          </Box>
          <IconButton aria-label="Close item options" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>
        {product.variants.length > 0 ? (
          <FormControl size="small" fullWidth required>
            <InputLabel id={`menu-size-${product.id}`}>Size</InputLabel>
            <Select
              labelId={`menu-size-${product.id}`}
              label="Size"
              value={variantId}
              onChange={(event) => setVariantId(event.target.value)}
            >
              <MenuItem value="" disabled>Choose a size</MenuItem>
              {product.variants.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  {option.name} · {formatPrice(option.price)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : (
          <Alert severity="info">
            No sizes are configured for this product. The base price is {formatPrice(product.price)}.
          </Alert>
        )}
        {product.addons.length > 0 ? (
          <Box>
            <Typography variant="subtitle1" fontWeight={600}>Add-ons</Typography>
            <Stack>
              {product.addons.map((addon) => (
                <FormControlLabel
                  key={addon.id}
                  control={
                    <Checkbox
                      checked={addonIds.includes(addon.id)}
                      onChange={(event) => setAddonIds((current) => (
                        event.target.checked
                          ? [...current, addon.id]
                          : current.filter((id) => id !== addon.id)
                      ))}
                    />
                  }
                  label={`${addon.name} · ${addon.price ? `+${formatPrice(addon.price)}` : 'Included'}`}
                  slotProps={{ typography: { variant: 'body2' } }}
                />
              ))}
            </Stack>
          </Box>
        ) : (
          <Alert severity="info">No add-ons are configured for this product.</Alert>
        )}
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
            Quantity
          </Typography>
          <QuantityStepper value={quantity} onChange={setQuantity} />
        </Box>
        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
          <Typography fontWeight={600}>Item total</Typography>
          <Typography fontWeight={700} color="primary.dark">
            {formatPrice(unitPrice * quantity)}
          </Typography>
        </Stack>
        {errorMessage && <Typography variant="body2" color="error">{errorMessage}</Typography>}
        <Button
          variant="contained"
          fullWidth
          onClick={addProductToCart}
          disabled={product.variants.length > 0 && !variant}
        >
          Add configured item to cart
        </Button>
      </Stack>
    </Drawer>
  )
}
