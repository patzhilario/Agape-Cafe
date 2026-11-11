import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
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
import { getSupabaseClient } from '../../lib/supabaseClient.js'
import { useAuth } from './useAuth.js'

function getProfileForm(account) {
  return {
    username: account.username || '',
    first_name: account.first_name || '',
    last_name: account.last_name || '',
    middle_initial: account.middle_initial || '',
    display_name: account.display_name || '',
    phone: account.phone || '',
    address: account.address || '',
  }
}

function PasswordSettings() {
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '', code: '' })
  const [needsCurrentPassword, setNeedsCurrentPassword] = useState(false)
  const [needsVerificationCode, setNeedsVerificationCode] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [notice, setNotice] = useState('')

  function updateField(event) {
    const { name, value } = event.target
    setPasswords((current) => ({ ...current, [name]: value }))
    setErrorMessage('')
    setNotice('')
  }

  async function sendCode() {
    if (isSaving || isSendingCode) return
    setIsSendingCode(true)
    setErrorMessage('')
    setNotice('')
    try {
      const { error } = await getSupabaseClient().auth.reauthenticate()
      if (error) throw error
      setNotice('Check your email for a verification code, then enter it below.')
    } catch (error) {
      setErrorMessage(error.message)
    } finally {
      setIsSendingCode(false)
    }
  }

  async function savePassword(event) {
    event.preventDefault()
    if (isSaving || isSendingCode) return
    setErrorMessage('')
    setNotice('')
    if (passwords.next.length < 8) {
      setErrorMessage('Use at least 8 characters for your new password.')
      return
    }
    if (passwords.next !== passwords.confirm) {
      setErrorMessage('The new password and confirmation do not match.')
      return
    }
    setIsSaving(true)
    try {
      const attributes = { password: passwords.next }
      if (needsCurrentPassword) attributes.current_password = passwords.current
      if (needsVerificationCode) attributes.nonce = passwords.code.trim()
      const { error } = await getSupabaseClient().auth.updateUser(attributes)
      if (error) throw error
      setPasswords({ current: '', next: '', confirm: '', code: '' })
      setNeedsCurrentPassword(false)
      setNeedsVerificationCode(false)
      setNotice('Your password was changed.')
    } catch (error) {
      if (error.code === 'current_password_required' || error.code === 'current_password_mismatch') {
        setNeedsCurrentPassword(true)
        setErrorMessage('Enter your current password to confirm this change.')
      } else if (error.code === 'reauthentication_needed' || error.code === 'reauth_nonce_missing') {
        setNeedsVerificationCode(true)
        setErrorMessage('Request a verification code to confirm this password change.')
      } else {
        setErrorMessage(error.message)
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Paper component="form" aria-label="Change password" variant="outlined" onSubmit={savePassword} sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack component="fieldset" disabled={isSaving || isSendingCode} spacing={2} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
        <Typography variant="h5">Change password</Typography>
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        {needsCurrentPassword && (
          <TextField label="Current password" name="current" type="password" autoComplete="current-password"
            value={passwords.current} onChange={updateField} required />
        )}
        <TextField label="New password" name="next" type="password" autoComplete="new-password"
          value={passwords.next} onChange={updateField} required
          helperText="Use at least 8 characters." slotProps={{ htmlInput: { minLength: 8 } }} />
        <TextField label="Confirm new password" name="confirm" type="password" autoComplete="new-password"
          value={passwords.confirm} onChange={updateField} required />
        {needsVerificationCode && (
          <>
            <Button type="button" onClick={sendCode}>Send verification code</Button>
            <TextField label="Verification code" name="code" autoComplete="one-time-code"
              value={passwords.code} onChange={updateField}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }} required />
          </>
        )}
        <Button type="submit" variant="contained">{isSaving ? 'Updating password...' : 'Update password'}</Button>
        <Button component={RouterLink} to="/auth/forgot-password?next=%2Fcustomer%2Fprofile">
          Set or reset password by email
        </Button>
      </Stack>
    </Paper>
  )
}

