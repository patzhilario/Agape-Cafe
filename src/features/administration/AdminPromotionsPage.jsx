import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
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
  TextField,
  Typography,
} from '@mui/material'
import { useAuth } from '../auth/useAuth.js'
import { getSupabaseClient } from '../../lib/supabaseClient.js'
import { formatPrice } from '../public/publicData.js'
import DeleteConfirmationDialog from '../../components/DeleteConfirmationDialog.jsx'

function check({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

function AdminPromotionsPage() {
  const { account } = useAuth()
  const isAdmin = account.roles.includes('admin')
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
  const [promotionDialogOpen, setPromotionDialogOpen] = useState(false)
  const [promotionToDelete, setPromotionToDelete] = useState(null)

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
      setPromotionDialogOpen(false)
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

  async function deletePromotion() {
    if (!promotionToDelete) return
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const { data, error } = await getSupabaseClient()
        .from('promotions')
        .delete()
        .eq('id', promotionToDelete.id)
        .select('id')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new Error('This promotion no longer exists. Refresh the page and try again.')
      setSuccessMessage(`${promotionToDelete.name} was permanently deleted.`)
      setPromotionToDelete(null)
      setReloadKey((value) => value + 1)
    } catch (error) {
      console.error('Unable to delete promotion.', error)
      setErrorMessage(error.message)
    } finally { setIsSaving(false) }
  }

  if (isLoading) return <Stack sx={{ alignItems: 'center', py: 10 }}><CircularProgress /></Stack>

  if (!isAdmin) {
    return (
      <Container maxWidth="md" sx={{ py: 8 }}>
        <Alert severity="warning">Promotion configuration is restricted to an Admin.</Alert>
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
        <Button variant="contained" sx={{ alignSelf: 'flex-start' }} onClick={() => setPromotionDialogOpen(true)}>
          Add promotion
        </Button>
        <Dialog
          open={promotionDialogOpen}
          onClose={() => !isSaving && setPromotionDialogOpen(false)}
          fullWidth
          maxWidth="md"
        >
          <Box component="form" onSubmit={createPromotion}>
            <DialogTitle>Create promotion</DialogTitle>
            <DialogContent dividers sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
              <Stack spacing={3}>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>PROMOTION DETAILS</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
                    <TextField label="Name" value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} required slotProps={{ htmlInput: { maxLength: 120 } }} />
                    <FormControl>
                      <InputLabel id="discount-type-label">Discount type</InputLabel>
                      <Select labelId="discount-type-label" label="Discount type" value={form.discountType} onChange={(event) => setForm((value) => ({ ...value, discountType: event.target.value }))}>
                        <MenuItem value="percentage">Percentage</MenuItem>
                        <MenuItem value="fixed">Fixed amount</MenuItem>
                      </Select>
                    </FormControl>
                    <TextField label={form.discountType === 'percentage' ? 'Percent off' : 'Amount off (PHP)'} type="number" value={form.discountValue} onChange={(event) => setForm((value) => ({ ...value, discountValue: event.target.value }))} required slotProps={{ htmlInput: { min: '0.01', step: '0.01', max: form.discountType === 'percentage' ? 100 : undefined } }} />
                    <TextField label="Minimum purchase (PHP)" type="number" value={form.minimumPurchase} onChange={(event) => setForm((value) => ({ ...value, minimumPurchase: event.target.value }))} slotProps={{ htmlInput: { min: '0', step: '0.01' } }} />
                    <TextField label="Maximum discount (optional, PHP)" type="number" value={form.maxDiscount} onChange={(event) => setForm((value) => ({ ...value, maxDiscount: event.target.value }))} slotProps={{ htmlInput: { min: '0.01', step: '0.01' } }} />
                  </Box>
                </Box>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>SCHEDULE AND USAGE LIMITS</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
                    <TextField
                      label="Starts at"
                      type="datetime-local"
                      value={form.startsAt}
                      onChange={(event) => setForm((value) => ({ ...value, startsAt: event.target.value }))}
                      required
                      fullWidth
                      slotProps={{
                        inputLabel: { shrink: true },
                        htmlInput: { style: { minWidth: 0, colorScheme: 'light' } },
                      }}
                      helperText="Philippine local time"
                    />
                    <TextField
                      label="Ends at (optional)"
                      type="datetime-local"
                      value={form.endsAt}
                      onChange={(event) => setForm((value) => ({ ...value, endsAt: event.target.value }))}
                      fullWidth
                      slotProps={{
                        inputLabel: { shrink: true },
                        htmlInput: { style: { minWidth: 0, colorScheme: 'light' } },
                      }}
                      helperText="Leave blank for no end date"
                    />
                    <TextField label="Total redemptions limit (optional)" type="number" value={form.maxUses} onChange={(event) => setForm((value) => ({ ...value, maxUses: event.target.value }))} slotProps={{ htmlInput: { min: '1', step: '1' } }} />
                    <TextField label="Per-customer limit (optional)" type="number" value={form.maxUsesPerCustomer} onChange={(event) => setForm((value) => ({ ...value, maxUsesPerCustomer: event.target.value }))} slotProps={{ htmlInput: { min: '1', step: '1' } }} />
                  </Box>
                </Box>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>DESCRIPTION AND TARGETING</Typography>
                  <Stack spacing={2}>
                    <TextField label="Description" value={form.description} onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 1000 } }} />
                    <TextField label="Terms and conditions" value={form.terms} onChange={(event) => setForm((value) => ({ ...value, terms: event.target.value }))} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 2000 } }} />
                    <FormControl>
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
                  </Stack>
                </Box>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2 }}>
              <Button onClick={() => setPromotionDialogOpen(false)} disabled={isSaving}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={isSaving}>Create inactive promotion</Button>
            </DialogActions>
          </Box>
        </Dialog>
        <Box>
          <Typography variant="h5">Existing promotions</Typography>
          {promotions.length ? (
            <TableContainer component={Paper} variant="outlined" sx={{ mt: 1.5 }}>
              <Table size="small" aria-label="Promotions" sx={{ minWidth: 900 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Promotion</TableCell>
                    <TableCell>Discount</TableCell>
                    <TableCell>Schedule</TableCell>
                    <TableCell>Minimum</TableCell>
                    <TableCell>Products</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {promotions.map((promotion) => (
                    <TableRow key={promotion.id} hover>
                      <TableCell>
                        <Typography fontWeight={700}>{promotion.name}</Typography>
                        {promotion.description && <Typography variant="caption" color="text.secondary">{promotion.description}</Typography>}
                      </TableCell>
                      <TableCell>
                        {promotion.discount_type === 'percentage'
                          ? `${promotion.discount_value}%`
                          : formatPrice(promotion.discount_value)}
                        {promotion.max_discount ? ` · max ${formatPrice(promotion.max_discount)}` : ''}
                      </TableCell>
                      <TableCell>
                        {new Date(promotion.starts_at).toLocaleDateString()}
                        {promotion.ends_at ? ` – ${new Date(promotion.ends_at).toLocaleDateString()}` : ' – No end'}
                      </TableCell>
                      <TableCell>{formatPrice(promotion.minimum_purchase)}</TableCell>
                      <TableCell>
                        {promotion.promotion_products?.length
                          ? promotion.promotion_products.map((target) => products.find((product) => product.id === target.product_id)?.name || 'Archived product').join(', ')
                          : 'All products'}
                      </TableCell>
                      <TableCell>
                        <FormControlLabel
                          control={<Switch size="small" checked={promotion.is_active} disabled={isSaving} onChange={(event) => setPromotionActive(promotion, event.target.checked)} />}
                          label={promotion.is_active ? 'Active' : 'Inactive'}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          color="error"
                          onClick={() => {
                            setErrorMessage('')
                            setPromotionToDelete(promotion)
                          }}
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
          ) : <Alert severity="info" sx={{ mt: 1.5 }}>No promotions have been configured.</Alert>}
        </Box>
      </Stack>
      <DeleteConfirmationDialog
        open={Boolean(promotionToDelete)}
        title="Permanently delete promotion?"
        itemName={promotionToDelete?.name}
        itemType="promotion"
        detail="Orders and payment history keep their saved totals. A promotion that has recorded redemptions cannot be deleted."
        warning="This action cannot be undone."
        errorMessage={errorMessage}
        isDeleting={isSaving}
        onCancel={() => setPromotionToDelete(null)}
        onConfirm={() => void deletePromotion()}
      />
    </Container>
  )
}

export default AdminPromotionsPage
