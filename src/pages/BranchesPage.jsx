import { useEffect, useState } from 'react'
import { Container, Stack } from '@mui/material'
import { getPublicBranches } from '../features/public/publicData.js'
import BranchCards from '../components/public/BranchCards.jsx'
import {
  PublicDataError,
  PublicLoading,
  SectionHeading,
  SupabaseSetupNotice,
} from '../components/public/PublicDataState.jsx'

const hasSupabaseConfig =
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY)

export default function BranchesPage() {
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
        console.error('Unable to load public branches.', error)
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
        <SectionHeading
          eyebrow="Visit Agapé Café"
          title="Our branches"
          description="Addresses and contact details for active branches."
        />
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
