import { useEffect, useState } from 'react'
import { Box, Button, Container, Stack, Typography } from '@mui/material'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'
import { getCachedPublicBranches, getPublicBranches } from '../features/public/publicData.js'
import BranchCards from '../components/public/BranchCards.jsx'
import { PublicDataError, PublicLoading, SupabaseSetupNotice } from '../components/public/PublicDataState.jsx'

const hasSupabaseConfig =
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY)

export default function BranchesPage() {
  const cachedBranches = getCachedPublicBranches()
  const [branches, setBranches] = useState(cachedBranches || [])
  const [isLoading, setIsLoading] = useState(hasSupabaseConfig && cachedBranches === undefined)
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
    <Box sx={{ bgcolor: '#f7f3ed', color: '#2c211b', minHeight: '70vh' }}>
      <Box
        component="header"
        sx={{
          overflow: 'hidden',
          bgcolor: '#30231c',
          color: '#fffaf3',
        }}
      >
        <Container maxWidth="lg">
          <Box
            sx={{
              minHeight: { xs: 340, md: 390 },
              py: { xs: 6, md: 8 },
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1fr auto' },
              gap: 3,
              alignItems: 'center',
            }}
          >
            <Stack spacing={{ xs: 2, md: 2.5 }} sx={{ maxWidth: 690 }}>
              <Typography variant="overline" sx={{ color: '#d8b18a', letterSpacing: '.2em' }}>
                AGAPÉ CAFÉ · OUR LOCATIONS
              </Typography>
              <Typography
                component="h1"
                sx={{
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontSize: { xs: 'clamp(3rem, 12vw, 4.2rem)', md: '5.2rem' },
                  fontWeight: 400,
                  letterSpacing: '-.055em',
                  lineHeight: '.98',
                }}
              >
                Come find us.
              </Typography>
              <Typography sx={{ maxWidth: 510, color: 'rgba(255,250,243,.74)', lineHeight: 1.8 }}>
                A familiar cup, a new favorite, or a little time together.
                There’s a seat waiting at an Agapé Café near you.
              </Typography>
              <Button
                component="a"
                href="#branch-locations"
                variant="outlined"
                color="inherit"
                endIcon={<ArrowDownwardIcon />}
                sx={{ alignSelf: 'flex-start', mt: 0.5, minHeight: 44 }}
              >
                Explore our locations
              </Button>
            </Stack>
            <Box
              sx={{
                display: 'flex',
                flexDirection: { xs: 'row', md: 'column' },
                alignItems: 'center',
                justifyContent: { xs: 'flex-start', md: 'center' },
                gap: { xs: 1.5, md: 1 },
                pl: { md: 5 },
                pt: { xs: 2, md: 0 },
                minWidth: { md: 190 },
                borderTop: { xs: '1px solid rgba(255,250,243,.2)', md: 0 },
                borderLeft: { md: '1px solid rgba(255,250,243,.2)' },
              }}
            >
              <PlaceOutlinedIcon sx={{ color: '#d8b18a', fontSize: { xs: 36, md: 60 } }} />
              <Box sx={{ textAlign: { md: 'center' } }}>
                <Typography
                  sx={{
                    color: '#d8b18a',
                    fontFamily: 'Georgia, "Times New Roman", serif',
                    fontSize: { xs: '3rem', md: '4.75rem' },
                    lineHeight: 1,
                  }}
                >
                  {isLoading ? '—' : String(branches.length).padStart(2, '0')}
                </Typography>
                <Typography variant="overline" sx={{ color: 'rgba(255,250,243,.65)', letterSpacing: '.16em' }}>
                  {branches.length === 1 ? 'LOCATION TO VISIT' : 'LOCATIONS TO VISIT'}
                </Typography>
              </Box>
            </Box>
          </Box>
        </Container>
      </Box>
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
        <Box id="branch-locations" sx={{ scrollMarginTop: 100 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '.72fr 1.28fr' },
              gap: { xs: 1, md: 8 },
              alignItems: 'end',
              mb: { xs: 2, md: 3 },
            }}
          >
            <Typography variant="overline" sx={{ color: '#8a5b3c', letterSpacing: '.18em' }}>
              PICK YOUR SPOT
            </Typography>
            <Box>
              <Typography
                component="h2"
                sx={{
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontSize: { xs: '2.25rem', md: '3rem' },
                  fontWeight: 400,
                  letterSpacing: '-.04em',
                }}
              >
                Our locations
              </Typography>
              <Typography sx={{ mt: 0.5, color: '#685c53', lineHeight: 1.7 }}>
                Find the address, opening hours, and contact details for each café.
              </Typography>
            </Box>
          </Box>
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
        </Box>
      </Container>
    </Box>
  )
}
