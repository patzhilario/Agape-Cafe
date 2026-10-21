import { Box, Container, Paper, Stack, Typography } from '@mui/material'

export default function AboutPage() {
  return (
    <Container maxWidth="md" sx={{ py: { xs: 6, md: 10 } }}>
      <Stack spacing={4}>
        <Box>
          <Typography variant="overline" color="primary" sx={{ letterSpacing: '.15em' }}>
            Agapé Café
          </Typography>
          <Typography variant="h1" gutterBottom>
            A little love in every cup.
          </Typography>
          <Typography variant="h6" color="text.secondary" fontWeight={400}>
            Agapé is a Greek word for love. It is the idea behind our name and
            the care we hope you feel whenever you visit.
          </Typography>
        </Box>
        <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 } }}>
          <Stack spacing={2}>
            <Typography variant="h2">Made for everyday moments</Typography>
            <Typography color="text.secondary">
              Whether you are taking a quiet pause or sharing time with someone,
              Agapé Café is here to be part of that moment. Browse our published
              menu and find the branch details available on this site.
            </Typography>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  )
}
