import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'

export function PublicLoading({ label = 'Loading shop information…' }) {
  return (
    <Stack sx={{ alignItems: 'center', py: 7 }} spacing={2}>
      <CircularProgress />
      <Typography color="text.secondary">{label}</Typography>
    </Stack>
  )
}

export function PublicDataError({ message, onRetry }) {
  return (
    <Alert
      severity="error"
      action={
        onRetry ? (
          <Button color="inherit" size="small" onClick={onRetry}>
            Try again
          </Button>
        ) : null
      }
    >
      {message}
    </Alert>
  )
}

export function SupabaseSetupNotice() {
  return (
    <Alert severity="info">
      Public shop information is served from Supabase. Configure the Supabase
      URL and publishable key, then apply the database migrations to display
      the live menu and store details.
    </Alert>
  )
}

export function EmptyPublicState({ children }) {
  return (
    <Box sx={{ py: 4, textAlign: 'center' }}>
      <Typography color="text.secondary">{children}</Typography>
    </Box>
  )
}

export function SectionHeading({ eyebrow, title, description, action }) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      sx={{
        alignItems: { xs: 'flex-start', sm: 'flex-end' },
        justifyContent: 'space-between',
        mb: 3,
      }}
    >
      <Box>
        {eyebrow && (
          <Typography variant="overline" color="primary" sx={{ letterSpacing: '.15em' }}>
            {eyebrow}
          </Typography>
        )}
        <Typography variant="h2">{title}</Typography>
        {description && <Typography color="text.secondary">{description}</Typography>}
      </Box>
      {action}
    </Stack>
  )
}

export function BackToMenuButton() {
  return (
    <Button component={RouterLink} to="/menu">
      Browse menu
    </Button>
  )
}
