import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Container, Divider, Stack, Typography } from '@mui/material'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'

const principles = [
  {
    number: '01',
    title: 'Make room',
    description: 'A café should feel like a place you can settle into, even when you only have a few minutes.',
  },
  {
    number: '02',
    title: 'Care in the details',
    description: 'From choosing your order to the moment it reaches you, the little things shape the experience.',
  },
  {
    number: '03',
    title: 'Come as you are',
    description: 'For a familiar favorite, a first visit, or a table shared with someone you love.',
  },
]

export default function AboutPage() {
  return (
    <Box sx={{ bgcolor: '#f7f3ed', color: '#2c211b' }}>
      <Box
        component="header"
        sx={{
          position: 'relative',
          overflow: 'hidden',
          bgcolor: '#30231c',
          color: '#fffaf3',
          '&::after': {
            content: '""',
            position: 'absolute',
            width: { xs: 220, md: 420 },
            height: { xs: 220, md: 420 },
            border: '1px solid rgba(255,250,243,.14)',
            borderRadius: '50%',
            right: { xs: -120, md: '8%' },
            top: { xs: '34%', md: '8%' },
            boxShadow: '0 0 0 34px rgba(255,250,243,.035), 0 0 0 75px rgba(255,250,243,.025)',
            pointerEvents: 'none',
          },
        }}
      >
        <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
          <Box
            sx={{
              minHeight: { xs: 480, md: 550 },
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1.15fr .85fr' },
              alignItems: 'center',
              gap: { xs: 3, md: 8 },
              py: { xs: 7, md: 9 },
            }}
          >
            <Stack spacing={{ xs: 2.5, md: 3 }}>
              <Typography
                variant="overline"
                sx={{ letterSpacing: '.2em', color: '#d8b18a' }}
              >
                THE STORY BEHIND AGAPÉ
              </Typography>
              <Typography
                component="h1"
                sx={{
                  maxWidth: 720,
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontSize: { xs: 'clamp(3.2rem, 13vw, 5rem)', md: 'clamp(4.6rem, 7vw, 6.4rem)' },
                  letterSpacing: '-.055em',
                  lineHeight: '.98',
                  fontWeight: 400,
                }}
              >
                A name rooted in love.
              </Typography>
              <Typography
                sx={{
                  maxWidth: 510,
                  color: 'rgba(255,250,243,.76)',
                  fontSize: { xs: '1rem', md: '1.125rem' },
                  lineHeight: 1.85,
                }}
              >
                Agapé is an ancient Greek word for generous, selfless love.
                It is the thought behind the café: to make people feel welcome,
                and to bring a little care to an everyday cup.
              </Typography>
              <Box sx={{ pt: 1 }}>
                <Divider sx={{ borderColor: 'rgba(255,250,243,.25)', maxWidth: 92 }} />
                <Typography variant="body2" sx={{ mt: 1.5, color: 'rgba(255,250,243,.64)' }}>
                  Agapé Café · A place to pause and be together
                </Typography>
              </Box>
            </Stack>
            <Box
              aria-label="Agapé, a Greek word for love"
              sx={{
                minHeight: { xs: 145, md: 300 },
                display: 'flex',
                alignItems: 'center',
                justifyContent: { xs: 'flex-start', md: 'center' },
                borderTop: { xs: '1px solid rgba(255,250,243,.18)', md: 0 },
                pt: { xs: 2, md: 0 },
              }}
            >
              <Stack sx={{ alignItems: { md: 'center' } }}>
                <Typography
                  lang="el"
                  aria-hidden="true"
                  sx={{
                    color: '#d8b18a',
                    fontFamily: 'Georgia, "Times New Roman", serif',
                    fontSize: { xs: '4rem', md: '6.75rem' },
                    lineHeight: 1,
                    letterSpacing: '.02em',
                  }}
                >
                  ἀγάπη
                </Typography>
                <Typography
                  variant="overline"
                  sx={{ mt: 1.5, letterSpacing: '.2em', color: 'rgba(255,250,243,.58)' }}
                >
                  AGÁPĒ · NOUN
                </Typography>
              </Stack>
            </Box>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 7, md: 11 } }}>
        <Box
          component="section"
          aria-labelledby="about-meaning"
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '.72fr 1.28fr' },
            gap: { xs: 2.5, md: 10 },
            alignItems: 'start',
          }}
        >
          <Typography
            variant="overline"
            sx={{ color: '#8a5b3c', letterSpacing: '.18em', pt: { md: 1 } }}
          >
            WHAT THE NAME MEANS
          </Typography>
          <Stack spacing={2.5}>
            <Typography
              id="about-meaning"
              component="h2"
              sx={{
                maxWidth: 680,
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: { xs: '2.35rem', md: '3.5rem' },
                fontWeight: 400,
                letterSpacing: '-.04em',
                lineHeight: 1.12,
              }}
            >
              It is not just what is in the cup. It is how you are welcomed.
            </Typography>
            <Typography sx={{ maxWidth: 620, color: '#685c53', lineHeight: 1.9 }}>
              We chose a word that speaks to care freely given. At Agapé Café,
              that idea lives in the small moments: a familiar order, a new
              favorite, a conversation that runs a little longer, or a quiet
              pause in the middle of a busy day.
            </Typography>
            <Typography sx={{ maxWidth: 620, color: '#685c53', lineHeight: 1.9 }}>
              Every visit is different. Our hope is simply that there is
              something here for yours.
            </Typography>
          </Stack>
        </Box>

        <Divider sx={{ my: { xs: 6, md: 9 }, borderColor: 'rgba(73,52,38,.2)' }} />

        <Box component="section" aria-labelledby="about-values">
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '.72fr 1.28fr' },
              gap: { xs: 2.5, md: 10 },
              mb: { xs: 3, md: 4 },
            }}
          >
            <Typography
              variant="overline"
              sx={{ color: '#8a5b3c', letterSpacing: '.18em', pt: { md: 1 } }}
            >
              A SIMPLE POINT OF VIEW
            </Typography>
            <Typography
              id="about-values"
              component="h2"
              sx={{
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: { xs: '2.2rem', md: '3rem' },
                fontWeight: 400,
                letterSpacing: '-.04em',
              }}
            >
              What we want a café to feel like.
            </Typography>
          </Box>
          <Box sx={{ ml: { md: 'calc(36% + 1.25rem)' } }}>
            {principles.map((principle, index) => (
              <Box key={principle.number}>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '42px 1fr', sm: '64px 1fr' },
                    gap: { xs: 1.5, sm: 3 },
                    py: { xs: 2.5, md: 3 },
                    alignItems: 'start',
                  }}
                >
                  <Typography
                    variant="overline"
                    sx={{ color: '#9a7357', letterSpacing: '.1em', pt: 0.5 }}
                  >
                    {principle.number}
                  </Typography>
                  <Box>
                    <Typography
                      component="h3"
                      sx={{
                        fontFamily: 'Georgia, "Times New Roman", serif',
                        fontSize: { xs: '1.55rem', md: '1.85rem' },
                        fontWeight: 400,
                      }}
                    >
                      {principle.title}
                    </Typography>
                    <Typography sx={{ mt: 0.75, maxWidth: 540, color: '#685c53', lineHeight: 1.8 }}>
                      {principle.description}
                    </Typography>
                  </Box>
                </Box>
                {index < principles.length - 1 && (
                  <Divider sx={{ borderColor: 'rgba(73,52,38,.16)' }} />
                )}
              </Box>
            ))}
          </Box>
        </Box>

        <Box
          component="section"
          aria-label="Visit Agapé Café"
          sx={{
            mt: { xs: 7, md: 10 },
            p: { xs: 3, md: 5 },
            bgcolor: '#e9dfd2',
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            gap: 2,
            alignItems: { sm: 'center' },
            justifyContent: 'space-between',
          }}
        >
          <Box>
            <Typography
              sx={{
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: { xs: '1.8rem', md: '2.35rem' },
                lineHeight: 1.2,
              }}
            >
              We saved you a little time.
            </Typography>
            <Typography sx={{ mt: 0.75, color: '#685c53' }}>
              Find a drink you love, or find a café near you.
            </Typography>
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              component={RouterLink}
              to="/menu"
              variant="contained"
              endIcon={<ArrowForwardIcon />}
              sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
            >
              Browse the menu
            </Button>
            <Button
              component={RouterLink}
              to="/branches"
              variant="text"
              sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
            >
              Find a branch
            </Button>
          </Stack>
        </Box>
      </Container>
    </Box>
  )
}
