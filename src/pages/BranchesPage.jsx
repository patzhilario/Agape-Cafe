import { useEffect, useState } from 'react'
import { Box, Container, Stack, Typography } from '@mui/material'
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
    <Box sx={{ bgcolor: 'background.default', minHeight: '70vh' }}>
      <Box
        sx={{
          py: { xs: 5, md: 7 },
          background: 'linear-gradient(120deg, #f4eadc 0%, #fbf7f1 58%, #efe1d1 100%)',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Container maxWidth="lg">
          <Stack spacing={1.25} sx={{ maxWidth: 680 }}>
            <Typography variant="overline" color="primary" sx={{ letterSpacing: '.14em' }}>
              YOUR NEIGHBORHOOD COFFEE STOP
            </Typography>
            <Typography variant="h1" sx={{ color: 'primary.dark', fontSize: { xs: '2.5rem', md: '3.5rem' } }}>
              Find your café.
            </Typography>
            <Typography color="text.secondary" sx={{ maxWidth: 560, lineHeight: 1.7 }}>
              See where we are, check each branch’s details, and plan a little
              coffee break close to you.
            </Typography>
          </Stack>
        </Container>
      </Box>
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
        <Stack spacing={3}>
          <SectionHeading
            eyebrow="Come on in"
            title="Our branches"
            description="Choose a location to see its address, hours, and contact details."
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
    </Box>
  )
}
