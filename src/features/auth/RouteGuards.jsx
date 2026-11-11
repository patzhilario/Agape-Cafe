import PointOfSaleOutlinedIcon from '@mui/icons-material/PointOfSaleOutlined'
import { getStoreBranchId } from '../public/publicData.js'
import { lazy, useEffect, useRef, useState } from 'react'
import {
  Alert,
  AppBar,
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Snackbar,
  Stack,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { Link as RouterLink, Navigate, useLocation } from 'react-router-dom'
import MenuIcon from '@mui/icons-material/Menu'
import DashboardIcon from '@mui/icons-material/Dashboard'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import Inventory2Icon from '@mui/icons-material/Inventory2'
import CampaignIcon from '@mui/icons-material/Campaign'
import DiscountIcon from '@mui/icons-material/Discount'
import AssessmentIcon from '@mui/icons-material/Assessment'
import PaymentsIcon from '@mui/icons-material/Payments'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import HistoryIcon from '@mui/icons-material/History'
import LogoutIcon from '@mui/icons-material/Logout'
import { useAuth } from './useAuth.js'
import logo from '../../assets/logo.jpg'
import { getSupabaseClient } from '../../lib/supabaseClient.js'

const StaffPOSPage = lazy(() => import('../administration/StaffPOSPage.jsx'))
const AccessManagementPage = lazy(() => import('./AccessManagementPage.jsx'))
const AdminAuditPage = lazy(() => import('./AdminAuditPage.jsx'))
const AdminStoreSettingsPage = lazy(() => import('../administration/AdminStoreSettingsPage.jsx'))
const AdminInventoryPage = lazy(() => import('../administration/AdminInventoryPage.jsx'))
const AdminMenuPage = lazy(() => import('../administration/AdminMenuPage.jsx'))
const AdminOrdersPage = lazy(() => import('../administration/AdminOrdersPage.jsx'))
const AdminPromotionsPage = lazy(() => import('../administration/AdminPromotionsPage.jsx'))
const AdminBenefitPolicyPage = lazy(() => import('../discounts/AdminBenefitPolicyPage.jsx'))
const AdminReportsPage = lazy(() => import('../reporting/AdminReportsPage.jsx'))
const AdminFinancialsPage = lazy(() => import('../reporting/AdminFinancialsPage.jsx'))

export function RequireAuth({ children, roles }) {
  const { account, authError, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <Stack sx={{ alignItems: 'center', py: 10 }} spacing={2}>
        <CircularProgress />
        <Typography color="text.secondary">Checking access…</Typography>
      </Stack>
    )
  }

  if (!account) {
    const next = `${location.pathname}${location.search}`
    return (
      <Navigate
        to={`/auth/sign-in?next=${encodeURIComponent(next)}`}
        replace
        state={{ message: authError }}
      />
    )
  }

  if (roles && !roles.some((role) => account.roles.includes(role))) {
    return <AccessDenied />
  }

  return children
}

