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

function getDocumentType(path) {
  return path.toLowerCase().split('?')[0].endsWith('.pdf') ? 'pdf' : 'image'
}

export default function AdminBenefitRequestsPage() {
  const { account, hasPermission } = useAuth()
  const canApprove = account.roles.includes('super_admin') || hasPermission('promotions', 'approve')
  const [branches, setBranches] = useState([])
  const [branchId, setBranchId] = useState('')
  const [requests, setRequests] = useState([])
  const [totalRequestCount, setTotalRequestCount] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [reviewNotes, setReviewNotes] = useState({})
  const [documentUrls, setDocumentUrls] = useState({})
  const [documentPreview, setDocumentPreview] = useState(null)
  const [selectedRequestId, setSelectedRequestId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [busyRequestId, setBusyRequestId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const selectedRequest = requests.find((request) => request.id === selectedRequestId)

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
      .then(({ data, count }) => {
        if (active) {
          setRequests(data)
          setTotalRequestCount(count)
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
      setDocumentPreview({
        title: `${label(request.benefit_type)} ID · ${request.order?.order_number || 'Benefit request'}`,
        url,
        type: getDocumentType(request.document_path),
      })
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
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small" aria-label="Benefit discount requests" sx={{ minWidth: 850 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Order</TableCell>
                  <TableCell>Benefit</TableCell>
                  <TableCell>Customer</TableCell>
                  <TableCell>Branch</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {requests.map((request) => (
                  <TableRow key={request.id} hover>
                    <TableCell sx={{ fontWeight: 700 }}>{request.order?.order_number || '—'}</TableCell>
                    <TableCell>{label(request.benefit_type)}</TableCell>
                    <TableCell>{request.order?.customer_name || '—'}</TableCell>
                    <TableCell>{request.branch?.name || '—'}</TableCell>
                    <TableCell>{new Date(request.created_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={request.status === 'approved' ? 'success' : request.status === 'rejected' ? 'error' : 'warning'}
                        label={label(request.status)}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" variant="outlined" onClick={() => setSelectedRequestId(request.id)}>View</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        <Dialog
          open={Boolean(selectedRequest)}
          onClose={() => setSelectedRequestId('')}
          fullWidth
          maxWidth="md"
          aria-labelledby="benefit-request-details-title"
        >
          {selectedRequest && (
            <>
              <DialogTitle id="benefit-request-details-title">
                {selectedRequest.order?.order_number} · {label(selectedRequest.benefit_type)}
              </DialogTitle>
              <DialogContent dividers>
                <Stack spacing={2.5}>
                  <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
                    <Stack spacing={1}>
                      <Typography fontWeight={700}>{selectedRequest.order?.customer_name} · {selectedRequest.branch?.name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        Submitted {new Date(selectedRequest.created_at).toLocaleString()}
                      </Typography>
                      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                        <Chip
                          size="small"
                          color={selectedRequest.status === 'approved' ? 'success' : selectedRequest.status === 'rejected' ? 'error' : 'warning'}
                          label={label(selectedRequest.status)}
                        />
                        <Typography variant="body2">
                          Order {formatPrice(selectedRequest.order?.total || 0)} · Payment {label(selectedRequest.order?.payment_status || 'unpaid')}
                        </Typography>
                        {selectedRequest.status === 'approved' && (
                          <Typography variant="body2" fontWeight={700} color="success.main">
                            Discount {formatPrice(selectedRequest.discount_total)}
                          </Typography>
                        )}
                      </Stack>
                    </Stack>
                  </Paper>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>ELIGIBLE ORDER ITEMS</Typography>
                    <Stack spacing={1}>
                    {selectedRequest.items.map((item) => (
                      <Paper key={item.order_item_id} variant="outlined" sx={{ p: 1.5 }}>
                      <Typography variant="body2">
                        {item.eligible_quantity} × {item.order_item?.product_name}
                        {item.order_item?.variant_name ? ` · ${item.order_item.variant_name}` : ''}
                        {item.discount_amount > 0 ? ` · ${formatPrice(item.discount_amount)} discount` : ''}
                      </Typography>
                      </Paper>
                    ))}
                  </Stack>
                  </Box>
                  {selectedRequest.review_note && (
                    <Alert severity={selectedRequest.status === 'rejected' ? 'warning' : 'info'}>
                      {selectedRequest.review_note}
                    </Alert>
                  )}
                  {selectedRequest.document_path ? (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      {documentUrls[selectedRequest.id] ? (
                        <Button onClick={() => setDocumentPreview({
                          title: `${label(selectedRequest.benefit_type)} ID · ${selectedRequest.order?.order_number || 'Benefit request'}`,
                          url: documentUrls[selectedRequest.id],
                          type: getDocumentType(selectedRequest.document_path),
                        })}>
                          View ID evidence
                        </Button>
                      ) : (
                        <Button onClick={() => openDocument(selectedRequest)}>View ID evidence (60-second link)</Button>
                      )}
                      {canApprove && (
                        <Button color="error" onClick={() => deleteDocument(selectedRequest)} disabled={busyRequestId === selectedRequest.id}>
                          Delete ID document
                        </Button>
                      )}
                    </Stack>
                  ) : <Alert severity="warning">No ID document is attached to this request.</Alert>}
                  {canApprove && selectedRequest.status === 'pending' && (
                    <Stack spacing={1}>
                      <TextField
                        label="Review note (required to reject)"
                        value={reviewNotes[selectedRequest.id] || ''}
                        onChange={(event) => setReviewNotes((current) => ({ ...current, [selectedRequest.id]: event.target.value }))}
                        multiline
                        minRows={2}
                        slotProps={{ htmlInput: { maxLength: 500 } }}
                      />
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                        <Button variant="contained" disabled={busyRequestId === selectedRequest.id || !selectedRequest.document_path || !documentUrls[selectedRequest.id]} onClick={() => reviewRequest(selectedRequest, 'approved')}>
                          Approve and apply discount
                        </Button>
                        <Button color="error" disabled={busyRequestId === selectedRequest.id} onClick={() => reviewRequest(selectedRequest, 'rejected')}>
                          Reject request
                        </Button>
                      </Stack>
                    </Stack>
                  )}
                </Stack>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setSelectedRequestId('')}>Close</Button>
              </DialogActions>
            </>
          )}
        </Dialog>
        {!isLoading && !errorMessage && (requests.length > 0 || page > 0) && (
          <PaginationControls
            page={page}
            pageSize={pageSize}
            totalItems={totalRequestCount}
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
      <Dialog
        open={Boolean(documentPreview)}
        onClose={() => setDocumentPreview(null)}
        fullWidth
        maxWidth="md"
        aria-labelledby="benefit-document-preview-title"
        slotProps={{ paper: { sx: { overflow: 'hidden', borderRadius: 2 } } }}
      >
        {documentPreview && (
          <>
            <DialogTitle id="benefit-document-preview-title">{documentPreview.title}</DialogTitle>
            <DialogContent sx={{ minHeight: { xs: 320, sm: 480 }, display: 'flex', justifyContent: 'center' }}>
              {documentPreview.type === 'pdf' ? (
                <Box
                  component="iframe"
                  title={documentPreview.title}
                  src={documentPreview.url}
                  sx={{ width: '100%', minHeight: { xs: 320, sm: 480 }, border: 0 }}
                />
              ) : (
                <Box
                  component="img"
                  src={documentPreview.url}
                  alt={documentPreview.title}
                  sx={{
                    display: 'block',
                    maxWidth: '100%',
                    maxHeight: { xs: '60vh', sm: '70vh' },
                    objectFit: 'contain',
                  }}
                />
              )}
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button onClick={() => setDocumentPreview(null)}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Container>
  )
}
