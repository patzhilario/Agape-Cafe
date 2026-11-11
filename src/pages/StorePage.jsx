import { useEffect, useState } from 'react'
import { Container, Stack, Typography } from '@mui/material'
import { getCachedPublicBranches, getPublicBranches } from '../features/public/publicData.js'
import BranchCards from '../components/public/BranchCards.jsx'
import { PublicDataError, PublicLoading, SupabaseSetupNotice } from '../components/public/PublicDataState.jsx'

const hasSupabaseConfig = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

export default function StorePage() {
  const cached = getCachedPublicBranches()
  const [stores, setStores] = useState(cached || [])
  const [isLoading, setIsLoading] = useState(hasSupabaseConfig && cached === undefined)
  const [errorMessage, setErrorMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!hasSupabaseConfig) return undefined
    let active = true
    getPublicBranches()
      .then((data) => {
        if (active) {
          setStores(data)
          setErrorMessage('')
        }
      })
      .catch((error) => { if (active) setErrorMessage(error.message) })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [reloadKey])

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack spacing={3}>
        <Typography variant="h2">Visit our cafe</Typography>
        <Typography color="text.secondary">Find our address, opening hours, and contact details.</Typography>
        {!hasSupabaseConfig && <SupabaseSetupNotice />}
        {errorMessage && <PublicDataError message={errorMessage} onRetry={() => {
          setIsLoading(true)
          setReloadKey((value) => value + 1)
        }} />}
        {isLoading ? <PublicLoading /> : <BranchCards branches={stores} />}
      </Stack>
    </Container>
  )
}
