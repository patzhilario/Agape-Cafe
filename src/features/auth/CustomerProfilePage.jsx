import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Container,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useAuth } from './useAuth.js'

export default function CustomerProfilePage() {
  const { account, updateProfile } = useAuth()
  const [form, setForm] = useState({
    display_name: account.display_name || '',
    phone: account.phone || '',
    address: account.address || '',
  })
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setForm({
      display_name: account.display_name || '',
      phone: account.phone || '',
      address: account.address || '',
    })
  }, [account])

  async function saveProfile(event) {
    event.preventDefault()
    setErrorMessage('')
    setSuccessMessage('')
    if (!form.display_name.trim()) {
      setErrorMessage('Enter the name you want us to use for your orders.')
      return
    }
    setIsSaving(true)
    try {
      await updateProfile(form)
      setSuccessMessage('Your profile was saved.')
    } catch (error) {
      console.error('Unable to update customer profile.', error)
      setErrorMessage(error.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, md: 7 } }}>
      <Paper component="form" variant="outlined" onSubmit={saveProfile} sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="overline" color="primary">Customer account</Typography>
            <Typography variant="h2">My profile</Typography>
            <Typography color="text.secondary">
              Update your name, contact number, and saved delivery address.
            </Typography>
          </Box>
          {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
          {successMessage && <Alert severity="success">{successMessage}</Alert>}
          <TextField
            label="Display name"
            value={form.display_name}
            onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))}
            required
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
          <TextField label="Email" value={account.email || ''} disabled />
          <TextField
            label="Phone"
            value={form.phone}
            onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
            autoComplete="tel"
            slotProps={{ htmlInput: { maxLength: 40 } }}
          />
          <TextField
            label="Delivery address (optional)"
            value={form.address}
            onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
            autoComplete="street-address"
            multiline
            minRows={3}
            helperText="You can save an address here, then confirm or edit it when choosing delivery."
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          <Button type="submit" variant="contained" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save profile'}
          </Button>
        </Stack>
      </Paper>
    </Container>
  )
}
