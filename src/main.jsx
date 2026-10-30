import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { BrowserRouter } from 'react-router-dom'
import AppRouter from './app/AppRouter.jsx'
import AppErrorBoundary from './components/AppErrorBoundary.jsx'
import { AuthProvider } from './features/auth/AuthProvider.jsx'
import { CartProvider } from './features/orders/CartProvider.jsx'
import theme from './app/theme.js'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <CartProvider>
              <AppRouter />
            </CartProvider>
          </AuthProvider>
        </BrowserRouter>
      </AppErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
)
