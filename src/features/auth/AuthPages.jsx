import { useState } from 'react'
import { Link as RouterLink, Navigate, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import GoogleIcon from '@mui/icons-material/Google'
import { useAuth } from './useAuth.js'

function LoadingState({ label }) {
  return (
    <Stack sx={{ alignItems: 'center', py: 8 }} spacing={2}>
      <CircularProgress />
      <Typography color="text.secondary">{label}</Typography>
    </Stack>
  )
}

function getPostSignInPath(account, requestedPath) {
  const isLocalPath =
    requestedPath.startsWith('/') && !requestedPath.startsWith('//')
  if (
    isLocalPath &&
    (requestedPath.startsWith('/admin') || requestedPath.startsWith('/customer'))
  ) {
    return requestedPath
  }
  return account.homePath
}

export function AuthPage() {
  const {
    account,
    authError,
    configurationError,
    isConfigured,
    isLoading,
    signInWithGoogle,
  } = useAuth()
  const [searchParams] = useSearchParams()
  const [signInError, setSignInError] = useState('')
  const [isStartingSignIn, setIsStartingSignIn] = useState(false)
  const nextPath = searchParams.get('next') || '/'

  if (isLoading) return <LoadingState label="Checking your session…" />
  if (account) return <Navigate to={getPostSignInPath(account, nextPath)} replace />

  async function startGoogleSignIn() {
    setSignInError('')
    setIsStartingSignIn(true)
    try {
      await signInWithGoogle(nextPath)
    } catch (error) {
      console.error('Google sign-in could not be started.', error)
      setSignInError('Google sign-in could not be started. Please try again.')
      setIsStartingSignIn(false)
    }
  }

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 6, md: 10 } }}>
      <Paper variant="outlined" sx={{ p: { xs: 3, sm: 5 } }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="overline" color="primary">
              Agapé Café account
            </Typography>
            <Typography variant="h2" gutterBottom>
              Sign in to continue
            </Typography>
            <Typography color="text.secondary">
              Use your Google account to access customer features or your
              assigned shop workspace.
            </Typography>
          </Box>
          {(configurationError || authError || signInError) && (
            <Alert severity="error">
              {configurationError || authError || signInError}
            </Alert>
          )}
          {!isConfigured && (
            <Alert severity="info">
              Configure Supabase URL and publishable key in the local
              environment, then enable Google in Supabase Auth.
            </Alert>
          )}
          <Button
            onClick={startGoogleSignIn}
            disabled={!isConfigured || isStartingSignIn}
            variant="contained"
            size="large"
            startIcon={
              isStartingSignIn ? <CircularProgress size={18} color="inherit" /> : <GoogleIcon />
            }
          >
            Continue with Google
          </Button>
          <Divider />
          <Typography variant="body2" color="text.secondary">
            New accounts are registered as customers. Administrative access is
            granted only by an authorized administrator.
          </Typography>
          <Button component={RouterLink} to="/" color="inherit" sx={{ alignSelf: 'flex-start' }}>
            Back to home
          </Button>
        </Stack>
      </Paper>
    </Container>
  )
}

export function AuthCallbackPage() {
  const { account, authError, isConfigured, isLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const callbackError =
    searchParams.get('error_description') ||
    searchParams.get('error') ||
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
        <Button component={RouterLink} to="/auth/sign-in" variant="contained">
          Return to sign in
        </Button>
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
