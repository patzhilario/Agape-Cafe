import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
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
  getAllBranchExpenses,
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

export default function AdminFinancialsPage() {
  const { account, hasPermission } = useAuth()
  const isSuperAdmin = account.roles.includes('super_admin')
  const canExport = isSuperAdmin || hasPermission('financials', 'export')
  const canCreate = isSuperAdmin ||
    hasPermission('financials', 'create') ||
    hasPermission('financials', 'edit')
  const canVoid = isSuperAdmin || hasPermission('financials', 'edit')
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
  const [expenses, setExpenses] = useState([])
  const [expensePage, setExpensePage] = useState(0)
  const [expensePageSize, setExpensePageSize] = useState(DEFAULT_PAGE_SIZE)
  const [expenseForm, setExpenseForm] = useState(emptyExpense)
  const [voidReasons, setVoidReasons] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isExportingExpenses, setIsExportingExpenses] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
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
        console.error('Unable to load branches for financial monitoring.', error)
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
    Promise.all([
      getFinancialReport(branchId, startDate, endDate),
      getBranchExpenses(branchId, startDate, endDate, expensePage, expensePageSize),
    ])
      .then(([report, loadedExpenses]) => {
        if (!active) return
        setSummary(report)
        setExpenses(loadedExpenses)
      })
      .catch((error) => {
        console.error('Unable to load financial report and expenses.', error)
        if (active) setErrorMessage(error.message)
      })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [branchId, branchesLoaded, endDate, expensePage, expensePageSize, isSuperAdmin, reloadKey, startDate])

  async function createExpense(event) {
    event.preventDefault()
    if (!branchId) {
      setErrorMessage('Select a branch before recording an expense.')
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
        'From', 'To', 'Branch', 'Completed orders', 'Gross sales', 'Discounts',
        'Net sales', 'Collected sales', 'Paid orders', 'Estimated COGS',
        'Uncosted orders', 'Manual usage cost', 'Uncosted manual usage',
        'Inventory purchases', 'Uncosted inventory purchases', 'Expenses',
        'Estimated profit',
      ],
      [[
        startDate,
        endDate,
        branchId ? branches.find((branch) => branch.id === branchId)?.name : 'All branches',
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
        ['Date', 'Branch', 'Category', 'Description', 'Amount', 'Note', 'Status', 'Void reason'],
        allExpenses.map((expense) => [
          expense.occurred_on,
          branches.find((branch) => branch.id === expense.branch_id)?.name || '',
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
        {!isSuperAdmin && !branches.length && branchesLoaded && (
          <Alert severity="info">No assigned branches are available for financial monitoring.</Alert>
        )}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            useFlexGap
            sx={{ alignItems: { md: 'center' }, flexWrap: { md: 'wrap' } }}
          >
            <FormControl fullWidth={false} sx={{ width: { xs: '100%', sm: 220 }, flexShrink: 0 }}>
              <InputLabel id="financials-branch-label">Branch</InputLabel>
              <Select
                labelId="financials-branch-label"
                label="Branch"
                value={branchId}
                onChange={(event) => {
                  setIsLoading(true)
                  setErrorMessage('')
                  setExpensePage(0)
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
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        {successMessage && <Alert severity="success">{successMessage}</Alert>}
        {isLoading ? (
          <Stack sx={{ alignItems: 'center', py: 8 }}><CircularProgress /></Stack>
        ) : !errorMessage && summary && (
          <>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 170 }}>
                <Typography variant="body2" color="text.secondary">Completed orders</Typography>
                <Typography variant="h5">{summary.completed_orders}</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 170 }}>
                <Typography variant="body2" color="text.secondary">Net sales</Typography>
                <Typography variant="h5">{formatPrice(summary.net_sales)}</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 170 }}>
                <Typography variant="body2" color="text.secondary">Payments collected in date range</Typography>
                <Typography variant="h5">{formatPrice(summary.collected_sales)}</Typography>
                <Typography variant="caption" color="text.secondary">{summary.paid_orders} paid order(s)</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 170 }}>
                <Typography variant="body2" color="text.secondary">Estimated ingredient cost</Typography>
                <Typography variant="h5">
                  {summary.cost_of_goods == null ? 'Incomplete' : formatPrice(summary.cost_of_goods)}
                </Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 170 }}>
                <Typography variant="body2" color="text.secondary">Manual closing usage cost</Typography>
                <Typography variant="h5">{formatPrice(summary.manual_usage_cost ?? 0)}</Typography>
                {!!Number(summary.uncosted_manual_usage) && (
                  <Typography variant="caption" color="warning.main">
                    {summary.uncosted_manual_usage} usage record(s) without cost
                  </Typography>
                )}
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 170 }}>
                <Typography variant="body2" color="text.secondary">Inventory purchases</Typography>
                <Typography variant="h5">{formatPrice(summary.inventory_purchases ?? 0)}</Typography>
                {!!Number(summary.uncosted_inventory_purchases) && (
                  <Typography variant="caption" color="warning.main">
                    {summary.uncosted_inventory_purchases} receipt(s) without cost
                  </Typography>
                )}
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 170 }}>
                <Typography variant="body2" color="text.secondary">Recorded expenses</Typography>
                <Typography variant="h5">{formatPrice(summary.expenses)}</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 170 }}>
                <Typography variant="body2" color="text.secondary">Estimated profit</Typography>
                <Typography variant="h5">
                  {summary.estimated_profit == null ? 'Incomplete' : formatPrice(summary.estimated_profit)}
                </Typography>
              </Paper>
            </Stack>
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
            {canExport && (
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                useFlexGap
                sx={{ flexWrap: 'wrap' }}
              >
                <Button variant="contained" onClick={exportSummary}>
                  Export financial summary CSV
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => void exportExpenses()}
                  disabled={isExportingExpenses}
                >
                  {isExportingExpenses ? 'Preparing expenses CSV…' : 'Export all expenses CSV'}
                </Button>
              </Stack>
            )}
            {canCreate && (
              <Paper component="form" onSubmit={createExpense} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
                <Stack spacing={2}>
                  <Typography variant="h6">Record a branch expense</Typography>
                  {!branchId && (
                    <Alert severity="info">Select one branch to record an expense. Expenses are branch-specific.</Alert>
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
                  <Button type="submit" variant="contained" disabled={isSaving || !branchId}>
                    {isSaving ? 'Saving…' : 'Record expense'}
                  </Button>
                </Stack>
              </Paper>
            )}
            <Box>
              <Typography variant="h5" gutterBottom>Expense records</Typography>
              {!expenses.length && expensePage === 0 ? (
                <Alert severity="info">No expenses were recorded in this date range.</Alert>
              ) : expenses.length ? (
                <Stack spacing={1.5}>
                  {expenses.map((expense) => (
                    <Paper key={expense.id} variant="outlined" sx={{ p: 2 }}>
                      <Stack spacing={1}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between' }}>
                          <Box>
                            <Typography fontWeight={700}>{expense.description}</Typography>
                            <Typography variant="body2" color="text.secondary">
                              {expense.occurred_on} · {branches.find((branch) => branch.id === expense.branch_id)?.name}
                              {' · '}{label(expense.category)}
                            </Typography>
                          </Box>
                          <Typography fontWeight={700}>{formatPrice(expense.amount)}</Typography>
                        </Stack>
                        {expense.note && <Typography variant="body2">{expense.note}</Typography>}
                        {expense.voided_at ? (
                          <Alert severity="warning">Voided: {expense.void_reason}</Alert>
                        ) : canVoid ? (
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <TextField
                              size="small"
                              label="Void reason"
                              value={voidReasons[expense.id] || ''}
                              onChange={(event) => setVoidReasons((current) => ({ ...current, [expense.id]: event.target.value }))}
                            />
                            <Button
                              color="error"
                              variant="outlined"
                              disabled={isSaving}
                              onClick={() => cancelExpense(expense)}
                            >
                              Void expense
                            </Button>
                          </Stack>
                        ) : null}
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              ) : (
                <Alert severity="info">No expenses were found on this page.</Alert>
              )}
              {!isLoading && !errorMessage && (expenses.length > 0 || expensePage > 0) && (
                <PaginationControls
                  page={expensePage}
                  pageSize={expensePageSize}
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
          </>
        )}
      </Stack>
    </Container>
  )
}
