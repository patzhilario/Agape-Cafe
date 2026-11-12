import { useRef, useState } from 'react'
import { Link as RouterLink, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Container,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { getSupabaseClient } from '../../lib/supabaseClient.js'
import { GoogleOneTap } from './GoogleOneTap.jsx'
import { PasswordField } from './PasswordField.jsx'
import { useAuth } from './useAuth.js'
import DataPolicyDialog, { DATA_POLICY_VERSION } from './DataPolicyDialog.jsx'

function LoadingState({ label }) {
  return (
    <Stack sx={{ alignItems: 'center', py: 8 }} spacing={2}>
      <CircularProgress />
      <Typography color="text.secondary">{label}</Typography>
    </Stack>
  )
}

function getPostSignInPath(account, requestedPath) {
  return /^\/(?:admin|customer)(?:[/?#]|$)/.test(requestedPath)
    ? requestedPath
    : account.homePath
}

function getGoogleProfile(credential) {
  // These claims only prefill editable fields. Supabase verifies the signup email separately.
  const payload = credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))
  const { given_name, family_name, email } = JSON.parse(new TextDecoder().decode(bytes))
  return {
    firstName: typeof given_name === 'string' ? given_name.slice(0, 60) : '',
    lastName: typeof family_name === 'string' ? family_name.slice(0, 60) : '',
    email: typeof email === 'string' ? email : '',
  }
}

function AuthForm({ title, children, onSubmit }) {
  return (
    <Container maxWidth="sm" sx={{ py: { xs: 6, md: 10 } }}>
      <Paper component="form" variant="outlined" onSubmit={onSubmit} sx={{ p: { xs: 3, sm: 5 } }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="overline" color="primary">Agapé Café account</Typography>
            <Typography variant="h2">{title}</Typography>
          </Box>
          {children}
        </Stack>
      </Paper>
    </Container>
  )
}

function getAuthErrorMessage(error) {
  if (error.code === 'email_address_not_authorized') {
    return 'We could not send a verification email to this address. Please contact the cafe for help.'
  }
  if (error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit') {
    return 'Too many requests. Please wait before requesting another email.'
  }
  return error.message || 'The request could not be completed. Please try again.'
}

function CredentialsPage({ isSignUp = false, isRecovery = false }) {
  const { account, authError, configurationError, isConfigured, isLoading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const signUpResult = !isSignUp && !isRecovery ? location.state?.signUpResult : null
  const [searchParams] = useSearchParams()
  const [form, setForm] = useState({
    username: '',
    firstName: '',
    lastName: '',
    middleInitial: '',
    email: signUpResult?.email || '',
    password: '',
    phone: '',
  })
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState(signUpResult?.notice || '')
  const [needsVerification, setNeedsVerification] = useState(Boolean(signUpResult?.needsVerification))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const [policyOpen, setPolicyOpen] = useState(false)
  const requestInFlight = useRef(false)
  const nextPath = searchParams.get('next') || '/'
  const nextQuery = new URLSearchParams({ next: nextPath }).toString()
  const signInPath = `/auth/sign-in?${nextQuery}`
  const signUpPath = `/auth/sign-up?${nextQuery}`

  if (isLoading) return <LoadingState label="Checking your session…" />
  if (account && !isRecovery) return <Navigate to={getPostSignInPath(account, nextPath)} replace />

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    if (name === 'email') setNeedsVerification(false)
    setNotice('')
  }

  async function submit(event) {
    event.preventDefault()
    if (requestInFlight.current || !isConfigured) return
    const email = form.email.trim()
    const username = form.username.trim().toLowerCase()
    const firstName = form.firstName.trim()
    const lastName = form.lastName.trim()
    const middleInitial = form.middleInitial.trim().toUpperCase()
    const phone = form.phone.trim()
    setFormError('')
    setNotice('')
    if (isSignUp) {
      setNeedsVerification(false)
      if (!policyAccepted) {
        setFormError('Read and agree to the Data Policy before creating an account.')
        return
      }
      if (!/^[a-z0-9][a-z0-9_.]{2,29}$/.test(username)) {
        setFormError('Use 3 to 30 letters, numbers, periods, or underscores for your username. Start with a letter or number.')
        return
      }
      if (!firstName || !lastName || !phone) {
        setFormError('Enter your first name, last name, and phone number.')
        return
      }
      if (middleInitial && !/^\p{L}$/u.test(middleInitial)) {
        setFormError('Enter one letter for your middle initial, or leave it blank.')
        return
      }
    }

    requestInFlight.current = true
    setIsSubmitting(true)
    try {
      const { auth } = getSupabaseClient()
      if (isRecovery) {
        const redirectTo = new URL('/auth/update-password', window.location.origin)
        redirectTo.search = nextQuery
        const { error } = await auth.resetPasswordForEmail(email, { redirectTo: redirectTo.href })
        if (error) throw error
        setNotice('Check your inbox for a link to set your password.')
      } else if (isSignUp) {
        const { data: isAvailable, error: availabilityError } = await getSupabaseClient().rpc(
          'is_username_available',
          { requested_username: username },
        )
        if (availabilityError) throw new Error('We could not check your username. Please try again.')
        if (!isAvailable) throw new Error('That username is already taken. Choose another username.')
        const redirectTo = new URL('/auth/callback', window.location.origin)
        redirectTo.search = nextQuery
        const { data, error } = await auth.signUp({
          email,
          password: form.password,
          options: {
            emailRedirectTo: redirectTo.href,
            data: {
              username,
              first_name: firstName,
              last_name: lastName,
              middle_initial: middleInitial,
              full_name: [firstName, middleInitial && middleInitial + '.', lastName].filter(Boolean).join(' '),
              signup_phone: phone,
              data_policy_version: DATA_POLICY_VERSION,
              data_policy_accepted_at: new Date().toISOString(),
            },
          },
        })
        if (error) throw error
        if (!data.session) {
          setForm((current) => ({ ...current, password: '' }))
          const canVerify = data.user?.identities?.length !== 0
          navigate(signInPath, {
            replace: true,
            state: {
              signUpResult: {
                email,
                needsVerification: canVerify,
                notice: canVerify
                  ? `Verification requested for ${email}. Check your Inbox and Spam folders, then verify your email before logging in.`
                  : 'This email may already be registered. Try logging in or setting your password.',
              },
            },
          })
        }
      } else {
        if (email.includes('@')) {
          const { error } = await auth.signInWithPassword({ email, password: form.password })
          if (error) throw error
        } else {
          const supabase = getSupabaseClient()
          const { data, error } = await supabase.functions.invoke('sign-in-with-username', {
            body: { username: email, password: form.password },
          })
          if (error) {
            const status = error.context?.status
            if (status === 429) {
              throw new Error('Too many login attempts. Please wait before trying again.')
            }
            if (status === 400 || status === 401) {
              throw new Error('Could not log in. Check your username and password, and verify your email before logging in.')
            }
            throw new Error('Username login is currently unavailable. Please use your email address to log in.')
          }
          if (!data?.access_token || !data?.refresh_token) {
            throw new Error('Username login is currently unavailable. Please use your email address to log in.')
          }
          const { error: sessionError } = await auth.setSession(data)
          if (sessionError) throw sessionError
        }
      }
    } catch (error) {
      if (error.code === 'email_not_confirmed') setNeedsVerification(true)
      setFormError(isSignUp && error.status === 504
        ? 'Sign-up timed out, so account creation could not be confirmed. Please submit the Sign Up form again shortly.'
        : getAuthErrorMessage(error))
    } finally {
      requestInFlight.current = false
      setIsSubmitting(false)
    }
  }

  async function resendVerification() {
    if (requestInFlight.current || !isConfigured) return
    const email = form.email.trim()
    setFormError('')
    setNotice('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError('Enter the email address you used to sign up, then request a new verification email.')
      return
    }

    requestInFlight.current = true
    setIsSubmitting(true)
    try {
      const redirectTo = new URL('/auth/callback', window.location.origin)
      redirectTo.search = nextQuery
      const { error } = await getSupabaseClient().auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: redirectTo.href },
      })
      if (error) throw error
      setNeedsVerification(true)
      setNotice(`Verification requested for ${email}. Check your Inbox and Spam folders. If you have already verified this email, log in.`)
    } catch (error) {
      setFormError(getAuthErrorMessage(error))
    } finally {
      requestInFlight.current = false
      setIsSubmitting(false)
    }
  }

  async function startGoogleRedirect() {
    if (requestInFlight.current || !isConfigured) return
    requestInFlight.current = true
    setIsSubmitting(true)
    setFormError('')
    try {
      const redirectTo = new URL('/auth/callback', window.location.origin)
      redirectTo.search = nextQuery
      const { error } = await getSupabaseClient().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectTo.href, queryParams: { prompt: 'select_account' } },
      })
      if (error) throw error
    } catch {
      setFormError('Google sign-in could not be started. You can continue with email.')
      requestInFlight.current = false
      setIsSubmitting(false)
    }
  }

  async function continueWithGoogle(credential, nonce) {
    if (requestInFlight.current || !isConfigured) return
    setFormError('')
    setNotice('')
    if (isSignUp) {
      try {
        const { firstName, lastName, email } = getGoogleProfile(credential)
        setForm((current) => ({
          ...current,
          firstName: firstName || current.firstName,
          lastName: lastName || current.lastName,
          email: email || current.email,
        }))
      } catch {
        setFormError('Google could not fill in your details. Enter them below.')
      }
      return
    }

    requestInFlight.current = true
    setIsSubmitting(true)
    try {
      const { error } = await getSupabaseClient().auth.signInWithIdToken({ provider: 'google', token: credential, nonce })
      if (error) throw error
    } catch {
      setFormError('Google sign-in could not be completed. If you are new here, create an account first.')
    } finally {
      requestInFlight.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <AuthForm title={isSignUp ? 'Create an account' : isRecovery ? 'Set or reset your password' : 'Log in'} onSubmit={submit}>
      {(configurationError || formError || authError) && (
        <Alert severity="error">{configurationError || formError || authError}</Alert>
      )}
      {notice && <Alert severity={needsVerification ? 'info' : 'success'}>{notice}</Alert>}
      {!isRecovery && isConfigured && import.meta.env.VITE_GOOGLE_CLIENT_ID && (
        <>
          <GoogleOneTap disabled={isSubmitting} isSignUp={isSignUp} onCredential={continueWithGoogle} />
          {isSignUp && (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
              Use Google to fill in your name and email.
            </Typography>
          )}
          <Divider>or use email</Divider>
        </>
      )}
      {!isSignUp && !isRecovery && isConfigured && !import.meta.env.VITE_GOOGLE_CLIENT_ID && (
        <>
          <Button variant="outlined" onClick={startGoogleRedirect} disabled={isSubmitting}>
            Continue with Google
          </Button>
          <Divider>or use email</Divider>
        </>
      )}
      {isSignUp && (
        <>
          <TextField
            label="Username"
            name="username"
            autoComplete="username"
            value={form.username}
            onChange={updateField}
            helperText="3 to 30 letters, numbers, periods, or underscores."
            slotProps={{ htmlInput: { minLength: 3, maxLength: 30, pattern: '[A-Za-z0-9][A-Za-z0-9_.]{2,29}', autoCapitalize: 'none' } }}
            required
          />
          <TextField
            label="First name"
            name="firstName"
            autoComplete="given-name"
            value={form.firstName}
            onChange={updateField}
            slotProps={{ htmlInput: { maxLength: 60 } }}
            required
          />
          <TextField
            label="Last name"
            name="lastName"
            autoComplete="family-name"
            value={form.lastName}
            onChange={updateField}
            slotProps={{ htmlInput: { maxLength: 60 } }}
            required
          />
          <TextField
            label="MI (optional)"
            name="middleInitial"
            autoComplete="additional-name"
            value={form.middleInitial}
            onChange={updateField}
            slotProps={{ htmlInput: { maxLength: 1 } }}
          />
        </>
      )}
      <TextField
        label={isSignUp || isRecovery ? 'Email address' : 'Email or username'}
        name="email"
        type={isSignUp || isRecovery ? 'email' : 'text'}
        autoComplete={isSignUp || isRecovery ? 'email' : 'username'}
        value={form.email}
        onChange={updateField}
        slotProps={{ htmlInput: { maxLength: 254, autoCapitalize: 'none' } }}
        required
      />
      {!isRecovery && (
        <PasswordField label="Password" name="password"
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          value={form.password} onChange={updateField} required
          helperText={isSignUp ? 'Use at least 8 characters.' : undefined}
          slotProps={{ htmlInput: { minLength: isSignUp ? 8 : undefined } }} />
      )}
      {isSignUp && (
        <TextField
          label="Phone number"
          name="phone"
          type="tel"
          autoComplete="tel"
          value={form.phone}
          onChange={updateField}
          slotProps={{ htmlInput: { maxLength: 40 } }}
          required
        />
      )}
      {isSignUp && (
        <>
          <FormControlLabel
            sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: '.875rem' } }}
            control={<Checkbox name="dataPolicyAccepted" checked={policyAccepted} onChange={() => setPolicyOpen(true)} required disabled={isSubmitting} slotProps={{ input: { 'aria-haspopup': 'dialog' } }} />}
            label="I agree to the Data Policy."
          />
          <DataPolicyDialog open={policyOpen} onClose={() => setPolicyOpen(false)} accepted={policyAccepted} onAcceptedChange={setPolicyAccepted} />
          <Typography variant="body2" color="text.secondary">
            We will email you a verification link. Verify your email before logging in.
          </Typography>
        </>
      )}
      <Button type="submit" variant="contained" size="large" disabled={!isConfigured || isSubmitting}>
        {isSignUp ? 'Sign Up' : isRecovery ? 'Send password link' : 'Log in'}
      </Button>
      {!isRecovery && needsVerification && (
        <Button onClick={resendVerification} disabled={!isConfigured || isSubmitting}>
          Resend verification email
        </Button>
      )}
      {!isSignUp && !isRecovery && (
        <Button component={RouterLink} to={`/auth/forgot-password?${nextQuery}`}>Set or reset password</Button>
      )}
      <Button component={RouterLink} to={isSignUp || isRecovery ? signInPath : signUpPath} variant={isSignUp || isRecovery ? 'text' : 'outlined'}>
        {isSignUp || isRecovery ? 'Back to log in' : 'Sign up'}
      </Button>
    </AuthForm>
  )
}

