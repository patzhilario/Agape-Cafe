import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, CircularProgress, Container, Dialog, DialogActions,
  DialogContent, DialogTitle, FormControlLabel,
  Paper, Stack, Switch, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { getSupabaseClient } from '../../lib/supabaseClient.js'
import DeleteConfirmationDialog from '../../components/DeleteConfirmationDialog.jsx'

const emptyStore = {
  id: '', name: '', address: '', map_url: '', phone: '', email: '',
  is_active: true, delivery_enabled: true, delivery_fee: 0,
}
const emptyPaymentMethod = {
  id: '', code: '', name: '', instructions: '', settlement_type: 'provider',
  is_active: true, qr_code_path: '',
}

export default function AdminStoreSettingsPage() {
  const [draft, setDraft] = useState(emptyStore)
  const [hasDeliveryFee, setHasDeliveryFee] = useState(false)
  const [branchPaymentMethods, setBranchPaymentMethods] = useState([])
  const [paymentDraft, setPaymentDraft] = useState(emptyPaymentMethod)
  const [paymentQrFile, setPaymentQrFile] = useState(null)
  const [isSavingPaymentMethod, setIsSavingPaymentMethod] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    let active = true
    async function loadSettings() {
      const supabase = getSupabaseClient()
      const { data: stores, error } = await supabase.rpc('get_store_branch')
      if (error) throw error
      if (!stores?.length) throw new Error('Store settings are not configured yet.')
      const store = stores[0]
      const { data: methods, error: methodsError } = await supabase
        .from('payment_methods')
        .select('id, code, name, instructions, settlement_type, is_active, qr_code_path')
        .eq('branch_id', store.id)
        .eq('settlement_type', 'provider')
        .order('name')
      if (methodsError) throw methodsError
      if (!active) return
      setDraft({ ...emptyStore, ...store })
      setHasDeliveryFee(Number(store.delivery_fee) > 0)
      setBranchPaymentMethods(methods || [])
    }
    void loadSettings()
      .catch((error) => { if (active) setErrorMessage(error.message) })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [])

  function requestDelete(type, record) {
    setErrorMessage('')
    setDeleteTarget({ type, record })
  }

  async function saveStore(event) {
    event.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')
    const mapUrl = (draft.map_url || '').trim()
    if (mapUrl) {
      try {
        const parsedMapUrl = new URL(mapUrl)
        const isGoogleMapsHost =
          parsedMapUrl.hostname === 'google.com' ||
          parsedMapUrl.hostname.endsWith('.google.com') ||
          parsedMapUrl.hostname === 'maps.app.goo.gl' ||
          parsedMapUrl.hostname === 'goo.gl'
        if (parsedMapUrl.protocol !== 'https:' || !isGoogleMapsHost) {
          throw new Error('Use a secure Google Maps link.')
        }
      } catch {
        setErrorMessage('Enter a valid HTTPS Google Maps link.')
        return
      }
    }
    const deliveryFee = hasDeliveryFee ? Number(draft.delivery_fee) : 0
    if (hasDeliveryFee && (!/^\d{1,8}(\.\d{1,2})?$/.test(String(draft.delivery_fee)) || !Number.isFinite(deliveryFee) || deliveryFee <= 0)) {
      setErrorMessage('Enter a delivery fee greater than zero with up to two decimal places, or choose free delivery.')
      return
    }
    setIsSaving(true)
    const payload = {
      name: (draft.name || '').trim(),
      address: (draft.address || '').trim(),
      map_url: mapUrl || null,
      phone: (draft.phone || '').trim() || null,
      email: (draft.email || '').trim() || null,
      is_active: Boolean(draft.is_active),
      delivery_enabled: true,
      delivery_fee: deliveryFee,
    }
    try {
      const supabase = getSupabaseClient()
      const result = await supabase.from('branches').update(payload).eq('id', draft.id).select('id').single()
      if (result.error) throw new Error(result.error.message)
      setSuccessMessage('Store settings saved.')
    } catch (error) {
      console.error('Unable to save store settings.', error)
      setErrorMessage(error.message)
    } finally {
      setIsSaving(false)
    }
  }

  async function savePaymentMethod() {
    if (!draft.id) return
    const name = paymentDraft.name.trim()
    if (name.length < 2 || name.length > 80) {
      setErrorMessage('Enter a payment method name between 2 and 80 characters.')
      return
    }
    if (paymentQrFile && paymentQrFile.size > 5 * 1024 * 1024) {
      setErrorMessage('The QR image must be 5 MB or smaller.')
      return
    }
    if (paymentQrFile && !['image/jpeg', 'image/png', 'image/webp'].includes(paymentQrFile.type)) {
      setErrorMessage('Use a JPG, PNG, or WebP image for the payment QR.')
      return
    }
    if (!paymentQrFile && !paymentDraft.qr_code_path) {
      setErrorMessage('Upload a QR image for online payment methods.')
      return
    }

    setIsSavingPaymentMethod(true)
    setErrorMessage('')
    const supabase = getSupabaseClient()
    const methodCode = paymentDraft.code || name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || `payment_${crypto.randomUUID().slice(0, 8)}`
    let uploadedQrPath = ''
    let paymentMethodSaved = false
    try {
      if (paymentQrFile) {
        uploadedQrPath = `branches/${draft.id}/payment-methods/${crypto.randomUUID()}-${paymentQrFile.name.replace(/[^a-zA-Z0-9.-]/g, '-')}`
        const { error } = await supabase.storage
          .from('branch-payment-qr')
          .upload(uploadedQrPath, paymentQrFile, {
            contentType: paymentQrFile.type,
            cacheControl: '31536000',
            upsert: false,
          })
        if (error) throw new Error(`Could not upload the QR image: ${error.message}`)
      }

      const payload = {
        branch_id: draft.id,
        code: methodCode,
        name,
        instructions: paymentDraft.instructions.trim(),
        settlement_type: 'provider',
        provider: methodCode,
        is_active: paymentDraft.is_active,
        qr_code_path: uploadedQrPath || paymentDraft.qr_code_path || null,
      }
      const result = paymentDraft.id
        ? await supabase.from('payment_methods').update(payload).eq('id', paymentDraft.id)
        : await supabase.from('payment_methods').insert(payload)
      if (result.error) throw new Error(result.error.message)
      paymentMethodSaved = true

      if (paymentDraft.qr_code_path && paymentDraft.qr_code_path !== payload.qr_code_path) {
        const { error } = await supabase.storage
          .from('branch-payment-qr')
          .remove([paymentDraft.qr_code_path])
        if (error) {
          console.error('Unable to remove the replaced payment QR.', error)
          setErrorMessage('Payment method was saved, but its previous QR image could not be removed from storage.')
        }
      }
      setPaymentDraft(emptyPaymentMethod)
      setPaymentQrFile(null)
      setPaymentDialogOpen(false)
      const { data, error } = await supabase
        .from('payment_methods')
        .select('id, code, name, instructions, settlement_type, is_active, qr_code_path')
        .eq('branch_id', draft.id)
        .eq('settlement_type', 'provider')
        .order('name')
      if (error) throw new Error(error.message)
      setBranchPaymentMethods(data)
    } catch (error) {
      if (uploadedQrPath && !paymentMethodSaved) {
        const { error: cleanupError } = await supabase.storage
          .from('branch-payment-qr')
          .remove([uploadedQrPath])
        if (cleanupError) console.error('Unable to remove the unlinked payment QR.', cleanupError)
      }
      console.error('Unable to save store payment method.', error)
      setErrorMessage(error.message)
    } finally {
      setIsSavingPaymentMethod(false)
    }
  }

  async function deactivatePaymentMethod(method) {
    setErrorMessage('')
    const { error } = await getSupabaseClient()
      .from('payment_methods')
      .update({ is_active: false })
      .eq('id', method.id)
    if (error) {
      console.error('Unable to deactivate store payment method.', error)
      setErrorMessage(error.message)
      return
    }
    setBranchPaymentMethods((current) => current.map((item) =>
      item.id === method.id ? { ...item, is_active: false } : item,
    ))
  }

  async function deletePaymentMethod() {
    if (!deleteTarget || deleteTarget.type !== 'payment_method') return
    const method = deleteTarget.record
    setIsDeleting(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const { data, error } = await getSupabaseClient()
        .from('payment_methods')
        .delete()
        .eq('id', method.id)
        .select('id')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new Error('This payment method no longer exists. Refresh the page and try again.')
      setBranchPaymentMethods((current) => current.filter((item) => item.id !== method.id))
      setDeleteTarget(null)
      setSuccessMessage(`${method.name} was permanently deleted.`)
      if (method.qr_code_path) {
        const { error: storageError } = await getSupabaseClient()
          .storage
          .from('branch-payment-qr')
          .remove([method.qr_code_path])
        if (storageError) {
          console.error('Payment method was deleted, but its QR image could not be removed.', storageError)
          setErrorMessage(`Payment method was deleted, but its QR image could not be removed from storage: ${storageError.message}`)
        }
      }
    } catch (error) {
      console.error('Unable to delete store payment method.', error)
      setErrorMessage(error.message)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={3}>
        <Typography variant="h2">Store settings</Typography>
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        {successMessage && <Alert severity="success">{successMessage}</Alert>}
        {isLoading ? <CircularProgress /> : draft.id && (
          <>
            <Paper component="form" onSubmit={saveStore} variant="outlined" sx={{ p: 3 }}>
              <Stack spacing={2}>
                <TextField label="Store name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required />
                <TextField label="Address" value={draft.address} onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))} required multiline minRows={2} />
                <TextField label="Google Maps link (optional)" type="url" value={draft.map_url || ''} onChange={(event) => setDraft((current) => ({ ...current, map_url: event.target.value }))} />
                <TextField label="Phone" value={draft.phone || ''} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} />
                <TextField label="Email" type="email" value={draft.email || ''} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} />
                <FormControlLabel control={<Switch checked={draft.is_active} onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))} />} label="Accepting orders" />
                <Typography variant="h6">Delivery fee</Typography>
                <FormControlLabel control={<Switch checked={hasDeliveryFee} onChange={(event) => setHasDeliveryFee(event.target.checked)} />} label="Charge a delivery fee" />
                {hasDeliveryFee ? (
                  <TextField label="Delivery fee (PHP)" type="number" value={draft.delivery_fee} onChange={(event) => setDraft((current) => ({ ...current, delivery_fee: event.target.value }))} required slotProps={{ htmlInput: { min: 0.01, max: 99999999.99, step: 0.01 } }} helperText="Added once to delivery orders. Dine-in and pick-up have no delivery fee." />
                ) : <Alert severity="info">Free delivery. No delivery fee is added to new orders.</Alert>}
                <Button type="submit" variant="contained" disabled={isSaving}>{isSaving ? 'Saving...' : 'Save store settings'}</Button>
              </Stack>
            </Paper>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="h5">Payment methods</Typography>
              <Button variant="outlined" onClick={() => {
                setPaymentDraft(emptyPaymentMethod)
                setPaymentQrFile(null)
                setErrorMessage('')
                setPaymentDialogOpen(true)
              }}>Add payment method</Button>
            </Stack>
            <TableContainer component={Paper} variant="outlined">
              <Table aria-label="Payment methods">
                <TableHead><TableRow><TableCell>Method</TableCell><TableCell>Type</TableCell><TableCell>Status</TableCell><TableCell>Actions</TableCell></TableRow></TableHead>
                <TableBody>
                  {branchPaymentMethods.map((method) => (
                    <TableRow key={method.id}>
                      <TableCell>{method.name}</TableCell>
                      <TableCell>E-payment / QR</TableCell>
                      <TableCell>{method.is_active ? 'Enabled' : 'Disabled'}</TableCell>
                      <TableCell>
                        <Button onClick={() => {
                          setPaymentDraft({ ...method })
                          setPaymentQrFile(null)
                          setErrorMessage('')
                          setPaymentDialogOpen(true)
                        }}>Edit</Button>
                        {method.is_active && <Button onClick={() => void deactivatePaymentMethod(method)}>Deactivate</Button>}
                        <Button color="error" onClick={() => requestDelete('payment_method', method)} disabled={isDeleting}>Delete</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </Stack>
      <Dialog
        open={paymentDialogOpen}
        onClose={() => !isSavingPaymentMethod && setPaymentDialogOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <Box component="form" onSubmit={(event) => {
          event.preventDefault()
          void savePaymentMethod()
        }}>
          <DialogTitle>{paymentDraft.id ? `Edit ${paymentDraft.name}` : 'Add payment method'}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
              <TextField
                label="Payment method name"
                value={paymentDraft.name}
                onChange={(event) => setPaymentDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="e.g. GCash, Maya, MariBank, BDO"
                required
                slotProps={{ htmlInput: { maxLength: 80 } }}
              />
              <Alert severity="info">E-payment only. Add an e-wallet or bank payment method and upload its receiving QR code.</Alert>
              <TextField
                label="Customer instructions (optional)"
                value={paymentDraft.instructions}
                onChange={(event) => setPaymentDraft((current) => ({
                  ...current,
                  instructions: event.target.value,
                }))}
                multiline
                minRows={2}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
              {paymentDraft.settlement_type === 'provider' && (
                <>
                  <Button
                    type="button"
                    component="label"
                    variant="outlined"
                    sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere', alignSelf: 'flex-start' }}
                  >
                    {paymentQrFile?.name || (paymentDraft.qr_code_path ? 'Replace QR code' : 'Upload QR code')}
                    <input
                      hidden
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => {
                        setPaymentQrFile(event.target.files?.[0] || null)
                        event.target.value = ''
                      }}
                    />
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                    JPG, PNG, or WebP · up to 5 MB. Staff verify uploaded customer receipts before marking payment complete.
                  </Typography>
                </>
              )}
              <FormControlLabel
                control={
                  <Switch
                    checked={paymentDraft.is_active}
                    onChange={(event) => setPaymentDraft((current) => ({
                      ...current,
                      is_active: event.target.checked,
                    }))}
                  />
                }
                label="Available to customers"
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button type="button" onClick={() => setPaymentDialogOpen(false)} disabled={isSavingPaymentMethod}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={isSavingPaymentMethod}>
              {isSavingPaymentMethod ? 'Saving…' : paymentDraft.id ? 'Save payment method' : 'Add payment method'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <DeleteConfirmationDialog
        open={Boolean(deleteTarget)}
        permanent
        title="Delete payment method?"
        itemName={deleteTarget?.record.name}
        itemType="payment method"
        detail="Saved payments retain their transaction details."
        errorMessage={errorMessage}
        isDeleting={isDeleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void deletePaymentMethod()}
      />
    </Container>
  )
}
