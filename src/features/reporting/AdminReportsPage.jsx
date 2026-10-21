import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useAuth } from '../auth/useAuth.js'
import { getAdminBranches } from '../administration/adminData.js'
import { formatPrice } from '../public/publicData.js'
import PaginationControls from '../../components/PaginationControls.jsx'
import {
  downloadCsv,
  getAllProductSalesReport,
  getAllPaymentTransactions,
  getPaymentRefundHistory,
  getReportPaymentMethods,
  recordPaymentRefund,
} from './reportData.js'

const DEFAULT_PAGE_SIZE = 50

function dateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function label(value) {
  return value.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ')
}

function transactionDate(transaction) {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(transaction.updated_at))
}

function orderDate(transaction) {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(transaction.order_created_at))
}

function salesPeriodLabel(value, grouping) {
  if (grouping === 'year') return value.slice(0, 4)
  const periodDate = new Date(`${value}T12:00:00`)
  return grouping === 'month'
    ? new Intl.DateTimeFormat('en-PH', {
        month: 'long',
        timeZone: 'Asia/Manila',
        year: 'numeric',
      }).format(periodDate)
    : new Intl.DateTimeFormat('en-PH', {
        dateStyle: 'medium',
        timeZone: 'Asia/Manila',
      }).format(periodDate)
}

function paymentStatus(transaction) {
  if (Number(transaction.amount) > 0 &&
      Number(transaction.refund_amount) >= Number(transaction.amount)) return 'refunded'
  if (Number(transaction.refund_amount) > 0) return 'partially_refunded'
  return transaction.status
}