function CustomerAccountSettings() {
  const { account, session, updateProfile } = useAuth()
  const [form, setForm] = useState(() => getProfileForm(account))
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const hasStructuredName = Boolean(account.first_name && account.last_name)
  const needsFullName = hasStructuredName || Boolean(form.first_name || form.last_name)

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setErrorMessage('')
    setSuccessMessage('')
  }

  async function saveProfile(event) {
    event.preventDefault()
    if (isSaving) return
    setErrorMessage('')
    setSuccessMessage('')
    const profile = {
      ...form,
      username: form.username.trim().toLowerCase(),
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      middle_initial: form.middle_initial.trim().toUpperCase(),
    }
    if (profile.username && !/^[a-z0-9][a-z0-9_.]{2,29}$/.test(profile.username)) {
      setErrorMessage('Use 3 to 30 letters, numbers, periods, or underscores for your username.')
      return
    }
    if (needsFullName && (!profile.first_name || !profile.last_name)) {
      setErrorMessage('Enter both your first name and last name.')
      return
    }
    if (profile.middle_initial && !/^\p{L}$/u.test(profile.middle_initial)) {
      setErrorMessage('Enter one letter for your middle initial, or leave it blank.')
      return
    }
    if (profile.first_name && profile.last_name) {
      profile.display_name = [
        profile.first_name,
        profile.middle_initial && profile.middle_initial + '.',
        profile.last_name,
      ].filter(Boolean).join(' ')
    }
    if (!profile.display_name.trim()) {
      setErrorMessage('Enter the name you want us to use for your orders.')
      return
    }

    setIsSaving(true)
    try {
      if (profile.username && profile.username !== account.username) {
        const { data, error } = await getSupabaseClient().rpc('is_username_available', {
          requested_username: profile.username,
        })
        if (error) throw new Error('We could not check your username. Please try again.')
        if (!data) throw new Error('That username is already taken. Choose another username.')
      }
      const savedAccount = await updateProfile(profile)
      setForm(getProfileForm(savedAccount))
      setSuccessMessage('Your profile was saved.')
    } catch (error) {
      setErrorMessage(error.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, md: 7 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="primary">Customer account</Typography>
          <Typography variant="h2">Account settings</Typography>
        </Box>
        <Paper component="form" aria-label="Profile details" variant="outlined" onSubmit={saveProfile} sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack component="fieldset" disabled={isSaving} spacing={2} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
            <Typography variant="h5">Personal details</Typography>
            {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
            {successMessage && <Alert severity="success">{successMessage}</Alert>}
            <TextField label="Username" name="username" autoComplete="username" value={form.username} onChange={updateField}
              required={Boolean(account.username)}
              helperText="Use 3 to 30 letters, numbers, periods, or underscores."
              slotProps={{ htmlInput: { minLength: 3, maxLength: 30, pattern: '[A-Za-z0-9][A-Za-z0-9_.]{2,29}', autoCapitalize: 'none' } }} />
            <TextField label="First name" name="first_name" autoComplete="given-name"
              value={form.first_name} onChange={updateField} required={needsFullName}
              slotProps={{ htmlInput: { maxLength: 60 } }} />
            <TextField label="Last name" name="last_name" autoComplete="family-name"
              value={form.last_name} onChange={updateField} required={needsFullName}
              slotProps={{ htmlInput: { maxLength: 60 } }} />
            <TextField label="MI (optional)" name="middle_initial" autoComplete="additional-name"
              value={form.middle_initial} onChange={updateField}
              slotProps={{ htmlInput: { maxLength: 1 } }} />
            {!hasStructuredName && (
              <TextField label="Display name" name="display_name" value={form.display_name} onChange={updateField}
                helperText="Your saved name is used until you enter both first name and last name."
                required={!needsFullName} slotProps={{ htmlInput: { maxLength: 120 } }} />
            )}
            <TextField label="Email address" value={session?.user.email || account.email || ''} disabled
              helperText={session?.user.email_confirmed_at ? 'Verified email' : 'Email verification pending'} />
            <TextField label="Phone number" name="phone" type="tel" autoComplete="tel"
              value={form.phone} onChange={updateField} required={Boolean(account.phone)}
              slotProps={{ htmlInput: { maxLength: 40 } }} />
            <TextField label="Delivery address (optional)" name="address" autoComplete="street-address"
              value={form.address} onChange={updateField} multiline minRows={3}
              slotProps={{ htmlInput: { maxLength: 500 } }} />
            <Button type="submit" variant="contained">{isSaving ? 'Saving...' : 'Save profile'}</Button>
          </Stack>
        </Paper>
        <PasswordSettings />
      </Stack>
    </Container>
  )
}

export default function CustomerProfilePage() {
  const { account } = useAuth()
  return <CustomerAccountSettings key={account.id} />
}
