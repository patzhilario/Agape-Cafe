import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
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
import { getPublicBranches, getPublicCategories, getPublicProducts } from '../features/public/publicData.js'
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
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [branches, setBranches] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [sortOrder, setSortOrder] = useState('featured')
  const [isLoading, setIsLoading] = useState(hasSupabaseConfig)
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
    <Box sx={{ minHeight: '70vh', bgcolor: 'background.default' }}>
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
        <Stack spacing={{ xs: 2.5, md: 3 }}>
          <Box>
            <Typography variant="overline" color="primary" sx={{ letterSpacing: '.12em' }}>
              A LITTLE SOMETHING FOR YOU
            </Typography>
            <Typography variant="h2">Find your favorite</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.75 }}>
              Browse the menu and make your next coffee moment yours.
            </Typography>
          </Box>
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
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 3 }}>
          <Stack spacing={1.5}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search drinks and treats..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
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
              spacing={1.5}
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
                    setIsLoading(true)
                    setBranchId(event.target.value)
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
              <Chip
                size="small"
                variant="outlined"
                label={`${sortedProducts.length} ${sortedProducts.length === 1 ? 'item' : 'items'}`}
                sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }}
              />
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
            minHeight: 48,
            borderBottom: 1,
            borderColor: 'divider',
            '& .MuiTab-root': {
              minHeight: 48,
              px: { xs: 1.5, sm: 2.5 },
              fontWeight: 700,
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
          <ProductGrid products={sortedProducts} />
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
