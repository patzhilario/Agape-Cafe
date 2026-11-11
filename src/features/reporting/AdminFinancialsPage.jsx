import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
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
  getAllBranchExpenses,
  getAllOperationalReport,
  getBranchExpenses,
  getFinancialReport,
  recordBranchExpense,
  voidBranchExpense,
} from './reportData.js'

const DEFAULT_PAGE_SIZE = 10

const categories = [
  ['rent', 'Rent'],
  ['utilities', 'Utilities'],
  ['payroll', 'Payroll'],
  ['maintenance', 'Maintenance'],
  ['marketing', 'Marketing'],
  ['supplies', 'Supplies'],
  ['taxes_and_fees', 'Taxes and fees'],
  ['other', 'Other'],
]

function dateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function label(value) {
  return value.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ')
}

function emptyExpense() {
  return {
    occurredOn: dateString(new Date()),
    category: 'supplies',
    description: '',
    amount: '',
    note: '',
  }
}

function dateKeyInManila(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const part = (type) => parts.find((item) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function buildDailySalesTrend(rows, startDate, endDate) {
  const totals = new Map()
  for (const row of rows) {
    if (row.status !== 'completed') continue
    const key = dateKeyInManila(row.created_at)
    totals.set(key, (totals.get(key) || 0) + Number(row.total || 0))
  }

  const days = []
  const current = new Date(`${startDate}T00:00:00`)
  const lastDay = new Date(`${endDate}T00:00:00`)
  while (current <= lastDay) {
    const key = dateString(current)
    days.push({ date: key, total: totals.get(key) || 0 })
    current.setDate(current.getDate() + 1)
  }
  return days
}

function SalesTrendChart({ data }) {
  const width = 900
  const height = 280
  const padding = { top: 20, right: 20, bottom: 42, left: 88 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const maxValue = Math.max(...data.map(({ total }) => total), 0)
  const scaleMax = maxValue > 0 ? maxValue * 1.15 : 1
  const points = data.map((item, index) => ({
    ...item,
    x: padding.left + (data.length > 1 ? (index / (data.length - 1)) * plotWidth : plotWidth / 2),
    y: padding.top + plotHeight - (item.total / scaleMax) * plotHeight,
  }))
  const linePath = points.map((point, index) =>
    `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`,
  ).join(' ')
  const areaPath = points.length
    ? `${linePath} L ${points.at(-1).x} ${padding.top + plotHeight} L ${points[0].x} ${padding.top + plotHeight} Z`
    : ''
  const tickCount = 4
  const axisLabel = (value) => new Intl.NumberFormat('en-PH', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
  const dateLabel = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
  })
  const labelIndexes = new Set([
    0,
    Math.floor((data.length - 1) / 4),
    Math.floor((data.length - 1) / 2),
    Math.floor(((data.length - 1) * 3) / 4),
    data.length - 1,
  ])

  return (
    <Box sx={{ overflowX: 'auto', mx: { xs: -1, sm: 0 } }}>
      <Box sx={{ minWidth: { xs: 560, sm: 0 } }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Daily completed-order net sales trend"
          style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id="financial-sales-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#8a6248" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#8a6248" stopOpacity="0.015" />
            </linearGradient>
          </defs>
          {Array.from({ length: tickCount + 1 }, (_, index) => {
            const value = (scaleMax * (tickCount - index)) / tickCount
            const y = padding.top + (plotHeight * index) / tickCount
            return (
              <g key={index}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  stroke="#e9e1d8"
                  strokeDasharray={index === tickCount ? undefined : '3 5'}
                />
                <text x={padding.left - 12} y={y + 4} textAnchor="end" fill="#70665d" fontSize="12">
                  {axisLabel(value)}
                </text>
              </g>
            )
          })}
          {areaPath && <path d={areaPath} fill="url(#financial-sales-fill)" />}
          {linePath && (
            <path d={linePath} fill="none" stroke="#5b3927" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
          )}
          {points.map((point, index) => (
            <g key={point.date}>
              <circle cx={point.x} cy={point.y} r={data.length <= 31 ? 4 : 2.5} fill="#fffdf9" stroke="#5b3927" strokeWidth="2">
                <title>{`${dateLabel(point.date)}: ${formatPrice(point.total)}`}</title>
              </circle>
              {labelIndexes.has(index) && (
                <text x={point.x} y={height - 12} textAnchor="middle" fill="#70665d" fontSize="12">
                  {dateLabel(point.date)}
                </text>
              )}
            </g>
          ))}
        </svg>
      </Box>
    </Box>
  )
}

export default function AdminFinancialsPage() {
  const { account, hasPermission } = useAuth()
  const isAdmin = account.roles.includes('admin')
  const canExport = isAdmin || hasPermission('financials', 'export')
  const canCreate = isAdmin ||
    hasPermission('financials', 'create') ||
    hasPermission('financials', 'edit')
  const canVoid = isAdmin || hasPermission('financials', 'edit')
  const [branches, setBranches] = useState([])
  const [branchesLoaded, setBranchesLoaded] = useState(false)
  const [branchId, setBranchId] = useState('')
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 29)
    return dateString(date)
  })
  const [endDate, setEndDate] = useState(() => dateString(new Date()))
  const [summary, setSummary] = useState(null)
  const [salesTrendState, setSalesTrendState] = useState({ key: '', data: [] })
  const [salesTrendError, setSalesTrendError] = useState({ key: '', message: '' })
  const [expenses, setExpenses] = useState([])
  const [totalExpenseCount, setTotalExpenseCount] = useState(0)
  const [expensePage, setExpensePage] = useState(0)
  const [expensePageSize, setExpensePageSize] = useState(DEFAULT_PAGE_SIZE)
  const [expenseForm, setExpenseForm] = useState(emptyExpense)
  const [voidReasons, setVoidReasons] = useState({})
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false)
  const [expenseToVoid, setExpenseToVoid] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isExportingExpenses, setIsExportingExpenses] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const salesTrendKey = `${branchId}|${startDate}|${endDate}|${reloadKey}`

  useEffect(() => {
    let active = true
    getAdminBranches(account)
      .then((data) => {
        if (!active) return
        setBranches(data)
        setBranchId(data[0]?.id || '')
        setBranchesLoaded(true)
        if (!isAdmin && !data.length) setIsLoading(false)
      })
      .catch((error) => {
        console.error('Unable to load branches for financial monitoring.', error)
        if (active) {
          setErrorMessage(error.message)
          setIsLoading(false)
        }
      })
    return () => { active = false }
  }, [account, isAdmin])

  useEffect(() => {
    if (!branchesLoaded || (!isAdmin && !branchId)) return undefined
    let active = true
    Promise.all([
      getFinancialReport(branchId, startDate, endDate),
      getBranchExpenses(branchId, startDate, endDate, expensePage, expensePageSize),
    ])
      .then(([report, loadedExpenses]) => {
        if (!active) return
        setSummary(report)
        setExpenses(loadedExpenses.data)
        setTotalExpenseCount(loadedExpenses.count)
      })
      .catch((error) => {
        console.error('Unable to load financial report and expenses.', error)
        if (active) setErrorMessage(error.message)
      })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [branchId, branchesLoaded, endDate, expensePage, expensePageSize, isAdmin, reloadKey, startDate])

  useEffect(() => {
    if (!branchesLoaded || (!isAdmin && !branchId)) return undefined
    let active = true
    getAllOperationalReport(branchId, startDate, endDate)
      .then((orders) => {
        if (active) setSalesTrendState({
          key: salesTrendKey,
          data: buildDailySalesTrend(orders, startDate, endDate),
        })
      })
      .catch((error) => {
        console.error('Unable to load daily sales trend.', error)
        if (active) setSalesTrendError({ key: salesTrendKey, message: error.message })
      })
    return () => { active = false }
  }, [branchId, branchesLoaded, endDate, isAdmin, reloadKey, salesTrendKey, startDate])

  async function createExpense(event) {
    event.preventDefault()
    if (!branchId) {
      setErrorMessage('Store unavailable before recording an expense.')
      return
    }
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      await recordBranchExpense({
        branchId,
        ...expenseForm,
        description: expenseForm.description.trim(),
        note: expenseForm.note.trim(),
      })
      setExpenseForm(emptyExpense())
      setExpenseDialogOpen(false)
      setSuccessMessage('Expense recorded and included in financial monitoring.')
      setIsLoading(true)
      setExpensePage(0)
      setReloadKey((key) => key + 1)
    } catch (error) {
      console.error('Unable to record branch expense.', error)
      setErrorMessage(error.message)
    } finally {
      setIsSaving(false)
    }
  }

  async function cancelExpense(expense) {
    const reason = voidReasons[expense.id]?.trim() || ''
    if (reason.length < 3) {
      setErrorMessage('Enter a void reason of at least 3 characters.')
      return
    }
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      await voidBranchExpense(expense.id, reason)
      setSuccessMessage('Expense voided. Its original record remains in the audit history.')
      setExpenseToVoid(null)
      setIsLoading(true)
      setExpensePage(0)
      setReloadKey((key) => key + 1)
    } catch (error) {
      console.error('Unable to void branch expense.', error)
      setErrorMessage(error.message)
    } finally {
      setIsSaving(false)
    }
  }

  function exportSummary() {
    downloadCsv(
      `agape-financial-summary-${startDate}-to-${endDate}.csv`,
      [
        'From', 'To', 'Completed orders', 'Gross sales', 'Discounts',
        'Net sales', 'Collected sales', 'Paid orders', 'Estimated COGS',
        'Uncosted orders', 'Manual usage cost', 'Uncosted manual usage',
        'Inventory purchases', 'Uncosted inventory purchases', 'Expenses',
        'Estimated profit',
      ],
      [[
        startDate,
        endDate,
        summary.completed_orders,
        summary.gross_sales,
        summary.discounts,
        summary.net_sales,
        summary.collected_sales,
        summary.paid_orders,
        summary.cost_of_goods ?? '',
        summary.uncosted_orders,
        summary.manual_usage_cost,
        summary.uncosted_manual_usage,
        summary.inventory_purchases,
        summary.uncosted_inventory_purchases,
        summary.expenses,
        summary.estimated_profit ?? '',
      ]],
    )
  }

  async function exportExpenses() {
    setIsExportingExpenses(true)
    setErrorMessage('')
    try {
      const allExpenses = await getAllBranchExpenses(branchId, startDate, endDate)
      downloadCsv(
        `agape-expenses-${startDate}-to-${endDate}.csv`,
        ['Date', 'Category', 'Description', 'Amount', 'Note', 'Status', 'Void reason'],
        allExpenses.map((expense) => [
          expense.occurred_on,
          expense.category,
          expense.description,
          expense.amount,
          expense.note,
          expense.voided_at ? 'voided' : 'active',
          expense.void_reason || '',
        ]),
      )
    } catch (error) {
      console.error('Unable to export expenses.', error)
      setErrorMessage(error.message)
    } finally {
      setIsExportingExpenses(false)
    }
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="primary">Agapé Café · Financial monitoring</Typography>
          <Typography variant="h2">Expenses and profit estimates</Typography>
          <Typography color="text.secondary">
            Cost of goods combines legacy order costs with the manually recorded
            inventory used at closing. Restock purchases are reported separately
            from usage so the same supplies are not counted twice in profit.
            These are operational estimates, not accounting statements.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Record inventory receipts and closing usage in Inventory. Purchases
            show cash outflow; the cost of supplies actually used contributes to
            estimated cost of goods.
          </Typography>
        </Box>
        {!isAdmin && !branches.length && branchesLoaded && (
          <Alert severity="info">No store details are available for financial monitoring.</Alert>
        )}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            useFlexGap
            sx={{ alignItems: { md: 'center' }, flexWrap: { md: 'wrap' } }}
          >

            <TextField
              fullWidth={false}
              label="From"
              type="date"
              sx={{ width: { xs: '100%', sm: 160 }, flexShrink: 0 }}
              value={startDate}
              onChange={(event) => {
                setIsLoading(true)
                setErrorMessage('')
                setExpensePage(0)
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
                setExpensePage(0)
                setEndDate(event.target.value)
              }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: startDate } }}
            />
            <Button variant="outlined" onClick={() => {
              setIsLoading(true)
              setErrorMessage('')
              setExpensePage(0)
              setReloadKey((key) => key + 1)
            }} sx={{ minWidth: 96, flexShrink: 0 }}>
              Refresh
            </Button>
          </Stack>
        </Paper>
        {canExport && (
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            useFlexGap
            sx={{ flexWrap: 'wrap', alignItems: { sm: 'center' } }}
          >
            <Button variant="contained" onClick={exportSummary} disabled={isLoading || !summary}>
              Export financial summary CSV
            </Button>
            <Button
              variant="outlined"
              onClick={() => void exportExpenses()}
              disabled={isExportingExpenses || isLoading}
            >
              {isExportingExpenses ? 'Preparing expenses CSV…' : 'Export all expenses CSV'}
            </Button>
          </Stack>
        )}
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        {successMessage && <Alert severity="success">{successMessage}</Alert>}
        {isLoading ? (
          <Stack sx={{ alignItems: 'center', py: 8 }}><CircularProgress /></Stack>
        ) : !errorMessage && summary && (
          <>
            <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 }, overflow: 'hidden' }}>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="h6" fontWeight={800}>Daily net sales</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Completed orders by order date · {startDate} to {endDate}
                  </Typography>
                </Box>
                {salesTrendState.key !== salesTrendKey && salesTrendError.key !== salesTrendKey ? (
                  <Stack sx={{ alignItems: 'center', py: 5 }}><CircularProgress size={28} /></Stack>
                ) : salesTrendError.key === salesTrendKey ? (
                  <Alert severity="warning">Sales trend unavailable: {salesTrendError.message}</Alert>
                ) : salesTrendState.data.length ? (
                  <SalesTrendChart data={salesTrendState.data} />
                ) : (
                  <Typography color="text.secondary" sx={{ py: 5, textAlign: 'center' }}>
                    No completed-order sales in this date range.
                  </Typography>
                )}
              </Stack>
            </Paper>
            <Box>
              <Typography variant="h5" sx={{ mb: 1.5 }}>Financial overview</Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: 'repeat(2, minmax(0, 1fr))',
                    md: 'repeat(4, minmax(0, 1fr))',
                  },
                  gap: { xs: 1.25, sm: 2 },
                }}
              >
                {[
                  {
                    title: 'Estimated profit',
                    value: summary.estimated_profit == null ? 'Incomplete' : formatPrice(summary.estimated_profit),
                    detail: 'Net sales less estimated costs',
                    color: summary.estimated_profit < 0 ? '#b42318' : '#2e6b4e',
                    featured: true,
                  },
                  {
                    title: 'Net sales',
                    value: formatPrice(summary.net_sales),
                    detail: `${summary.completed_orders} completed orders`,
                    color: '#5b3927',
                  },
                  {
                    title: 'Collected payments',
                    value: formatPrice(summary.collected_sales),
                    detail: `${summary.paid_orders} paid orders in date range`,
                    color: '#315f78',
                  },
                  {
                    title: 'Recorded expenses',
                    value: formatPrice(summary.expenses),
                    detail: 'Non-voided branch expenses',
                    color: '#9a5a22',
                  },
                  {
                    title: 'Estimated ingredient cost',
                    value: summary.cost_of_goods == null ? 'Incomplete' : formatPrice(summary.cost_of_goods),
                    detail: 'Cost of ingredients used',
                    color: '#74519a',
                  },
                  {
                    title: 'Closing usage cost',
                    value: formatPrice(summary.manual_usage_cost ?? 0),
                    detail: Number(summary.uncosted_manual_usage)
                      ? `${summary.uncosted_manual_usage} records missing cost`
                      : 'Manual inventory usage',
                    color: '#687d36',
                    warning: !!Number(summary.uncosted_manual_usage),
                  },
                  {
                    title: 'Inventory purchases',
                    value: formatPrice(summary.inventory_purchases ?? 0),
                    detail: Number(summary.uncosted_inventory_purchases)
                      ? `${summary.uncosted_inventory_purchases} receipts missing cost`
                      : 'Stock receipt spending',
                    color: '#a05442',
                    warning: !!Number(summary.uncosted_inventory_purchases),
                  },
                  {
                    title: 'Gross sales',
                    value: formatPrice(summary.gross_sales),
                    detail: `${formatPrice(summary.discounts)} in discounts`,
                    color: '#47776f',
                  },
                ].map((metric) => (
                  <Paper
                    key={metric.title}
                    variant="outlined"
                    sx={{
                      p: { xs: 1.5, sm: 2 },
                      minWidth: 0,
                      borderTop: 3,
                      borderTopColor: metric.color,
                      bgcolor: metric.featured ? 'rgba(46, 107, 78, 0.045)' : 'background.paper',
                    }}
                  >
                    <Stack spacing={0.75} sx={{ height: '100%' }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={700}>
                        {metric.title}
                      </Typography>
                      <Typography
                        variant="h6"
                        sx={{
                          color: metric.color,
                          fontWeight: 800,
                          lineHeight: 1.2,
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {metric.value}
                      </Typography>
                      <Typography
                        variant="caption"
                        color={metric.warning ? 'warning.main' : 'text.secondary'}
                        sx={{ mt: 'auto' }}
                      >
                        {metric.detail}
                      </Typography>
                    </Stack>
                  </Paper>
                ))}
              </Box>
            </Box>
            <Alert severity={
              Number(summary.uncosted_orders) ||
              Number(summary.uncosted_manual_usage) ||
              Number(summary.uncosted_inventory_purchases)
                ? 'warning'
                : 'info'
            }>
              {Number(summary.uncosted_orders) || Number(summary.uncosted_manual_usage)
                ? `${summary.uncosted_orders} completed order(s) and ${summary.uncosted_manual_usage} manual usage record(s) are missing ingredient costs. Estimated cost of goods and profit are incomplete.`
                : `Gross sales ${formatPrice(summary.gross_sales)} less discounts ${formatPrice(summary.discounts)}, estimated ingredient usage, and non-voided branch expenses.`}
              {!!Number(summary.uncosted_inventory_purchases) &&
                ` ${summary.uncosted_inventory_purchases} restock receipt(s) have no cost, so inventory purchase spending is incomplete.`}
            </Alert>
            {canCreate && (
              <>
              <Button variant="contained" sx={{ alignSelf: 'flex-start' }} onClick={() => setExpenseDialogOpen(true)}>
                Record expense
              </Button>
              <Dialog open={expenseDialogOpen} onClose={() => !isSaving && setExpenseDialogOpen(false)} fullWidth maxWidth="sm">
                <Box component="form" onSubmit={createExpense}>
                  <DialogTitle>Record a branch expense</DialogTitle>
                  <DialogContent dividers>
                <Stack spacing={2}>
                  {!branchId && (
                    <Alert severity="info">Store details are unavailable. Reload the page to record an expense.</Alert>
                  )}
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                    <TextField
                      label="Expense date"
                      type="date"
                      value={expenseForm.occurredOn}
                      onChange={(event) => setExpenseForm((current) => ({ ...current, occurredOn: event.target.value }))}
                      slotProps={{ inputLabel: { shrink: true } }}
                      required
                    />
                    <FormControl required sx={{ minWidth: 180 }}>
                      <InputLabel id="expense-category-label">Category</InputLabel>
                      <Select
                        labelId="expense-category-label"
                        label="Category"
                        value={expenseForm.category}
                        onChange={(event) => setExpenseForm((current) => ({ ...current, category: event.target.value }))}
                      >
                        {categories.map(([value, text]) => <MenuItem key={value} value={value}>{text}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <TextField
                      label="Amount"
                      type="number"
                      value={expenseForm.amount}
                      onChange={(event) => setExpenseForm((current) => ({ ...current, amount: event.target.value }))}
                      slotProps={{ htmlInput: { min: '0.01', max: '100000000', step: '0.01' } }}
                      required
                    />
                  </Stack>
                  <TextField
                    label="Description"
                    value={expenseForm.description}
                    onChange={(event) => setExpenseForm((current) => ({ ...current, description: event.target.value }))}
                    slotProps={{ htmlInput: { maxLength: 240 } }}
                    required
                  />
                  <TextField
                    label="Note (optional)"
                    value={expenseForm.note}
                    onChange={(event) => setExpenseForm((current) => ({ ...current, note: event.target.value }))}
                    slotProps={{ htmlInput: { maxLength: 500 } }}
                    multiline
                    minRows={2}
                  />
                </Stack>
                  </DialogContent>
                  <DialogActions sx={{ px: 3, py: 2 }}>
                    <Button onClick={() => setExpenseDialogOpen(false)} disabled={isSaving}>Cancel</Button>
                    <Button type="submit" variant="contained" disabled={isSaving || !branchId}>
                      {isSaving ? 'Saving…' : 'Record expense'}
                    </Button>
                  </DialogActions>
                </Box>
              </Dialog>
              </>
            )}
            <Box>
              <Typography variant="h5" gutterBottom>Expense records</Typography>
              {!expenses.length && expensePage === 0 ? (
                <Alert severity="info">No expenses were recorded in this date range.</Alert>
              ) : expenses.length ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small" aria-label="Expense records" sx={{ minWidth: 780 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Category</TableCell>
                        <TableCell>Description</TableCell>
                        <TableCell>Note</TableCell>
                        <TableCell align="right">Amount</TableCell>
                        <TableCell>Status</TableCell>
                        {canVoid && <TableCell align="right">Action</TableCell>}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {expenses.map((expense) => (
                        <TableRow key={expense.id} hover>
                          <TableCell>{expense.occurred_on}</TableCell>
                          <TableCell>{label(expense.category)}</TableCell>
                          <TableCell>{expense.description}</TableCell>
                          <TableCell>{expense.note || '—'}</TableCell>
                          <TableCell align="right">{formatPrice(expense.amount)}</TableCell>
                          <TableCell>{expense.voided_at ? `Voided · ${expense.void_reason}` : 'Active'}</TableCell>
                          {canVoid && (
                            <TableCell align="right">
                              {!expense.voided_at && (
                                <Button
                                  size="small"
                                  color="error"
                                  variant="outlined"
                                  disabled={isSaving}
                                  onClick={() => setExpenseToVoid(expense)}
                                >
                                  Void
                                </Button>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Alert severity="info">No expenses were found on this page.</Alert>
              )}
              {!isLoading && !errorMessage && (expenses.length > 0 || expensePage > 0) && (
                <PaginationControls
                  page={expensePage}
                  pageSize={expensePageSize}
                  totalItems={totalExpenseCount}
                  hasNextPage={expenses.length === expensePageSize}
                  isLoading={isLoading}
                  onChange={(nextPage, nextPageSize) => {
                    setIsLoading(true)
                    setExpensePage(nextPage)
                    setExpensePageSize(nextPageSize)
                  }}
                />
              )}
            </Box>
            <Dialog open={Boolean(expenseToVoid)} onClose={() => !isSaving && setExpenseToVoid(null)} fullWidth maxWidth="xs">
              <DialogTitle>Void expense</DialogTitle>
              <DialogContent>
                <Stack spacing={2} sx={{ pt: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    {expenseToVoid?.description} · {formatPrice(expenseToVoid?.amount)}
                  </Typography>
                  <TextField
                    label="Reason for voiding"
                    value={expenseToVoid ? (voidReasons[expenseToVoid.id] || '') : ''}
                    onChange={(event) => expenseToVoid && setVoidReasons((current) => ({
                      ...current,
                      [expenseToVoid.id]: event.target.value,
                    }))}
                    required
                    slotProps={{ htmlInput: { minLength: 3, maxLength: 500 } }}
                  />
                </Stack>
              </DialogContent>
              <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button onClick={() => setExpenseToVoid(null)} disabled={isSaving}>Cancel</Button>
                <Button
                  color="error"
                  variant="contained"
                  disabled={isSaving || (expenseToVoid && (voidReasons[expenseToVoid.id]?.trim().length || 0) < 3)}
                  onClick={() => expenseToVoid && void cancelExpense(expenseToVoid)}
                >
                  Void expense
                </Button>
              </DialogActions>
            </Dialog>
          </>
        )}
      </Stack>
    </Container>
  )
}