export function AuthPage() {
  return <CredentialsPage />
}

export function AuthSignUpPage() {
  return <CredentialsPage isSignUp />
}

export function AuthPasswordRequestPage() {
  return <CredentialsPage isRecovery />
}

export function AuthPasswordUpdatePage() {
  const { account, isLoading, session } = useAuth()
  const [searchParams] = useSearchParams()
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const nextPath = searchParams.get('next') || '/'
  const nextQuery = new URLSearchParams({ next: nextPath }).toString()

  if (isLoading) return <LoadingState label="Checking your password link…" />
  if (isSaved && account) return <Navigate to={getPostSignInPath(account, nextPath)} replace />
  if (!session) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Alert severity="error" sx={{ mb: 3 }}>This password link is invalid or has expired.</Alert>
        <Button component={RouterLink} to={`/auth/forgot-password?${nextQuery}`}>Request a new link</Button>
      </Container>
    )
  }

  async function savePassword(event) {
    event.preventDefault()
    setErrorMessage('')
    setIsSaving(true)
    try {
      const { error } = await getSupabaseClient().auth.updateUser({ password })
      if (error) throw error
      setIsSaved(true)
    } catch (error) {
      setErrorMessage(error.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <AuthForm title="Set your password" onSubmit={savePassword}>
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
      {isSaved && (
        <Alert severity="success">
          Your password was saved. <RouterLink to="/auth/sign-in">Return to log in</RouterLink>
        </Alert>
      )}
      <PasswordField label="New password" autoComplete="new-password" required
        helperText="Use at least 8 characters." slotProps={{ htmlInput: { minLength: 8 } }}
        value={password} onChange={(event) => setPassword(event.target.value)} />
      <Button type="submit" variant="contained" disabled={isSaving || isSaved}>Save password</Button>
    </AuthForm>
  )
}

export function AuthCallbackPage() {
  const { account, authError, isConfigured, isLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const callbackError =
    searchParams.get('error_description') ||
    fragment.get('error_description') ||
    searchParams.get('error') ||
    fragment.get('error') ||
    searchParams.get('message') ||
    ''
  const requestedPath = searchParams.get('next') || '/'
  const safeNextPath =
    requestedPath.startsWith('/') && !requestedPath.startsWith('//')
      ? requestedPath
      : '/'

  if (account) return <Navigate to={getPostSignInPath(account, safeNextPath)} replace />
  if (!isConfigured || callbackError || authError) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          {callbackError || authError || 'Supabase is not configured.'}
        </Alert>
        <Stack direction="row" spacing={2}>
          <Button component={RouterLink} to={`/auth/sign-in?next=${encodeURIComponent(safeNextPath)}`} variant="contained">
            Return to log in
          </Button>
          <Button component={RouterLink} to={`/auth/sign-up?next=${encodeURIComponent(safeNextPath)}`}>
            Sign up
          </Button>
        </Stack>
      </Container>
    )
  }
  if (isLoading) return <LoadingState label="Completing secure sign-in…" />

  return <Navigate to={`/auth/sign-in?next=${encodeURIComponent(safeNextPath)}`} replace />
}

export function AuthErrorPage() {
  const { authError } = useAuth()
  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Alert severity="error" sx={{ mb: 3 }}>
        {authError || 'Sign-in was cancelled or could not be completed.'}
      </Alert>
      <Button component={RouterLink} to="/auth/sign-in" variant="contained">
        Try signing in again
      </Button>
    </Container>
  )
}
