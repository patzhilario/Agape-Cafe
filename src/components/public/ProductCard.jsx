import { lazy, Suspense, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import CoffeeOutlinedIcon from '@mui/icons-material/CoffeeOutlined'
import AddShoppingCartOutlinedIcon from '@mui/icons-material/AddShoppingCartOutlined'
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
      <Card
        variant="outlined"
        sx={{
          height: '100%',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: 3,
          borderColor: 'rgba(67, 48, 34, 0.14)',
          bgcolor: '#fffdfa',
          transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
          '&:hover': {
            transform: 'translateY(-3px)',
            borderColor: 'rgba(91, 57, 39, 0.32)',
            boxShadow: '0 14px 30px rgba(57, 35, 23, 0.09)',
          },
        }}
      >
        <CardActionArea
          component={RouterLink}
          to={`/menu/${product.id}`}
          sx={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'stretch' }}
        >
          <Box
            sx={{
              position: 'relative',
              flexShrink: 0,
              aspectRatio: '1.12 / 1',
              bgcolor: '#eee7dd',
              overflow: 'hidden',
              '& img': { transition: 'transform 260ms ease' },
              '&:hover img': { transform: 'scale(1.035)' },
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
              <Box sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: 'linear-gradient(145deg, #f1e7da, #e2cfbb)' }}>
                <CoffeeOutlinedIcon aria-hidden="true" sx={{ fontSize: 64, color: 'primary.light' }} />
              </Box>
            )}
            {(product.is_best_seller || product.is_featured) && (
              <Chip
                size="small"
                label={product.is_best_seller ? 'Best seller' : 'Featured'}
                sx={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  bgcolor: 'rgba(255,253,249,.94)',
                  color: 'primary.dark',
                  fontWeight: 700,
                  boxShadow: '0 2px 8px rgba(40,28,21,.12)',
                }}
              />
            )}
          </Box>
          <CardContent sx={{ px: 2.25, pt: 1.5, pb: 1, '&:last-child': { pb: 1 }, flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Stack sx={{ flex: 1, gap: 0.75 }}>
              <Typography variant="overline" color="primary" sx={{ letterSpacing: '.12em', lineHeight: 1.4, minHeight: '1.4em', overflowWrap: 'anywhere' }}>
                {product.category?.name || '\u00a0'}
              </Typography>
              <Typography variant="h6" component="h3" sx={{ fontWeight: 750, lineHeight: 1.25, overflowWrap: 'anywhere' }}>
                {product.name}
              </Typography>
              {product.description && <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  lineHeight: 1.4,
                }}
              >
                {product.description}
              </Typography>}
              <Typography variant="body1" color="primary.dark" fontWeight={800} sx={{ mt: 'auto', pt: 0.25 }}>
                {product.variants.length ? `From ${formatPrice(lowestPrice)}` : formatPrice(lowestPrice)}
              </Typography>
            </Stack>
          </CardContent>
        </CardActionArea>
        <CardContent sx={{ px: 2.25, pt: 0, pb: 2.25, flexShrink: 0 }}>
          <Button
            variant="contained"
            fullWidth
            startIcon={<AddShoppingCartOutlinedIcon />}
            onClick={() => setIsOptionsOpen(true)}
            sx={{ minHeight: 44, borderRadius: 2 }}
          >
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
