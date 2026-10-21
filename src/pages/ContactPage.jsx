import { useEffect, useState } from 'react'
import { Container, Stack, Typography } from '@mui/material'
import { getPublicBranches } from '../features/public/publicData.js'
import BranchCards from '../components/public/BranchCards.jsx'
import {
  PublicDataError,
  PublicLoading,
  SupabaseSetupNotice,
} from '../components/public/PublicDataState.jsx'

const hasSupabaseConfig =
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY)

export default function ContactPage() {
  const [branches, setBranches] = useState([])
  const [isLoading, setIsLoading] = useState(hasSupabaseConfig)
  const [errorMessage, setErrorMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!hasSupabaseConfig) return undefined
    let active = true
    getPublicBranches()
      .then((data) => {
        if (active) {
          setBranches(data)
          setErrorMessage('')
        }
      })
      .catch((error) => {
        console.error('Unable to load public contact details.', error)
        if (active) setErrorMessage(error.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack spacing={4}>
        <Stack spacing={1}>
          <Typography variant="overline" color="primary">
            We’re here to help
          </Typography>
          <Typography variant="h1">Contact Agapé Café</Typography>
          <Typography color="text.secondary">
            Call or email an active branch using the contact details published below.
          </Typography>
        </Stack>
        {!hasSupabaseConfig && <SupabaseSetupNotice />}
        {errorMessage && (
          <PublicDataError
            message={errorMessage}
            onRetry={() => {
              setIsLoading(true)
              setReloadKey((key) => key + 1)
            }}
          />
        )}
        {!hasSupabaseConfig ? null : isLoading ? <PublicLoading /> : <BranchCards branches={branches} />}
      </Stack>
    </Container>
  )
}
