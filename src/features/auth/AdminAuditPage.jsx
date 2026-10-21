import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import PaginationControls from '../../components/PaginationControls.jsx'
import { getSupabaseClient } from '../../lib/supabaseClient.js'

const DEFAULT_PAGE_SIZE = 10

const actionDescriptions = {
  account_access_updated: 'Account access and permissions were updated.',
  benefit_discount_approved: 'A PWD or senior discount request was approved.',
  benefit_discount_policy_updated: 'The discount policy was updated.',
  benefit_discount_rejected: 'A PWD or senior discount request was rejected.',
  benefit_discount_requested: 'A customer requested a PWD or senior discount.',
  branch_created: 'A branch was created.',
  branch_updated: 'Branch details were updated.',
  branch_expense_recorded: 'A branch expense was recorded.',
  branch_expense_voided: 'A branch expense was voided.',
  customer_order_created: 'A customer placed an order.',
  inventory_item_deleted_with_history: 'An inventory item and its linked history were permanently deleted.',
  order_cancelled: 'An order was cancelled.',
  order_payment_recorded: 'An order payment was recorded.',
  order_payment_proof_rejected: 'A GCash payment proof was rejected.',
  order_payment_proof_submitted: 'A customer submitted GCash payment proof.',
  order_status_updated: 'An order status was updated.',
}

const detailLabels = {
  amount: 'Amount',
  benefit_type: 'Discount type',
  cancellation_reason: 'Cancellation reason',
  category: 'Category',
  gcash_qr_configured: 'GCash QR code configured',
  ingredient_count: 'Ingredients',
  deleted_branch_stock_rows: 'Deleted branch stock rows',
  deleted_movement_rows: 'Deleted stock movement rows',
  deleted_option_recipes: 'Deleted size and add-on recipes',
  deleted_product_recipes: 'Deleted product recipes',
  discount_total: 'Discount',
  new_role: 'New role',
  new_status: 'New status',
  occurred_on: 'Expense date',
  payment_method: 'Payment method',
  payment_status: 'Payment status',
  previous_roles: 'Previous roles',
  previous_status: 'Previous status',
  pwd_enabled: 'PWD discount enabled',
  reason: 'Reason',
  review_note: 'Review note',
  senior_citizen_enabled: 'Senior discount enabled',
  unit_cost: 'Unit cost',
  unit: 'Stock unit',
  name: 'Inventory item',
  quantity_delta: 'Quantity change',
  vat_registration: 'VAT registration',
}

function label(value = '') {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
}

function isInternalDetail(key) {
  return /(^|_)(id|path|url|token|fingerprint|hash)$/.test(key)
    || ['branch_ids', 'permission_ids', 'document_path_cleared'].includes(key)
}

function formatDetailValue(key, value) {
  if (value == null || value === '') return 'Not provided'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) {
    if (key === 'previous_roles') return value.map(label).join(', ') || 'None'
    return `${value.length} item${value.length === 1 ? '' : 's'}`
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([nestedKey]) => !isInternalDetail(nestedKey))
      .map(([nestedKey, nestedValue]) => `${detailLabels[nestedKey] || label(nestedKey)}: ${formatDetailValue(nestedKey, nestedValue)}`)
      .join('; ')
  }
  if (['amount', 'discount_total', 'subtotal', 'total', 'unit_cost'].includes(key)) {
    const amount = Number(value)
    if (!Number.isFinite(amount)) return String(value)
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      maximumFractionDigits: 2,
    }).format(amount)
  }
  if (key === 'occurred_on' && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return new Date(`${value}T12:00:00`).toLocaleDateString()
  }
  if (typeof value === 'string' && /^[a-z]+(?:_[a-z]+)+$/.test(value)) return label(value)
  return String(value)
}

function readableDetails(details = {}) {
  return Object.entries(details)
    .filter(([key, value]) => !isInternalDetail(key) && value != null && value !== '')
    .map(([key, value]) => ({
      label: detailLabels[key] || label(key),
      value: formatDetailValue(key, value),
    }))
}

export default function AdminAuditPage() {
  const [logs, setLogs] = useState([])
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [reloadKey, setReloadKey] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let active = true
    getSupabaseClient()
      .from('audit_logs')
      .select(`
        id, action, record_type, details, created_at,
        actor:profiles!audit_logs_actor_id_fkey(display_name, email),
        branch:branches!audit_logs_branch_id_fkey(name)
      `)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1)
      .then(({ data, error }) => {
        if (error) throw new Error(error.message)
        if (active) {
          setLogs(data)
          setErrorMessage('')
        }
      })
      .catch((error) => {
        console.error('Unable to load the audit trail.', error)
        if (active) setErrorMessage(error.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [page, pageSize, reloadKey])

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={3}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: { md: 'center' } }}
        >
          <Box>
            <Typography variant="overline" color="primary">Security and accountability</Typography>
            <Typography variant="h2">Audit trail</Typography>
            <Typography color="text.secondary">
              Recent administrator and business actions, newest first.
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            disabled={isLoading}
            sx={{ alignSelf: { xs: 'stretch', md: 'auto' }, minHeight: 42 }}
            onClick={() => {
              setIsLoading(true)
              setReloadKey((value) => value + 1)
            }}
          >
            Refresh
          </Button>
        </Stack>
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        {isLoading ? (
          <Stack sx={{ alignItems: 'center', py: 8 }}><CircularProgress /></Stack>
        ) : !logs.length && page === 0 ? (
          <Alert severity="info">No audit events have been recorded yet.</Alert>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small" aria-label="Audit trail" sx={{ minWidth: 1000 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Record</TableCell>
                  <TableCell>Administrator</TableCell>
                  <TableCell>Branch</TableCell>
                  <TableCell>Description and details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logs.map((log) => {
                  const details = readableDetails(log.details)
                  return (
                    <TableRow key={log.id} hover>
                      <TableCell>{new Date(log.created_at).toLocaleString()}</TableCell>
                      <TableCell><Chip size="small" color="primary" variant="outlined" label={label(log.action)} /></TableCell>
                      <TableCell>{label(log.record_type)}</TableCell>
                      <TableCell>{log.actor?.display_name || log.actor?.email || 'System'}</TableCell>
                      <TableCell>{log.branch?.name || '—'}</TableCell>
                      <TableCell sx={{ whiteSpace: 'normal', minWidth: 300 }}>
                        <Typography variant="body2">
                          {actionDescriptions[log.action] || `${label(log.action)}.`}
                        </Typography>
                        {details.map((detail) => (
                          <Typography key={detail.label} variant="caption" color="text.secondary" component="div">
                            <strong>{detail.label}:</strong> {detail.value}
                          </Typography>
                        ))}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {!isLoading && !errorMessage && (logs.length > 0 || page > 0) && (
          <PaginationControls
            page={page}
            pageSize={pageSize}
            hasNextPage={logs.length === pageSize}
            isLoading={isLoading}
            onChange={(nextPage, nextPageSize) => {
              setIsLoading(true)
              setPage(nextPage)
              setPageSize(nextPageSize)
            }}
          />
        )}
      </Stack>
    </Container>
  )
}
