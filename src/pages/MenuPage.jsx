import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material'
import { getPublicBranches, getPublicCategories, getPublicProducts } from '../features/public/publicData.js'
import ProductGrid from '../components/public/ProductGrid.jsx'
import { useCart } from '../features/orders/useCart.js'
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

export default function MenuPage() {
  const { branchId, setBranchId } = useCart()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [branches, setBranches] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [search, setSearch] = useState('')
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

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack spacing={4}>
        <SectionHeading
          eyebrow="Agapé Café"
          title="Our menu"
          description="Browse the products currently published by the café."
        />
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
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            fullWidth
            label="Search the menu"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            slotProps={{
              htmlInput: { 'aria-label': 'Search products by name or description' },
            }}
          />
          <FormControl fullWidth>
            <InputLabel id="menu-category-label">Category</InputLabel>
            <Select
              labelId="menu-category-label"
              value={selectedCategory}
              label="Category"
              onChange={(event) => setSelectedCategory(event.target.value)}
            >
              <MenuItem value="all">All categories</MenuItem>
              {categories.map((category) => (
                <MenuItem key={category.id} value={category.slug}>
                  {category.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth>
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
                <MenuItem key={branch.id} value={branch.id}>
                  {branch.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
        {selectedBranch && (
          <Alert severity="info">
            Showing products marked available at the selected branch. Final
            availability is confirmed by the café.
          </Alert>
        )}
        {!hasSupabaseConfig ? null : isLoading ? (
          <PublicLoading label="Loading the menu…" />
        ) : visibleProducts.length ? (
          <ProductGrid products={visibleProducts} />
        ) : (
          <EmptyPublicState>
            {products.length
              ? 'No published products match these filters.'
              : 'No products have been published yet.'}
          </EmptyPublicState>
        )}
      </Stack>
    </Container>
  )
}
