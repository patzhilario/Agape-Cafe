import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import { useAuth } from '../auth/useAuth.js'
import { getAdminBranches } from './adminData.js'
import { getSupabaseClient } from '../../lib/supabaseClient.js'
import { formatPrice, publicImageUrl } from '../public/publicData.js'
import { optimizeProductImage } from '../../lib/imageOptimization.js'
import PaginationControls from '../../components/PaginationControls.jsx'
import DeleteConfirmationDialog from '../../components/DeleteConfirmationDialog.jsx'

const DEFAULT_CATALOG_PAGE_SIZE = 10

function categorySlug(name) {
  return name.trim().toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function AdminMenuPage() {
  const { account } = useAuth()
  const isSuperAdmin = account.roles.includes('super_admin')
  const [branches, setBranches] = useState([])
  const [branchId, setBranchId] = useState('')
  const [menuView, setMenuView] = useState('branch')
  const [categories, setCategories] = useState([])
  const [products, setProducts] = useState([])
  const [variants, setVariants] = useState([])
  const [addons, setAddons] = useState([])
  const [availability, setAvailability] = useState([])
  const [availabilityBranchId, setAvailabilityBranchId] = useState('')
  const [branchOptionSettings, setBranchOptionSettings] = useState({})
  const [branchOptionEdits, setBranchOptionEdits] = useState({})
  const [branchOptionsProduct, setBranchOptionsProduct] = useState(null)
  const [categoryName, setCategoryName] = useState('')
  const [editingCategory, setEditingCategory] = useState(null)
  const [newProduct, setNewProduct] = useState({
    name: '', sku: '', description: '', price: '', categoryId: '',
  })
  const [productEdits, setProductEdits] = useState({})
  const [productImageFiles, setProductImageFiles] = useState({})
  const [branchEdits, setBranchEdits] = useState({})
  const [optionDrafts, setOptionDrafts] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [catalogReloadKey, setCatalogReloadKey] = useState(0)
  const [availabilityReloadKey, setAvailabilityReloadKey] = useState(0)
  const [productDialogOpen, setProductDialogOpen] = useState(false)
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [editingProductId, setEditingProductId] = useState('')
  const [optionDialogType, setOptionDialogType] = useState('')
  const [branchPage, setBranchPage] = useState(0)
  const [branchPageSize, setBranchPageSize] = useState(DEFAULT_CATALOG_PAGE_SIZE)
  const [productPage, setProductPage] = useState(0)
  const [productPageSize, setProductPageSize] = useState(DEFAULT_CATALOG_PAGE_SIZE)
  const [categoryPage, setCategoryPage] = useState(0)
  const [categoryPageSize, setCategoryPageSize] = useState(DEFAULT_CATALOG_PAGE_SIZE)
  const editingProduct = products.find((product) => product.id === editingProductId)
  const paginatedBranchProducts = useMemo(
    () => products.slice(branchPage * branchPageSize, (branchPage + 1) * branchPageSize),
    [branchPage, branchPageSize, products],
  )
  const paginatedProducts = useMemo(
    () => products.slice(productPage * productPageSize, (productPage + 1) * productPageSize),
    [productPage, productPageSize, products],
  )
  const paginatedCategories = useMemo(
    () => categories.slice(categoryPage * categoryPageSize, (categoryPage + 1) * categoryPageSize),
    [categories, categoryPage, categoryPageSize],
  )

  const canEditBranchMenu = isSuperAdmin || (
    account.branchAssignments.some((assignment) => assignment.branch_id === branchId) &&
    account.permissions.some((permission) =>
      permission.branchId === branchId &&
      permission.module === 'menu' &&
      (permission.action === 'edit' || permission.action === 'manage'),
    )
  )
  const publishedCategories = useMemo(
    () => categories.filter((category) => category.is_published),
    [categories],
  )

  useEffect(() => {
    let active = true
    Promise.all([
      getAdminBranches(account),
      getSupabaseClient().from('categories')
        .select('id, name, slug, is_published')
        .order('sort_order')
        .then(({ data, error }) => {
          if (error) throw new Error(error.message)
          return data
        }),
      getSupabaseClient().from('products')
        .select('id, category_id, name, sku, description, image_path, price, is_published, is_available, is_featured, is_best_seller, archived_at')
        .is('archived_at', null)
        .order('name')
        .then(({ data, error }) => {
          if (error) throw new Error(error.message)
          return data
        }),
      getSupabaseClient().from('product_variants')
        .select('id, product_id, name, price, is_active')
        .order('sort_order')
        .then(({ data, error }) => {
          if (error) throw new Error(error.message)
          return data
        }),
      getSupabaseClient().from('product_addons')
        .select('id, product_id, name, price, is_active')
        .order('sort_order')
        .then(({ data, error }) => {
          if (error) throw new Error(error.message)
          return data
        }),
    ])
      .then(([loadedBranches, loadedCategories, loadedProducts, loadedVariants, loadedAddons]) => {
        if (!active) return
        setBranches(loadedBranches)
        setCategories(loadedCategories)
        setProducts(loadedProducts)
        setVariants(loadedVariants)
        setAddons(loadedAddons)
        setProductEdits(Object.fromEntries(loadedProducts.map((product) => [product.id, {
          categoryId: product.category_id || '',
          name: product.name,
          sku: product.sku,
          description: product.description,
          price: String(product.price),
          is_published: product.is_published,
          is_available: product.is_available,
          is_featured: product.is_featured,
          is_best_seller: product.is_best_seller,
        }])))
        const assignedBranch = account.branchAssignments[0]?.branch_id
        const firstActiveBranch = loadedBranches.find((branch) => branch.is_active)?.id
        setBranchId((current) => current || (isSuperAdmin ? firstActiveBranch || '' : assignedBranch || ''))
      })
      .catch((error) => {
        console.error('Unable to load menu administration data.', error)
        if (active) setErrorMessage(error.message)
      })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [account, isSuperAdmin, catalogReloadKey])

  useEffect(() => {
    if (!branchId) {
      return undefined
    }
    let active = true
    Promise.all([
      getSupabaseClient()
        .from('branch_product_availability')
        .select('product_id, is_available, price_override')
        .eq('branch_id', branchId),
      getSupabaseClient()
        .from('branch_product_variant_settings')
        .select('variant_id, is_available, price_override')
        .eq('branch_id', branchId),
      getSupabaseClient()
        .from('branch_product_addon_settings')
        .select('addon_id, is_available, price_override')
        .eq('branch_id', branchId),
    ])
      .then(([availabilityResult, variantSettingsResult, addonSettingsResult]) => {
        if (availabilityResult.error) throw new Error(availabilityResult.error.message)
        if (variantSettingsResult.error) throw new Error(variantSettingsResult.error.message)
        if (addonSettingsResult.error) throw new Error(addonSettingsResult.error.message)
        if (active) {
          const data = availabilityResult.data
          const optionSettings = {
            ...Object.fromEntries(variantSettingsResult.data.map((setting) => [
              `variant:${setting.variant_id}`,
              { isAvailable: setting.is_available, priceOverride: setting.price_override },
            ])),
            ...Object.fromEntries(addonSettingsResult.data.map((setting) => [
              `addon:${setting.addon_id}`,
              { isAvailable: setting.is_available, priceOverride: setting.price_override },
            ])),
          }
          setAvailability(data)
          setAvailabilityBranchId(branchId)
          setBranchEdits(Object.fromEntries(data.map((entry) => [entry.product_id, {
            isAvailable: entry.is_available,
            priceOverride: entry.price_override == null ? '' : String(entry.price_override),
          }])))
          setBranchOptionSettings(optionSettings)
          setBranchOptionEdits(optionSettings)
        }
      })
      .catch((error) => {
        console.error('Unable to load branch menu availability.', error)
        if (active) setErrorMessage(error.message)
      })
    return () => { active = false }
  }, [branchId, availabilityReloadKey])

  async function createCategory(event) {
    event.preventDefault()
    const name = categoryName.trim()
    const slug = categorySlug(name)
    if (!slug) {
      setErrorMessage('Enter a category name containing letters or numbers.')
      return
    }
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const query = editingCategory
        ? getSupabaseClient().from('categories')
          .update({ name, slug })
          .eq('id', editingCategory.id)
        : getSupabaseClient().from('categories').insert({ name, slug })
      const { error } = await query
      if (error) throw new Error(error.message)
      setCategoryName('')
      const updated = Boolean(editingCategory)
      setEditingCategory(null)
      setCategoryDialogOpen(false)
      setMenuView('catalog')
      if (!updated) setCategoryPage(0)
      setSuccessMessage(updated ? 'Category updated.' : 'Category created as unpublished.')
      setCatalogReloadKey((value) => value + 1)
    } catch (error) {
      console.error(editingCategory ? 'Unable to update menu category.' : 'Unable to create menu category.', error)
      setErrorMessage(error.message)
    } finally { setIsSaving(false) }
  }

  function openCategoryEditor(category = null) {
    setErrorMessage('')
    setCategoryName(category?.name || '')
    setEditingCategory(category)
    setCategoryDialogOpen(true)
  }

  async function publishCategory(category, isPublished) {
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const { error } = await getSupabaseClient()
        .from('categories')
        .update({ is_published: isPublished })
        .eq('id', category.id)
      if (error) throw new Error(error.message)
      setSuccessMessage(`${category.name} ${isPublished ? 'published' : 'unpublished'}.`)
      setCatalogReloadKey((value) => value + 1)
    } catch (error) {
      console.error('Unable to update category publication.', error)
      setErrorMessage(error.message)
    } finally { setIsSaving(false) }
  }

  function requestMenuDelete(type, record) {
    setErrorMessage('')
    setDeleteTarget({ type, record })
  }

  async function deleteMenuRecord() {
    if (!deleteTarget) return
    const tableByType = {
      category: 'categories',
      product: 'products',
      variant: 'product_variants',
      addon: 'product_addons',
    }
    const table = tableByType[deleteTarget.type]
    if (!table) return
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const { data, error } = await getSupabaseClient()
        .from(table)
        .delete()
        .eq('id', deleteTarget.record.id)
        .select('id')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new Error('This menu record no longer exists. Refresh the page and try again.')

      const { type, record } = deleteTarget
      setDeleteTarget(null)
      setCatalogReloadKey((value) => value + 1)
      setAvailabilityReloadKey((value) => value + 1)
      setSuccessMessage(`${record.name} was permanently deleted.`)
      if (type === 'product' && record.image_path) {
        const { error: imageError } = await getSupabaseClient()
          .storage
          .from('menu-images')
          .remove([record.image_path])
        if (imageError) {
          console.error('Product was deleted, but its image could not be removed.', imageError)
          setErrorMessage(`Product was deleted, but its image could not be removed from storage: ${imageError.message}`)
        }
      }
    } catch (error) {
      console.error('Unable to delete menu data.', error)
      setErrorMessage(error.message)
    } finally { setIsSaving(false) }
  }

  async function createOption(product, optionType) {
    const draft = optionDrafts[product.id] || {}
    const isVariant = optionType === 'variant'
    const table = isVariant ? 'product_variants' : 'product_addons'
    const optionLabel = isVariant ? 'size' : 'add-on'
    const name = ((isVariant ? draft.variantName : draft.addonName) || '').trim()
    const rawPrice = isVariant ? draft.variantPrice : draft.addonPrice
    const price = Number(rawPrice)
    if (!name || rawPrice === '' || !Number.isFinite(price) || price < 0) {
      setErrorMessage(`Enter a name and price of 0 or more for this ${optionLabel}.`)
      return
    }
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const { data, error } = await getSupabaseClient().from(table).insert({
        product_id: product.id,
        name,
        price,
      }).select('id, product_id, name, price, is_active').single()
      if (error) throw new Error(error.message)
      if (isVariant) {
        setVariants((current) => [...current, data])
        setOptionDrafts((current) => ({
          ...current,
          [product.id]: { ...current[product.id], variantName: '', variantPrice: '' },
        }))
      } else {
        setAddons((current) => [...current, data])
        setOptionDrafts((current) => ({
          ...current,
          [product.id]: { ...current[product.id], addonName: '', addonPrice: '' },
        }))
      }
      setSuccessMessage(`${isVariant ? 'Size' : 'Add-on'} “${data.name}” saved to the database for ${product.name}.`)
      setOptionDialogType('')
    } catch (error) {
      console.error('Unable to add product option.', error)
      setErrorMessage(error.message)
    } finally { setIsSaving(false) }
  }

  async function setOptionActive(option, optionType, isActive) {
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const table = optionType === 'variant' ? 'product_variants' : 'product_addons'
      const { error } = await getSupabaseClient().from(table)
        .update({ is_active: isActive })
        .eq('id', option.id)
      if (error) throw new Error(error.message)
      setSuccessMessage(`${option.name} ${isActive ? 'enabled' : 'disabled'}.`)
      setCatalogReloadKey((value) => value + 1)
    } catch (error) {
      console.error('Unable to update product option.', error)
      setErrorMessage(error.message)
    } finally { setIsSaving(false) }
  }

  async function createProduct(event) {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const { data, error } = await getSupabaseClient().from('products').insert({
        name: newProduct.name.trim(),
        sku: newProduct.sku.trim(),
        description: newProduct.description.trim(),
        price: Number(newProduct.price),
        category_id: newProduct.categoryId || null,
      }).select('id').single()
      if (error) throw new Error(error.message)
      if (branchId) {
        const availabilityResult = await getSupabaseClient().from('branch_product_availability').upsert({
          branch_id: branchId,
          product_id: data.id,
          is_available: true,
          price_override: null,
        }, { onConflict: 'branch_id,product_id' })
        if (availabilityResult.error) throw new Error(availabilityResult.error.message)
      }
      setNewProduct({ name: '', sku: '', description: '', price: '', categoryId: '' })
      setProductDialogOpen(false)
      setProductPage(0)
      setMenuView('products')
      setSuccessMessage('Product created as unpublished; publish it when its menu details are ready.')
      setCatalogReloadKey((value) => value + 1)
      setAvailabilityReloadKey((value) => value + 1)
    } catch (error) {
      console.error('Unable to create menu product.', error)
      setErrorMessage(error.message)
    } finally { setIsSaving(false) }
  }

  async function saveProduct(product) {
    const edit = productEdits[product.id]
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    let uploadedPath = ''
    let productSaved = false
    try {
      const imageFile = productImageFiles[product.id]
      let imagePath = product.image_path
      if (imageFile) {
        const optimizedImage = await optimizeProductImage(imageFile)
        uploadedPath = `products/${product.id}/${crypto.randomUUID()}.webp`
        const { error: uploadError } = await getSupabaseClient()
          .storage
          .from('menu-images')
          .upload(uploadedPath, optimizedImage, {
            contentType: 'image/webp',
            cacheControl: '31536000',
            upsert: false,
          })
        if (uploadError) throw new Error(`Could not upload the optimized product image: ${uploadError.message}`)
        imagePath = uploadedPath
      }
      const { error } = await getSupabaseClient().from('products').update({
        name: edit.name.trim(),
        sku: edit.sku.trim(),
        description: edit.description.trim(),
        image_path: imagePath,
        category_id: edit.categoryId || null,
        price: Number(edit.price),
        is_published: edit.is_published,
        is_available: edit.is_available,
        is_featured: edit.is_featured,
        is_best_seller: edit.is_best_seller,
      }).eq('id', product.id)
      if (error) throw new Error(error.message)
      productSaved = true
      let cleanupWarning = ''
      if (uploadedPath && product.image_path) {
        const { error: deleteError } = await getSupabaseClient()
          .storage
          .from('menu-images')
          .remove([product.image_path])
        if (deleteError) {
          console.error('Unable to remove the replaced product image.', deleteError)
          cleanupWarning = `${product.name} was saved, but the previous image could not be removed from storage.`
        }
      }
      if (cleanupWarning) setErrorMessage(cleanupWarning)
      else setSuccessMessage(`${product.name} saved.`)
      setProductImageFiles((current) => {
        const next = { ...current }
        delete next[product.id]
        return next
      })
      setCatalogReloadKey((value) => value + 1)
    } catch (error) {
      console.error('Unable to update menu product.', error)
      if (uploadedPath && !productSaved) {
        const { error: cleanupError } = await getSupabaseClient()
          .storage
          .from('menu-images')
          .remove([uploadedPath])
        if (cleanupError) console.error('Unable to remove the unlinked product image.', cleanupError)
      }
      setErrorMessage(error.message)
    } finally { setIsSaving(false) }
  }

  async function saveBranchAvailability(product, draftOverride) {
    const edit = draftOverride || branchEdits[product.id] || { isAvailable: false, priceOverride: '' }
    if (edit.priceOverride !== '' && (!Number.isFinite(Number(edit.priceOverride)) || Number(edit.priceOverride) < 0)) {
      setErrorMessage('Enter a valid branch price of zero or more, or leave it blank to use the base price.')
      return
    }
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const { error } = await getSupabaseClient().from('branch_product_availability').upsert({
        branch_id: branchId,
        product_id: product.id,
        is_available: edit.isAvailable,
        price_override: edit.priceOverride === '' ? null : Number(edit.priceOverride),
      }, { onConflict: 'branch_id,product_id' })
      if (error) throw new Error(error.message)
      setBranchEdits((current) => ({ ...current, [product.id]: edit }))
      setSuccessMessage(`Branch availability saved for ${product.name}.`)
      setAvailabilityReloadKey((value) => value + 1)
    } catch (error) {
      console.error('Unable to save branch menu availability.', error)
      setErrorMessage(error.message)
    } finally { setIsSaving(false) }
  }

  function updateBranchOption(option, optionType, changes) {
    const key = `${optionType}:${option.id}`
    setBranchOptionEdits((current) => ({
      ...current,
      [key]: {
        isAvailable: current[key]?.isAvailable ?? branchOptionSettings[key]?.isAvailable ?? true,
        priceOverride: current[key]?.priceOverride ?? (
          branchOptionSettings[key]?.priceOverride == null
            ? ''
            : String(branchOptionSettings[key].priceOverride)
        ),
        ...changes,
      },
    }))
  }

  async function saveBranchOption(option, optionType) {
    if (!branchId || availabilityBranchId !== branchId) {
      setErrorMessage('Wait for this branch’s menu settings to finish loading before saving.')
      return
    }
    const key = `${optionType}:${option.id}`
    const edit = branchOptionEdits[key] || branchOptionSettings[key] || {
      isAvailable: true,
      priceOverride: '',
    }
    const priceOverride = edit.priceOverride ?? ''
    if (priceOverride !== '' &&
        (!Number.isFinite(Number(priceOverride)) || Number(priceOverride) < 0)) {
      setErrorMessage('Enter a valid option price of zero or more, or leave it blank to use its default price.')
      return
    }
    const isVariant = optionType === 'variant'
    const table = isVariant
      ? 'branch_product_variant_settings'
      : 'branch_product_addon_settings'
    const idColumn = isVariant ? 'variant_id' : 'addon_id'
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const { error } = await getSupabaseClient().from(table).upsert({
        branch_id: branchId,
        [idColumn]: option.id,
        is_available: edit.isAvailable,
        price_override: priceOverride === '' ? null : Number(priceOverride),
      }, { onConflict: `branch_id,${idColumn}` })
      if (error) throw new Error(error.message)
      const saved = {
        isAvailable: edit.isAvailable,
        priceOverride: priceOverride === '' ? null : Number(priceOverride),
      }
      setBranchOptionSettings((current) => ({ ...current, [key]: saved }))
      setBranchOptionEdits((current) => ({ ...current, [key]: saved }))
      setSuccessMessage(`${option.name} settings saved for this branch.`)
    } catch (error) {
      console.error('Unable to save branch-specific menu option settings.', error)
      setErrorMessage(error.message)
    } finally { setIsSaving(false) }
  }

  if (isLoading) {
    return <Stack sx={{ alignItems: 'center', py: 10 }}><CircularProgress /></Stack>
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack spacing={3}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 1.5, md: 2 }} sx={{ justifyContent: 'space-between', alignItems: { md: 'center' } }}>
          <Box>
            <Typography variant="overline" color="primary">Agapé Café · Catalog</Typography>
            <Typography variant="h2">Menu</Typography>
            <Typography color="text.secondary">Manage this branch’s prices, availability, sizes, and add-ons without changing other branches’ catalog.</Typography>
          </Box>
          {isSuperAdmin && (menuView === 'catalog' || menuView === 'products') && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap sx={{ width: { xs: '100%', md: 'auto' }, flexWrap: 'wrap' }}>
              {menuView === 'catalog' && (
                <Button
                  variant="outlined"
                  onClick={() => openCategoryEditor()}
                  sx={{ width: { xs: '100%', sm: 'auto' }, minHeight: 42 }}
                >
                  Add category
                </Button>
              )}
              {menuView === 'products' && (
                <Button
                  variant="contained"
                  onClick={() => setProductDialogOpen(true)}
                  sx={{ width: { xs: '100%', sm: 'auto' }, minHeight: 42 }}
                >
                  Add product
                </Button>
              )}
            </Stack>
          )}
        </Stack>
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        {successMessage && <Alert severity="success">{successMessage}</Alert>}
        {menuView === 'branch' && <FormControl fullWidth required>
          <InputLabel id="menu-branch-label">Branch</InputLabel>
          <Select labelId="menu-branch-label" label="Branch" value={branchId} onChange={(event) => {
            setBranchOptionsProduct(null)
            setAvailabilityBranchId('')
            setBranchId(event.target.value)
          }}>
            {branches.filter((branch) => branch.is_active).map((branch) => <MenuItem key={branch.id} value={branch.id}>{branch.name}</MenuItem>)}
          </Select>
        </FormControl>}
        <Tabs
          value={menuView}
          onChange={(_, value) => {
            setMenuView(value)
            setBranchPage(0)
            setProductPage(0)
            setCategoryPage(0)
          }}
          aria-label="Menu management sections"
        >
          <Tab value="branch" label="Branch menu editor" />
          {isSuperAdmin && <Tab value="catalog" label="Catalog" />}
          {isSuperAdmin && <Tab value="products" label="Product list" />}
        </Tabs>
        {menuView === 'branch' && (
          <Alert severity="info">
            Edit branch prices and turn individual sizes or add-ons on or off. These settings apply only to the selected branch; shared product details stay unchanged.
          </Alert>
        )}
        {menuView === 'branch' && !branches.some((branch) => branch.is_active) && (
          <Alert severity="warning">Create or activate a branch before managing branch availability.</Alert>
        )}
        {menuView === 'branch' && !isSuperAdmin && !canEditBranchMenu && (
          <Alert severity="warning">You need Menu edit permission for a branch to update availability.</Alert>
        )}
        {isSuperAdmin && menuView === 'catalog' && (
          <>
            <Box>
              <Typography variant="h6" sx={{ mb: 1 }}>Categories</Typography>
              {categories.length ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small" aria-label="Menu categories" sx={{ minWidth: 540 }}>
                    <TableHead><TableRow><TableCell>Category</TableCell><TableCell>Slug</TableCell><TableCell>Status</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
                    <TableBody>
                      {paginatedCategories.map((category) => (
                        <TableRow key={category.id} hover>
                          <TableCell sx={{ fontWeight: 700 }}>{category.name}</TableCell>
                          <TableCell>{category.slug}</TableCell>
                          <TableCell>
                            <FormControlLabel
                              control={<Switch size="small" checked={category.is_published} disabled={isSaving} onChange={(event) => publishCategory(category, event.target.checked)} />}
                              label={category.is_published ? 'Published' : 'Unpublished'}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                              <Button
                                size="small"
                                onClick={() => openCategoryEditor(category)}
                                disabled={isSaving}
                              >
                                Edit
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                onClick={() => requestMenuDelete('category', category)}
                                disabled={isSaving}
                              >
                                Delete
                              </Button>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : <Alert severity="info">No categories yet. Add one to organize the menu.</Alert>}
              {categories.length > 0 && (
                <PaginationControls
                  page={categoryPage}
                  pageSize={categoryPageSize}
                  hasNextPage={(categoryPage + 1) * categoryPageSize < categories.length}
                  isLoading={isLoading}
                  onChange={(nextPage, nextPageSize) => {
                    setCategoryPage(nextPage)
                    setCategoryPageSize(nextPageSize)
                  }}
                />
              )}
            </Box>
            <Dialog
              open={categoryDialogOpen}
              onClose={() => {
                if (isSaving) return
                setCategoryDialogOpen(false)
                setEditingCategory(null)
              }}
              fullWidth
              maxWidth="xs"
            >
              <Box component="form" onSubmit={createCategory}>
                <DialogTitle>{editingCategory ? 'Edit category' : 'Add category'}</DialogTitle>
                <DialogContent>
                  {errorMessage && <Alert severity="error" sx={{ mt: 1 }}>{errorMessage}</Alert>}
                  <TextField autoFocus fullWidth sx={{ mt: 1 }} label="Category name" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} required slotProps={{ htmlInput: { maxLength: 100 } }} />
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                  <Button onClick={() => {
                    setCategoryDialogOpen(false)
                    setEditingCategory(null)
                  }} disabled={isSaving}>Cancel</Button>
                  <Button type="submit" variant="contained" disabled={isSaving}>
                    {isSaving ? 'Saving…' : editingCategory ? 'Save changes' : 'Create category'}
                  </Button>
                </DialogActions>
              </Box>
            </Dialog>
          </>
        )}
        {menuView === 'branch' && (
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <TableContainer>
              <Table aria-label="Branch menu availability and pricing" sx={{ minWidth: 760 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Product</TableCell>
                    <TableCell>Catalog price</TableCell>
                    <TableCell>Branch price</TableCell>
                    <TableCell>Available</TableCell>
                    <TableCell align="right">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedBranchProducts.map((product) => {
                    const branchEntry = availabilityBranchId === branchId
                      ? availability.find((entry) => entry.product_id === product.id)
                      : null
                    const branchEdit = (availabilityBranchId === branchId && branchEdits[product.id]) || {
                      isAvailable: branchEntry?.is_available || false,
                      priceOverride: branchEntry?.price_override == null ? '' : String(branchEntry.price_override),
                    }
                    return (
                      <TableRow key={product.id} hover>
                        <TableCell>
                          <Typography fontWeight={700}>{product.name}</Typography>
                          <Typography variant="body2" color="text.secondary">{product.sku}</Typography>
                        </TableCell>
                        <TableCell>{formatPrice(product.price)}</TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            aria-label={`Branch price for ${product.name}`}
                            type="number"
                            value={branchEdit.priceOverride}
                            placeholder="Use catalog price"
                            disabled={!branchId || availabilityBranchId !== branchId || !canEditBranchMenu || isSaving}
                            onChange={(event) => setBranchEdits((state) => ({
                              ...state,
                              [product.id]: { ...branchEdit, priceOverride: event.target.value },
                            }))}
                            slotProps={{ htmlInput: { min: '0', step: '0.01' } }}
                            helperText={variants.some((variant) => variant.product_id === product.id)
                              ? branchEdit.priceOverride === ''
                                ? 'Sizes follow catalog prices'
                                : 'Adjusts all size prices by the same amount'
                              : branchEdit.priceOverride === ''
                                ? 'Uses catalog price'
                                : ''}
                          />
                          {variants.some((variant) => variant.product_id === product.id) && (
                            <Typography variant="caption" color="text.secondary">
                              {variants
                                .filter((variant) => variant.product_id === product.id && variant.is_active)
                                .map((variant) => {
                                  const adjustment = branchEdit.priceOverride === ''
                                    ? 0
                                    : Number(branchEdit.priceOverride) - Number(product.price)
                                  const sizeSetting = branchOptionSettings[`variant:${variant.id}`]
                                  const effectivePrice = sizeSetting?.priceOverride ??
                                    Math.max(0, Number(variant.price) + adjustment)
                                  return `${variant.name}: ${formatPrice(effectivePrice)}${sizeSetting?.isAvailable === false ? ' (off)' : ''}`
                                })
                                .join(' · ')}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <FormControlLabel
                            sx={{ m: 0 }}
                            control={
                              <Switch
                                checked={Boolean(branchEdit.isAvailable)}
                                disabled={!branchId || availabilityBranchId !== branchId || !canEditBranchMenu || isSaving}
                                onChange={(event) => setBranchEdits((state) => ({
                                  ...state,
                                  [product.id]: { ...branchEdit, isAvailable: event.target.checked },
                                }))}
                              />
                            }
                            label={branchEdit.isAvailable ? 'On' : 'Off'}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'flex-end' }}>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => setBranchOptionsProduct(product)}
                              disabled={
                                !branchId ||
                                availabilityBranchId !== branchId ||
                                !canEditBranchMenu ||
                                isSaving ||
                                (!variants.some((variant) => variant.product_id === product.id) &&
                                  !addons.some((addon) => addon.product_id === product.id))
                              }
                            >
                              Edit sizes / add-ons
                            </Button>
                            <Button
                              variant="contained"
                              size="small"
                              onClick={() => saveBranchAvailability(product)}
                              disabled={!branchId || availabilityBranchId !== branchId || !canEditBranchMenu || isSaving}
                            >
                              Save
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {!products.length && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Alert severity="info">Add a product in the catalog before managing branch availability.</Alert>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            {products.length > 0 && (
              <PaginationControls
                page={branchPage}
                pageSize={branchPageSize}
                hasNextPage={(branchPage + 1) * branchPageSize < products.length}
                isLoading={isLoading}
                onChange={(nextPage, nextPageSize) => {
                  setBranchPage(nextPage)
                  setBranchPageSize(nextPageSize)
                }}
              />
            )}
          </Paper>
        )}
        {menuView === 'branch' && (
          <Dialog
            open={Boolean(branchOptionsProduct)}
            onClose={() => !isSaving && setBranchOptionsProduct(null)}
            fullWidth
            maxWidth="md"
          >
            <DialogTitle>
              Branch sizes and add-ons{branchOptionsProduct ? ` · ${branchOptionsProduct.name}` : ''}
            </DialogTitle>
            <DialogContent>
              <Stack spacing={3} sx={{ pt: 1 }}>
                <Alert severity="info">
                  These changes affect only {branches.find((branch) => branch.id === branchId)?.name || 'this branch'}.
                  Leave a price blank to use the default; switch an option off to hide it from this branch’s menu.
                </Alert>
                {[
                  {
                    type: 'variant',
                    title: 'Sizes',
                    options: variants.filter((option) =>
                      option.product_id === branchOptionsProduct?.id && option.is_active,
                    ),
                    priceLabel: 'Branch size price',
                  },
                  {
                    type: 'addon',
                    title: 'Add-ons',
                    options: addons.filter((option) =>
                      option.product_id === branchOptionsProduct?.id && option.is_active,
                    ),
                    priceLabel: 'Branch add-on price',
                  },
                ].filter((group) => group.options.length > 0).map((group) => (
                  <Stack key={group.type} spacing={1}>
                    <Typography variant="h6">{group.title}</Typography>
                    {group.options.map((option) => {
                      const key = `${group.type}:${option.id}`
                      const setting = branchOptionEdits[key] || branchOptionSettings[key] || {
                        isAvailable: true,
                        priceOverride: '',
                      }
                      const product = branchOptionsProduct
                      const productBranchPrice = branchEdits[product?.id]?.priceOverride
                      const branchBasePrice = productBranchPrice === undefined || productBranchPrice === ''
                        ? Number(product?.price ?? 0)
                        : Number(productBranchPrice)
                      const variantDefaultPrice = Math.max(
                        0,
                        Number(option.price) + branchBasePrice - Number(product?.price ?? 0),
                      )
                      const defaultPrice = group.type === 'variant'
                        ? variantDefaultPrice
                        : Number(option.price)
                      return (
                        <Paper key={option.id} variant="outlined" sx={{ p: 1.5 }}>
                          <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={1.5}
                            sx={{ alignItems: { sm: 'center' } }}
                          >
                            <Box sx={{ flex: 1 }}>
                              <Typography fontWeight={700}>{option.name}</Typography>
                              <Typography variant="body2" color="text.secondary">
                                Default for this branch: {formatPrice(defaultPrice)}
                              </Typography>
                            </Box>
                            <TextField
                              size="small"
                              type="number"
                              label={group.priceLabel}
                              value={setting.priceOverride ?? ''}
                              placeholder={formatPrice(defaultPrice)}
                              disabled={!canEditBranchMenu || availabilityBranchId !== branchId || isSaving}
                              onChange={(event) => updateBranchOption(option, group.type, {
                                priceOverride: event.target.value,
                              })}
                              slotProps={{ htmlInput: { min: '0', step: '0.01' } }}
                              sx={{ width: { xs: '100%', sm: 180 } }}
                            />
                            <FormControlLabel
                              sx={{ m: 0 }}
                              control={
                                <Switch
                                  checked={Boolean(setting.isAvailable)}
                                  disabled={!canEditBranchMenu || availabilityBranchId !== branchId || isSaving}
                                  onChange={(event) => updateBranchOption(option, group.type, {
                                    isAvailable: event.target.checked,
                                  })}
                                />
                              }
                              label={setting.isAvailable ? 'Available' : 'Unavailable'}
                            />
                            <Button
                              size="small"
                              variant="contained"
                              onClick={() => void saveBranchOption(option, group.type)}
                              disabled={!canEditBranchMenu || availabilityBranchId !== branchId || isSaving}
                            >
                              Save
                            </Button>
                          </Stack>
                        </Paper>
                      )
                    })}
                  </Stack>
                ))}
                {!variants.some((option) => option.product_id === branchOptionsProduct?.id && option.is_active) &&
                  !addons.some((option) => option.product_id === branchOptionsProduct?.id && option.is_active) && (
                    <Typography color="text.secondary">No active sizes or add-ons are configured for this product.</Typography>
                )}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button onClick={() => setBranchOptionsProduct(null)} disabled={isSaving}>Done</Button>
            </DialogActions>
          </Dialog>
        )}
        {menuView === 'products' && isSuperAdmin && <>
          <Dialog open={productDialogOpen} onClose={() => !isSaving && setProductDialogOpen(false)} fullWidth maxWidth="sm">
            <Box component="form" onSubmit={createProduct}>
              <DialogTitle>Add menu product</DialogTitle>
              <DialogContent>
                <Stack spacing={2} sx={{ pt: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    Products are created unpublished. Review the details before making them visible on the public menu.
                  </Typography>
                  <TextField autoFocus label="Product name" value={newProduct.name} onChange={(event) => setNewProduct((value) => ({ ...value, name: event.target.value }))} required />
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField fullWidth label="SKU" value={newProduct.sku} onChange={(event) => setNewProduct((value) => ({ ...value, sku: event.target.value }))} required />
                    <TextField fullWidth label="Price (PHP)" type="number" value={newProduct.price} onChange={(event) => setNewProduct((value) => ({ ...value, price: event.target.value }))} required slotProps={{ htmlInput: { min: '0', step: '0.01' } }} />
                  </Stack>
                  <FormControl fullWidth>
                    <InputLabel id="new-product-category">Category</InputLabel>
                    <Select labelId="new-product-category" label="Category" value={newProduct.categoryId} onChange={(event) => setNewProduct((value) => ({ ...value, categoryId: event.target.value }))}>
                      <MenuItem value="">No category</MenuItem>
                      {categories.map((category) => <MenuItem key={category.id} value={category.id}>{category.name}{category.is_published ? '' : ' · unpublished'}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <TextField label="Description" value={newProduct.description} onChange={(event) => setNewProduct((value) => ({ ...value, description: event.target.value }))} multiline minRows={2} />
                </Stack>
              </DialogContent>
              <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button onClick={() => setProductDialogOpen(false)} disabled={isSaving}>Cancel</Button>
                <Button type="submit" variant="contained" disabled={isSaving}>Create unpublished product</Button>
              </DialogActions>
            </Box>
          </Dialog>
          <Box>
          {products.length ? (
          <>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small" aria-label="Product list" sx={{ minWidth: 700 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Product</TableCell>
                  <TableCell>SKU</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell align="right">Price</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedProducts.map((product) => (
                  <TableRow key={product.id} hover>
                    <TableCell>
                      <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                        <Typography fontWeight={700}>{product.name}</Typography>
                        {product.is_best_seller && (
                          <Chip size="small" color="secondary" label="Best seller" />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>{product.sku}</TableCell>
                    <TableCell>{categories.find((category) => category.id === product.category_id)?.name || '—'}</TableCell>
                    <TableCell align="right">{formatPrice(product.price)}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                        <Chip
                          size="small"
                          color={product.is_published ? 'success' : 'default'}
                          label={product.is_published ? 'Published' : 'Unpublished'}
                        />
                        <Chip
                          size="small"
                          variant="outlined"
                          color={product.is_available ? 'success' : 'default'}
                          label={product.is_available ? 'Available' : 'Unavailable'}
                        />
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" variant="outlined" onClick={() => setEditingProductId(product.id)}>Edit</Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => requestMenuDelete('product', product)}
                        disabled={isSaving}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {products.length > 0 && (
            <PaginationControls
              page={productPage}
              pageSize={productPageSize}
              hasNextPage={(productPage + 1) * productPageSize < products.length}
              isLoading={isLoading}
              onChange={(nextPage, nextPageSize) => {
                setProductPage(nextPage)
                setProductPageSize(nextPageSize)
              }}
            />
          )}
          {products.map((product) => {
            const edit = productEdits[product.id] || {}
            return (
              <Dialog
                key={product.id}
                open={editingProductId === product.id}
                onClose={() => !isSaving && setEditingProductId('')}
                fullWidth
                maxWidth="md"
              >
                <DialogTitle>Edit menu product · {product.name}</DialogTitle>
                <DialogContent dividers>
                <Stack spacing={2}>
                  {isSuperAdmin && menuView === 'products' && (
                    <>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField label="Name" value={edit.name || ''} onChange={(event) => setProductEdits((state) => ({ ...state, [product.id]: { ...state[product.id], name: event.target.value } }))} />
                        <TextField label="SKU" value={edit.sku || ''} onChange={(event) => setProductEdits((state) => ({ ...state, [product.id]: { ...state[product.id], sku: event.target.value } }))} />
                        <TextField label="Base price (PHP)" type="number" value={edit.price || ''} onChange={(event) => setProductEdits((state) => ({ ...state, [product.id]: { ...state[product.id], price: event.target.value } }))} slotProps={{ htmlInput: { min: '0', step: '0.01' } }} />
                        <FormControl fullWidth>
                          <InputLabel id={`product-category-${product.id}`}>Category</InputLabel>
                          <Select labelId={`product-category-${product.id}`} label="Category" value={edit.categoryId || ''} onChange={(event) => setProductEdits((state) => ({ ...state, [product.id]: { ...state[product.id], categoryId: event.target.value } }))}>
                            <MenuItem value="">No category</MenuItem>
                            {categories.map((category) => <MenuItem key={category.id} value={category.id}>{category.name}</MenuItem>)}
                          </Select>
                        </FormControl>
                      </Stack>
                      <TextField label="Description" multiline minRows={2} value={edit.description || ''} onChange={(event) => setProductEdits((state) => ({ ...state, [product.id]: { ...state[product.id], description: event.target.value } }))} />
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                        {product.image_path && (
                          <Box
                            component="img"
                            src={publicImageUrl(product.image_path)}
                            alt={`${product.name} product`}
                            loading="lazy"
                            sx={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 1 }}
                          />
                        )}
                        <Button
                          component="label"
                          size="small"
                          variant="outlined"
                          sx={{ minWidth: 112, width: 'fit-content' }}
                        >
                          {productImageFiles[product.id] ? 'Image selected' : 'Upload image'}
                          <input
                            hidden
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(event) => {
                              const file = event.target.files?.[0]
                              if (file) setProductImageFiles((current) => ({ ...current, [product.id]: file }))
                              event.target.value = ''
                            }}
                          />
                        </Button>
                        <Typography variant="body2" color="text.secondary">
                          Resized to WebP (max 1,200 px and 600 KB) before storage upload.
                        </Typography>
                      </Stack>
                      <Stack direction="row" sx={{ flexWrap: 'wrap' }}>
                        <FormControlLabel control={<Switch checked={Boolean(edit.is_published)} onChange={(event) => setProductEdits((state) => ({ ...state, [product.id]: { ...state[product.id], is_published: event.target.checked } }))} />} label="Published" />
                        <FormControlLabel control={<Switch checked={Boolean(edit.is_available)} onChange={(event) => setProductEdits((state) => ({ ...state, [product.id]: { ...state[product.id], is_available: event.target.checked } }))} />} label="Available" />
                        <FormControlLabel control={<Switch checked={Boolean(edit.is_featured)} onChange={(event) => setProductEdits((state) => ({ ...state, [product.id]: { ...state[product.id], is_featured: event.target.checked } }))} />} label="Featured" />
                        <FormControlLabel control={<Switch checked={Boolean(edit.is_best_seller)} onChange={(event) => setProductEdits((state) => ({ ...state, [product.id]: { ...state[product.id], is_best_seller: event.target.checked } }))} />} label="Best seller badge" />
                      </Stack>
                      <Button variant="contained" onClick={() => saveProduct(product)} disabled={isSaving}>Save catalog details</Button>
                      <Stack spacing={1}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
                          <Box>
                            <Typography variant="subtitle1" fontWeight={700}>Sizes and add-ons</Typography>
                            <Typography variant="body2" color="text.secondary">
                              Manage options separately from the product details.
                            </Typography>
                          </Box>
                          <Stack direction="row" spacing={1}>
                            <Button size="small" variant="outlined" onClick={() => setOptionDialogType('variant')}>
                              Add size
                            </Button>
                            <Button size="small" variant="outlined" onClick={() => setOptionDialogType('addon')}>
                              Add add-on
                            </Button>
                          </Stack>
                        </Stack>
                        {[
                          ...variants.filter((entry) => entry.product_id === product.id)
                            .map((entry) => ({ ...entry, type: 'variant' })),
                          ...addons.filter((entry) => entry.product_id === product.id)
                            .map((entry) => ({ ...entry, type: 'addon' })),
                        ].length ? (
                          <TableContainer component={Paper} variant="outlined">
                            <Table size="small" aria-label={`${product.name} sizes and add-ons`}>
                              <TableHead>
                                <TableRow>
                                  <TableCell>Type</TableCell>
                                  <TableCell>Name</TableCell>
                                  <TableCell align="right">Price</TableCell>
                                  <TableCell>Status</TableCell>
                                  <TableCell align="right">Actions</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {[
                                  ...variants.filter((entry) => entry.product_id === product.id)
                                    .map((entry) => ({ ...entry, type: 'variant' })),
                                  ...addons.filter((entry) => entry.product_id === product.id)
                                    .map((entry) => ({ ...entry, type: 'addon' })),
                                ].map((option) => (
                                  <TableRow key={`${option.type}-${option.id}`}>
                                    <TableCell>{option.type === 'variant' ? 'Size' : 'Add-on'}</TableCell>
                                    <TableCell>{option.name}</TableCell>
                                    <TableCell align="right">{formatPrice(option.price)}</TableCell>
                                    <TableCell>
                                      <FormControlLabel
                                        control={<Switch size="small" checked={option.is_active} disabled={isSaving} onChange={(event) => setOptionActive(option, option.type, event.target.checked)} />}
                                        label={option.is_active ? 'Active' : 'Inactive'}
                                      />
                                    </TableCell>
                                    <TableCell align="right">
                                      <Button
                                        size="small"
                                        color="error"
                                        onClick={() => requestMenuDelete(option.type, option)}
                                        disabled={isSaving}
                                      >
                                        Delete
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            No sizes or add-ons have been added yet.
                          </Typography>
                        )}
                      </Stack>
                    </>
                  )}
                </Stack>
                </DialogContent>
                <DialogActions sx={{ px: 3, py: 2 }}>
                  <Button onClick={() => setEditingProductId('')} disabled={isSaving}>Close</Button>
                </DialogActions>
              </Dialog>
            )
          })}
          <Dialog
            open={Boolean(optionDialogType && editingProduct)}
            onClose={() => !isSaving && setOptionDialogType('')}
            fullWidth
            maxWidth="xs"
          >
            <DialogTitle>{optionDialogType === 'variant' ? 'Add size' : 'Add add-on'}</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 1 }}>
                <TextField
                  autoFocus
                  label={optionDialogType === 'variant' ? 'Size name' : 'Add-on name'}
                  value={optionDialogType === 'variant'
                    ? optionDrafts[editingProduct?.id]?.variantName || ''
                    : optionDrafts[editingProduct?.id]?.addonName || ''}
                  onChange={(event) => setOptionDrafts((state) => ({
                    ...state,
                    [editingProduct.id]: {
                      ...state[editingProduct.id],
                      [optionDialogType === 'variant' ? 'variantName' : 'addonName']: event.target.value,
                    },
                  }))}
                  required
                />
                <TextField
                  label="Price (PHP)"
                  type="number"
                  value={optionDialogType === 'variant'
                    ? optionDrafts[editingProduct?.id]?.variantPrice || ''
                    : optionDrafts[editingProduct?.id]?.addonPrice || ''}
                  onChange={(event) => setOptionDrafts((state) => ({
                    ...state,
                    [editingProduct.id]: {
                      ...state[editingProduct.id],
                      [optionDialogType === 'variant' ? 'variantPrice' : 'addonPrice']: event.target.value,
                    },
                  }))}
                  slotProps={{ htmlInput: { min: '0', step: '0.01' } }}
                  required
                />
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2 }}>
              <Button onClick={() => setOptionDialogType('')} disabled={isSaving}>Cancel</Button>
              <Button
                variant="contained"
                disabled={isSaving || !editingProduct}
                onClick={() => editingProduct && void createOption(editingProduct, optionDialogType)}
              >
                {isSaving ? 'Saving…' : optionDialogType === 'variant' ? 'Add size' : 'Add add-on'}
              </Button>
            </DialogActions>
          </Dialog>
          </>
          ) : <Alert severity="info">No products are configured. Add real catalog records; no sample products are created.</Alert>}
          </Box>
        </>}
        {menuView === 'catalog' && publishedCategories.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            Published categories: {publishedCategories.map((category) => category.name).join(', ')}
          </Typography>
        )}
      </Stack>
      <DeleteConfirmationDialog
        open={Boolean(deleteTarget)}
        title={`Permanently delete ${deleteTarget?.type === 'category' ? 'category' : deleteTarget?.type === 'product' ? 'product' : 'menu option'}?`}
        itemName={deleteTarget?.record.name}
        itemType={deleteTarget?.type === 'category' ? 'category' : deleteTarget?.type === 'product' ? 'product' : 'option'}
        detail={deleteTarget?.type === 'category'
          ? 'Products in this category will remain in the catalog without a category.'
          : deleteTarget?.type === 'product'
            ? 'The product, its sizes/add-ons, branch stock and recipe links will be removed. Existing orders keep their saved item details.'
            : 'Existing orders keep their saved option details.'}
        warning="This action cannot be undone."
        errorMessage={errorMessage}
        isDeleting={isSaving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void deleteMenuRecord()}
      />
    </Container>
  )
}

export default AdminMenuPage
