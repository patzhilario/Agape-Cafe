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
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import { getSupabaseClient } from '../../lib/supabaseClient.js'
import { formatPrice } from '../public/publicData.js'

const emptyBranch = {
  id: '',
  name: '',
  address: '',
  map_url: '',
  phone: '',
  email: '',
  is_active: true,
  delivery_enabled: false,
  delivery_fee: '0',
}

const emptyPaymentMethod = {
  id: '',
  code: '',
  name: '',
  instructions: '',
  settlement_type: 'pay_at_branch',
  is_active: true,
  qr_code_path: '',
}

export default function AdminBranchesPage() {
  const [branches, setBranches] = useState([])
  const [draft, setDraft] = useState(emptyBranch)
  const [branchPaymentMethods, setBranchPaymentMethods] = useState([])
  const [branchDiningTables, setBranchDiningTables] = useState([])
  const [branchDiningTableOrders, setBranchDiningTableOrders] = useState([])
  const [diningTableDraft, setDiningTableDraft] = useState({ id: '', label: '' })
  const [paymentDraft, setPaymentDraft] = useState(emptyPaymentMethod)
  const [paymentQrFile, setPaymentQrFile] = useState(null)
  const [isLoadingPaymentMethods, setIsLoadingPaymentMethods] = useState(false)
  const [isSavingDiningTable, setIsSavingDiningTable] = useState(false)
  const [isSavingPaymentMethod, setIsSavingPaymentMethod] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    getSupabaseClient()
      .from('branches')
      .select('id, name, address, map_url, phone, email, is_active, delivery_enabled, delivery_fee')
      .order('name')
      .then(({ data, error }) => {
        if (error) throw new Error(error.message)
        if (active) {
          setBranches(data)
          setErrorMessage('')
        }
      })
      .catch((error) => {
        console.error('Unable to load branch settings.', error)
        if (active) setErrorMessage(error.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [reloadKey])

  function openNewBranch() {
    setDraft(emptyBranch)
    setBranchPaymentMethods([])
    setBranchDiningTables([])
    setBranchDiningTableOrders([])
    setDiningTableDraft({ id: '', label: '' })
    setIsLoadingPaymentMethods(false)
    setPaymentDraft(emptyPaymentMethod)
    setPaymentQrFile(null)
    setErrorMessage('')
    setDialogOpen(true)
  }

  function openEditBranch(branch) {
    setDraft({ ...branch })
    setBranchDiningTables([])
    setBranchDiningTableOrders([])
    setDiningTableDraft({ id: '', label: '' })
    setPaymentDraft(emptyPaymentMethod)
    setPaymentQrFile(null)
    setErrorMessage('')
    setDialogOpen(true)
    setIsLoadingPaymentMethods(true)
    getSupabaseClient()
      .from('payment_methods')
      .select('id, code, name, instructions, settlement_type, is_active, qr_code_path')
      .eq('branch_id', branch.id)
      .order('name')
      .then(({ data, error }) => {
        if (error) throw new Error(error.message)
        setBranchPaymentMethods(data)
      })
      .catch((error) => {
        console.error('Unable to load branch payment methods.', error)
        setErrorMessage(error.message)
      })
      .finally(() => setIsLoadingPaymentMethods(false))
    getSupabaseClient()
      .from('branch_dining_tables')
      .select('id, label, is_active')
      .eq('branch_id', branch.id)
      .order('label')
      .then(({ data, error }) => {
        if (error) throw new Error(error.message)
        setBranchDiningTables(data)
      })
      .catch((error) => {
        console.error('Unable to load branch dining tables.', error)
        setErrorMessage(error.message)
      })
    getSupabaseClient()
      .from('orders')
      .select('id, order_number, status, dining_table_id')
      .eq('branch_id', branch.id)
      .eq('fulfillment_method', 'dine_in')
      .not('status', 'in', '(cancelled,completed)')
      .not('dining_table_id', 'is', null)
      .then(({ data, error }) => {
        if (error) throw new Error(error.message)
        setBranchDiningTableOrders(data)
      })
      .catch((error) => {
        console.error('Unable to load active dine-in table orders.', error)
        setErrorMessage(error.message)
      })
  }

  async function saveBranch(event) {
    event.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')
    const deliveryFee = Number(draft.delivery_fee)
    if (!Number.isFinite(deliveryFee) || deliveryFee < 0) {
      setErrorMessage('Enter a valid non-negative delivery fee.')
      return
    }
    const mapUrl = draft.map_url.trim()
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
    setIsSaving(true)
    const payload = {
      name: draft.name.trim(),
      address: draft.address.trim(),
      map_url: mapUrl || null,
      phone: draft.phone.trim() || null,
      email: draft.email.trim() || null,
      is_active: draft.is_active,
      delivery_enabled: draft.delivery_enabled,
      delivery_fee: deliveryFee,
    }
    try {
      const supabase = getSupabaseClient()
      const result = draft.id
        ? await supabase.from('branches').update(payload).eq('id', draft.id).select('id').single()
        : await supabase.from('branches').insert(payload).select('id').single()
      if (result.error) throw new Error(result.error.message)
      setDialogOpen(false)
      setSuccessMessage(draft.id ? 'Branch details updated.' : 'Branch created. You can now assign staff to it.')
      setReloadKey((value) => value + 1)
    } catch (error) {
      console.error('Unable to save branch settings.', error)
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
    if (paymentDraft.settlement_type === 'provider' && !paymentQrFile && !paymentDraft.qr_code_path) {
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
            cacheControl: '3600',
            upsert: false,
          })
        if (error) throw new Error(`Could not upload the QR image: ${error.message}`)
      }

      const payload = {
        branch_id: draft.id,
        code: methodCode,
        name,
        instructions: paymentDraft.instructions.trim(),
        settlement_type: paymentDraft.settlement_type,
        provider: paymentDraft.settlement_type === 'provider' ? methodCode : null,
        is_active: paymentDraft.is_active,
        qr_code_path: paymentDraft.settlement_type === 'provider'
          ? uploadedQrPath || paymentDraft.qr_code_path || null
          : null,
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
        if (error) console.error('Unable to remove the replaced payment QR.', error)
      }
      setPaymentDraft(emptyPaymentMethod)
      setPaymentQrFile(null)
      const { data, error } = await supabase
        .from('payment_methods')
        .select('id, code, name, instructions, settlement_type, is_active, qr_code_path')
        .eq('branch_id', draft.id)
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
      console.error('Unable to save branch payment method.', error)
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
      console.error('Unable to deactivate branch payment method.', error)
      setErrorMessage(error.message)
      return
    }
    setBranchPaymentMethods((current) => current.map((item) =>
      item.id === method.id ? { ...item, is_active: false } : item,
    ))
  }

  async function saveDiningTable() {
    if (!draft.id) return
    const label = diningTableDraft.label.trim()
    if (label.length < 1 || label.length > 40) {
      setErrorMessage('Enter a table name or number between 1 and 40 characters.')
      return
    }
    setIsSavingDiningTable(true)
    setErrorMessage('')
    try {
      const result = diningTableDraft.id
        ? await getSupabaseClient()
          .from('branch_dining_tables')
          .update({ label })
          .eq('id', diningTableDraft.id)
          .eq('branch_id', draft.id)
        : await getSupabaseClient()
          .from('branch_dining_tables')
          .insert({ branch_id: draft.id, label })
      if (result.error) throw new Error(result.error.message)
      setDiningTableDraft({ id: '', label: '' })
      const { data, error } = await getSupabaseClient()
        .from('branch_dining_tables')
        .select('id, label, is_active')
        .eq('branch_id', draft.id)
        .order('label')
      if (error) throw new Error(error.message)
      setBranchDiningTables(data)
    } catch (error) {
      console.error('Unable to save branch dining table.', error)
      setErrorMessage(error.message)
    } finally {
      setIsSavingDiningTable(false)
    }
  }

  async function setDiningTableActive(table, isActive) {
    setErrorMessage('')
    const { error } = await getSupabaseClient()
      .from('branch_dining_tables')
      .update({ is_active: isActive })
      .eq('id', table.id)
      .eq('branch_id', draft.id)
    if (error) {
      console.error('Unable to update branch dining table.', error)
      setErrorMessage(error.message)
      return
    }
    setBranchDiningTables((current) => current.map((entry) =>
      entry.id === table.id ? { ...entry, is_active: isActive } : entry,
    ))
  }

  async function toggleBranch(branch, isActive) {
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const { error } = await getSupabaseClient()
        .from('branches')
        .update({ is_active: isActive })
        .eq('id', branch.id)
      if (error) throw new Error(error.message)
      setSuccessMessage(`${branch.name} ${isActive ? 'opened for orders' : 'deactivated'}.`)
      setReloadKey((value) => value + 1)
    } catch (error) {
      console.error('Unable to update branch status.', error)
      setErrorMessage(error.message)
    }
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={3}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
          <Box>
            <Typography variant="overline" color="primary">Super Admin · Locations</Typography>
            <Typography variant="h2">Branches</Typography>
            <Typography color="text.secondary">Set up café locations, then assign staff and admins to their reporting branch.</Typography>
          </Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openNewBranch}>Add branch</Button>
        </Stack>
        {errorMessage && !dialogOpen && <Alert severity="error">{errorMessage}</Alert>}
        {successMessage && <Alert severity="success">{successMessage}</Alert>}
        {isLoading ? (
          <Stack sx={{ alignItems: 'center', py: 8 }}><CircularProgress /></Stack>
        ) : branches.length ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
            {branches.map((branch) => (
              <Paper key={branch.id} variant="outlined" sx={{ p: 2.5 }}>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Box>
                      <Typography variant="h6">{branch.name}</Typography>
                      <Typography color="text.secondary">{branch.address || 'No address added'}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Delivery: {branch.delivery_enabled
                          ? Number(branch.delivery_fee) > 0
                            ? formatPrice(branch.delivery_fee)
                            : 'Free'
                          : 'Off'}
                      </Typography>
                    </Box>
                    <Button size="small" startIcon={<EditIcon />} onClick={() => openEditBranch(branch)}>Edit</Button>
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {[branch.phone, branch.email].filter(Boolean).join(' · ') || 'No contact details'}
                  </Typography>
                  <FormControlLabel
                    control={<Switch checked={branch.is_active} onChange={(event) => toggleBranch(branch, event.target.checked)} />}
                    label={branch.is_active ? 'Open for orders' : 'Inactive'}
                  />
                </Stack>
              </Paper>
            ))}
          </Box>
        ) : (
          <Alert severity="info">No branches have been created. Add the first branch to configure locations and staff access.</Alert>
        )}
      </Stack>
      <Dialog
        open={dialogOpen}
        onClose={() => !isSaving && !isSavingPaymentMethod && !isSavingDiningTable && setDialogOpen(false)}
        fullWidth
        maxWidth="md"
      >
        <Box component="form" onSubmit={saveBranch}>
          <DialogTitle>{draft.id ? 'Edit branch' : 'Add branch'}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
              <TextField autoFocus label="Branch name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required slotProps={{ htmlInput: { maxLength: 120 } }} />
              <TextField label="Address" value={draft.address} onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))} multiline minRows={2} required slotProps={{ htmlInput: { maxLength: 500 } }} />
              <TextField
                label="Google Maps link (optional)"
                type="url"
                value={draft.map_url || ''}
                onChange={(event) => setDraft((current) => ({ ...current, map_url: event.target.value }))}
                placeholder="https://maps.app.goo.gl/..."
                helperText="Paste the branch's Google Maps share link. Visitors can preview the location or open it in Maps."
                slotProps={{ htmlInput: { maxLength: 2048 } }}
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField fullWidth label="Phone (optional)" value={draft.phone || ''} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} slotProps={{ htmlInput: { maxLength: 40 } }} />
                <TextField fullWidth label="Email (optional)" type="email" value={draft.email || ''} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} slotProps={{ htmlInput: { maxLength: 254 } }} />
              </Stack>
              <FormControlLabel control={<Switch checked={draft.is_active} onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))} />} label="Accepting orders" />
              <FormControlLabel
                control={<Switch checked={Boolean(draft.delivery_enabled)} onChange={(event) => setDraft((current) => ({ ...current, delivery_enabled: event.target.checked }))} />}
                label="Offer delivery"
              />
              <TextField
                label="Delivery fee (PHP)"
                type="number"
                value={draft.delivery_fee ?? '0'}
                onChange={(event) => setDraft((current) => ({ ...current, delivery_fee: event.target.value }))}
                disabled={!draft.delivery_enabled}
                slotProps={{ htmlInput: { min: '0', step: '0.01' } }}
                helperText="Set to 0 for free delivery. Delivery is off for new branches until enabled."
              />
              {draft.id && (
                <Stack spacing={2} sx={{ pt: 2, borderTop: 1, borderColor: 'divider' }}>
                  <Box>
                    <Typography variant="h6">Payment methods</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Choose which payment options customers can use at this branch. Online methods need their own QR code.
                    </Typography>
                  </Box>
                  {isLoadingPaymentMethods ? (
                    <CircularProgress size={24} />
                  ) : (
                    <Stack spacing={1}>
                      {branchPaymentMethods.map((method) => (
                        <Paper key={method.id} variant="outlined" sx={{ p: 1.5 }}>
                          <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={1.5}
                            sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
                          >
                            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                              {method.qr_code_path && (
                                <Box
                                  component="img"
                                  src={getSupabaseClient().storage.from('branch-payment-qr').getPublicUrl(method.qr_code_path).data.publicUrl}
                                  alt={`${method.name} QR`}
                                  sx={{ width: 56, height: 56, objectFit: 'contain' }}
                                />
                              )}
                              <Box>
                                <Typography fontWeight={700}>{method.name}</Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {method.settlement_type === 'provider' ? 'Online QR' : 'Pay at branch'}
                                  {' · '}{method.is_active ? 'Enabled' : 'Disabled'}
                                </Typography>
                              </Box>
                            </Stack>
                            <Stack direction="row" spacing={1}>
                              <Button
                                type="button"
                                size="small"
                                onClick={() => {
                                  setPaymentDraft({ ...method })
                                  setPaymentQrFile(null)
                                  setErrorMessage('')
                                }}
                              >
                                Edit
                              </Button>
                              {method.is_active && (
                                <Button
                                  type="button"
                                  size="small"
                                  color="error"
                                  onClick={() => void deactivatePaymentMethod(method)}
                                >
                                  Deactivate
                                </Button>
                              )}
                            </Stack>
                          </Stack>
                        </Paper>
                      ))}
                      {!branchPaymentMethods.length && (
                        <Alert severity="info">No payment methods are configured for this branch yet.</Alert>
                      )}
                    </Stack>
                  )}
                  <Box sx={{ pt: 2, borderTop: 1, borderColor: 'divider' }}>
                    <Stack spacing={1.5}>
                      <Box>
                        <Typography variant="h6">Dine-in tables</Typography>
                        <Typography variant="body2" color="text.secondary">
                          Add table names or numbers for this branch. An active dine-in order holds its table until staff completes or voids the order.
                        </Typography>
                      </Box>
                      {branchDiningTables.map((table) => {
                        const activeOrder = branchDiningTableOrders.find(
                          (order) => order.dining_table_id === table.id,
                        )
                        return (
                          <Paper key={table.id} variant="outlined" sx={{ p: 1.25 }}>
                            <Stack
                              direction={{ xs: 'column', sm: 'row' }}
                              spacing={1}
                              sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
                            >
                              <Typography fontWeight={700}>
                                {table.label} · {activeOrder ? `Occupied · ${activeOrder.order_number}` : 'Available'}
                                {!table.is_active && ' · Disabled'}
                              </Typography>
                              <Stack direction="row" spacing={1}>
                                <Button
                                  type="button"
                                  size="small"
                                  onClick={() => setDiningTableDraft({ id: table.id, label: table.label })}
                                >
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  size="small"
                                  color={table.is_active ? 'error' : 'primary'}
                                  onClick={() => void setDiningTableActive(table, !table.is_active)}
                                >
                                  {table.is_active ? 'Disable' : 'Enable'}
                                </Button>
                              </Stack>
                            </Stack>
                          </Paper>
                        )
                      })}
                      {!branchDiningTables.length && (
                        <Alert severity="info">No dine-in tables are configured for this branch.</Alert>
                      )}
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                        <TextField
                          fullWidth
                          label={diningTableDraft.id ? 'Edit table name or number' : 'New table name or number'}
                          value={diningTableDraft.label}
                          onChange={(event) => setDiningTableDraft((current) => ({
                            ...current,
                            label: event.target.value,
                          }))}
                          slotProps={{ htmlInput: { maxLength: 40 } }}
                        />
                        <Button
                          type="button"
                          variant="contained"
                          onClick={() => void saveDiningTable()}
                          disabled={isSavingDiningTable}
                          sx={{ whiteSpace: 'nowrap' }}
                        >
                          {diningTableDraft.id ? 'Save table' : 'Add table'}
                        </Button>
                        {diningTableDraft.id && (
                          <Button
                            type="button"
                            onClick={() => setDiningTableDraft({ id: '', label: '' })}
                          >
                            Cancel
                          </Button>
                        )}
                      </Stack>
                    </Stack>
                  </Box>
                  <Typography variant="subtitle1" fontWeight={700}>
                    {paymentDraft.id ? `Edit ${paymentDraft.name}` : 'Add payment method'}
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                      fullWidth
                      label="Payment method name"
                      value={paymentDraft.name}
                      onChange={(event) => setPaymentDraft((current) => ({ ...current, name: event.target.value }))}
                      placeholder="e.g. GCash, Cash, MariBank, BDO"
                      slotProps={{ htmlInput: { maxLength: 80 } }}
                    />
                    <FormControl fullWidth>
                      <InputLabel id="payment-settlement-label">Payment type</InputLabel>
                      <Select
                        labelId="payment-settlement-label"
                        label="Payment type"
                        value={paymentDraft.settlement_type}
                        onChange={(event) => setPaymentDraft((current) => ({
                          ...current,
                          settlement_type: event.target.value,
                        }))}
                      >
                        <MenuItem value="pay_at_branch">Cash / pay at branch</MenuItem>
                        <MenuItem value="provider">Online QR payment</MenuItem>
                      </Select>
                    </FormControl>
                  </Stack>
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
                        {paymentQrFile?.name || (
                          paymentDraft.qr_code_path ? 'Replace QR code' : 'Upload QR code'
                        )}
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
                        JPG, PNG, or WebP · up to 5 MB. Customers upload a payment receipt and reference; branch staff verify before marking it paid.
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
                  <Stack direction="row" spacing={1}>
                    <Button
                      type="button"
                      variant="contained"
                      onClick={() => void savePaymentMethod()}
                      disabled={isSavingPaymentMethod || isLoadingPaymentMethods}
                    >
                      {isSavingPaymentMethod ? 'Saving…' : paymentDraft.id ? 'Save payment method' : 'Add payment method'}
                    </Button>
                    {paymentDraft.id && (
                      <Button
                        type="button"
                        onClick={() => {
                          setPaymentDraft(emptyPaymentMethod)
                          setPaymentQrFile(null)
                          setErrorMessage('')
                        }}
                      >
                        Cancel edit
                      </Button>
                    )}
                  </Stack>
                </Stack>
              )}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setDialogOpen(false)} disabled={isSaving || isSavingPaymentMethod || isSavingDiningTable}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={isSaving}>{isSaving ? 'Saving…' : draft.id ? 'Save branch' : 'Create branch'}</Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Container>
  )
}
