import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useAuth } from '../auth/useAuth.js'
import { getAdminBranches } from '../administration/adminData.js'
import { formatPrice } from '../public/publicData.js'
import PaginationControls from '../../components/PaginationControls.jsx'
import {
  downloadCsv,
  getAllOperationalReport,
  getFinancialReport,
  getOperationalReport,
} from './reportData.js'

const DEFAULT_PAGE_SIZE = 10

function dateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function label(value) {
  return value.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ')
}

export default function AdminReportsPage() {
  const { account, hasPermission } = useAuth()
  const isSuperAdmin = account.roles.includes('super_admin')
  const canExport = isSuperAdmin || hasPermission('reports', 'export')
  const canViewFinancials = isSuperAdmin || hasPermission('financials', 'view')
  const [branches, setBranches] = useState([])
  const [branchesLoaded, setBranchesLoaded] = useState(false)
  const [branchId, setBranchId] = useState('')
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 29)
    return dateString(date)
  })
  const [endDate, setEndDate] = useState(() => dateString(new Date()))
  const [orders, setOrders] = useState([])
  const [financialSummary, setFinancialSummary] = useState(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    getAdminBranches(account)
      .then((data) => {
        if (!active) return
        setBranches(data)
        if (!isSuperAdmin) setBranchId(data[0]?.id || '')
        setBranchesLoaded(true)
        if (!isSuperAdmin && !data.length) setIsLoading(false)
      })
      .catch((error) => {
        console.error('Unable to load branches for reports.', error)
        if (active) {
          setErrorMessage(error.message)
          setIsLoading(false)
        }
      })
    return () => { active = false }
  }, [account, isSuperAdmin])

  useEffect(() => {
    if (!branchesLoaded || (!isSuperAdmin && !branchId)) return undefined
    let active = true
    getOperationalReport(branchId, startDate, endDate, page, pageSize)
      .then((data) => { if (active) setOrders(data) })
      .catch((error) => {
        console.error('Unable to load operational report.', error)
        if (active) setErrorMessage(error.message)
      })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [branchId, branchesLoaded, endDate, isSuperAdmin, page, pageSize, reloadKey, startDate])

  useEffect(() => {
    if (!branchesLoaded || (!isSuperAdmin && !branchId)) return undefined
    if (!canViewFinancials) return undefined
    let active = true
    getFinancialReport(branchId, startDate, endDate)
      .then((summary) => { if (active) setFinancialSummary(summary) })
      .catch((error) => {
        console.error('Unable to load financial totals for reports.', error)
        if (active) setErrorMessage(error.message)
      })
    return () => { active = false }
  }, [branchId, branchesLoaded, canViewFinancials, endDate, isSuperAdmin, reloadKey, startDate])

  const completedOrders = orders.filter((order) => order.status === 'completed')
  const completedSales = completedOrders.reduce((sum, order) => sum + Number(order.total), 0)

  async function exportReport() {
    setIsExporting(true)
    setErrorMessage('')
    try {
      const allOrders = await getAllOperationalReport(branchId, startDate, endDate)
      downloadCsv(
        `agape-orders-${startDate}-to-${endDate}.csv`,
        ['Order number', 'Branch', 'Created at', 'Status', 'Payment status', 'Paid amount', 'Customer', 'Fulfillment', 'Subtotal', 'Discounts', 'Total', 'Items'],
        allOrders.map((order) => [
          order.order_number,
          order.branch_name,
          order.created_at,
          order.status,
          order.payment_status,
          order.paid_amount,
          order.customer_name,
          order.fulfillment_method,
          order.subtotal,
          order.discount_total,
          order.total,
          order.items.map((item) => `${item.quantity}x ${item.product_name}${item.variant_name ? ` (${item.variant_name})` : ''}`).join('; '),
        ]),
      )
    } catch (error) {
      console.error('Unable to export operational report.', error)
      setErrorMessage(error.message)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="primary">Agapé Café · Reporting</Typography>
          <Typography variant="h2">Operations reports</Typography>
          <Typography color="text.secondary">
            Review order activity and export branch-scoped order details as CSV.
            Completed sales and paid collections are shown separately for clarity.
          </Typography>
        </Box>
        {!isSuperAdmin && !branches.length && branchesLoaded && (
          <Alert severity="info">No assigned branches are available for reporting.</Alert>
        )}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            useFlexGap
            sx={{ alignItems: { md: 'center' }, flexWrap: { md: 'wrap' } }}
          >
            <FormControl fullWidth={false} sx={{ width: { xs: '100%', sm: 220 }, flexShrink: 0 }}>
              <InputLabel id="reports-branch-label">Branch</InputLabel>
              <Select
                labelId="reports-branch-label"
                label="Branch"
                value={branchId}
                onChange={(event) => {
                  setIsLoading(true)
                  setErrorMessage('')
                  setFinancialSummary(null)
                  setPage(0)
                  setBranchId(event.target.value)
                }}
              >
                {isSuperAdmin && <MenuItem value="">All branches</MenuItem>}
                {branches.map((branch) => (
                  <MenuItem key={branch.id} value={branch.id}>{branch.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              fullWidth={false}
              label="From"
              type="date"
              sx={{ width: { xs: '100%', sm: 160 }, flexShrink: 0 }}
              value={startDate}
              onChange={(event) => {
                setIsLoading(true)
                setErrorMessage('')
                setFinancialSummary(null)
                setPage(0)
                setStartDate(event.target.value)
              }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: endDate } }}
            />
            <TextField
              fullWidth={false}
              label="To"
              type="date"
              sx={{ width: { xs: '100%', sm: 160 }, flexShrink: 0 }}
              value={endDate}
              onChange={(event) => {
                setIsLoading(true)
                setErrorMessage('')
                setFinancialSummary(null)
                setPage(0)
                setEndDate(event.target.value)
              }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: startDate } }}
            />
            <Button variant="outlined" onClick={() => {
              setIsLoading(true)
              setErrorMessage('')
              setFinancialSummary(null)
              setPage(0)
              setReloadKey((key) => key + 1)
            }} sx={{ minWidth: 96, flexShrink: 0 }}>
              Refresh
            </Button>
            {canExport && (
              <Button
                variant="contained"
                sx={{ minWidth: 144, flexShrink: 0 }}
                onClick={() => void exportReport()}
                disabled={isLoading || isExporting || Boolean(errorMessage)}
              >
                {isExporting ? 'Preparing CSV…' : 'Export all CSV'}
              </Button>
            )}
          </Stack>
        </Paper>
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        {isLoading ? (
          <Stack sx={{ alignItems: 'center', py: 8 }}><CircularProgress /></Stack>
        ) : errorMessage ? null : (
          <>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                <Typography variant="body2" color="text.secondary">Orders on this page</Typography>
                <Typography variant="h5">{orders.length}</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                <Typography variant="body2" color="text.secondary">Completed orders on this page</Typography>
                <Typography variant="h5">{completedOrders.length}</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
                <Typography variant="body2" color="text.secondary">Completed sales on this page</Typography>
                <Typography variant="h5">{formatPrice(completedSales)}</Typography>
              </Paper>
            </Stack>
            {canViewFinancials && financialSummary && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
                <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 170 }}>
                  <Typography variant="body2" color="text.secondary">Payments collected · date range</Typography>
                  <Typography variant="h5">{formatPrice(financialSummary.collected_sales)}</Typography>
                  <Typography variant="caption" color="text.secondary">{financialSummary.paid_orders} paid order(s)</Typography>
                </Paper>
                <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 170 }}>
                  <Typography variant="body2" color="text.secondary">Estimated inventory cost · completed orders</Typography>
                  <Typography variant="h5">
                    {financialSummary.cost_of_goods == null ? 'Incomplete' : formatPrice(financialSummary.cost_of_goods)}
                  </Typography>
                </Paper>
                <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 170 }}>
                  <Typography variant="body2" color="text.secondary">Recorded branch expenses · date range</Typography>
                  <Typography variant="h5">{formatPrice(financialSummary.expenses)}</Typography>
                </Paper>
              </Stack>
            )}
            {financialSummary && Number(financialSummary.uncosted_orders) > 0 && (
              <Alert severity="warning">
                Estimated inventory cost is incomplete for {financialSummary.uncosted_orders} completed order(s).
                Add unit cost to inventory receipts before those orders are completed to include their ingredient costs.
              </Alert>
            )}
            {!orders.length && !errorMessage ? (
              <Alert severity="info">No orders were found on this page for the selected date range.</Alert>
            ) : (
              orders.map((order) => (
                <Paper key={order.order_id} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
                  <Stack spacing={1}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
                      <Box>
                        <Typography variant="h6">{order.order_number} · {order.branch_name}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {new Date(order.created_at).toLocaleString()} · {order.customer_name}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={1}>
                        <Chip size="small" label={label(order.status)} />
                        <Chip size="small" variant="outlined" label={`Payment ${label(order.payment_status)}`} />
                      </Stack>
                    </Stack>
                    <Typography variant="body2">
                      {order.items.map((item) =>
                        `${item.quantity}× ${item.product_name}${item.variant_name ? ` (${item.variant_name})` : ''}`,
                      ).join(' · ')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {label(order.fulfillment_method)} · Subtotal {formatPrice(order.subtotal)}
                      {' · '}Discount {formatPrice(order.discount_total)}{' · '}Total {formatPrice(order.total)}
                      {' · '}Paid {formatPrice(order.paid_amount)}
                    </Typography>
                  </Stack>
                </Paper>
              ))
            )}
            {!errorMessage && (orders.length > 0 || page > 0) && (
              <PaginationControls
                page={page}
                pageSize={pageSize}
                hasNextPage={orders.length === pageSize}
                isLoading={isLoading}
                onChange={(nextPage, nextPageSize) => {
                  setIsLoading(true)
                  setPage(nextPage)
                  setPageSize(nextPageSize)
                }}
              />
            )}
          </>
        )}
      </Stack>
    </Container>
  )
}
