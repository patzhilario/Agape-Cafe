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
import {
  clearBenefitDocumentReference,
  deleteBenefitDocument,
  getApproverBenefitRequests,
  getBenefitDocumentUrl,
  reviewBenefitRequest,
} from './benefitData.js'
import { formatPrice } from '../public/publicData.js'
import PaginationControls from '../../components/PaginationControls.jsx'

const DEFAULT_PAGE_SIZE = 10

function label(value) {
  return value.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ')
}

export default function AdminBenefitRequestsPage() {
  const { account, hasPermission } = useAuth()
  const canApprove = account.roles.includes('super_admin') || hasPermission('promotions', 'approve')
  const [branches, setBranches] = useState([])
  const [branchId, setBranchId] = useState('')
  const [requests, setRequests] = useState([])
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [reviewNotes, setReviewNotes] = useState({})
  const [documentUrls, setDocumentUrls] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [busyRequestId, setBusyRequestId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    getAdminBranches(account)
      .then((data) => {
        if (!active) return
        setBranches(data)
        const assignedBranch = account.branchAssignments[0]?.branch_id
        setBranchId((current) => current || (account.roles.includes('super_admin') ? '' : assignedBranch || ''))
      })
      .catch((error) => {
        console.error('Unable to load branches for benefit review.', error)
        if (active) setErrorMessage(error.message)
      })
    return () => { active = false }
  }, [account])

  useEffect(() => {
    let active = true
    getApproverBenefitRequests(branchId, page, pageSize)
      .then((data) => {
        if (active) {
          setRequests(data)
          setErrorMessage('')
        }
      })
      .catch((error) => {
        console.error('Unable to load branch benefit requests.', error)
        if (active) setErrorMessage(error.message)
      })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [branchId, page, pageSize, reloadKey])

  async function openDocument(request) {
    setErrorMessage('')
    try {
      const url = await getBenefitDocumentUrl(request.document_path)
      setDocumentUrls((current) => ({ ...current, [request.id]: url }))
    } catch (error) {
      console.error('Unable to open private benefit evidence.', error)
      setErrorMessage(error.message)
    }
  }

  async function reviewRequest(request, decision) {
    const note = reviewNotes[request.id]?.trim() || ''
    if (decision === 'rejected' && note.length < 3) {
      setErrorMessage('Provide a rejection reason of at least 3 characters.')
      return
    }
    setBusyRequestId(request.id)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      await reviewBenefitRequest(request.id, decision, note)
      setSuccessMessage(`${request.order?.order_number || 'Order'} benefit request ${decision}.`)
      setRequests((current) => current.map((item) => (
        item.id === request.id ? { ...item, status: decision, decision_note: note } : item
      )))
    } catch (error) {
      console.error('Unable to review benefit request.', error)
      setErrorMessage(error.message)
    } finally { setBusyRequestId('') }
  }

  async function deleteDocument(request) {
    setBusyRequestId(request.id)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      await deleteBenefitDocument(request.document_path)
      await clearBenefitDocumentReference(request.id)
      setSuccessMessage('Private document deleted and its reference cleared.')
      setRequests((current) => current.map((item) => (
        item.id === request.id ? { ...item, document_path: null } : item
      )))
    } catch (error) {
      console.error('Unable to delete the benefit document.', error)
      setErrorMessage(error.message)
    } finally { setBusyRequestId('') }
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="primary">Agapé Café · Restricted access</Typography>
          <Typography variant="h2">PWD and Senior Citizen requests</Typography>
          <Typography color="text.secondary">
            Review requests only for assigned branches. Open ID documents
            through short-lived private links; approvals recalculate the unpaid
            order total transactionally and are recorded in the audit log.
          </Typography>
        </Box>
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        {successMessage && <Alert severity="success">{successMessage}</Alert>}
        {!account.roles.includes('super_admin') && (
          <FormControl fullWidth>
            <InputLabel id="benefit-review-branch-label">Branch</InputLabel>
            <Select
              labelId="benefit-review-branch-label"
              label="Branch"
              value={branchId}
              onChange={(event) => {
                setIsLoading(true)
                setPage(0)
                setBranchId(event.target.value)
              }}
            >
              {branches.map((branch) => <MenuItem key={branch.id} value={branch.id}>{branch.name}</MenuItem>)}
            </Select>
          </FormControl>
        )}
        {!canApprove && (
          <Alert severity="info">You have view access only. A Super Admin must grant Promotions approve permission to review requests.</Alert>
        )}
        {isLoading ? (
          <Stack sx={{ alignItems: 'center', py: 8 }}><CircularProgress /></Stack>
        ) : !requests.length && page === 0 ? (
          <Alert severity="info">No benefit discount requests are visible for this branch.</Alert>
        ) : requests.map((request) => (
          <Paper key={request.id} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
                <Box>
                  <Typography variant="h6">{request.order?.order_number} · {label(request.benefit_type)}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {request.order?.customer_name} · {request.branch?.name} · {new Date(request.created_at).toLocaleString()}
                  </Typography>
                </Box>
                <Typography fontWeight={700}>
                  {label(request.status)}
                  {request.status === 'approved' ? ` · ${formatPrice(request.discount_total)}` : ''}
                </Typography>
              </Stack>
              <Stack spacing={1}>
                {request.items.map((item) => (
                  <Typography key={item.order_item_id} variant="body2">
                    {item.eligible_quantity} × {item.order_item?.product_name}
                    {item.order_item?.variant_name ? ` · ${item.order_item.variant_name}` : ''}
                    {item.discount_amount > 0 ? ` · ${formatPrice(item.discount_amount)} discount` : ''}
                  </Typography>
                ))}
              </Stack>
              <Typography variant="body2">
                Order total: {formatPrice(request.order?.total || 0)} · Payment {label(request.order?.payment_status || 'unpaid')}
              </Typography>
              {request.review_note && <Alert severity={request.status === 'rejected' ? 'warning' : 'info'}>{request.review_note}</Alert>}
              {request.document_path ? (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  {documentUrls[request.id] ? (
                    <Button component="a" href={documentUrls[request.id]} target="_blank" rel="noreferrer">
                      Open private ID
                    </Button>
                  ) : (
                    <Button onClick={() => openDocument(request)}>View ID evidence (60-second link)</Button>
                  )}
                  {canApprove && (
                    <Button color="error" onClick={() => deleteDocument(request)} disabled={busyRequestId === request.id}>
                      Delete ID document
                    </Button>
                  )}
                </Stack>
              ) : <Alert severity="warning">No ID document is attached to this request.</Alert>}
              {canApprove && request.status === 'pending' && (
                <Stack spacing={1}>
                  <TextField
                    label="Review note (required to reject)"
                    value={reviewNotes[request.id] || ''}
                    onChange={(event) => setReviewNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                    multiline
                    minRows={2}
                    slotProps={{ htmlInput: { maxLength: 500 } }}
                  />
                  <Stack direction="row" spacing={1}>
                    <Button variant="contained" disabled={busyRequestId === request.id || !request.document_path || !documentUrls[request.id]} onClick={() => reviewRequest(request, 'approved')}>
                      Approve and apply discount
                    </Button>
                    <Button color="error" disabled={busyRequestId === request.id} onClick={() => reviewRequest(request, 'rejected')}>
                      Reject request
                    </Button>
                  </Stack>
                </Stack>
              )}
            </Stack>
          </Paper>
        ))}
        {!isLoading && !errorMessage && (requests.length > 0 || page > 0) && (
          <PaginationControls
            page={page}
            pageSize={pageSize}
            hasNextPage={requests.length === pageSize}
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
