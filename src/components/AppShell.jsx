import { useEffect, useRef, useState } from 'react'
import { Alert, AppBar, Badge, Box, Button, Container, Drawer, IconButton, Snackbar, Stack, Toolbar, Typography, useMediaQuery, useTheme } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import MenuIcon from '@mui/icons-material/Menu'
import ShoppingCartOutlinedIcon from '@mui/icons-material/ShoppingCartOutlined'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { useAuth } from '../features/auth/useAuth.js'
import { useCart } from '../features/orders/useCart.js'
import CartSummaryPanel from './public/CartSummaryPanel.jsx'

const logo = new URL('../assets/logo.jpg', import.meta.url).href

const navigation = [
  { label: 'Home', to: '/' },
  { label: 'Menu', to: '/menu' },
  { label: 'Branches', to: '/branches' },
  { label: 'About', to: '/about' },
]

export default function AppShell({ children }) {
  const { account, isLoading, signOut } = useAuth()
  const { totalQuantity, isCartOpen, openCart, closeCart } = useCart()
  const location = useLocation()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const [signOutError, setSignOutError] = useState('')
  const [navigationOpen, setNavigationOpen] = useState(false)
  const mobileNavigationButtonRef = useRef(null)

  function closeNavigation() {
    setNavigationOpen(false)
  }

  useEffect(() => {
    if (location.state?.openCart) {
      openCart()
    } else {
      closeCart()
    }
  }, [location.pathname, location.state?.openCart, openCart, closeCart])

  async function handleSignOut() {
    setSignOutError('')
    try {
      await signOut()
    } catch (error) {
      setSignOutError(error.message)
    }
  }

  if (location.pathname.startsWith('/admin')) {
    return <Box component="main" sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>{children}</Box>
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar
        position="sticky"
        color="inherit"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Container maxWidth="lg">
          <Toolbar disableGutters sx={{ minHeight: { xs: 64, md: 76 }, gap: { xs: 1, md: 4 } }}>
            <Box
              component={RouterLink}
              to="/"
              sx={{
                display: 'block',
                position: 'relative',
                flex: { xs: '0 0 112px', sm: '0 0 136px', md: '0 0 156px' },
                height: { xs: 42, md: 52 },
                overflow: 'hidden',
                '& img': {
                  width: 236,
                  height: 236,
                  maxWidth: 'none',
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                },
              }}
              aria-label="Agapé Café home"
            >
              <img src={logo} alt="Agapé Café" />
            </Box>
            {!isMobile && <Stack
              direction="row"
              spacing={0.5}
              sx={{ ml: 'auto', minWidth: 0, overflowX: 'auto' }}
            >
              {navigation.map(({ label, to }) => (
                <Button
                  key={to}
                  component={RouterLink}
                  to={to}
                  color="inherit"
                  size="small"
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  {label}
                </Button>
              ))}
              {account ? (
                <>
                  <Button
                    component={RouterLink}
                    to={account.homePath}
                    color="primary"
                    size="small"
                    sx={{ whiteSpace: 'nowrap' }}
                  >
                    {account.roles.some((role) => ['super_admin', 'branch_admin', 'staff'].includes(role))
                      ? 'Admin workspace'
                      : 'My account'}
                  </Button>
                  <Button
                    color="inherit"
                    size="small"
                    onClick={handleSignOut}
                    sx={{ whiteSpace: 'nowrap' }}
                  >
                    Sign out
                  </Button>
                </>
              ) : (
                <Button
                  component={RouterLink}
                  to="/auth/sign-in"
                  color="primary"
                  size="small"
                  disabled={isLoading}
                  variant="outlined"
                  sx={{
                    whiteSpace: 'nowrap',
                    borderWidth: 1.5,
                    '&:hover': { borderWidth: 1.5, bgcolor: 'rgba(91, 57, 39, 0.06)' },
                  }}
                >
                  Sign in
                </Button>
              )}
              <IconButton
                onClick={openCart}
                color="primary"
                aria-label={`Shopping cart, ${totalQuantity} items`}
                aria-haspopup="dialog"
                aria-expanded={isCartOpen}
                sx={{
                  width: 40,
                  height: 40,
                  border: 1,
                  borderColor: 'divider',
                }}
              >
                <Badge badgeContent={totalQuantity} color="secondary" max={99}>
                  <ShoppingCartOutlinedIcon fontSize="small" />
                </Badge>
              </IconButton>
            </Stack>}
            {isMobile && (
              <IconButton
                ref={mobileNavigationButtonRef}
                aria-label="Open site navigation"
                onClick={(event) => {
                  event.currentTarget.blur()
                  setNavigationOpen(true)
                }}
                sx={{ ml: 'auto' }}
              >
                <MenuIcon />
              </IconButton>
            )}
          </Toolbar>
        </Container>
      </AppBar>
      <Drawer
        anchor="left"
        open={navigationOpen}
        onClose={closeNavigation}
        ModalProps={{ keepMounted: true, disableRestoreFocus: true }}
        slotProps={{
          paper: { sx: { width: 'min(88vw, 340px)', p: 2 } },
          transition: {
            onExited: () => {
              window.requestAnimationFrame(() => mobileNavigationButtonRef.current?.focus())
            },
          },
        }}
      >
        <Stack spacing={1}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="h6" fontWeight={800}>Agapé Café</Typography>
            <IconButton aria-label="Close site navigation" onClick={closeNavigation} autoFocus>
              <CloseIcon />
            </IconButton>
          </Stack>
          {navigation.map(({ label, to }) => (
            <Button
              key={to}
              component={RouterLink}
              to={to}
              color="inherit"
              onClick={closeNavigation}
              sx={{ justifyContent: 'flex-start', minHeight: 44 }}
            >
              {label}
            </Button>
          ))}
          {account ? (
            <>
              <Button
                component={RouterLink}
                to={account.homePath}
                color="primary"
                onClick={closeNavigation}
                sx={{ justifyContent: 'flex-start', minHeight: 44 }}
              >
                {account.roles.some((role) => ['super_admin', 'branch_admin', 'staff'].includes(role))
                  ? 'Admin workspace'
                  : 'My account'}
              </Button>
              <Button
                color="inherit"
                onClick={() => {
                  closeNavigation()
                  void handleSignOut()
                }}
                sx={{ justifyContent: 'flex-start', minHeight: 44 }}
              >
                Sign out
              </Button>
            </>
          ) : (
            <Button
              component={RouterLink}
              to="/auth/sign-in"
              color="primary"
              variant="contained"
              disabled={isLoading}
              onClick={closeNavigation}
              sx={{ justifyContent: 'flex-start', minHeight: 44, mt: 1 }}
            >
              Sign in
            </Button>
          )}
          <Button
            color="primary"
            onClick={() => {
              closeNavigation()
              openCart()
            }}
            startIcon={
              <Badge badgeContent={totalQuantity} color="secondary" max={99}>
                <ShoppingCartOutlinedIcon fontSize="small" />
              </Badge>
            }
            sx={{ justifyContent: 'flex-start', minHeight: 44 }}
          >
            Shopping cart
          </Button>
        </Stack>
      </Drawer>
      <Box component="main" sx={{ flex: 1 }}>
        {children}
      </Box>
      <Box component="footer" sx={{ py: 3, borderTop: 1, borderColor: 'divider' }}>
        <Container maxWidth="lg">
          <Typography variant="body2" color="text.secondary">
            Agapé Café · Coffee shop management system
          </Typography>
        </Container>
      </Box>
      <Drawer
        anchor="right"
        open={isCartOpen}
        onClose={closeCart}
        slotProps={{ paper: { sx: { width: { xs: '100vw', sm: 360 }, p: 2 } } }}
      >
        <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 1 }}>
          <IconButton aria-label="Close cart" onClick={closeCart}>
            <CloseIcon />
          </IconButton>
        </Stack>
        <CartSummaryPanel onCheckout={closeCart} />
      </Drawer>
      <Snackbar
        open={Boolean(signOutError)}
        autoHideDuration={6000}
        onClose={() => setSignOutError('')}
      >
        <Alert severity="error" onClose={() => setSignOutError('')}>
          {signOutError}
        </Alert>
      </Snackbar>
    </Box>
  )
}
