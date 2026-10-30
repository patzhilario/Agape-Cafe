import { Component } from 'react'
import { Box, Button, Container, Stack, Typography } from '@mui/material'

export default class AppErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('Application rendering failed.', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box component="main" sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center' }}>
          <Container maxWidth="sm">
            <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
              <Typography variant="h4">This page could not be loaded</Typography>
              <Typography color="text.secondary">
                Try reloading the app. If the problem continues, check your connection and try again later.
              </Typography>
              <Button variant="contained" onClick={() => window.location.reload()}>
                Reload app
              </Button>
            </Stack>
          </Container>
        </Box>
      )
    }

    return this.props.children
  }
}
