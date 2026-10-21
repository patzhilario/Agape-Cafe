import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useAuth } from '../auth/useAuth.js'
import { getSupabaseClient } from '../../lib/supabaseClient.js'
import { formatPrice } from '../public/publicData.js'

function check({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

function AdminPromotionsPage() {
  const { account } = useAuth()
  const isSuperAdmin = account.roles.includes('super_admin')
  const [promotions, setPromotions] = useState([])
  const [products, setProducts] = useState([])
  const [targets, setTargets] = useState([])
  const [form, setForm] = useState({
    name: '',
    description: '',
    terms: '',
    discountType: 'percentage',
    discountValue: '',
    maxDiscount: '',
    minimumPurchase: '0',
    startsAt: '',
    endsAt: '',
    maxUses: '',
    maxUsesPerCustomer: '',
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    Promise.all([
      getSupabaseClient().from('promotions')
        .select('id, name, description, terms, discount_type, discount_value, max_discount, minimum_purchase, starts_at, ends_at, is_active, max_uses, max_uses_per_customer, promotion_products(product_id)')
        .order('starts_at', { ascending: false }),
      getSupabaseClient().from('products')
        .select('id, name, sku')
        .is('archived_at', null)
        .order('name'),
    ].map((query) => query.then(check)))
      .then(([loadedPromotions, loadedProducts]) => {
        if (active) {
          setPromotions(loadedPromotions)
          setProducts(loadedProducts)
        }
      })
      .catch((error) => {
        console.error('Unable to load promotions.', error)
        if (active) setErrorMessage(error.message)
      })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [reloadKey])

  async function createPromotion(event) {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const startsAt = new Date(form.startsAt)
      const endsAt = form.endsAt ? new Date(form.endsAt) : null
      if (Number.isNaN(startsAt.getTime()) || (endsAt && endsAt <= startsAt)) {
        throw new Error('Choose a valid promotion start and end time.')
      }

      const { data: promotion, error } = await getSupabaseClient()
        .from('promotions')
        .insert({
          name: form.name.trim(),
          description: form.description.trim(),
          terms: form.terms.trim(),
          discount_type: form.discountType,
          discount_value: Number(form.discountValue),
          max_discount: form.maxDiscount === '' ? null : Number(form.maxDiscount),
          minimum_purchase: Number(form.minimumPurchase),
          starts_at: startsAt.toISOString(),
          ends_at: endsAt?.toISOString() || null,
          max_uses: form.maxUses === '' ? null : Number(form.maxUses),
          max_uses_per_customer: form.maxUsesPerCustomer === '' ? null : Number(form.maxUsesPerCustomer),
          is_active: false,
        })
        .select('id')
        .single()
      if (error) throw new Error(error.message)

      if (targets.length) {
        const { error: targetError } = await getSupabaseClient()
          .from('promotion_products')
          .insert(targets.map((productId) => ({
            promotion_id: promotion.id,
            product_id: productId,
          })))
        if (targetError) throw new Error(`Promotion saved inactive, but product targeting failed: ${targetError.message}`)
      }

      setForm({
        name: '',
        description: '',
        terms: '',
        discountType: 'percentage',
        discountValue: '',
        maxDiscount: '',
        minimumPurchase: '0',
        startsAt: '',
        endsAt: '',
        maxUses: '',
        maxUsesPerCustomer: '',
      })
      setTargets([])
      setSuccessMessage('Promotion created inactive. Review its details, then activate it when ready.')
      setReloadKey((value) => value + 1)
    } catch (error) {
      console.error('Unable to create promotion.', error)
      setErrorMessage(error.message)
    } finally { setIsSaving(false) }
  }

  async function setPromotionActive(promotion, isActive) {
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const { error } = await getSupabaseClient()
        .from('promotions')
        .update({ is_active: isActive })
        .eq('id', promotion.id)
      if (error) throw new Error(error.message)
      setSuccessMessage(`${promotion.name} ${isActive ? 'activated' : 'deactivated'}.`)
      setReloadKey((value) => value + 1)
    } catch (error) {
      console.error('Unable to update promotion status.', error)
      setErrorMessage(error.message)
    } finally { setIsSaving(false) }
  }

  if (isLoading) return <Stack sx={{ alignItems: 'center', py: 10 }}><CircularProgress /></Stack>

  if (!isSuperAdmin) {
    return (
      <Container maxWidth="md" sx={{ py: 8 }}>
        <Alert severity="warning">Promotion configuration is restricted to a Super Admin.</Alert>
      </Container>
    )
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="primary">Agapé Café · Operations</Typography>
          <Typography variant="h2">Promotions</Typography>
          <Typography color="text.secondary">
            Define dates, discount limits, and optional product targets. New
            promotions start inactive and are never silently made live.
          </Typography>
        </Box>
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        {successMessage && <Alert severity="success">{successMessage}</Alert>}
        <Paper component="form" onSubmit={createPromotion} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>
            <Typography variant="h6">Create promotion</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Name" value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} required slotProps={{ htmlInput: { maxLength: 120 } }} />
              <FormControl fullWidth>
                <InputLabel id="discount-type-label">Discount type</InputLabel>
                <Select labelId="discount-type-label" label="Discount type" value={form.discountType} onChange={(event) => setForm((value) => ({ ...value, discountType: event.target.value }))}>
                  <MenuItem value="percentage">Percentage</MenuItem>
                  <MenuItem value="fixed">Fixed amount</MenuItem>
                </Select>
              </FormControl>
              <TextField label={form.discountType === 'percentage' ? 'Percent off' : 'Amount off (PHP)'} type="number" value={form.discountValue} onChange={(event) => setForm((value) => ({ ...value, discountValue: event.target.value }))} required slotProps={{ htmlInput: { min: '0.01', step: '0.01', max: form.discountType === 'percentage' ? 100 : undefined } }} />
              <TextField label="Minimum purchase (PHP)" type="number" value={form.minimumPurchase} onChange={(event) => setForm((value) => ({ ...value, minimumPurchase: event.target.value }))} slotProps={{ htmlInput: { min: '0', step: '0.01' } }} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Maximum discount (optional, PHP)" type="number" value={form.maxDiscount} onChange={(event) => setForm((value) => ({ ...value, maxDiscount: event.target.value }))} slotProps={{ htmlInput: { min: '0.01', step: '0.01' } }} />
              <TextField label="Total redemptions limit (optional)" type="number" value={form.maxUses} onChange={(event) => setForm((value) => ({ ...value, maxUses: event.target.value }))} slotProps={{ htmlInput: { min: '1', step: '1' } }} />
              <TextField label="Per-customer limit (optional)" type="number" value={form.maxUsesPerCustomer} onChange={(event) => setForm((value) => ({ ...value, maxUsesPerCustomer: event.target.value }))} slotProps={{ htmlInput: { min: '1', step: '1' } }} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Starts at" type="datetime-local" value={form.startsAt} onChange={(event) => setForm((value) => ({ ...value, startsAt: event.target.value }))} required InputLabelProps={{ shrink: true }} />
              <TextField label="Ends at (optional)" type="datetime-local" value={form.endsAt} onChange={(event) => setForm((value) => ({ ...value, endsAt: event.target.value }))} InputLabelProps={{ shrink: true }} />
            </Stack>
            <TextField label="Description" value={form.description} onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 1000 } }} />
            <TextField label="Terms and conditions" value={form.terms} onChange={(event) => setForm((value) => ({ ...value, terms: event.target.value }))} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 2000 } }} />
            <FormControl fullWidth>
              <InputLabel id="promotion-products-label">Target products (optional)</InputLabel>
              <Select
                multiple
                labelId="promotion-products-label"
                label="Target products (optional)"
                value={targets}
                onChange={(event) => setTargets(event.target.value)}
                renderValue={(selected) => selected.map((id) => products.find((product) => product.id === id)?.name || id).join(', ')}
              >
                {products.map((product) => <MenuItem key={product.id} value={product.id}>{product.name} · {product.sku}</MenuItem>)}
              </Select>
            </FormControl>
            <Typography variant="body2" color="text.secondary">
              No product targets means the promotion applies to all eligible products.
            </Typography>
            <Button type="submit" variant="contained" disabled={isSaving}>Create inactive promotion</Button>
          </Stack>
        </Paper>
        <Stack spacing={2}>
          <Typography variant="h5">Existing promotions</Typography>
          {promotions.length ? promotions.map((promotion) => (
            <Paper key={promotion.id} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
              <Stack spacing={1.5}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
                  <Box>
                    <Typography variant="h6">{promotion.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {promotion.discount_type === 'percentage'
                        ? `${promotion.discount_value}% off`
                        : `${formatPrice(promotion.discount_value)} off`}
                      {' · Starts '}{new Date(promotion.starts_at).toLocaleString()}
                      {promotion.ends_at ? ` · Ends ${new Date(promotion.ends_at).toLocaleString()}` : ' · No end date'}
                    </Typography>
                  </Box>
                  <FormControlLabel
                    control={<Switch checked={promotion.is_active} disabled={isSaving} onChange={(event) => setPromotionActive(promotion, event.target.checked)} />}
                    label={promotion.is_active ? 'Active' : 'Inactive'}
                  />
                </Stack>
                <Typography variant="body2">
                  Minimum {formatPrice(promotion.minimum_purchase)}
                  {promotion.max_discount ? ` · Maximum discount ${formatPrice(promotion.max_discount)}` : ''}
                  {promotion.max_uses ? ` · Uses ${promotion.max_uses}` : ''}
                  {promotion.max_uses_per_customer ? ` · Per customer ${promotion.max_uses_per_customer}` : ''}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Target products: {promotion.promotion_products?.length
                    ? promotion.promotion_products.map((target) => products.find((product) => product.id === target.product_id)?.name || 'Archived product').join(', ')
                    : 'All products'}
                </Typography>
                {promotion.terms && <Typography variant="body2">{promotion.terms}</Typography>}
              </Stack>
            </Paper>
          )) : <Alert severity="info">No promotions have been configured.</Alert>}
        </Stack>
      </Stack>
    </Container>
  )
}

export default AdminPromotionsPage
