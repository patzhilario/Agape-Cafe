import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Avatar,
  Box,
  Chip,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import InputAdornment from '@mui/material/InputAdornment'
import SearchIcon from '@mui/icons-material/Search'
import CoffeeOutlinedIcon from '@mui/icons-material/CoffeeOutlined'
import {
  getCachedPublicBranches,
  getCachedPublicCategories,
  getCachedPublicProducts,
  getPublicBranches,
  getPublicCategories,
  getPublicProducts,
} from '../features/public/publicData.js'
import ProductGrid from '../components/public/ProductGrid.jsx'
import { useCart } from '../features/orders/useCart.js'
import {
  EmptyPublicState,
  PublicDataError,
  PublicLoading,
  SupabaseSetupNotice,
} from '../components/public/PublicDataState.jsx'

const hasSupabaseConfig =
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY)

export default function MenuPage() {
  const { branchId, setBranchId } = useCart()
  const cachedProducts = getCachedPublicProducts({ branchId: branchId || undefined })
  const cachedCategories = getCachedPublicCategories()
  const cachedBranches = getCachedPublicBranches()
  const [products, setProducts] = useState(cachedProducts || [])
  const [categories, setCategories] = useState(cachedCategories || [])
  const [branches, setBranches] = useState(cachedBranches || [])
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [sortOrder, setSortOrder] = useState('featured')
  const [isLoading, setIsLoading] = useState(hasSupabaseConfig && cachedProducts === undefined)
  const [errorMessage, setErrorMessage] = useState('')
  const [filterError, setFilterError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const branchSelectionRef = useRef({ branchId, setBranchId })
  const selectedBranch = branches.some((branch) => branch.id === branchId) ? branchId : ''

  useEffect(() => {
    branchSelectionRef.current = { branchId, setBranchId }
  }, [branchId, setBranchId])

  useEffect(() => {
    if (!hasSupabaseConfig) return undefined
    let active = true

    Promise.all([getPublicCategories(), getPublicBranches()])
      .then(([loadedCategories, loadedBranches]) => {
        if (!active) return
        setCategories(loadedCategories)
        setBranches(loadedBranches)
        const currentSelection = branchSelectionRef.current
        if (
          currentSelection.branchId &&
          !loadedBranches.some((branch) => branch.id === currentSelection.branchId)
        ) {
          currentSelection.setBranchId('')
        }
      })
      .catch((error) => {
        console.error('Unable to load public menu filters.', error)
        if (active) setFilterError(error.message)
      })

    return () => {
      active = false
    }
  }, [reloadKey])

  const loadProducts = useCallback(() => {
    if (!hasSupabaseConfig) return Promise.resolve([])
    return getPublicProducts({ branchId: selectedBranch || undefined })
  }, [selectedBranch])

  useEffect(() => {
    if (!hasSupabaseConfig) return undefined
    let active = true
    loadProducts()
      .then((loadedProducts) => {
        if (active) {
          setProducts(loadedProducts)
          setErrorMessage('')
        }
      })
      .catch((error) => {
        console.error('Unable to load the public menu.', error)
        if (active) setErrorMessage(error.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [loadProducts, reloadKey])

  const normalizedSearch = search.trim().toLocaleLowerCase()
  const visibleProducts = products.filter((product) => {
    const matchesCategory =
      selectedCategory === 'all' || product.category?.slug === selectedCategory
    const matchesSearch =
      !normalizedSearch ||
      [product.name, product.description, product.category?.name]
        .filter(Boolean)
        .some((value) => value.toLocaleLowerCase().includes(normalizedSearch))
    return matchesCategory && matchesSearch
  })
  const priceOf = (product) => product.variants.length
    ? Math.min(...product.variants.map((variant) => variant.price))
    : product.price
  const sortedProducts = [...visibleProducts].sort((first, second) => {
    if (sortOrder === 'price-ascending') return priceOf(first) - priceOf(second)
    if (sortOrder === 'price-descending') return priceOf(second) - priceOf(first)
    if (sortOrder === 'popular') {
      return Number(second.is_best_seller) - Number(first.is_best_seller)
    }
    return 0
  })

  return (
    <Box sx={{ minHeight: '70vh', bgcolor: '#f7f3ed', color: '#2c211b' }}>
      <Box
        component="header"
        sx={{
          position: 'relative',
          overflow: 'hidden',
          bgcolor: '#eee5d9',
          '&::after': {
            content: '""',
            position: 'absolute',
            width: { xs: 210, md: 360 },
            height: { xs: 210, md: 360 },
            top: { xs: -90, md: -160 },
            right: { xs: -100, md: '8%' },
            border: '1px solid rgba(91,57,39,.12)',
            borderRadius: '50%',
            boxShadow: '0 0 0 28px rgba(91,57,39,.035), 0 0 0 65px rgba(91,57,39,.025)',
            pointerEvents: 'none',
          },
        }}
      >
        <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1.2fr .8fr' },
              gap: { xs: 3, md: 7 },
              alignItems: 'center',
              py: { xs: 5, md: 8 },
            }}
          >
            <Stack spacing={{ xs: 1.5, md: 2 }}>
              <Typography variant="overline" color="primary" sx={{ letterSpacing: '.2em' }}>
                THE AGAPÉ MENU
              </Typography>
              <Typography
                component="h1"
                sx={{
                  maxWidth: 690,
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontSize: { xs: 'clamp(2.8rem, 12vw, 4rem)', md: '5.25rem' },
                  fontWeight: 400,
                  letterSpacing: '-.055em',
                  lineHeight: '.98',
                }}
              >
                A good day starts with a good cup.
              </Typography>
              <Typography sx={{ maxWidth: 520, color: '#685c53', lineHeight: 1.8 }}>
                Find a familiar favorite or something new to make your moment.
                Browse the menu and choose what sounds good today.
              </Typography>
            </Stack>
            <Stack
              direction="row"
              spacing={2}
              sx={{
                alignItems: 'center',
                justifyContent: { md: 'flex-end' },
                borderTop: { xs: '1px solid rgba(91,57,39,.16)', md: 0 },
                pt: { xs: 2, md: 0 },
              }}
            >
              <Avatar
                sx={{
                  width: { xs: 58, md: 76 },
                  height: { xs: 58, md: 76 },
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                }}
              >
                <CoffeeOutlinedIcon sx={{ fontSize: { xs: 30, md: 38 } }} />
              </Avatar>
              <Box>
                <Typography variant="overline" color="primary" sx={{ letterSpacing: '.15em' }}>
                  MADE FOR YOUR MOMENT
                </Typography>
                <Typography sx={{ color: '#685c53', maxWidth: 260, lineHeight: 1.6 }}>
                  Coffee, treats, and little comforts to enjoy your way.
                </Typography>
              </Box>
            </Stack>
          </Box>
        </Container>
      </Box>
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
        <Stack spacing={{ xs: 2.5, md: 3 }}>
        {!hasSupabaseConfig && <SupabaseSetupNotice />}
        {filterError && <PublicDataError message={filterError} />}
        {errorMessage && (
          <PublicDataError
            message={errorMessage}
            onRetry={() => {
              setIsLoading(true)
              setReloadKey((key) => key + 1)
            }}
          />
        )}
        <Paper
          variant="outlined"
          sx={{
            p: { xs: 1.5, sm: 2 },
            borderRadius: 3,
            bgcolor: 'rgba(255,255,255,.82)',
            borderColor: 'rgba(67,48,34,.14)',
            boxShadow: '0 10px 30px rgba(57,35,23,.035)',
          }}
        >
          <Stack spacing={1.75}>
            <TextField
              fullWidth
              size="medium"
              placeholder="Search drinks and treats..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#fff', borderRadius: 2.5 } }}
              slotProps={{
                htmlInput: { 'aria-label': 'Search products by name or description' },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon color="action" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.25}
              useFlexGap
              sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap' }}
            >
              <FormControl size="small" sx={{ width: { xs: '100%', sm: 250 }, flexShrink: 0 }}>
                <InputLabel id="menu-branch-label">Branch availability</InputLabel>
                <Select
                  labelId="menu-branch-label"
                  value={selectedBranch}
                  label="Branch availability"
                  onChange={(event) => {
                    const nextBranchId = event.target.value
                    const nextProducts = getCachedPublicProducts({
                      branchId: nextBranchId || undefined,
                    })
                    if (nextProducts !== undefined) {
                      setProducts(nextProducts)
                      setIsLoading(false)
                    } else {
                      setIsLoading(true)
                    }
                    setBranchId(nextBranchId)
                  }}
                >
                  <MenuItem value="">All published products</MenuItem>
                  {branches.map((branch) => (
                    <MenuItem key={branch.id} value={branch.id}>{branch.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ width: { xs: '100%', sm: 210 }, flexShrink: 0 }}>
                <InputLabel id="menu-sort-label">Sort by</InputLabel>
                <Select
                  labelId="menu-sort-label"
                  value={sortOrder}
                  label="Sort by"
                  onChange={(event) => setSortOrder(event.target.value)}
                >
                  <MenuItem value="featured">Featured</MenuItem>
                  <MenuItem value="popular">Best sellers</MenuItem>
                  <MenuItem value="price-ascending">Price: low to high</MenuItem>
                  <MenuItem value="price-descending">Price: high to low</MenuItem>
                </Select>
              </FormControl>
              <Box sx={{ flex: 1 }} />
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ ml: { sm: 'auto' }, alignSelf: { xs: 'flex-start', sm: 'center' }, px: 0.5 }}
              >
                <Box component="span" sx={{ color: 'primary.dark', fontWeight: 800 }}>
                  {sortedProducts.length}
                </Box>
                {' '}{sortedProducts.length === 1 ? 'item' : 'items'}
              </Typography>
            </Stack>
          </Stack>
        </Paper>
        <Tabs
          value={selectedCategory}
          onChange={(_, value) => setSelectedCategory(value)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          aria-label="Browse menu categories"
          sx={{
            minHeight: 44,
            borderBottom: '1px solid rgba(67,48,34,.16)',
            '& .MuiTabs-flexContainer': { gap: { xs: 1, sm: 2 } },
            '& .MuiTabs-indicator': {
              height: 2,
              borderRadius: 2,
              bgcolor: 'primary.dark',
            },
            '& .MuiTab-root': {
              minHeight: 46,
              minWidth: 'auto',
              px: { xs: 1, sm: 1.5 },
              color: 'text.secondary',
              fontWeight: 700,
              textTransform: 'none',
              transition: 'color 150ms ease',
              '&.Mui-selected': {
                color: 'primary.dark',
              },
              '&:hover': { color: 'primary.main', bgcolor: 'transparent' },
            },
          }}
        >
          <Tab value="all" label="All" />
          {categories.map((category) => (
            <Tab key={category.id} value={category.slug} label={category.name} />
          ))}
        </Tabs>
        {selectedBranch && (
          <Alert severity="info">
            Showing products marked available at the selected branch. Final
            availability is confirmed by the café.
          </Alert>
        )}
        {!hasSupabaseConfig ? null : isLoading ? (
          <PublicLoading label="Loading the menu…" />
        ) : visibleProducts.length ? (
          <Stack spacing={2}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
              <Typography
                component="h2"
                sx={{
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontSize: { xs: '1.8rem', md: '2.25rem' },
                  fontWeight: 400,
                  letterSpacing: '-.035em',
                }}
              >
                {selectedCategory === 'all'
                  ? 'Explore the menu'
                  : categories.find((category) => category.slug === selectedCategory)?.name}
              </Typography>
              {sortOrder === 'popular' && (
                <Chip size="small" variant="outlined" label="Best sellers first" />
              )}
            </Box>
            <ProductGrid products={sortedProducts} />
          </Stack>
        ) : (
          <EmptyPublicState>
            {products.length
              ? 'No published products match these filters.'
              : 'No products have been published yet.'}
          </EmptyPublicState>
        )}
      </Stack>
      </Container>
    </Box>
  )
}
