import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Container, Divider, Stack, Typography } from '@mui/material'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import CoffeeOutlinedIcon from '@mui/icons-material/CoffeeOutlined'

export default function AboutPage() {
  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: '70vh' }}>
      <Box
        sx={{
          py: { xs: 7, md: 11 },
          background: 'linear-gradient(120deg, #f4eadc 0%, #fbf7f1 58%, #efe1d1 100%)',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Container maxWidth="lg">
          <Stack spacing={2.5} sx={{ maxWidth: 760 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'primary.main' }}>
              <CoffeeOutlinedIcon fontSize="small" />
              <Typography variant="overline" sx={{ letterSpacing: '.15em' }}>
                A LITTLE LOVE IN EVERY CUP
              </Typography>
            </Stack>
            <Typography
              variant="h1"
              sx={{
                color: 'primary.dark',
                fontSize: { xs: 'clamp(2.5rem, 10vw, 3.5rem)', md: 'clamp(3.5rem, 6vw, 5rem)' },
              }}
            >
              A café for the moments that matter.
            </Typography>
            <Typography
              variant="h6"
              color="text.secondary"
              fontWeight={400}
              sx={{ maxWidth: 650, lineHeight: 1.7 }}
            >
              Agapé is a Greek word for love—a simple idea that inspires the
              way we welcome you, prepare your order, and make room for a
              little pause in your day.
            </Typography>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.25}
              useFlexGap
              sx={{ pt: 1, flexWrap: 'wrap' }}
            >
              <Button
                component={RouterLink}
                to="/menu"
                variant="contained"
                endIcon={<ArrowForwardIcon />}
                sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}
              >
                Explore our menu
              </Button>
              <Button
                component={RouterLink}
                to="/branches"
                variant="text"
                sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}
              >
                Find a branch
              </Button>
            </Stack>
          </Stack>
        </Container>
      </Box>
      <Container maxWidth="lg" sx={{ py: { xs: 6, md: 9 } }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '0.8fr 1.2fr' },
            columnGap: { xs: 3, md: 10 },
            rowGap: { xs: 2, md: 0 },
          }}
        >
          <Box>
            <Typography variant="overline" color="primary" sx={{ letterSpacing: '.14em' }}>
              OUR POINT OF VIEW
            </Typography>
            <Typography variant="h3" sx={{ mt: 0.75, color: 'primary.dark', fontWeight: 750 }}>
              Good coffee. Good company. A moment to breathe.
            </Typography>
          </Box>
          <Stack spacing={2}>
            <Typography color="text.secondary" sx={{ lineHeight: 1.9 }}>
              We believe a café can be more than a stop along the way. It can
              be the start of a conversation, a familiar place to recharge, or
              a small reward after a long day. Agapé Café is here for those
              everyday moments, with a menu to explore and branches to visit.
            </Typography>
            <Typography color="text.secondary" sx={{ lineHeight: 1.9 }}>
              Whether you already know your usual or are choosing something
              new, we hope your next visit feels easy, warm, and made for you.
            </Typography>
          </Stack>
        </Box>
        <Divider sx={{ my: { xs: 5, md: 7 } }} />
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          useFlexGap
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, flexWrap: 'wrap' }}
        >
          <Box>
            <Typography variant="h4" sx={{ color: 'primary.dark', fontWeight: 750 }}>
              Your next coffee moment is waiting.
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Take a look at the menu or come find us nearby.
            </Typography>
          </Box>
          <Button
            component={RouterLink}
            to="/menu"
            variant="outlined"
            endIcon={<ArrowForwardIcon />}
            sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}
          >
            Browse the menu
          </Button>
        </Stack>
      </Container>
    </Box>
  )
}