export default function AdminReportsPage() {
  const { account, hasPermission } = useAuth()
  const isSuperAdmin = account.roles.includes('super_admin')
  const canViewReports = isSuperAdmin || hasPermission('reports', 'view')
  const canViewFinancials = isSuperAdmin || hasPermission('financials', 'view')
  const canRecordRefund = isSuperAdmin || hasPermission('financials', 'edit')
  const canExport = isSuperAdmin || hasPermission('reports', 'export')
  const [branches, setBranches] = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])
  const [branchesLoaded, setBranchesLoaded] = useState(false)
  const [branchId, setBranchId] = useState('')
  const [paymentMethodCode, setPaymentMethodCode] = useState('')
  const [reportView, setReportView] = useState(canViewFinancials ? 'transactions' : 'products')
  const [salesGrouping, setSalesGrouping] = useState('day')
  const [salesCategory, setSalesCategory] = useState('')
  const [salesProduct, setSalesProduct] = useState('')
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 29)
    return dateString(date)
  })
  const [endDate, setEndDate] = useState(() => dateString(new Date()))
  const [transactions, setTransactions] = useState([])
  const [productSales, setProductSales] = useState([])
  const [refundHistory, setRefundHistory] = useState([])
  const [selectedTransaction, setSelectedTransaction] = useState(null)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundNote, setRefundNote] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefundHistoryLoading, setIsRefundHistoryLoading] = useState(false)
  const [isSavingRefund, setIsSavingRefund] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    Promise.all([getAdminBranches(account), getReportPaymentMethods()])
      .then(([loadedBranches, loadedMethods]) => {
        if (!active) return
        setBranches(loadedBranches)
        setPaymentMethods(loadedMethods)
        if (!isSuperAdmin) setBranchId(loadedBranches[0]?.id || '')
        setBranchesLoaded(true)
      })
      .catch((error) => {
        console.error('Unable to load report filters.', error)
        if (active) {
          setErrorMessage(error.message)
          setIsLoading(false)
        }
      })
    return () => { active = false }
  }, [account, isSuperAdmin])

  useEffect(() => {
    if (
      !branchesLoaded ||
      !canViewReports ||
      reportView !== 'transactions' ||
      !canViewFinancials ||
      (!isSuperAdmin && !branchId)
    ) {
      return undefined
    }
    let active = true
    getAllPaymentTransactions(branchId, paymentMethodCode, startDate, endDate)
      .then((data) => {
        if (!active) return
        setTransactions(data)
      })
      .catch((error) => {
        console.error('Unable to load transactions report.', error)
        if (active) setErrorMessage(error.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [
    branchId,
    branchesLoaded,
    canViewFinancials,
    canViewReports,
    endDate,
    isSuperAdmin,
    paymentMethodCode,
    reloadKey,
    reportView,
    startDate,
  ])

  useEffect(() => {
    if (
      !branchesLoaded ||
      !canViewReports ||
      reportView !== 'products' ||
      (!isSuperAdmin && !branchId)
    ) {
      return undefined
    }
    let active = true
    getAllProductSalesReport(branchId, startDate, endDate, salesGrouping)
      .then((data) => {
        if (active) setProductSales(data)
      })
      .catch((error) => {
        console.error('Unable to load product sales report.', error)
        if (active) setErrorMessage(error.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [
    branchId,
    branchesLoaded,
    canViewReports,
    endDate,
    isSuperAdmin,
    reloadKey,
    reportView,
    salesGrouping,
    startDate,
  ])

  const salesCategories = [...new Set(productSales.map((row) => row.category_name))]
    .sort((first, second) => first.localeCompare(second))
  const salesProducts = [...new Set(
    productSales
      .filter((row) => !salesCategory || row.category_name === salesCategory)
      .map((row) => row.product_name),
  )].sort((first, second) => first.localeCompare(second))
  const filteredProductSales = productSales.filter((row) =>
    (!salesCategory || row.category_name === salesCategory) &&
    (!salesProduct || row.product_name === salesProduct),
  )
  const visibleProductSales = filteredProductSales.slice(page * pageSize, (page + 1) * pageSize)
  const visibleTransactions = transactions.slice(page * pageSize, (page + 1) * pageSize)
  const productSalesTotals = filteredProductSales.reduce((totals, row) => ({
    unitsSold: totals.unitsSold + Number(row.units_sold),
    productOrders: totals.productOrders + Number(row.order_count),
    grossSales: totals.grossSales + Number(row.gross_sales),
    netSales: totals.netSales + Number(row.net_sales),
  }), { unitsSold: 0, productOrders: 0, grossSales: 0, netSales: 0 })
  const transactionTotals = transactions.reduce((totals, transaction) => ({
    paymentAmount: totals.paymentAmount + Number(transaction.amount),
    refundCount: totals.refundCount + Number(transaction.refund_count),
    refundAmount: totals.refundAmount + Number(transaction.refund_amount),
    netAmount: totals.netAmount +
      Number(transaction.amount) - Number(transaction.refund_amount),
  }), { paymentAmount: 0, refundCount: 0, refundAmount: 0, netAmount: 0 })

  async function openTransaction(transaction) {
    setSelectedTransaction(transaction)
    setRefundHistory([])
    setRefundAmount('')
    setRefundNote('')
    setErrorMessage('')
    setSuccessMessage('')
    setIsRefundHistoryLoading(true)
    try {
      const history = await getPaymentRefundHistory(transaction.payment_id)
      setRefundHistory(history)
    } catch (error) {
      console.error('Unable to load payment refund history.', error)
      setErrorMessage(error.message)
    } finally {
      setIsRefundHistoryLoading(false)
    }
  }

  async function saveRefund(event) {
    event.preventDefault()
    if (!selectedTransaction) return
    const note = refundNote.trim()
    if (note.length < 3) {
      setErrorMessage('Enter a note of at least 3 characters for this refund.')
      return
    }

    setIsSavingRefund(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      await recordPaymentRefund(selectedTransaction.payment_id, refundAmount, note)
      const history = await getPaymentRefundHistory(selectedTransaction.payment_id)
      setRefundHistory(history)
      setRefundAmount('')
      setRefundNote('')
      setSuccessMessage('Refund record saved.')
      setIsLoading(true)
      setReloadKey((key) => key + 1)
    } catch (error) {
      console.error('Unable to save payment refund record.', error)
      setErrorMessage(error.message)
    } finally {
      setIsSavingRefund(false)
    }
  }

  async function exportReport() {
    setIsExporting(true)
    setErrorMessage('')
    try {
      if (reportView === 'products') {
        const rows = filteredProductSales
        downloadCsv(
          `agape-product-sales-${salesGrouping}-${startDate}-to-${endDate}.csv`,
          ['Period', 'Product', 'Category', 'Units sold', 'Orders', 'Gross line sales', 'Line sales after item discounts'],
          rows.map((row) => [
            row.period_start,
            row.product_name,
            row.category_name,
            row.units_sold,
            row.order_count,
            row.gross_sales,
            row.net_sales,
          ]),
        )
      } else {
        const allTransactions = await getAllPaymentTransactions(
          branchId,
          paymentMethodCode,
          startDate,
          endDate,
        )
        downloadCsv(
          `agape-payments-${startDate}-to-${endDate}.csv`,
          [
            'Branch',
            'Order number',
            'Order date',
            'Payment updated at',
            'Customer',
            'Payment type',
            'Payment status',
            'Payment amount',
            'Refund transactions',
            'Refund amount',
            'Net amount',
          ],
          allTransactions.map((transaction) => [
            transaction.branch_name,
            transaction.order_number,
            transaction.order_created_at,
            transaction.updated_at,
            transaction.customer_name,
            transaction.payment_method_name,
            transaction.status,
            transaction.amount,
            transaction.refund_count,
            transaction.refund_amount,
            Number(transaction.amount) - Number(transaction.refund_amount),
          ]),
        )
      }
    } catch (error) {
      console.error(`Unable to export ${reportView} report.`, error)
      setErrorMessage(error.message)
    } finally {
      setIsExporting(false)
    }
  }

  const totalRefunded = refundHistory.reduce((sum, refund) => sum + Number(refund.amount), 0)
  const remainingRefundable = selectedTransaction
    ? Math.max(0, Number(selectedTransaction.amount) - totalRefunded)
    : 0
  const selectedPaymentIsRefundable = selectedTransaction &&
    ['paid', 'partially_refunded'].includes(selectedTransaction.status) &&
    remainingRefundable > 0

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="primary">Agapé Café · Reporting</Typography>
          <Typography variant="h2">Reports</Typography>
          <Typography color="text.secondary">
            View payment activity or see which products sold during a selected period.
          </Typography>
        </Box>
        {!canViewReports && (
          <Alert severity="info">Reports view permission is required to view reports.</Alert>
        )}
        {!isSuperAdmin && !branches.length && branchesLoaded && (
          <Alert severity="info">No assigned branches are available for reporting.</Alert>
        )}
        {canViewReports && (
          <>
            <Tabs
              value={reportView}
              onChange={(_, nextView) => {
                setIsLoading(true)
                setErrorMessage('')
                setSuccessMessage('')
                setPage(0)
                setReportView(nextView)
              }}
              aria-label="Report type"
            >
              {canViewFinancials && <Tab value="transactions" label="Payment transactions" />}
              <Tab value="products" label="Product sales" />
            </Tabs>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={2}
                useFlexGap
                sx={{ alignItems: { md: 'center' }, flexWrap: { md: 'wrap' } }}
              >
                <FormControl sx={{ width: { xs: '100%', sm: 240 }, flexShrink: 0 }}>
                  <InputLabel id="reports-branch-label">Branch</InputLabel>
                  <Select
                    labelId="reports-branch-label"
                    label="Branch"
                    value={branchId}
                    onChange={(event) => {
                      setIsLoading(true)
                      setErrorMessage('')
                      setPage(0)
                      setSalesCategory('')
                      setSalesProduct('')
                      setBranchId(event.target.value)
                    }}
                  >
                    {isSuperAdmin && <MenuItem value="">All branches</MenuItem>}
                    {branches.map((branch) => (
                      <MenuItem key={branch.id} value={branch.id}>{branch.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {reportView === 'transactions' ? (
                  <>
                    <FormControl sx={{ width: { xs: '100%', sm: 210 }, flexShrink: 0 }}>
                      <InputLabel id="reports-method-label">Payment type</InputLabel>
                      <Select
                        labelId="reports-method-label"
                        label="Payment type"
                        value={paymentMethodCode}
                        onChange={(event) => {
                          setIsLoading(true)
                          setErrorMessage('')
                          setPage(0)
                          setPaymentMethodCode(event.target.value)
                        }}
                      >
                        <MenuItem value="">All payment types</MenuItem>
                        {paymentMethods.map((method) => (
                          <MenuItem key={method.code} value={method.code}>{method.name}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </>
                ) : (
                  <FormControl sx={{ width: { xs: '100%', sm: 210 }, flexShrink: 0 }}>
                    <InputLabel id="sales-grouping-label">Group by</InputLabel>
                    <Select
                      labelId="sales-grouping-label"
                      label="Group by"
                      value={salesGrouping}
                      onChange={(event) => {
                        setIsLoading(true)
                        setErrorMessage('')
                        setPage(0)
                        setSalesCategory('')
                        setSalesProduct('')
                        setSalesGrouping(event.target.value)
                      }}
                    >
                      <MenuItem value="day">Day</MenuItem>
                      <MenuItem value="month">Month</MenuItem>
                      <MenuItem value="year">Year</MenuItem>
                    </Select>
                  </FormControl>
                )}
                {reportView === 'products' && (
                  <>
                    <FormControl sx={{ width: { xs: '100%', sm: 210 }, flexShrink: 0 }}>
                      <InputLabel id="sales-category-label">Category</InputLabel>
                      <Select
                        labelId="sales-category-label"
                        label="Category"
                        value={salesCategory}
                        onChange={(event) => {
                          setPage(0)
                          setSalesCategory(event.target.value)
                          setSalesProduct('')
                        }}
                      >
                        <MenuItem value="">All categories</MenuItem>
                        {salesCategories.map((category) => (
                          <MenuItem key={category} value={category}>{category}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl sx={{ width: { xs: '100%', sm: 210 }, flexShrink: 0 }}>
                      <InputLabel id="sales-product-label">Product</InputLabel>
                      <Select
                        labelId="sales-product-label"
                        label="Product"
                        value={salesProduct}
                        onChange={(event) => {
                          setPage(0)
                          setSalesProduct(event.target.value)
                        }}
                      >
                        <MenuItem value="">All products</MenuItem>
                        {salesProducts.map((product) => (
                          <MenuItem key={product} value={product}>{product}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </>
                )}
                <TextField
                  label="From"
                  type="date"
                  sx={{ width: { xs: '100%', sm: 160 }, flexShrink: 0 }}
                  value={startDate}
                  onChange={(event) => {
                    setIsLoading(true)
                    setErrorMessage('')
                    setPage(0)
                    setSalesCategory('')
                    setSalesProduct('')
                    setStartDate(event.target.value)
                  }}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: endDate } }}
                />
                <TextField
                  label="To"
                  type="date"
                  sx={{ width: { xs: '100%', sm: 160 }, flexShrink: 0 }}
                  value={endDate}
                  onChange={(event) => {
                    setIsLoading(true)
                    setErrorMessage('')
                    setPage(0)
                    setSalesCategory('')
                    setSalesProduct('')
                    setEndDate(event.target.value)
                  }}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: startDate } }}
                />
                <Button
                  variant="outlined"
                  onClick={() => {
                    setIsLoading(true)
                    setErrorMessage('')
                    setPage(0)
                    setReloadKey((key) => key + 1)
                  }}
                  sx={{ minWidth: 96, flexShrink: 0 }}
                >
                  Refresh
                </Button>
                {canExport && (
                  <Button
                    variant="contained"
                    onClick={() => void exportReport()}
                    disabled={isLoading || isExporting || Boolean(errorMessage)}
                  >
                    {isExporting ? 'Preparing CSV…' : 'Export filtered CSV'}
                  </Button>
                )}
              </Stack>
            </Paper>
            {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
            {successMessage && <Alert severity="success">{successMessage}</Alert>}
            {isLoading ? (
              <Stack sx={{ alignItems: 'center', py: 8 }}><CircularProgress /></Stack>
            ) : errorMessage ? null : (
              <>
                {reportView === 'products' ? (
                  <Stack spacing={2}>
                    <Alert severity="info">
                      Counts completed orders by order date. Sales are item-line totals; order-wide discounts are not allocated to individual products.
                    </Alert>
                    {!productSales.length ? (
                      <Alert severity="info">No completed product sales match these filters.</Alert>
                    ) : !filteredProductSales.length ? (
                      <Alert severity="info">No product sales match the selected category or product.</Alert>
                    ) : (
                      <TableContainer component={Paper} variant="outlined">
                        <Table
                          size="small"
                          sx={{
                            minWidth: 900,
                            '& .MuiTableHead-root .MuiTableCell-root, & .MuiTableFooter-root .MuiTableCell-root': {
                              whiteSpace: 'nowrap',
                            },
                          }}
                        >
                          <TableHead>
                            <TableRow>
                              <TableCell>{label(salesGrouping)} period</TableCell>
                              <TableCell>Product</TableCell>
                              <TableCell>Category</TableCell>
                              <TableCell align="right">Units sold</TableCell>
                              <TableCell align="right">Orders per product</TableCell>
                              <TableCell align="right">Gross line sales</TableCell>
                              <TableCell align="right">Line sales after item discounts</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {visibleProductSales.map((row) => (
                              <TableRow
                                key={`${row.period_start}:${row.product_id || row.product_name}:${row.category_name}`}
                                hover
                              >
                                <TableCell>{salesPeriodLabel(row.period_start, salesGrouping)}</TableCell>
                                <TableCell>{row.product_name}</TableCell>
                                <TableCell>{row.category_name}</TableCell>
                                <TableCell align="right">{row.units_sold}</TableCell>
                                <TableCell align="right">{row.order_count}</TableCell>
                                <TableCell align="right">{formatPrice(row.gross_sales)}</TableCell>
                                <TableCell align="right">{formatPrice(row.net_sales)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                          <TableFooter>
                            <TableRow>
                              <TableCell colSpan={3}><strong>Total</strong></TableCell>
                              <TableCell align="right"><strong>{productSalesTotals.unitsSold}</strong></TableCell>
                              <TableCell align="right"><strong>{productSalesTotals.productOrders}</strong></TableCell>
                              <TableCell align="right"><strong>{formatPrice(productSalesTotals.grossSales)}</strong></TableCell>
                              <TableCell align="right"><strong>{formatPrice(productSalesTotals.netSales)}</strong></TableCell>
                            </TableRow>
                          </TableFooter>
                        </Table>
                      </TableContainer>
                    )}
                    {!!filteredProductSales.length && (
                      <Typography variant="caption" color="text.secondary">
                        Totals include all matching rows, not just this page. Orders are summed per product and may count the same order more than once.
                      </Typography>
                    )}
                  </Stack>
                ) : (
                  transactions.length ? (
                    <TableContainer component={Paper} variant="outlined">
                      <Table
                        size="small"
                        sx={{
                          minWidth: 1280,
                          '& .MuiTableHead-root .MuiTableCell-root, & .MuiTableFooter-root .MuiTableCell-root': {
                            whiteSpace: 'nowrap',
                          },
                        }}
                      >
                        <TableHead>
                          <TableRow>
                            <TableCell>Branch</TableCell>
                            <TableCell>Order</TableCell>
                            <TableCell>Order date</TableCell>
                            <TableCell>Payment updated</TableCell>
                            <TableCell>Payment type</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell align="right">Payment</TableCell>
                            <TableCell align="right">Refunds</TableCell>
                            <TableCell align="right">Refund amount</TableCell>
                            <TableCell align="right">Net amount</TableCell>
                            <TableCell align="right">Details</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {visibleTransactions.map((transaction) => (
                            <TableRow key={transaction.payment_id} hover>
                              <TableCell>{transaction.branch_name}</TableCell>
                              <TableCell>
                                <Typography variant="body2" fontWeight={700}>
                                  {transaction.order_number}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {transaction.customer_name}
                                </Typography>
                              </TableCell>
                              <TableCell>{orderDate(transaction)}</TableCell>
                              <TableCell>{transactionDate(transaction)}</TableCell>
                              <TableCell>{transaction.payment_method_name}</TableCell>
                              <TableCell>
                                <Chip
                                  size="small"
                                  label={label(paymentStatus(transaction))}
                                  color={paymentStatus(transaction) === 'paid' ? 'success' : 'warning'}
                                />
                              </TableCell>
                              <TableCell align="right">{formatPrice(transaction.amount)}</TableCell>
                              <TableCell align="right">{transaction.refund_count}</TableCell>
                              <TableCell align="right">{formatPrice(transaction.refund_amount)}</TableCell>
                              <TableCell align="right">
                                {formatPrice(Number(transaction.amount) - Number(transaction.refund_amount))}
                              </TableCell>
                              <TableCell align="right">
                                <Button size="small" onClick={() => void openTransaction(transaction)}>
                                  View
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                        <TableFooter>
                          <TableRow>
                            <TableCell colSpan={6}>
                              <strong>Total ({transactions.length} transactions)</strong>
                            </TableCell>
                            <TableCell align="right"><strong>{formatPrice(transactionTotals.paymentAmount)}</strong></TableCell>
                            <TableCell align="right"><strong>{transactionTotals.refundCount}</strong></TableCell>
                            <TableCell align="right"><strong>{formatPrice(transactionTotals.refundAmount)}</strong></TableCell>
                            <TableCell align="right"><strong>{formatPrice(transactionTotals.netAmount)}</strong></TableCell>
                            <TableCell />
                          </TableRow>
                        </TableFooter>
                      </Table>
                    </TableContainer>
                  ) : (
                    <Alert severity="info">No payment transactions match these filters.</Alert>
                  )
                )}
                {((reportView === 'products' ? filteredProductSales : transactions).length > 0 || page > 0) && (
                  <PaginationControls
                    page={page}
                    pageSize={pageSize}
                    hasNextPage={reportView === 'products'
                      ? (page + 1) * pageSize < filteredProductSales.length
                      : (page + 1) * pageSize < transactions.length}
                    isLoading={isLoading}
                    onChange={(nextPage, nextPageSize) => {
                      setPage(nextPage)
                      setPageSize(nextPageSize)
                    }}
                  />
                )}
              </>
            )}
          </>
        )}
      </Stack>
      <Dialog
        open={Boolean(selectedTransaction)}
        onClose={() => setSelectedTransaction(null)}
        fullWidth
        maxWidth="md"
        aria-labelledby="payment-transaction-detail-title"
      >
        {selectedTransaction && (
          <>
            <DialogTitle id="payment-transaction-detail-title">
              {selectedTransaction.order_number} · {selectedTransaction.branch_name}
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2.5}>
                {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
                {successMessage && <Alert severity="success">{successMessage}</Alert>}
                <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
                  <Stack spacing={1.25}>
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1}
                      sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
                    >
                      <Box>
                        <Typography fontWeight={700}>{selectedTransaction.customer_name}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          Order date: {orderDate(selectedTransaction)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Payment updated: {transactionDate(selectedTransaction)}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={1}>
                        <Chip size="small" label={label(selectedTransaction.order_status)} />
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`Payment ${label(paymentStatus({
                            ...selectedTransaction,
                            refund_amount: totalRefunded,
                          }))}`}
                        />
                      </Stack>
                    </Stack>
                    <Typography variant="body2">
                      {selectedTransaction.items.map((item) =>
                        `${item.quantity}× ${item.product_name}${item.variant_name ? ` (${item.variant_name})` : ''}`,
                      ).join(' · ')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {label(selectedTransaction.fulfillment_method)} · Subtotal {formatPrice(selectedTransaction.subtotal)}
                      {' · '}Discount {formatPrice(selectedTransaction.discount_total)}
                      {' · '}Total {formatPrice(selectedTransaction.total)}
                    </Typography>
                    <Typography variant="body2">
                      {selectedTransaction.payment_method_name} · Payment {formatPrice(selectedTransaction.amount)}
                    </Typography>
                    <Typography variant="body2" fontWeight={700}>
                      Refunded {formatPrice(totalRefunded)} · Remaining refundable {formatPrice(remainingRefundable)}
                    </Typography>
                  </Stack>
                </Paper>

                <Box>
                  <Typography variant="h6" gutterBottom>Refund history</Typography>
                  {isRefundHistoryLoading ? (
                    <CircularProgress size={24} />
                  ) : refundHistory.length ? (
                    <Stack spacing={1}>
                      {refundHistory.map((refund) => (
                        <Paper key={refund.refund_id} variant="outlined" sx={{ p: 1.5 }}>
                          <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={1}
                            sx={{ justifyContent: 'space-between' }}
                          >
                            <Box>
                              <Typography fontWeight={700}>{formatPrice(refund.amount)}</Typography>
                              <Typography variant="body2">{refund.note}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                {refund.created_by_name ? `${refund.created_by_name} · ` : ''}
                                {new Date(refund.created_at).toLocaleString()}
                              </Typography>
                            </Box>
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">No refund records yet.</Typography>
                  )}
                </Box>

                {canRecordRefund && selectedPaymentIsRefundable && (
                  <Paper
                    component="form"
                    onSubmit={(event) => void saveRefund(event)}
                    variant="outlined"
                    sx={{ p: { xs: 2, sm: 2.5 } }}
                  >
                    <Stack spacing={2}>
                      <Box>
                        <Typography variant="h6">Record completed refund</Typography>
                        <Typography variant="body2" color="text.secondary">
                          Enter a refund already issued outside this site. The amount cannot exceed the remaining balance.
                        </Typography>
                      </Box>
                      <TextField
                        label="Refund amount"
                        type="number"
                        value={refundAmount}
                        onChange={(event) => setRefundAmount(event.target.value)}
                        slotProps={{
                          htmlInput: {
                            min: '0.01',
                            max: remainingRefundable.toFixed(2),
                            step: '0.01',
                          },
                        }}
                        required
                      />
                      <TextField
                        label="Refund note (required)"
                        value={refundNote}
                        onChange={(event) => setRefundNote(event.target.value)}
                        multiline
                        minRows={2}
                        slotProps={{ htmlInput: { maxLength: 500 } }}
                        required
                      />
                      <Button
                        type="submit"
                        variant="contained"
                        disabled={
                          isSavingRefund ||
                          isRefundHistoryLoading ||
                          !refundAmount ||
                          Number(refundAmount) > remainingRefundable ||
                          refundNote.trim().length < 3
                        }
                      >
                        {isSavingRefund ? 'Saving refund…' : 'Save refund record'}
                      </Button>
                    </Stack>
                  </Paper>
                )}
                {!canRecordRefund && (
                  <Alert severity="info">Financial edit permission is required to record a refund.</Alert>
                )}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSelectedTransaction(null)}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Container>
  )
}