export function AdminArea() {
  const { account, session, hasPermission, signOut } = useAuth()
  const location = useLocation()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const [openOrdersCount, setOpenOrdersCount] = useState(0)
  const mobileMenuButtonRef = useRef(null)
  const isAdmin = account.roles.includes('admin')
  const canViewOrders = isAdmin || hasPermission('orders', 'view')
  const googleAvatarUrl =
    account.google_avatar_url ||
    session?.user?.user_metadata?.avatar_url ||
    session?.user?.user_metadata?.picture ||
    ''
  const accountName =
    account.display_name ||
    session?.user?.user_metadata?.full_name ||
    session?.user?.user_metadata?.name ||
    account.email
  const roleLabels = {
    customer: 'Customer',
    staff: 'Staff',
    admin: 'Admin',
  }
  const accountRole = isAdmin
    ? 'Admin'
    : account.roles.map((role) => roleLabels[role] || role).join(', ')
  const sections = [
    { path: '', module: '', label: 'Overview', icon: DashboardIcon, group: 'Workspace' },
    { path: 'orders', module: 'orders', label: 'Orders', icon: ReceiptLongIcon, group: 'Daily operations' },
    ...((isAdmin || (hasPermission('orders', 'view') && hasPermission('orders', 'create'))) ? [{ path: 'pos', module: 'orders', label: 'POS', icon: PointOfSaleOutlinedIcon, group: 'Daily operations' }] : []),
    { path: 'menu', module: 'menu', label: 'Menu', icon: MenuBookIcon, group: 'Menu and stock' },
    { path: 'inventory', module: 'inventory', label: 'Inventory', icon: Inventory2Icon, group: 'Menu and stock' },
    ...(isAdmin ? [{ path: 'promotions', module: 'promotions', label: 'Promotions', icon: CampaignIcon, group: 'Sales and benefits' }] : []),
    ...(isAdmin ? [{ path: 'benefit-policy', module: 'promotions', label: 'Benefit policy', icon: DiscountIcon, group: 'Sales and benefits' }] : []),
    { path: 'reports', module: 'reports', label: 'Reports', icon: AssessmentIcon, group: 'Performance' },
    { path: 'financials', module: 'financials', label: 'Financials', icon: PaymentsIcon, group: 'Performance' },
    ...(isAdmin ? [
      { path: 'permissions', module: 'staff', label: 'Account management', icon: AdminPanelSettingsIcon, group: 'Administration' },
      { path: 'audit', module: '', label: 'Audit trail', icon: HistoryIcon, group: 'Administration' },
      { path: 'settings', module: '', label: 'Store settings', icon: Inventory2Icon, group: 'Administration' },
    ] : []),
  ]
  const sectionPath = location.pathname.replace(/^\/admin\/?/, '').split('/')[0]
  const currentSection = sections.find((section) => section.path === sectionPath)
  const visibleSections = sections.filter(
    (section) => !section.module || isAdmin || hasPermission(section.module, 'view'),
  )
  const navigationGroups = [...new Set(visibleSections.map((section) => section.group))]
  useEffect(() => {
    if (!canViewOrders) return undefined

    let active = true
    async function loadOpenOrdersCount() {
      try {
        const { count, error } = await getSupabaseClient()
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
          .eq('branch_id', await getStoreBranchId())
        if (error) throw new Error(error.message)
        if (active) setOpenOrdersCount(count || 0)
      } catch (error) {
        console.error('Unable to load the open order count for navigation.', error)
      }
    }

    void loadOpenOrdersCount()
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadOpenOrdersCount()
    }, 30_000)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void loadOpenOrdersCount()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      active = false
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [canViewOrders])
  const isDeniedRoute = (sectionPath && !currentSection) ||
    (sectionPath === 'permissions' && !isAdmin) ||
    (currentSection?.module && !hasPermission(currentSection.module, 'view') && !isAdmin)

  let pageContent
  if (sectionPath === 'branches' && isAdmin) pageContent = <Navigate to="/admin/settings" replace />
  else if (isDeniedRoute) pageContent = <AccessDenied to="/admin" />
  else if (sectionPath === 'permissions') pageContent = <AccessManagementPage />
  else if (sectionPath === 'audit') pageContent = <AdminAuditPage />
  else if (sectionPath === 'settings' && isAdmin) pageContent = <AdminStoreSettingsPage />
  else if (sectionPath === 'settings') pageContent = <AccessDenied to="/admin" />
  else if (sectionPath === 'pos') pageContent = <StaffPOSPage />
  else if (sectionPath === 'orders') pageContent = <AdminOrdersPage />
  else if (sectionPath === 'menu') pageContent = <AdminMenuPage />
  else if (sectionPath === 'inventory') pageContent = <AdminInventoryPage />
  else if (sectionPath === 'promotions' && isAdmin) pageContent = <AdminPromotionsPage />
  else if (sectionPath === 'benefit-policy' && isAdmin) pageContent = <AdminBenefitPolicyPage />
  else if (sectionPath === 'reports') pageContent = <AdminReportsPage />
  else if (sectionPath === 'financials') pageContent = <AdminFinancialsPage />
  else {
    pageContent = (
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="overline" color="primary">Agapé Café · Administration</Typography>
            <Typography variant="h2">Workspace</Typography>
            <Typography color="text.secondary">
              Welcome, {account.display_name || account.email}. Choose a workspace
              below to manage your store operations.
            </Typography>
          </Box>
          <Box>
          <Typography variant="h6" gutterBottom>Available workspaces</Typography>
          <Stack spacing={3}>
            {navigationGroups.map((group) => {
              const groupSections = visibleSections.filter(
                (section) => section.group === group && section.path,
              )
              if (!groupSections.length) return null
              return (
                <Box key={group}>
                  <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
                    {group}
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: { xs: 1.5, sm: 2 } }}>
                    {groupSections.map((section) => (
                      <Paper
                        key={section.path}
                        component={RouterLink}
                        to={`/admin/${section.path}`}
                        variant="outlined"
                        sx={{
                          p: { xs: 2, sm: 2.5 },
                          minWidth: 0,
                          textDecoration: 'none',
                          color: 'inherit',
                          transition: 'transform 150ms ease, border-color 150ms ease',
                          '&:hover': { borderColor: 'primary.main', transform: 'translateY(-2px)' },
                        }}
                      >
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
                          <Box sx={{
                            width: 40,
                            height: 40,
                            flexShrink: 0,
                            borderRadius: 2,
                            display: 'grid',
                            placeItems: 'center',
                            bgcolor: 'action.hover',
                          }}>
                            <section.icon color="primary" fontSize="small" />
                          </Box>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="subtitle1" fontWeight={700} noWrap>
                              {section.label}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" noWrap>
                              Open {section.label.toLowerCase()}
                            </Typography>
                          </Box>
                        </Stack>
                      </Paper>
                    ))}
                  </Box>
                </Box>
              )
            })}
          </Stack>
            {!visibleSections.some((section) => section.path) && (
              <Alert severity="info">No workspaces are assigned yet. Contact an Admin to get module access.</Alert>
            )}
          </Box>
        </Stack>
      </Container>
    )
  }

  const drawerContent = (
    <Stack sx={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <Box sx={{ px: 2.5, py: 3 }}>
        <Box
          component={RouterLink}
          to="/"
          aria-label="Agapé Café home"
          sx={{
            display: 'block',
            position: 'relative',
            width: '100%',
            maxWidth: 220,
            height: 68,
            overflow: 'hidden',
          }}
        >
          <Box
            component="img"
            src={logo}
            alt="Agapé Café"
            sx={{
              width: 300,
              height: 300,
              maxWidth: 'none',
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary">Workspace</Typography>
      </Box>
      <Divider />
      <Box sx={{ px: 2, py: 1.75 }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }}>
          <Avatar
            src={googleAvatarUrl || undefined}
            alt={accountName}
            sx={{ width: 42, height: 42, fontSize: '1rem', fontWeight: 700 }}
          >
            {accountName?.trim()?.charAt(0)?.toUpperCase() || '?'}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography fontWeight={700} noWrap title={accountName}>
              {accountName}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap title={account.email}>
              {account.email}
            </Typography>
            <Chip
              size="small"
              label={accountRole || 'Account'}
              sx={{ mt: 0.5, height: 22, maxWidth: '100%', '& .MuiChip-label': { px: 1 } }}
            />
          </Box>
        </Stack>
      </Box>
      <Divider />
      <List sx={{ px: 1, py: 1, flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {navigationGroups.map((group) => (
          <Box key={group} sx={{ mb: 1 }}>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ px: 2, lineHeight: 2.5 }}
            >
              {group}
            </Typography>
            {visibleSections.filter((section) => section.group === group).map((section) => {
              const Icon = section.icon
              const to = section.path ? `/admin/${section.path}` : '/admin'
              const selected = location.pathname.replace(/\/$/, '') === to
              return (
                <ListItemButton
                  key={section.path || 'overview'}
                  component={RouterLink}
                  to={to}
                  selected={selected}
                  onClick={() => setDrawerOpen(false)}
                  sx={{ borderRadius: 2, mb: 0.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    {section.path === 'orders' ? (
                      <Badge
                        badgeContent={openOrdersCount}
                        color="error"
                        max={99}
                        invisible={openOrdersCount === 0}
                      >
                        <Icon fontSize="small" />
                      </Badge>
                    ) : (
                      <Icon fontSize="small" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={section.label}
                    secondary={section.path === 'orders' && openOrdersCount
                      ? `${openOrdersCount} open ${openOrdersCount === 1 ? 'order' : 'orders'}`
                      : undefined}
                  />
                </ListItemButton>
              )
            })}
          </Box>
        ))}
      </List>
      <Divider />
      <Button
        color="inherit"
        startIcon={<LogoutIcon />}
        onClick={async () => {
          try {
            await signOut()
          } catch (error) {
            setSignOutError(error.message)
          }
        }}
        sx={{ justifyContent: 'flex-start', mx: 1, my: 1, px: 2 }}
      >
        Sign out
      </Button>
    </Stack>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={!isMobile || drawerOpen}
        onClose={() => setDrawerOpen(false)}
        ModalProps={{ keepMounted: true, disableRestoreFocus: true }}
        slotProps={{
          transition: {
            onExited: () => {
              if (isMobile) {
                window.requestAnimationFrame(() => mobileMenuButtonRef.current?.focus())
              }
            },
          },
        }}
        sx={{
          width: 260,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: 260,
            boxSizing: 'border-box',
            overflow: 'hidden',
          },
        }}
      >
        {drawerContent}
      </Drawer>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Toolbar>
            {isMobile && (
              <IconButton
                ref={mobileMenuButtonRef}
                edge="start"
                onClick={(event) => {
                  event.currentTarget.blur()
                  setDrawerOpen(true)
                }}
                aria-label="Open admin navigation"
                sx={{ mr: 1 }}
              >
                <MenuIcon />
              </IconButton>
            )}
            <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
              {sections.find((section) => section.path === sectionPath)?.label || 'Overview'}
            </Typography>
            <Button component={RouterLink} to="/" size="small">View storefront</Button>
          </Toolbar>
        </AppBar>
        <Box component="main" sx={{ minHeight: 'calc(100vh - 64px)' }}>{pageContent}</Box>
      </Box>
      <Snackbar open={Boolean(signOutError)} autoHideDuration={6000} onClose={() => setSignOutError('')}>
        <Alert severity="error" onClose={() => setSignOutError('')}>{signOutError}</Alert>
      </Snackbar>
    </Box>
  )
}

export function CustomerArea() {
  const { account } = useAuth()
  return (
    <Container maxWidth="md" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack spacing={2}>
        <Typography variant="overline" color="primary">
          Agapé Café · Customer account
        </Typography>
        <Typography variant="h2">Welcome{account.display_name ? `, ${account.display_name}` : ''}</Typography>
        <Typography color="text.secondary">
          Review your past orders or explore the menu to start a new order.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ pt: 1 }}>
          <Button component={RouterLink} to="/customer/orders" variant="contained">
            Order history
          </Button>
          <Button component={RouterLink} to="/customer/profile" variant="outlined">
            Account settings
          </Button>
          <Button component={RouterLink} to="/menu" variant="outlined">
            Browse menu
          </Button>
        </Stack>
      </Stack>
    </Container>
  )
}

export function AccessDenied({ to = '/' }) {
  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Alert severity="warning" sx={{ mb: 3 }}>
        You do not have permission to access this page.
      </Alert>
      <Button component={RouterLink} to={to} variant="contained">
        {to === '/admin' ? 'Return to workspace' : 'Return home'}
      </Button>
    </Container>
  )
}
