import CustomerNotifications from '../features/orders/CustomerNotifications.jsx'
import { useEffect, useRef, useState } from 'react'
import { Alert, AppBar, Badge, Box, Button, Container, Divider, Drawer, Grid, IconButton, Snackbar, Stack, Toolbar, Typography, useMediaQuery, useTheme } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import MenuIcon from '@mui/icons-material/Menu'
import ShoppingCartOutlinedIcon from '@mui/icons-material/ShoppingCartOutlined'
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined'
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined'
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined'
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined'
import FacebookIcon from '@mui/icons-material/Facebook'
import InstagramIcon from '@mui/icons-material/Instagram'
import SvgIcon from '@mui/material/SvgIcon'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { useAuth } from '../features/auth/useAuth.js'
import { useCart } from '../features/orders/useCart.js'
import CartSummaryPanel from './public/CartSummaryPanel.jsx'

const logo = new URL('../assets/logo.jpg', import.meta.url).href
const currentYear = new Date().getFullYear()

const navigation = [
  { label: 'Home', to: '/' },
  { label: 'Menu', to: '/menu' },
  { label: 'Visit us', to: '/visit' },
  { label: 'About', to: '/about' },
]

export default function AppShell({ children }) {
  const { account, isLoading, signOut, canAccessWorkspace } = useAuth()
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
              spacing={1.25}
              sx={{ ml: 'auto', minWidth: 0, alignItems: 'center', overflowX: 'auto' }}
            >
              {navigation.map(({ label, to }) => (
                <Button
                  key={to}
                  component={RouterLink}
                  to={to}
                  color="inherit"
                  size="small"
                  sx={{
                    minHeight: 40,
                    px: 1.5,
                    borderRadius: 2,
                    fontWeight: location.pathname === to ? 700 : 500,
                    bgcolor: location.pathname === to ? 'action.selected' : 'transparent',
                    whiteSpace: 'nowrap',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
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
                    sx={{ minHeight: 40, px: 1.5, whiteSpace: 'nowrap' }}
                  >
                    {canAccessWorkspace()
                      ? 'Workspace'
                      : 'My account'}
                  </Button>
                  <Button
                    color="inherit"
                    size="small"
                    onClick={handleSignOut}
                    sx={{ minHeight: 40, px: 1.5, whiteSpace: 'nowrap' }}
                  >
                    Sign out
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    component={RouterLink}
                    to="/auth/sign-in"
                    color="primary"
                    size="small"
                    disabled={isLoading}
                    variant="outlined"
                    sx={{
                      minHeight: 40,
                      px: 2,
                      ml: 0.75,
                      whiteSpace: 'nowrap',
                      borderWidth: 1.5,
                      '&:hover': { borderWidth: 1.5, bgcolor: 'rgba(91, 57, 39, 0.06)' },
                    }}
                  >
                    Login
                  </Button>
                </>
              )}
              <IconButton
                onClick={openCart}
                color="primary"
                aria-label={`Shopping cart, ${totalQuantity} items`}
                aria-haspopup="dialog"
                aria-expanded={isCartOpen}
                sx={{
                  width: 42,
                  height: 42,
                  ml: 0.75,
                  border: 1,
                  borderColor: 'divider',
                }}
              >
                <Badge badgeContent={totalQuantity} color="secondary" max={99}>
                  <ShoppingCartOutlinedIcon fontSize="small" />
                </Badge>
              </IconButton>
            </Stack>}
            {account?.roles.includes('customer') && <CustomerNotifications key={account.id} customerId={account.id} />}
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
                {canAccessWorkspace()
                  ? 'Workspace'
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
            <>
              <Button
                component={RouterLink}
                to="/auth/sign-in"
                color="primary"
                variant="contained"
                disabled={isLoading}
                onClick={closeNavigation}
                sx={{ justifyContent: 'flex-start', minHeight: 44, mt: 1 }}
              >
                Login
              </Button>
            </>
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
      <Box
        component="footer"
        sx={{
          mt: 'auto',
          bgcolor: '#211813',
          color: '#fffaf4',
          borderTop: '1px solid rgba(255, 250, 244, 0.08)',
          pt: { xs: 4, sm: 5, md: 6 },
          pb: { xs: 3, sm: 3.5, md: 4 },
        }}
      >
        <Container maxWidth="lg" sx={{ px: { xs: 2.5, sm: 3, md: 4 } }}>
          <Grid container spacing={{ xs: 3.5, sm: 4, md: 4 }}>
            {/* Column 1: Brand & Bio */}
            <Grid size={{ xs: 12, md: 4.5 }}>
              <Stack spacing={2}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <Box
                    component="img"
                    src={logo}
                    alt="Agapé Café Logo"
                    sx={{
                      width: 44,
                      height: 44,
                      objectFit: 'cover',
                      borderRadius: '50%',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                      border: '2px solid rgba(255,250,244,0.15)',
                    }}
                  />
                  <Box>
                    <Typography variant="h6" fontWeight={800} sx={{ letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                      Agapé Café
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#d8b18a', fontWeight: 500, display: 'block' }}>
                      A little love in every cup
                    </Typography>
                  </Box>
                </Stack>
                <Typography
                  variant="body2"
                  sx={{
                    color: 'rgba(255,250,244,0.76)',
                    lineHeight: 1.65,
                    maxWidth: { xs: '100%', md: 360 },
                    fontStyle: 'italic',
                    fontSize: '0.875rem',
                  }}
                >
                  agápe [noun] [Greek] — selfless, sacrificial unconditional love of God, the highest of the four types of love.
                </Typography>
                <Stack direction="row" spacing={1.25} sx={{ pt: 0.5 }}>
                  <IconButton
                    component="a"
                    href="https://www.facebook.com/p/Agape-Caf%C3%A9-Calamba-61572641432555/"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Agapé Café on Facebook"
                    size="small"
                    sx={{
                      width: 36,
                      height: 36,
                      color: 'rgba(255,250,244,0.85)',
                      bgcolor: 'rgba(255,250,244,0.06)',
                      border: '1px solid rgba(255,250,244,0.12)',
                      '&:hover': { bgcolor: 'rgba(216, 177, 138, 0.2)', color: '#d8b18a', borderColor: '#d8b18a' },
                    }}
                  >
                    <FacebookIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                  <IconButton
                    component="a"
                    href="https://www.instagram.com/agape.cafe_/"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Agapé Café on Instagram"
                    size="small"
                    sx={{
                      width: 36,
                      height: 36,
                      color: 'rgba(255,250,244,0.85)',
                      bgcolor: 'rgba(255,250,244,0.06)',
                      border: '1px solid rgba(255,250,244,0.12)',
                      '&:hover': { bgcolor: 'rgba(216, 177, 138, 0.2)', color: '#d8b18a', borderColor: '#d8b18a' },
                    }}
                  >
                    <InstagramIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                  <IconButton
                    component="a"
                    href="https://www.tiktok.com/@agapecafe_"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Agapé Café on TikTok"
                    size="small"
                    sx={{
                      width: 36,
                      height: 36,
                      color: 'rgba(255,250,244,0.85)',
                      bgcolor: 'rgba(255,250,244,0.06)',
                      border: '1px solid rgba(255,250,244,0.12)',
                      '&:hover': { bgcolor: 'rgba(216, 177, 138, 0.2)', color: '#d8b18a', borderColor: '#d8b18a' },
                    }}
                  >
                    <SvgIcon sx={{ fontSize: 18 }}>
                      <path d="M16.6 2c.3 2.6 1.8 4.2 4.4 4.4v3.3a8.3 8.3 0 0 1-4.4-1.3v7.3a6.3 6.3 0 1 1-5.4-6.2v3.4a3 3 0 1 0 2.1 2.8V2z" />
                    </SvgIcon>
                  </IconButton>
                </Stack>
              </Stack>
            </Grid>

            {/* Column 2: Quick Links */}
            <Grid size={{ xs: 6, sm: 4, md: 2.5 }}>
              <Typography
                variant="caption"
                sx={{
                  color: '#d8b18a',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  display: 'block',
                  mb: 2,
                }}
              >
                Quick Links
              </Typography>
              <Stack spacing={1}>
                <Button
                  component={RouterLink}
                  to="/"
                  color="inherit"
                  sx={{
                    justifyContent: 'flex-start',
                    p: 0,
                    minHeight: 'auto',
                    color: 'rgba(255,250,244,0.78)',
                    fontSize: '0.875rem',
                    fontWeight: 400,
                    textTransform: 'none',
                    '&:hover': { color: '#d8b18a', bgcolor: 'transparent', pl: 0.5 },
                    transition: 'all 0.2s ease',
                  }}
                >
                  Home
                </Button>
                <Button
                  component={RouterLink}
                  to="/menu"
                  color="inherit"
                  sx={{
                    justifyContent: 'flex-start',
                    p: 0,
                    minHeight: 'auto',
                    color: 'rgba(255,250,244,0.78)',
                    fontSize: '0.875rem',
                    fontWeight: 400,
                    textTransform: 'none',
                    '&:hover': { color: '#d8b18a', bgcolor: 'transparent', pl: 0.5 },
                    transition: 'all 0.2s ease',
                  }}
                >
                  Our Menu & Orders
                </Button>
                <Button
                  component={RouterLink}
                  to="/visit"
                  color="inherit"
                  sx={{
                    justifyContent: 'flex-start',
                    p: 0,
                    minHeight: 'auto',
                    color: 'rgba(255,250,244,0.78)',
                    fontSize: '0.875rem',
                    fontWeight: 400,
                    textTransform: 'none',
                    '&:hover': { color: '#d8b18a', bgcolor: 'transparent', pl: 0.5 },
                    transition: 'all 0.2s ease',
                  }}
                >
                  Visit us
                </Button>
                <Button
                  component={RouterLink}
                  to="/about"
                  color="inherit"
                  sx={{
                    justifyContent: 'flex-start',
                    p: 0,
                    minHeight: 'auto',
                    color: 'rgba(255,250,244,0.78)',
                    fontSize: '0.875rem',
                    fontWeight: 400,
                    textTransform: 'none',
                    '&:hover': { color: '#d8b18a', bgcolor: 'transparent', pl: 0.5 },
                    transition: 'all 0.2s ease',
                  }}
                >
                  About Our Story
                </Button>
                {account ? (
                  <Button
                    component={RouterLink}
                    to={account.homePath}
                    color="inherit"
                    sx={{
                      justifyContent: 'flex-start',
                      p: 0,
                      minHeight: 'auto',
                      color: 'rgba(255,250,244,0.78)',
                      fontSize: '0.875rem',
                      fontWeight: 400,
                      textTransform: 'none',
                      '&:hover': { color: '#d8b18a', bgcolor: 'transparent', pl: 0.5 },
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {canAccessWorkspace()
                      ? 'Workspace'
                      : 'My Account'}
                  </Button>
                ) : (
                  <>
                    <Button
                      component={RouterLink}
                      to="/auth/sign-in"
                      color="inherit"
                      sx={{
                        justifyContent: 'flex-start',
                        p: 0,
                        minHeight: 'auto',
                        color: 'rgba(255,250,244,0.78)',
                        fontSize: '0.875rem',
                        fontWeight: 400,
                        textTransform: 'none',
                        '&:hover': { color: '#d8b18a', bgcolor: 'transparent', pl: 0.5 },
                        transition: 'all 0.2s ease',
                      }}
                    >
                      Sign In
                    </Button>
                    <Button
                      component={RouterLink}
                      to="/auth/sign-up"
                      color="inherit"
                      sx={{ justifyContent: 'flex-start', p: 0, minHeight: 'auto', fontSize: '0.875rem', textTransform: 'none' }}
                    >
                      Sign Up
                    </Button>
                  </>
                )}
              </Stack>
            </Grid>

            {/* Column 3: Hours & Service */}
            <Grid size={{ xs: 6, sm: 4, md: 2.5 }}>
              <Typography
                variant="caption"
                sx={{
                  color: '#d8b18a',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  display: 'block',
                  mb: 2,
                }}
              >
                Store Hours
              </Typography>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <AccessTimeOutlinedIcon sx={{ fontSize: 17, color: '#d8b18a', mt: 0.3 }} />
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: '#fffaf4', fontSize: '0.875rem' }}>
                      Mon – Sat
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'rgba(255,250,244,0.72)', display: 'block' }}>
                      12:00 PM – 10:00 PM
                    </Typography>
                  </Box>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <AccessTimeOutlinedIcon sx={{ fontSize: 17, color: '#d8b18a', mt: 0.3 }} />
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: '#fffaf4', fontSize: '0.875rem' }}>
                      Sunday
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'rgba(255,250,244,0.72)', display: 'block' }}>
                      11:00 AM – 10:00 PM
                    </Typography>
                  </Box>
                </Stack>
                <Typography variant="caption" sx={{ color: 'rgba(255,250,244,0.52)', pt: 0.5, fontStyle: 'italic', display: 'block' }}>
                  Dine-in, pick-up & delivery
                </Typography>
              </Stack>
            </Grid>

            {/* Column 4: Contact & Location */}
            <Grid size={{ xs: 12, sm: 4, md: 2.5 }}>
              <Typography
                variant="caption"
                sx={{
                  color: '#d8b18a',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  display: 'block',
                  mb: 2,
                }}
              >
                Contact
              </Typography>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <LocationOnOutlinedIcon sx={{ fontSize: 17, color: '#d8b18a', mt: 0.3, flexShrink: 0 }} />
                  <Typography variant="body2" sx={{ color: 'rgba(255,250,244,0.75)', lineHeight: 1.5, fontSize: '0.875rem' }}>
                    Calamba, Laguna
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <PhoneOutlinedIcon sx={{ fontSize: 17, color: '#d8b18a', flexShrink: 0 }} />
                  <Typography
                    component="a"
                    href="tel:+639928505785"
                    variant="body2"
                    sx={{
                      color: 'rgba(255,250,244,0.75)',
                      textDecoration: 'none',
                      fontSize: '0.875rem',
                      '&:hover': { color: '#d8b18a' },
                    }}
                  >
                    0992-850-5785
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <EmailOutlinedIcon sx={{ fontSize: 17, color: '#d8b18a', flexShrink: 0 }} />
                  <Typography
                    component="a"
                    href="mailto:agapecafecalamba@gmail.com"
                    variant="body2"
                    sx={{
                      color: 'rgba(255,250,244,0.75)',
                      textDecoration: 'none',
                      fontSize: '0.875rem',
                      minWidth: 0,
                      overflowWrap: 'anywhere',
                      '&:hover': { color: '#d8b18a' },
                    }}
                  >
                    agapecafecalamba@gmail.com
                  </Typography>
                </Stack>
              </Stack>
            </Grid>
          </Grid>

          <Divider sx={{ my: { xs: 3, md: 3.5 }, borderColor: 'rgba(255,250,244,0.08)' }} />

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            sx={{
              alignItems: 'center',
              justifyContent: 'space-between',
              textAlign: { xs: 'center', sm: 'left' },
            }}
          >
            <Typography variant="caption" sx={{ color: 'rgba(255,250,244,0.55)', fontSize: '0.8125rem' }}>
              © {currentYear} Agapé Café. All rights reserved.
            </Typography>
            <Stack direction="row" spacing={2.5}>
              <Typography
                component={RouterLink}
                to="/about"
                variant="caption"
                sx={{
                  color: 'rgba(255,250,244,0.6)',
                  textDecoration: 'none',
                  fontSize: '0.8125rem',
                  '&:hover': { color: '#d8b18a' },
                }}
              >
                About Us
              </Typography>
              <Typography
                component={RouterLink}
                to="/visit"
                variant="caption"
                sx={{
                  color: 'rgba(255,250,244,0.6)',
                  textDecoration: 'none',
                  fontSize: '0.8125rem',
                  '&:hover': { color: '#d8b18a' },
                }}
              >
                Visit us
              </Typography>
              <Typography
                component={RouterLink}
                to="/menu"
                variant="caption"
                sx={{
                  color: 'rgba(255,250,244,0.6)',
                  textDecoration: 'none',
                  fontSize: '0.8125rem',
                  '&:hover': { color: '#d8b18a' },
                }}
              >
                Menu
              </Typography>
            </Stack>
          </Stack>
        </Container>
      </Box>
      <Drawer
        anchor="right"
        open={isCartOpen}
        onClose={closeCart}
        slotProps={{
          paper: {
            sx: {
              width: { xs: '100vw', sm: 420, md: 460 },
              maxWidth: '100vw',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            },
          },
        }}
      >
        <CartSummaryPanel onCheckout={closeCart} onClose={closeCart} />
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
