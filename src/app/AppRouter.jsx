import { lazy, Suspense } from 'react'
import { Link as RouterLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Box, Button, CircularProgress, Container, Drawer, IconButton, Stack, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import AppShell from '../components/AppShell.jsx'
import { ADMIN_ROLES } from '../features/auth/authConstants.js'
import { AdminArea, CustomerArea, RequireAuth } from '../features/auth/RouteGuards.jsx'

const AuthPage = lazy(() => import('../features/auth/AuthPages.jsx').then((module) => ({ default: module.AuthPage })))
const AuthSignUpPage = lazy(() => import('../features/auth/AuthPages.jsx').then((module) => ({ default: module.AuthSignUpPage })))
const AuthCallbackPage = lazy(() => import('../features/auth/AuthPages.jsx').then((module) => ({ default: module.AuthCallbackPage })))
const AuthErrorPage = lazy(() => import('../features/auth/AuthPages.jsx').then((module) => ({ default: module.AuthErrorPage })))
const AuthPasswordRequestPage = lazy(() => import('../features/auth/AuthPages.jsx').then((module) => ({ default: module.AuthPasswordRequestPage })))
const AuthPasswordUpdatePage = lazy(() => import('../features/auth/AuthPages.jsx').then((module) => ({ default: module.AuthPasswordUpdatePage })))

const HomePage = lazy(() => import('../pages/HomePage.jsx'))
const MenuPage = lazy(() => import('../pages/MenuPage.jsx'))
const ProductPage = lazy(() => import('../pages/ProductPage.jsx'))
const StorePage = lazy(() => import('../pages/StorePage.jsx'))
const AboutPage = lazy(() => import('../pages/AboutPage.jsx'))
const CheckoutPage = lazy(() => import('../pages/CheckoutPage.jsx'))
const OrderHistoryPage = lazy(() => import('../pages/OrderHistoryPage.jsx'))
const OrderReceiptPage = lazy(() => import('../pages/OrderReceiptPage.jsx'))
const OrderDetailPage = lazy(() => import('../pages/OrderDetailPage.jsx'))
const CustomerProfilePage = lazy(() => import('../features/auth/CustomerProfilePage.jsx'))

const plannedRoutes = ['/privacy', '/terms']

function NotFoundPage() {
  return (
    <Container maxWidth="md" sx={{ py: 10 }}>
      <Typography variant="h1" gutterBottom>
        Page not found
      </Typography>
      <Button component={RouterLink} to="/" variant="contained">
        Return home
      </Button>
    </Container>
  )
}

function PlannedPage({ path }) {
  return (
    <Container maxWidth="md" sx={{ py: 10 }}>
      <Typography variant="overline" color="primary">
        Planned route
      </Typography>
      <Typography variant="h1" gutterBottom>
        {path}
      </Typography>
      <Typography color="text.secondary">
        This page will be implemented in its scheduled project phase. No
        placeholder business data or nonfunctional controls are shown here.
      </Typography>
    </Container>
  )
}

function CheckoutDrawer({ location }) {
  const navigate = useNavigate()
  const backgroundLocation = location.state.backgroundLocation

  function closeDrawer() {
    navigate(backgroundLocation, { replace: true })
  }

  return (
    <Drawer
      anchor="right"
      open
      onClose={closeDrawer}
      slotProps={{
        paper: {
          sx: {
            width: { xs: '100vw', sm: 520, md: 600 },
            minWidth: 0,
            maxWidth: '100vw',
            boxSizing: 'border-box',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      <Stack
        direction="row"
        spacing={2}
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          px: { xs: 2, sm: 3 },
          py: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Box>
          <Typography variant="overline" color="primary" sx={{ letterSpacing: 1.5 }}>
            Agapé Café
          </Typography>
          <Typography variant="subtitle1" fontWeight={700}>Checkout</Typography>
        </Box>
        <IconButton aria-label="Close checkout" onClick={closeDrawer}>
          <CloseIcon />
        </IconButton>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, width: '100%', overflowY: 'auto', px: { xs: 2, sm: 3 }, pb: 3 }}>
        <Routes location={location}>
          <Route
            path="/customer"
            element={
              <RequireAuth roles={['customer']}>
                <Outlet />
              </RequireAuth>
            }
          >
            <Route path="checkout" element={<CheckoutPage panel />} />
          </Route>
        </Routes>
      </Box>
    </Drawer>
  )
}

export default function AppRouter() {
  const location = useLocation()
  const backgroundLocation = location.state?.backgroundLocation
  const showCheckoutDrawer =
    Boolean(backgroundLocation) && location.pathname === '/customer/checkout'

  return (
    <AppShell>
      <Suspense
        fallback={
          <Stack sx={{ alignItems: 'center', py: 10 }}>
            <CircularProgress />
            <Typography color="text.secondary">Loading page…</Typography>
          </Stack>
        }
      >
        <Routes location={showCheckoutDrawer ? backgroundLocation : location}>
          <Route path="/receipt/:orderId" element={<RequireAuth><OrderReceiptPage /></RequireAuth>} />
          <Route path="/" element={<HomePage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/menu/:productId" element={<ProductPage />} />
          <Route path="/visit" element={<StorePage />} />
          <Route path="/branches" element={<Navigate to="/visit" replace />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<Navigate to="/visit" replace />} />
          <Route
            path="/cart"
            element={<Navigate to="/menu" replace state={{ openCart: true }} />}
          />
          {plannedRoutes.map((path) => (
            <Route key={path} path={path} element={<PlannedPage path={path} />} />
          ))}
          <Route path="/auth/sign-in" element={<AuthPage />} />
          <Route path="/auth/sign-up" element={<AuthSignUpPage />} />
          <Route path="/auth/forgot-password" element={<AuthPasswordRequestPage />} />
          <Route path="/auth/update-password" element={<AuthPasswordUpdatePage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/auth/error" element={<AuthErrorPage />} />
          <Route
            path="/customer"
            element={
              <RequireAuth roles={['customer']}>
                <Outlet />
              </RequireAuth>
            }
          >
            <Route index element={<CustomerArea />} />
            <Route path="profile" element={<CustomerProfilePage />} />
            <Route path="checkout" element={<CheckoutPage />} />
            <Route path="orders" element={<OrderHistoryPage />} />
            <Route path="orders/:orderId" element={<OrderDetailPage />} />
          </Route>
          <Route
            path="/admin/*"
            element={
              <RequireAuth roles={ADMIN_ROLES}>
                <Suspense
                  fallback={
                    <Stack sx={{ alignItems: 'center', py: 10 }}>
                      <CircularProgress />
                      <Typography color="text.secondary">Loading workspace…</Typography>
                    </Stack>
                  }
                >
                  <AdminArea />
                </Suspense>
              </RequireAuth>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        {showCheckoutDrawer && <CheckoutDrawer location={location} />}
      </Suspense>
    </AppShell>
  )
}
