import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import CoffeeOutlinedIcon from '@mui/icons-material/CoffeeOutlined'
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
  getCachedPublicBranches,
  getCachedPublicProducts,
  getCachedPublicPromotions,
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
  const cachedProducts = getCachedPublicProducts({ featured: true, limit: 4 })
  const cachedBranches = getCachedPublicBranches()
  const cachedPromotions = getCachedPublicPromotions()
  const hasCachedHomeData =
    cachedProducts !== undefined &&
    cachedBranches !== undefined &&
    cachedPromotions !== undefined
  const [featuredProducts, setFeaturedProducts] = useState(cachedProducts || [])
  const [branches, setBranches] = useState(cachedBranches || [])
  const [promotions, setPromotions] = useState(cachedPromotions || [])
  const [isLoading, setIsLoading] = useState(hasSupabaseConfig && !hasCachedHomeData)
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
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(120deg, #f4eadc 0%, #fbf7f1 56%, #efe1d1 100%)',
          color: 'text.primary',
          py: { xs: 5, sm: 7, md: 10 },
          '&::before': {
            content: '""',
            position: 'absolute',
            width: { xs: 240, md: 420 },
            height: { xs: 240, md: 420 },
            borderRadius: '50%',
            border: '1px solid rgba(91, 57, 39, 0.08)',
            right: { xs: -125, md: -145 },
            top: { xs: -105, md: -180 },
            boxShadow: '0 0 0 34px rgba(91, 57, 39, 0.025), 0 0 0 72px rgba(91, 57, 39, 0.02)',
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            width: { xs: 150, md: 230 },
            height: { xs: 150, md: 230 },
            borderRadius: '50%',
            bgcolor: 'rgba(184, 121, 69, 0.08)',
            left: { xs: -90, md: '8%' },
            bottom: { xs: -105, md: -145 },
          },
        }}
      >
        <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1.05fr 0.95fr' },
              gap: { xs: 4, md: 7 },
              alignItems: 'center',
            }}
          >
            <Stack spacing={{ xs: 2, md: 2.5 }} sx={{ maxWidth: 600, py: { md: 2 } }}>
              <Chip
                icon={<CoffeeOutlinedIcon />}
                label="A little pause, made just for you"
                sx={{
                  alignSelf: 'flex-start',
                  bgcolor: 'rgba(255, 253, 249, 0.75)',
                  color: 'primary.dark',
                  border: '1px solid rgba(91, 57, 39, 0.12)',
                  '& .MuiChip-icon': { color: 'primary.main' },
                }}
              />
              <Typography
                variant="h1"
                sx={{
                  maxWidth: 620,
                  color: 'primary.dark',
                  fontSize: { xs: 'clamp(2.1rem, 9vw, 3.25rem)', md: 'clamp(3.5rem, 5.7vw, 5.3rem)' },
                  lineHeight: { xs: 1.04, md: 1.02 },
                  letterSpacing: '-0.055em',
                }}
              >
                Find your little moment of calm.
              </Typography>
              <Typography
                variant="h6"
                sx={{
                  maxWidth: 500,
                  color: 'text.secondary',
                  fontWeight: 400,
                  lineHeight: 1.7,
                  fontSize: { xs: '1rem', md: '1.15rem' },
                }}
              >
                Thoughtfully made coffee, comforting favorites, and a cozy
                little break waiting for you at Agapé Café.
              </Typography>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.25}
                useFlexGap
                sx={{ pt: 0.5, flexWrap: 'wrap', alignItems: { sm: 'center' } }}
              >
                <Button
                  component={RouterLink}
                  to="/menu"
                  variant="contained"
                  color="primary"
                  size="large"
                  endIcon={<ArrowForwardIcon />}
                  sx={{ minHeight: 48, px: 2.5, width: { xs: '100%', sm: 'auto' } }}
                >
                  Explore the menu
                </Button>
                <Button
                  component={RouterLink}
                  to="/branches"
                  variant="text"
                  color="primary"
                  size="large"
                  sx={{ minHeight: 46, px: 2, width: { xs: '100%', sm: 'auto' } }}
                >
                  Find your nearest café
                </Button>
              </Stack>
              <Stack
                direction="row"
                spacing={{ xs: 1.5, sm: 2.5 }}
                useFlexGap
                sx={{
                  pt: { xs: 0.5, md: 1 },
                  flexWrap: 'wrap',
                  rowGap: 1,
                  color: 'text.secondary',
                }}
              >
                {['Made fresh to order', 'A warm welcome, always'].map((item) => (
                  <Stack key={item} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <Box
                      aria-hidden="true"
                      sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'secondary.main' }}
                    />
                    <Typography variant="body2">{item}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Stack>
            <Box
              sx={{
                position: 'relative',
                width: '100%',
                maxWidth: 520,
                justifySelf: { md: 'end' },
                mx: { xs: 'auto', md: 0 },
                pr: { xs: 1, sm: 2 },
                pb: { xs: 1, sm: 2 },
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  inset: { xs: '10% 0 0 10%', md: '8% 0 0 12%' },
                  borderRadius: { xs: 6, md: 8 },
                  bgcolor: 'secondary.main',
                  opacity: 0.18,
                  transform: 'rotate(4deg)',
                }}
              />
              <Box
                sx={{
                  position: 'relative',
                  aspectRatio: { xs: '1.16 / 1', sm: '1.35 / 1', md: '0.96 / 1' },
                  overflow: 'hidden',
                  borderRadius: { xs: 5, md: 7 },
                  bgcolor: '#e8d8c5',
                  background: 'linear-gradient(145deg, #e7d5c0 0%, #f4e9dc 50%, #d7b99b 100%)',
                  boxShadow: '0 28px 70px rgba(57, 35, 23, 0.16)',
                }}
              >
                <Box
                  aria-hidden="true"
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    overflow: 'hidden',
                    background:
                      'radial-gradient(circle at 52% 43%, #d8b58f 0 22%, transparent 22.5%), radial-gradient(circle at 50% 45%, rgba(255,253,249,.48) 0 38%, transparent 38.5%), linear-gradient(145deg, #eadbc9 0%, #f4eadf 52%, #cfaa87 100%)',
                  }}
                >
                  <Box
                    sx={{
                      position: 'absolute',
                      width: { xs: 188, sm: 220, md: 270 },
                      height: { xs: 188, sm: 220, md: 270 },
                      left: '50%',
                      top: '45%',
                      transform: 'translate(-50%, -50%)',
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      bgcolor: 'rgba(255, 253, 249, 0.58)',
                      border: '1px solid rgba(255, 253, 249, 0.72)',
                      boxShadow: '0 20px 55px rgba(91, 57, 39, 0.12)',
                    }}
                  >
                    <Box
                      sx={{
                        width: '76%',
                        height: '76%',
                        borderRadius: '50%',
                        display: 'grid',
                        placeItems: 'center',
                        color: '#fffaf4',
                        bgcolor: 'primary.main',
                        boxShadow: 'inset 0 0 0 10px rgba(255,255,255,.08)',
                      }}
                    >
                      <CoffeeOutlinedIcon sx={{ fontSize: { xs: 92, sm: 112, md: 136 } }} />
                    </Box>
                  </Box>
                  <Box
                    sx={{
                      position: 'absolute',
                      width: { xs: 46, md: 62 },
                      height: { xs: 46, md: 62 },
                      borderRadius: '50%',
                      top: '13%',
                      right: '15%',
                      bgcolor: 'rgba(255, 253, 249, 0.72)',
                      boxShadow: '0 10px 28px rgba(91, 57, 39, 0.08)',
                    }}
                  />
                  <Box
                    sx={{
                      position: 'absolute',
                      width: { xs: 25, md: 34 },
                      height: { xs: 25, md: 34 },
                      borderRadius: '50%',
                      top: '24%',
                      left: '14%',
                      bgcolor: 'rgba(91, 57, 39, 0.12)',
                    }}
                  />
                </Box>
                <Box
                  sx={{
                    position: 'absolute',
                    inset: '45% 0 0',
                    background: 'linear-gradient(transparent, rgba(40, 28, 21, 0.38))',
                  }}
                />
                <Paper
                  elevation={0}
                  sx={{
                    position: 'absolute',
                    zIndex: 2,
                    left: { xs: 14, sm: 20 },
                    right: { xs: 14, sm: 20 },
                    bottom: { xs: 14, sm: 20 },
                    p: { xs: 1.5, sm: 2 },
                    borderRadius: 3,
                    bgcolor: 'rgba(255, 253, 249, 0.94)',
                    backdropFilter: 'blur(12px)',
                  }}
                >
                  <Typography variant="overline" color="primary" sx={{ letterSpacing: '.12em' }}>
                    YOUR COFFEE BREAK
                  </Typography>
                  <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.3 }}>
                    Something lovely is brewing
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Take a breath. We’ll make your moment.
                  </Typography>
                </Paper>
              </Box>
            </Box>
          </Box>
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

          <Box
            component="section"
            aria-labelledby="home-about-heading"
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '.8fr 1.2fr' },
              gap: { xs: 2, md: 8 },
              alignItems: 'center',
              py: { xs: 4, md: 5 },
              borderTop: '1px solid rgba(67, 48, 34, 0.2)',
              borderBottom: '1px solid rgba(67, 48, 34, 0.2)',
            }}
          >
            <Box>
              <Typography variant="overline" color="primary" sx={{ letterSpacing: '.16em' }}>
                A LITTLE MORE ABOUT US
              </Typography>
              <Typography
                id="home-about-heading"
                component="h2"
                sx={{
                  mt: 0.75,
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontSize: { xs: '2rem', md: '2.65rem' },
                  fontWeight: 400,
                  letterSpacing: '-.04em',
                  lineHeight: 1.1,
                }}
              >
                Get to know Agapé Café
              </Typography>
            </Box>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
            >
              <Typography color="text.secondary" sx={{ maxWidth: 470, lineHeight: 1.8 }}>
                Learn the meaning behind our name and the idea that inspires
                the way we welcome you.
              </Typography>
              <Button
                component={RouterLink}
                to="/about"
                variant="text"
                color="primary"
                endIcon={<ArrowForwardIcon />}
                sx={{ alignSelf: { xs: 'flex-start', sm: 'center' }, whiteSpace: 'nowrap' }}
              >
                Our story
              </Button>
            </Stack>
          </Box>

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
