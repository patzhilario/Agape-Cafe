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
  FormControlLabel,
  Paper,
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
  gcash_qr_path: '',
  delivery_enabled: false,
  delivery_fee: '0',
}

export default function AdminBranchesPage() {
  const [branches, setBranches] = useState([])
  const [draft, setDraft] = useState(emptyBranch)
  const [qrFile, setQrFile] = useState(null)
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
      .select('id, name, address, map_url, phone, email, is_active, gcash_qr_path, delivery_enabled, delivery_fee')
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
    setQrFile(null)
    setErrorMessage('')
    setDialogOpen(true)
  }

  function openEditBranch(branch) {
    setDraft({ ...branch })
    setQrFile(null)
    setErrorMessage('')
    setDialogOpen(true)
  }

  async function saveBranch(event) {
    event.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')
    if (qrFile && qrFile.size > 5 * 1024 * 1024) {
      setErrorMessage('The branch QR image must be 5 MB or smaller.')
      return
    }
    if (qrFile && !['image/jpeg', 'image/png', 'image/webp'].includes(qrFile.type)) {
      setErrorMessage('Use a JPG, PNG, or WebP image for the branch QR.')
      return
    }
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
        ? await supabase.from('branches').update(payload).eq('id', draft.id).select('id, gcash_qr_path').single()
        : await supabase.from('branches').insert(payload).select('id, gcash_qr_path').single()
      if (result.error) throw new Error(result.error.message)
      const savedBranch = result.data
      if (qrFile) {
        const oldQrPath = savedBranch.gcash_qr_path
        const qrPath = `branches/${savedBranch.id}/${crypto.randomUUID()}-${qrFile.name.replace(/[^a-zA-Z0-9.-]/g, '-')}`
        const { error: uploadError } = await supabase.storage
          .from('branch-payment-qr')
          .upload(qrPath, qrFile, { contentType: qrFile.type, cacheControl: '3600', upsert: false })
        if (uploadError) {
          throw new Error(`Branch details saved, but the QR upload failed: ${uploadError.message}`)
        }
        const { error: pathError } = await supabase
          .from('branches')
          .update({ gcash_qr_path: qrPath })
          .eq('id', savedBranch.id)
        if (pathError) {
          const { error: cleanupError } = await supabase.storage.from('branch-payment-qr').remove([qrPath])
          if (cleanupError) console.error('Unable to remove the unlinked branch QR code.', cleanupError)
          throw new Error(`Branch details saved, but its QR path could not be saved: ${pathError.message}`)
        }
        if (oldQrPath) {
          const { error: deleteError } = await supabase.storage.from('branch-payment-qr').remove([oldQrPath])
          if (deleteError) console.error('Unable to remove the replaced branch QR code.', deleteError)
        }
      }
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
                      {branch.gcash_qr_path && (
                        <Box
                          component="img"
                          src={getSupabaseClient().storage.from('branch-payment-qr').getPublicUrl(branch.gcash_qr_path).data.publicUrl}
                          alt={`${branch.name} GCash QR`}
                          sx={{ width: 144, height: 144, objectFit: 'contain', border: 1, borderColor: 'divider', borderRadius: 1, p: 1 }}
                        />
                      )}
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
      <Dialog open={dialogOpen} onClose={() => !isSaving && setDialogOpen(false)} fullWidth maxWidth="sm">
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
              <Button
                component="label"
                variant="outlined"
                sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
              >
                {qrFile?.name || (draft.gcash_qr_path ? 'Replace GCash QR code' : 'Upload GCash QR code (optional)')}
                <input
                  hidden
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) setQrFile(file)
                    event.target.value = ''
                  }}
                />
              </Button>
              <Typography variant="caption" color="text.secondary">
                Customers see this branch’s QR during GCash checkout. Use a clear JPG, PNG, or WebP image up to 5 MB.
              </Typography>
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
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setDialogOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={isSaving}>{isSaving ? 'Saving…' : draft.id ? 'Save branch' : 'Create branch'}</Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Container>
  )
}
