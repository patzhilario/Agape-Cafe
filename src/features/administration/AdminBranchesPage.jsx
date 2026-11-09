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
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import { getSupabaseClient } from '../../lib/supabaseClient.js'
import PaginationControls from '../../components/PaginationControls.jsx'
import DeleteConfirmationDialog from '../../components/DeleteConfirmationDialog.jsx'

const DEFAULT_BRANCH_PAGE_SIZE = 10

const emptyBranch = {
  id: '',
  name: '',
  address: '',
  map_url: '',
  phone: '',
  email: '',
  is_active: true,
  delivery_enabled: false,
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
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [diningTableDialogOpen, setDiningTableDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [branchPage, setBranchPage] = useState(0)
  const [branchPageSize, setBranchPageSize] = useState(DEFAULT_BRANCH_PAGE_SIZE)
  const pageBranches = branches.slice(
    branchPage * branchPageSize,
    (branchPage + 1) * branchPageSize,
  )

  useEffect(() => {
    let active = true
    getSupabaseClient()
      .from('branches')
      .select('id, name, address, map_url, phone, email, is_active, delivery_enabled')
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
    setPaymentDialogOpen(false)
    setErrorMessage('')
    setDialogOpen(true)
  }

  function openEditBranch(branch) {
    setDraft({
      ...emptyBranch,
      ...branch,
      name: branch.name || '',
      address: branch.address || '',
      map_url: branch.map_url || '',
      phone: branch.phone || '',
      email: branch.email || '',
      is_active: Boolean(branch.is_active),
      delivery_enabled: Boolean(branch.delivery_enabled),
    })
    setBranchDiningTables([])
    setBranchDiningTableOrders([])
    setDiningTableDraft({ id: '', label: '' })
    setDiningTableDialogOpen(false)
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
      .is('deleted_at', null)
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
    setIsSaving(true)
    const payload = {
      name: (draft.name || '').trim(),
      address: (draft.address || '').trim(),
      map_url: mapUrl || null,
      phone: (draft.phone || '').trim() || null,
      email: (draft.email || '').trim() || null,
      is_active: Boolean(draft.is_active),
      delivery_enabled: Boolean(draft.delivery_enabled),
    }
    try {
      const supabase = getSupabaseClient()
      const result = draft.id
        ? await supabase.from('branches').update(payload).eq('id', draft.id).select('id').single()
        : await supabase.from('branches').insert(payload).select('id').single()
      if (result.error) throw new Error(result.error.message)
      setDialogOpen(false)
      setSuccessMessage(draft.id ? 'Branch details updated.' : 'Branch created. You can now assign staff to it.')
      if (!draft.id) setBranchPage(0)
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
        .is('deleted_at', null)
        .order('label')
      if (error) throw new Error(error.message)
      setBranchDiningTables(data)
      setDiningTableDialogOpen(false)
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

  function requestDelete(type, record) {
    setErrorMessage('')
    setDeleteTarget({ type, record })
  }

  async function deleteBranch() {
    if (!deleteTarget || deleteTarget.type !== 'branch') return
    const branch = deleteTarget.record
    setIsDeleting(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const { data: paymentMethods, error: paymentMethodsError } = await getSupabaseClient()
        .from('payment_methods')
        .select('qr_code_path')
        .eq('branch_id', branch.id)
      if (paymentMethodsError) throw new Error(paymentMethodsError.message)

      const { data, error } = await getSupabaseClient()
        .from('branches')
        .delete()
        .eq('id', branch.id)
        .select('id')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new Error('This branch no longer exists. Refresh the page and try again.')

      setDeleteTarget(null)
      setSuccessMessage(`${branch.name} was permanently deleted.`)
      setReloadKey((value) => value + 1)
      const qrPaths = paymentMethods.map(({ qr_code_path }) => qr_code_path).filter(Boolean)
      if (qrPaths.length) {
        const { error: storageError } = await getSupabaseClient()
          .storage
          .from('branch-payment-qr')
          .remove(qrPaths)
        if (storageError) {
          console.error('Branch was deleted, but its payment QR images could not be removed.', storageError)
          setErrorMessage(`Branch was deleted, but its payment QR images could not be removed from storage: ${storageError.message}`)
        }
      }
    } catch (error) {
      console.error('Unable to delete branch.', error)
      setErrorMessage(error.message)
    } finally {
      setIsDeleting(false)
    }
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
      console.error('Unable to delete branch payment method.', error)
      setErrorMessage(error.message)
    } finally {
      setIsDeleting(false)
    }
  }

  async function deleteDiningTable() {
    if (!deleteTarget || deleteTarget.type !== 'dining_table') return
    const table = deleteTarget.record
    setIsDeleting(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const { error } = await getSupabaseClient().rpc('delete_branch_dining_table', {
        target_table_id: table.id,
        target_branch_id: draft.id,
      })
      if (error) throw new Error(error.message)
      setBranchDiningTables((current) => current.filter((entry) => entry.id !== table.id))
      setDeleteTarget(null)
      setSuccessMessage(`${table.label} was removed. Past orders keep their table details.`)
    } catch (error) {
      console.error('Unable to delete branch dining table.', error)
      setErrorMessage(error.message)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={3}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 1.5, md: 2 }} sx={{ justifyContent: 'space-between', alignItems: { md: 'center' } }}>
          <Box>
            <Typography variant="overline" color="primary">Super Admin · Locations</Typography>
            <Typography variant="h2">Branches</Typography>
            <Typography color="text.secondary">Set up café locations, then assign staff and admins to their reporting branch.</Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={openNewBranch}
            sx={{ alignSelf: { xs: 'stretch', md: 'auto' }, minHeight: 42 }}
          >
            Add branch
          </Button>
        </Stack>
        {errorMessage && !dialogOpen && <Alert severity="error">{errorMessage}</Alert>}
        {successMessage && <Alert severity="success">{successMessage}</Alert>}
        {isLoading ? (
          <Stack sx={{ alignItems: 'center', py: 8 }}><CircularProgress /></Stack>
        ) : branches.length ? (
          <>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small" aria-label="Branches" sx={{ minWidth: 850 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Branch</TableCell>
                    <TableCell>Address</TableCell>
                    <TableCell>Contact</TableCell>
                    <TableCell>Delivery</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pageBranches.map((branch) => (
                    <TableRow key={branch.id} hover>
                      <TableCell sx={{ fontWeight: 700 }}>{branch.name}</TableCell>
                      <TableCell>{branch.address || '—'}</TableCell>
                      <TableCell>{[branch.phone, branch.email].filter(Boolean).join(' · ') || '—'}</TableCell>
                      <TableCell>{branch.delivery_enabled ? 'Available' : 'Off'}</TableCell>
                      <TableCell>
                        <FormControlLabel
                          control={<Switch size="small" checked={branch.is_active} onChange={(event) => toggleBranch(branch, event.target.checked)} />}
                          label={branch.is_active ? 'Open' : 'Inactive'}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                          <Button size="small" startIcon={<EditIcon />} onClick={() => openEditBranch(branch)}>Edit</Button>
                          <Button
                            size="small"
                            color="error"
                            onClick={() => requestDelete('branch', branch)}
                            disabled={isDeleting}
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
            <PaginationControls
              page={branchPage}
              pageSize={branchPageSize}
              totalItems={branches.length}
              hasNextPage={(branchPage + 1) * branchPageSize < branches.length}
              isLoading={isLoading}
              onChange={(nextPage, nextPageSize) => {
                setBranchPage(nextPage)
                setBranchPageSize(nextPageSize)
              }}
            />
          </>
        ) : (
          <Alert severity="info">No branches have been created. Add the first branch to configure locations and staff access.</Alert>
        )}
      </Stack>
      <Dialog
        open={dialogOpen}
        onClose={() => !isSaving && !isSavingPaymentMethod && !isSavingDiningTable && setDialogOpen(false)}
        disableRestoreFocus
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
                    <Stack spacing={1.5}>
                      {branchPaymentMethods.length ? (
                        <TableContainer component={Paper} variant="outlined">
                          <Table size="small" aria-label="Branch payment methods" sx={{ minWidth: 600 }}>
                            <TableHead>
                              <TableRow>
                                <TableCell>Method</TableCell>
                                <TableCell>Type</TableCell>
                                <TableCell>Status</TableCell>
                                <TableCell align="right">Actions</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {branchPaymentMethods.map((method) => (
                                <TableRow key={method.id} hover>
                                  <TableCell>
                                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                      {method.qr_code_path && (
                                        <Box
                                          component="img"
                                          src={getSupabaseClient().storage.from('branch-payment-qr').getPublicUrl(method.qr_code_path).data.publicUrl}
                                          alt={`${method.name} QR`}
                                          sx={{ width: 36, height: 36, objectFit: 'contain' }}
                                        />
                                      )}
                                      <Typography fontWeight={700}>{method.name}</Typography>
                                    </Stack>
                                  </TableCell>
                                  <TableCell>{method.settlement_type === 'provider' ? 'Online QR' : 'Pay at branch'}</TableCell>
                                  <TableCell>{method.is_active ? 'Enabled' : 'Disabled'}</TableCell>
                                  <TableCell align="right">
                                    <Button
                                      type="button"
                                      size="small"
                                      onClick={() => {
                                        setPaymentDraft({ ...method })
                                        setPaymentQrFile(null)
                                        setErrorMessage('')
                                        setPaymentDialogOpen(true)
                                      }}
                                    >
                                      Edit
                                    </Button>
                                    {method.is_active && (
                                      <Button type="button" size="small" color="error" onClick={() => void deactivatePaymentMethod(method)}>
                                        Deactivate
                                      </Button>
                                    )}
                                    <Button
                                      type="button"
                                      size="small"
                                      color="error"
                                      onClick={() => requestDelete('payment_method', method)}
                                      disabled={isDeleting}
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
                        <Alert severity="info">No payment methods are configured for this branch yet.</Alert>
                      )}
                      <Button
                        type="button"
                        variant="outlined"
                        sx={{ alignSelf: 'flex-start' }}
                        onClick={() => {
                          setPaymentDraft(emptyPaymentMethod)
                          setPaymentQrFile(null)
                          setErrorMessage('')
                          setPaymentDialogOpen(true)
                        }}
                      >
                        Add payment method
                      </Button>
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
                      {branchDiningTables.length ? (
                        <TableContainer component={Paper} variant="outlined">
                          <Table size="small" aria-label="Branch dining tables" sx={{ minWidth: 540 }}>
                            <TableHead>
                              <TableRow>
                                <TableCell>Table</TableCell>
                                <TableCell>Occupancy</TableCell>
                                <TableCell>Status</TableCell>
                                <TableCell align="right">Actions</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {branchDiningTables.map((table) => {
                                const activeOrder = branchDiningTableOrders.find(
                                  (order) => order.dining_table_id === table.id,
                                )
                                return (
                                  <TableRow key={table.id} hover>
                                    <TableCell sx={{ fontWeight: 700 }}>{table.label}</TableCell>
                                    <TableCell>{activeOrder ? `Occupied · ${activeOrder.order_number}` : 'Available'}</TableCell>
                                    <TableCell>{table.is_active ? 'Enabled' : 'Disabled'}</TableCell>
                                    <TableCell align="right">
                                      <Button
                                        type="button"
                                        size="small"
                                        onClick={() => {
                                          setDiningTableDraft({ id: table.id, label: table.label })
                                          setDiningTableDialogOpen(true)
                                        }}
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
                                      <Button
                                        type="button"
                                        size="small"
                                        color="error"
                                        onClick={() => requestDelete('dining_table', table)}
                                        disabled={isDeleting}
                                      >
                                        Delete
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                )
                              })}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      ) : (
                        <Alert severity="info">No dine-in tables are configured for this branch.</Alert>
                      )}
                      <Button
                        type="button"
                        variant="outlined"
                        sx={{ alignSelf: 'flex-start' }}
                        onClick={() => {
                          setDiningTableDraft({ id: '', label: '' })
                          setDiningTableDialogOpen(true)
                        }}
                      >
                        Add dining table
                      </Button>
                    </Stack>
                  </Box>
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
                placeholder="e.g. GCash, Cash, MariBank, BDO"
                required
                slotProps={{ htmlInput: { maxLength: 80 } }}
              />
              <FormControl>
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
            <Button type="submit" variant="contained" disabled={isSavingPaymentMethod || isLoadingPaymentMethods}>
              {isSavingPaymentMethod ? 'Saving…' : paymentDraft.id ? 'Save payment method' : 'Add payment method'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
      <Dialog
        open={diningTableDialogOpen}
        onClose={() => !isSavingDiningTable && setDiningTableDialogOpen(false)}
        disableRestoreFocus
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{diningTableDraft.id ? 'Edit dining table' : 'Add dining table'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            sx={{ mt: 1 }}
            label="Table name or number"
            value={diningTableDraft.label}
            onChange={(event) => setDiningTableDraft((current) => ({
              ...current,
              label: event.target.value,
            }))}
            slotProps={{ htmlInput: { maxLength: 40 } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDiningTableDialogOpen(false)} disabled={isSavingDiningTable}>Cancel</Button>
          <Button variant="contained" onClick={() => void saveDiningTable()} disabled={isSavingDiningTable}>
            {isSavingDiningTable ? 'Saving…' : diningTableDraft.id ? 'Save table' : 'Add table'}
          </Button>
        </DialogActions>
      </Dialog>
      <DeleteConfirmationDialog
        open={Boolean(deleteTarget)}
        permanent={deleteTarget?.type !== 'dining_table'}
        title={deleteTarget?.type === 'branch'
          ? 'Permanently delete branch?'
          : deleteTarget?.type === 'payment_method'
            ? 'Permanently delete payment method?'
            : 'Remove dining table?'}
        itemName={deleteTarget?.type === 'branch'
          ? deleteTarget.record.name
          : deleteTarget?.type === 'payment_method'
            ? deleteTarget.record.name
            : deleteTarget?.record.label}
        itemType={deleteTarget?.type === 'branch'
          ? 'branch'
          : deleteTarget?.type === 'payment_method'
            ? 'payment method'
            : 'dining table'}
        detail={deleteTarget?.type === 'branch'
          ? 'Its payment methods, QR codes, dining tables, and branch-specific menu/stock settings will also be removed. Branches referenced by orders, staff assignments, or financial records are protected and cannot be deleted.'
          : deleteTarget?.type === 'payment_method'
            ? 'Past payments keep their transaction details. This payment method will no longer be available.'
            : 'This table will be removed from the table list and cannot be selected for new orders. Past orders keep their table details. Complete or cancel any ongoing order first.'}
        warning={deleteTarget?.type === 'dining_table'
          ? 'This table cannot be restored from this screen.'
          : 'Permanent deletion cannot be undone.'}
        errorMessage={errorMessage}
        isDeleting={isDeleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget?.type === 'branch') void deleteBranch()
          else if (deleteTarget?.type === 'payment_method') void deletePaymentMethod()
          else if (deleteTarget?.type === 'dining_table') void deleteDiningTable()
        }}
      />
    </Container>
  )
}
