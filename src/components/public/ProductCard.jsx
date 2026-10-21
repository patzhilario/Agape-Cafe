import { lazy, Suspense, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import CoffeeOutlinedIcon from '@mui/icons-material/CoffeeOutlined'
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Stack,
  Typography,
} from '@mui/material'
import { useCart } from '../../features/orders/useCart.js'
import { formatPrice } from '../../features/public/publicData.js'

const ProductOptionsDrawer = lazy(() => import('./ProductOptionsDrawer.jsx'))

export default function ProductCard({ product }) {
  const { addItem } = useCart()
  const [isOptionsOpen, setIsOptionsOpen] = useState(false)
  const lowestPrice = product.variants.length
    ? Math.min(...product.variants.map((option) => option.price))
    : product.price

  function addConfiguredItem(item) {
    addItem(item)
    setIsOptionsOpen(false)
  }

  return (
    <>
      <Card variant="outlined" sx={{ height: '100%', overflow: 'hidden' }}>
        <CardActionArea component={RouterLink} to={`/menu/${product.id}`}>
          <Box
            sx={{
              aspectRatio: '4 / 3',
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
                loading="lazy"
                decoding="async"
                sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <CoffeeOutlinedIcon aria-hidden="true" sx={{ fontSize: 58, color: 'primary.light' }} />
            )}
          </Box>
          <CardContent>
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                {product.category?.name && (
                  <Typography variant="caption" color="text.secondary">
                    {product.category.name}
                  </Typography>
                )}
                {product.is_best_seller && <Chip size="small" label="Best seller" />}
                {!product.is_best_seller && product.is_featured && (
                  <Chip size="small" label="Featured" />
                )}
              </Stack>
              <Typography variant="h6" component="h3">{product.name}</Typography>
              {product.description && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {product.description}
                </Typography>
              )}
              <Typography variant="body2" color="primary.dark" fontWeight={700}>
                {product.variants.length ? `From ${formatPrice(lowestPrice)}` : formatPrice(lowestPrice)}
              </Typography>
            </Stack>
          </CardContent>
        </CardActionArea>
        <CardContent sx={{ pt: 0 }}>
          <Button variant="contained" fullWidth onClick={() => setIsOptionsOpen(true)}>
            Add to cart
          </Button>
        </CardContent>
      </Card>
      {isOptionsOpen && (
        <Suspense fallback={null}>
          <ProductOptionsDrawer
            product={product}
            onAdd={addConfiguredItem}
            onClose={() => setIsOptionsOpen(false)}
          />
        </Suspense>
      )}
    </>
  )
}
