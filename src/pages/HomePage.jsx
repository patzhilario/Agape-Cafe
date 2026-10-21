import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import {
  formatPrice,
  getPublicBranches,
  getPublicProducts,
  getPublicPromotions,
} from '../features/public/publicData.js'
import BranchCards from '../components/public/BranchCards.jsx'
import ProductGrid from '../components/public/ProductGrid.jsx'
import {
  EmptyPublicState,
  PublicDataError,
  PublicLoading,
  SectionHeading,
  SupabaseSetupNotice,
} from '../components/public/PublicDataState.jsx'

const hasSupabaseConfig =
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY)

function PromotionCard({ promotion }) {
  const value =
    promotion.discount_type === 'percentage'
      ? `${Number(promotion.discount_value)}% off`
      : `${formatPrice(promotion.discount_value)} off`
  const validFrom = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' }).format(
    new Date(promotion.starts_at),
  )
  const validUntil = promotion.ends_at
    ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' }).format(
        new Date(promotion.ends_at),
      )
    : 'While active'

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Stack spacing={1.25}>
          <Chip label={value} color="secondary" sx={{ alignSelf: 'flex-start' }} />
          <Typography variant="h6">{promotion.name}</Typography>
          {promotion.description && (
            <Typography color="text.secondary">{promotion.description}</Typography>
          )}
          {promotion.terms && (
            <>
              <Divider />
              <Typography variant="body2" color="text.secondary">
                {promotion.terms}
              </Typography>
            </>
          )}
          {Number(promotion.minimum_purchase) > 0 && (
            <Typography variant="caption" color="text.secondary">
              Minimum purchase: {formatPrice(promotion.minimum_purchase)}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            Valid: {validFrom} – {validUntil}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  )
}

export default function HomePage() {
  const [featuredProducts, setFeaturedProducts] = useState([])
  const [branches, setBranches] = useState([])
  const [promotions, setPromotions] = useState([])
  const [isLoading, setIsLoading] = useState(hasSupabaseConfig)
  const [errorMessage, setErrorMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!hasSupabaseConfig) return undefined
    let active = true

    Promise.all([
      getPublicProducts({ featured: true, limit: 4 }),
      getPublicBranches(),
      getPublicPromotions(),
    ])
      .then(([products, activeBranches, activePromotions]) => {
        if (!active) return
        setFeaturedProducts(products)
        setBranches(activeBranches)
        setPromotions(activePromotions)
        setErrorMessage('')
      })
      .catch((error) => {
        console.error('Unable to load the public home page data.', error)
        if (active) setErrorMessage(error.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [reloadKey])

  return (
    <>
      <Box
        sx={{
          bgcolor: 'primary.dark',
          color: 'primary.contrastText',
          py: { xs: 9, md: 15 },
          overflow: 'hidden',
          position: 'relative',
          '&::after': {
            content: '""',
            position: 'absolute',
            width: { xs: 260, md: 500 },
            height: { xs: 260, md: 500 },
            border: '1px solid rgba(255,250,244,.12)',
            borderRadius: '50%',
            right: { xs: -110, md: '4%' },
            top: '50%',
            transform: 'translateY(-50%)',
            boxShadow: '0 0 0 44px rgba(255,250,244,.035), 0 0 0 88px rgba(255,250,244,.025)',
          },
        }}
      >
        <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
          <Stack spacing={3} sx={{ maxWidth: 720 }}>
            <Typography variant="overline" sx={{ letterSpacing: '.18em', opacity: 0.8 }}>
              AGAPÉ CAFÉ
            </Typography>
            <Typography variant="h1" color="inherit">
              A little love in every cup.
            </Typography>
            <Typography
              variant="h6"
              color="inherit"
              sx={{ maxWidth: 580, opacity: 0.82, fontWeight: 400 }}
            >
              Find your next favorite from the Agapé Café menu and choose the
              branch that works for you.
            </Typography>
            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
              <Button
                component={RouterLink}
                to="/menu"
                variant="contained"
                color="secondary"
                size="large"
              >
                Explore the menu
              </Button>
              <Button
                component={RouterLink}
                to="/branches"
                variant="outlined"
                color="inherit"
                size="large"
              >
                Find a branch
              </Button>
            </Stack>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 9 } }}>
        <Stack spacing={{ xs: 7, md: 10 }}>
          {!hasSupabaseConfig && <SupabaseSetupNotice />}
          {errorMessage && (
            <PublicDataError
              message={errorMessage}
              onRetry={() => {
                setIsLoading(true)
                setReloadKey((key) => key + 1)
              }}
            />
          )}
          <Box>
            <SectionHeading
              eyebrow="A few favorites"
              title="Featured from the menu"
              description="Published selections from our current menu."
              action={
                <Button
                  component={RouterLink}
                  to="/menu"
                  endIcon={<ArrowForwardIcon />}
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  View full menu
                </Button>
              }
            />
            {!hasSupabaseConfig ? (
              <EmptyPublicState>
                Connect Supabase and publish featured products to show them here.
              </EmptyPublicState>
            ) : isLoading ? (
              <PublicLoading label="Loading featured products…" />
            ) : featuredProducts.length ? (
              <ProductGrid products={featuredProducts} />
            ) : (
              <EmptyPublicState>
                Featured products will appear here when published by the shop.
              </EmptyPublicState>
            )}
          </Box>

          <Box>
            <SectionHeading
              eyebrow="While available"
              title="Current promotions"
              description="Only active promotions within their validity dates are shown."
            />
            {!hasSupabaseConfig ? (
              <EmptyPublicState>
                Connect Supabase to display current promotion details.
              </EmptyPublicState>
            ) : isLoading ? (
              <PublicLoading label="Checking current promotions…" />
            ) : promotions.length ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    sm: 'repeat(2, minmax(0, 1fr))',
                    lg: 'repeat(3, minmax(0, 1fr))',
                  },
                  gap: 2,
                }}
              >
                {promotions.map((promotion) => (
                  <PromotionCard key={promotion.id} promotion={promotion} />
                ))}
              </Box>
            ) : (
              <EmptyPublicState>No active promotions are available right now.</EmptyPublicState>
            )}
          </Box>

          <Paper
            variant="outlined"
            sx={{
              p: { xs: 3, md: 5 },
              bgcolor: 'primary.dark',
              color: 'primary.contrastText',
            }}
          >
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={3}
              sx={{
                alignItems: { xs: 'flex-start', md: 'center' },
                justifyContent: 'space-between',
              }}
            >
              <Box>
                <Typography variant="overline" sx={{ letterSpacing: '.15em', opacity: 0.8 }}>
                  Made for your coffee moment
                </Typography>
                <Typography variant="h2" color="inherit">
                  Get to know Agapé Café
                </Typography>
              </Box>
              <Button
                component={RouterLink}
                to="/about"
                variant="outlined"
                color="inherit"
                endIcon={<ArrowForwardIcon />}
              >
                About the café
              </Button>
            </Stack>
          </Paper>

          <Box>
            <SectionHeading
              eyebrow="Come by"
              title="Our branches"
              description="Branch details published by Agapé Café."
              action={
                <Button
                  component={RouterLink}
                  to="/branches"
                  endIcon={<ArrowForwardIcon />}
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  All branches
                </Button>
              }
            />
            {!hasSupabaseConfig ? (
              <EmptyPublicState>
                Connect Supabase to display active branch information.
              </EmptyPublicState>
            ) : isLoading ? (
              <PublicLoading label="Loading active branches…" />
            ) : (
              <BranchCards branches={branches.slice(0, 3)} />
            )}
          </Box>
        </Stack>
      </Container>
    </>
  )
}
