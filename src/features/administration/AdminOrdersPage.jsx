import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
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
  TextField,
  Typography,
} from '@mui/material'
import { useAuth } from '../auth/useAuth.js'
import {
  getBenefitDocumentUrl,
  reviewBenefitRequest,
} from '../discounts/benefitData.js'
import {
  getAdminBranches,
  getOrders,
  recordManualProviderPaymentOverride,
  recordOrderPayment,
  updateOrderStatus,
} from './adminData.js'
import {
  getOrderPaymentProofUrl,
  reviewOrderPaymentProof,
} from '../orders/orderData.js'
import { formatPrice } from '../public/publicData.js'
import PaginationControls from '../../components/PaginationControls.jsx'

const DEFAULT_PAGE_SIZE = 10

const nextStatus = {
  pending: 'confirmed',
  confirmed: 'preparing',
  preparing: 'ready',
  ready: 'completed',
}

function label(value) {
  return value.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ')
}

function getDocumentType(path) {
  return path.toLowerCase().split('?')[0].endsWith('.pdf') ? 'pdf' : 'image'
}

export default function AdminOrdersPage() {
  const { account, hasPermission } = useAuth()
  const canEditOrders = account.roles.includes('super_admin') || hasPermission('orders', 'edit')
  const canCancelOrders = account.roles.includes('super_admin') || hasPermission('orders', 'cancel')
  const canApproveBenefits = account.roles.includes('super_admin') || hasPermission('promotions', 'approve')
  const [branches, setBranches] = useState([])
  const [branchId, setBranchId] = useState('')
  const [orders, setOrders] = useState([])
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [cancelReasons, setCancelReasons] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [busyOrderId, setBusyOrderId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [proofUrls, setProofUrls] = useState({})
  const [paymentReviewNotes, setPaymentReviewNotes] = useState({})
  const [manualPaymentOverrideNotes, setManualPaymentOverrideNotes] = useState({})
  const [benefitDocumentUrls, setBenefitDocumentUrls] = useState({})
  const [benefitReviewNotes, setBenefitReviewNotes] = useState({})
  const [documentPreview, setDocumentPreview] = useState(null)

  useEffect(() => {
    let active = true
    getAdminBranches(account)
      .then((data) => {
        if (!active) return
        setBranches(data)
        const assignedBranch = account.branchAssignments[0]?.branch_id
        setBranchId((current) =>
          current || (account.roles.includes('super_admin') ? '' : assignedBranch || ''),
        )
      })
      .catch((error) => {
        console.error('Unable to load branches for order management.', error)
        if (active) setErrorMessage(error.message)
      })
    return () => {
      active = false
    }
  }, [account])

  const loadOrders = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage('')
    try {
      const loadedOrders = await getOrders(branchId, page, pageSize)
      setOrders(loadedOrders)
      const proofEntries = canEditOrders ? loadedOrders.flatMap((order) =>
        (order.payment_proof || [])
          .filter((proof) => proof.document_path)
          .map((proof) => [order.id, proof.document_path]),
      ) : []
      const proofUrlEntries = await Promise.all(proofEntries.map(async ([orderId, path]) => [
        orderId,
        await getOrderPaymentProofUrl(path).catch((error) => {
          console.error(`Unable to open payment proof for order ${orderId}.`, error)
          return ''
        }),
      ]))
      setProofUrls(Object.fromEntries(proofUrlEntries))
      const benefitEntries = canApproveBenefits ? loadedOrders.flatMap((order) =>
        (order.benefit_request || [])
          .filter((request) => request.document_path)
          .map((request) => [request.id, request.document_path]),
      ) : []
      const benefitUrlEntries = await Promise.all(benefitEntries.map(async ([requestId, path]) => [
        requestId,
        await getBenefitDocumentUrl(path).catch((error) => {
          console.error(`Unable to open benefit ID for request ${requestId}.`, error)
          return ''
        }),
      ]))
      setBenefitDocumentUrls(Object.fromEntries(benefitUrlEntries))
    } catch (error) {
      console.error('Unable to load the branch order queue.', error)
      setErrorMessage(error.message)
    } finally {
      setIsLoading(false)
    }
  }, [branchId, canApproveBenefits, canEditOrders, page, pageSize])

  useEffect(() => {
    void Promise.resolve().then(loadOrders)
  }, [loadOrders, reloadKey])

  async function runOrderAction(order, action) {
    setBusyOrderId(order.id)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      if (action === 'paid' || action === 'manual_provider_override') {
        if (action === 'manual_provider_override') {
          const reason = manualPaymentOverrideNotes[order.id]?.trim() || ''
          if (reason.length < 3) {
            setErrorMessage('Enter a reason of at least 3 characters for the manual override.')
            return
          }
          await recordManualProviderPaymentOverride(order.id, reason)
        } else {
          await recordOrderPayment(order.id)
        }
        setSuccessMessage(
          action === 'manual_provider_override'
            ? `Manual online payment override recorded for ${order.order_number}.`
            : `Payment recorded for ${order.order_number}.`,
        )
        setOrders((current) => current.map((item) => (
          item.id === order.id ? { ...item, payment_status: 'paid' } : item
        )))
      } else if (action === 'payment_approved' || action === 'payment_rejected') {
        const decision = action === 'payment_approved' ? 'approved' : 'rejected'
        const note = paymentReviewNotes[order.id]?.trim() || ''
        if (decision === 'rejected' && note.length < 3) {
          setErrorMessage('Provide a rejection reason of at least 3 characters.')
          return
        }
        await reviewOrderPaymentProof(order.id, decision, note)
        setSuccessMessage(`Payment proof ${decision} for ${order.order_number}.`)
        setOrders((current) => current.map((item) => {
          if (item.id !== order.id) return item
          const updatedProofs = (item.payment_proof || []).map((proof) => ({
            ...proof,
            status: decision,
            review_note: note || proof.review_note,
          }))
          return {
            ...item,
            payment_status: decision === 'approved' ? 'paid' : item.payment_status,
            payment_proof: updatedProofs,
          }
        }))
      } else if (action === 'benefit_approved' || action === 'benefit_rejected') {
        const request = order.benefit_request?.[0]
        const decision = action === 'benefit_approved' ? 'approved' : 'rejected'
        const note = benefitReviewNotes[request?.id]?.trim() || ''
        if (decision === 'rejected' && note.length < 3) {
          setErrorMessage('Provide a reason of at least 3 characters when rejecting an ID request.')
          return
        }
        if (!request) throw new Error('This order has no benefit discount request.')
        await reviewBenefitRequest(request.id, decision, note)
        setSuccessMessage(`${label(request.benefit_type)} ID request ${decision} for ${order.order_number}.`)
        setOrders((current) => current.map((item) => {
          if (item.id !== order.id) return item
          const updatedBenefit = (item.benefit_request || []).map((req) => (
            req.id === request.id ? { ...req, status: decision, decision_note: note } : req
          ))
          return {
            ...item,
            benefit_request: updatedBenefit,
          }
        }))
      } else {
        const reason = action === 'cancelled' ? cancelReasons[order.id]?.trim() : null
        if (action === 'cancelled' && (!reason || reason.length < 3)) {
          setErrorMessage('Enter a cancellation reason of at least 3 characters.')
          return
        }
        await updateOrderStatus(order.id, action, reason)
        setSuccessMessage(`${order.order_number} updated to ${label(action)}.`)
        setOrders((current) => current.map((item) => (
          item.id === order.id ? {
            ...item,
            status: action,
            ...(action === 'cancelled' ? { cancellation_reason: reason } : {}),
          } : item
        )))
      }
    } catch (error) {
      console.error('Unable to update order.', error)
      setErrorMessage(error.message)
    } finally {
      setBusyOrderId('')
    }
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="primary">Agapé Café · Operations</Typography>
          <Typography variant="h2">Order management</Typography>
          <Typography color="text.secondary">
            Review orders visible to your assigned branches, advance fulfillment,
            record branch payments, or cancel with a reason.
          </Typography>
        </Box>
        {!account.roles.includes('super_admin') && (
          <FormControl fullWidth>
            <InputLabel id="orders-branch-label">Branch</InputLabel>
            <Select
              labelId="orders-branch-label"
              label="Branch"
              value={branchId}
              onChange={(event) => {
                setPage(0)
                setBranchId(event.target.value)
              }}
            >
              {branches.map((branch) => (
                <MenuItem key={branch.id} value={branch.id}>{branch.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        {successMessage && <Alert severity="success">{successMessage}</Alert>}
        {isLoading ? (
          <Stack sx={{ alignItems: 'center', py: 8 }}><CircularProgress /></Stack>
        ) : !orders.length && page === 0 ? (
          <Alert severity="info">No orders are available for this branch.</Alert>
        ) : orders.map((order) => {
          const payment = Array.isArray(order.payment) ? order.payment[0] : order.payment
          const isOnlinePayment = payment?.method?.settlement_type === 'provider'
          return (
          <Paper key={order.id} variant="outlined" sx={{ overflow: 'hidden' }}>
            <Stack spacing={0}>
              <Box sx={{ p: { xs: 2, sm: 2.5 }, bgcolor: 'background.default' }}>
                <Stack spacing={1.5}>
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1.5}
                    sx={{ justifyContent: 'space-between', alignItems: { md: 'center' } }}
                  >
                    <Box>
                      <Typography variant="overline" color="text.secondary">Order</Typography>
                      <Typography variant="h6" sx={{ lineHeight: 1.2 }}>{order.order_number}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {new Intl.DateTimeFormat('en-PH', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(new Date(order.created_at))}
                      </Typography>
                    </Box>
                    <Stack
                      direction="row"
                      spacing={1}
                      useFlexGap
                      sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                    >
                      <Chip
                        color={order.status === 'cancelled' ? 'error' : order.status === 'completed' ? 'success' : 'primary'}
                        label={label(order.status)}
                        size="small"
                      />
                      <Chip
                        color={order.payment_status === 'paid' ? 'success' : 'default'}
                        label={`Payment ${label(order.payment_status)}`}
                        size="small"
                        variant="outlined"
                      />
                      {(order.benefit_request?.[0] || Number(order.discount_total) > 0) && (
                        <Chip
                          color={order.benefit_request?.[0]?.status === 'pending' ? 'warning' : 'success'}
                          label={order.benefit_request?.[0]
                            ? `Discount ${label(order.benefit_request[0].status)}`
                            : 'Discount applied'}
                          size="small"
                        />
                      )}
                    </Stack>
                  </Stack>
                  <Divider />
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={{ xs: 1, sm: 4 }}
                    useFlexGap
                    sx={{ flexWrap: 'wrap' }}
                  >
                    <Box>
                      <Typography variant="caption" color="text.secondary">CUSTOMER</Typography>
                      <Typography fontWeight={700}>{order.customer_name}</Typography>
                      <Typography variant="body2" color="text.secondary">{order.customer_phone}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" color="text.secondary">BRANCH & FULFILLMENT</Typography>
                      <Typography fontWeight={700}>{order.branch?.name || 'Branch'}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {label(order.fulfillment_method)}
                        {order.dining_table?.label ? ` · Table ${order.dining_table.label}` : ''}
                        {order.fulfillment_method === 'delivery' && order.delivery_address
                          ? ` · ${order.delivery_address}`
                          : ''}
                      </Typography>
                    </Box>
                  </Stack>
                </Stack>
              </Box>
              <Divider />
              <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
                <Stack spacing={1.5}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Typography fontWeight={700}>Order items</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                    </Typography>
                  </Stack>
                  <Stack divider={<Divider flexItem />} spacing={1}>
                    {order.items.map((item) => (
                      <Stack
                        key={item.id}
                        direction="row"
                        spacing={2}
                        sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Typography fontWeight={600}>
                            {item.quantity}× {item.product_name}
                            {item.variant_name ? ` · ${item.variant_name}` : ''}
                          </Typography>
                          {item.addons?.length > 0 && (
                            <Typography variant="caption" color="text.secondary">
                              Add-ons: {item.addons.map((addon) => addon.addon_name).join(', ')}
                            </Typography>
                          )}
                        </Box>
                        <Typography fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>
                          {formatPrice(item.line_total)}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                  {order.fulfillment_method === 'delivery' && Number(order.delivery_fee) > 0 && (
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">Delivery fee</Typography>
                      <Typography variant="body2">{formatPrice(order.delivery_fee)}</Typography>
                    </Stack>
                  )}
                  <Divider />
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Typography fontWeight={700}>Order total</Typography>
                    <Typography variant="h6" color="primary.main" fontWeight={800}>
                      {formatPrice(order.total)}
                    </Typography>
                  </Stack>
                </Stack>
              </Box>
              {order.customer_note && (
                <Alert severity="info" sx={{ mx: { xs: 2, sm: 2.5 }, mb: 2 }}>
                  <strong>Customer note:</strong> {order.customer_note}
                </Alert>
              )}
              {order.benefit_request?.[0] && (
                <Paper variant="outlined" sx={{ p: 2, mx: { xs: 2, sm: 2.5 }, mb: 2 }}>
                  <Stack spacing={1}>
                    <Typography fontWeight={700}>
                      {label(order.benefit_request[0].benefit_type)} ID · {label(order.benefit_request[0].status)}
                      {order.benefit_request[0].status === 'approved' ? ` · ${formatPrice(order.benefit_request[0].discount_total)} discount` : ''}
                    </Typography>
                    {order.benefit_request[0].items?.map((item) => (
                      <Typography key={item.order_item_id} variant="body2" color="text.secondary">
                        {item.eligible_quantity} × {item.order_item?.product_name}
                        {item.order_item?.variant_name ? ` · ${item.order_item.variant_name}` : ''}
                      </Typography>
                    ))}
                    {order.benefit_request[0].review_note && (
                      <Alert severity={order.benefit_request[0].status === 'rejected' ? 'warning' : 'info'}>
                        {order.benefit_request[0].review_note}
                      </Alert>
                    )}
                    {order.benefit_request[0].status === 'pending' && (
                      canApproveBenefits ? (
                        <>
                          {benefitDocumentUrls[order.benefit_request[0].id] ? (
                            <Button
                              variant="outlined"
                              onClick={() => setDocumentPreview({
                                title: `${label(order.benefit_request[0].benefit_type)} ID · ${order.order_number}`,
                                url: benefitDocumentUrls[order.benefit_request[0].id],
                                type: getDocumentType(order.benefit_request[0].document_path),
                              })}
                              sx={{ alignSelf: 'flex-start' }}
                            >
                              View ID document
                            </Button>
                          ) : (
                            <Alert severity="warning">The ID document is unavailable. Request a new upload before approving.</Alert>
                          )}
                          <Alert severity="info">Verify this ID before approving. Online payment proof stays locked until the discount decision is made.</Alert>
                          <TextField
                            size="small"
                            label="Reason (required if rejecting)"
                            value={benefitReviewNotes[order.benefit_request[0].id] || ''}
                            onChange={(event) => setBenefitReviewNotes((current) => ({
                              ...current,
                              [order.benefit_request[0].id]: event.target.value,
                            }))}
                          />
                          <Stack direction="row" spacing={1}>
                            <Button
                              variant="contained"
                              disabled={busyOrderId === order.id || !benefitDocumentUrls[order.benefit_request[0].id]}
                              onClick={() => runOrderAction(order, 'benefit_approved')}
                            >
                              Verify ID and apply discount
                            </Button>
                            <Button
                              color="error"
                              disabled={busyOrderId === order.id}
                              onClick={() => runOrderAction(order, 'benefit_rejected')}
                            >
                              Reject request
                            </Button>
                          </Stack>
                        </>
                      ) : (
                        <Alert severity="info">
                          You can view the request here, but need Promotions approve permission to verify the ID and apply the discount.
                        </Alert>
                      )
                    )}
                  </Stack>
                </Paper>
              )}
              {order.status === 'cancelled' && order.cancellation_reason && (
                <Alert severity="warning" sx={{ mx: { xs: 2, sm: 2.5 }, mb: 2 }}>
                  <strong>Cancellation reason:</strong> {order.cancellation_reason}
                </Alert>
              )}
              <Box sx={{ px: { xs: 2, sm: 2.5 }, pb: { xs: 2, sm: 2.5 } }}>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  ORDER ACTIONS
                </Typography>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  useFlexGap
                  sx={{ flexWrap: 'wrap', alignItems: { sm: 'center' } }}
                >
                {canEditOrders && nextStatus[order.status] && (
                  <Button
                    variant="contained"
                    disabled={busyOrderId === order.id}
                    onClick={() => runOrderAction(order, nextStatus[order.status])}
                  >
                    {busyOrderId === order.id ? 'Saving…' : `Mark ${label(nextStatus[order.status])}`}
                  </Button>
                )}
                {canEditOrders && order.payment_status === 'unpaid' && order.status !== 'cancelled' &&
                  !isOnlinePayment && (
                  <Button
                    variant="outlined"
                    disabled={busyOrderId === order.id}
                    onClick={() => runOrderAction(order, 'paid')}
                  >
                    Record payment
                  </Button>
                )}
                {canEditOrders && isOnlinePayment &&
                  order.payment_status === 'unpaid' && order.status !== 'cancelled' && (
                  <Stack spacing={1} sx={{ width: '100%', flexBasis: '100%' }}>
                    {order.payment_proof?.[0] ? (
                      <>
                        <Typography variant="body2" fontWeight={600}>
                          {payment.payment_method_name} proof: {label(order.payment_proof[0].status)}
                          {order.payment_proof[0].review_note ? ` · ${order.payment_proof[0].review_note}` : ''}
                        </Typography>
                        {order.payment_proof[0].reference_number && (
                          <Typography variant="body2">
                            Payment reference: {order.payment_proof[0].reference_number}
                          </Typography>
                        )}
                        {proofUrls[order.id] ? (
                          <Button
                            variant="outlined"
                            onClick={() => setDocumentPreview({
                              title: `${payment.payment_method_name} payment proof · ${order.order_number}`,
                              url: proofUrls[order.id],
                              type: getDocumentType(order.payment_proof[0].document_path),
                            })}
                            sx={{ alignSelf: 'flex-start' }}
                          >
                            View payment proof
                          </Button>
                        ) : order.payment_proof[0].document_path ? (
                          <Typography variant="caption" color="text.secondary">
                            Document: {order.payment_proof[0].document_path}
                          </Typography>
                        ) : null}
                        {order.payment_proof[0].status === 'pending' && order.benefit_request?.[0]?.status !== 'pending' && (
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <TextField
                              size="small"
                              label="Rejection reason (if rejecting)"
                              value={paymentReviewNotes[order.id] || ''}
                              onChange={(event) => setPaymentReviewNotes((current) => ({ ...current, [order.id]: event.target.value }))}
                            />
                            <Button variant="contained" disabled={busyOrderId === order.id} onClick={() => runOrderAction(order, 'payment_approved')}>
                              Verify payment
                            </Button>
                            <Button color="error" disabled={busyOrderId === order.id} onClick={() => runOrderAction(order, 'payment_rejected')}>
                              Reject proof
                            </Button>
                          </Stack>
                        )}
                        {order.payment_proof[0].status === 'pending' && order.benefit_request?.[0]?.status === 'pending' && (
                          <Alert severity="warning">Verify the benefit ID request first; payment proof cannot be approved until the discounted total is confirmed.</Alert>
                        )}
                      </>
                    ) : (
                      <Stack spacing={1}>
                        <Typography variant="body2" color="text.secondary">Waiting for customer to upload payment proof.</Typography>
                        <TextField
                          size="small"
                          label="Reason for manual override"
                          value={manualPaymentOverrideNotes[order.id] || ''}
                          onChange={(event) => setManualPaymentOverrideNotes((current) => ({
                            ...current,
                            [order.id]: event.target.value,
                          }))}
                          slotProps={{ htmlInput: { maxLength: 500 } }}
                        />
                        <Button
                          variant="outlined"
                          size="small"
                          disabled={
                            busyOrderId === order.id ||
                            (manualPaymentOverrideNotes[order.id]?.trim().length || 0) < 3
                          }
                          onClick={() => runOrderAction(order, 'manual_provider_override')}
                          sx={{ alignSelf: 'flex-start' }}
                        >
                          Manual override: Record payment
                        </Button>
                      </Stack>
                    )}
                  </Stack>
                )}
                {canCancelOrders && !['cancelled', 'completed'].includes(order.status) && (
                  <>
                    <TextField
                      size="small"
                      label={order.payment_status === 'unpaid' ? 'Void reason' : 'Cancellation reason'}
                      value={cancelReasons[order.id] || ''}
                      onChange={(event) =>
                        setCancelReasons((current) => ({
                          ...current,
                          [order.id]: event.target.value,
                        }))
                      }
                      slotProps={{ htmlInput: { maxLength: 500 } }}
                    />
                    <Button
                      color="error"
                      disabled={busyOrderId === order.id}
                      onClick={() => runOrderAction(order, 'cancelled')}
                    >
                      {order.payment_status === 'unpaid' ? 'Void unpaid order' : 'Cancel order'}
                    </Button>
                  </>
                )}
              </Stack>
              </Box>
            </Stack>
          </Paper>
        )})}
        {!isLoading && !errorMessage && (orders.length > 0 || page > 0) && (
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
      </Stack>
      <Dialog
        open={Boolean(documentPreview)}
        onClose={() => setDocumentPreview(null)}
        fullWidth
        maxWidth="md"
        aria-labelledby="order-document-preview-title"
        slotProps={{ paper: { sx: { overflow: 'hidden', borderRadius: 2 } } }}
      >
        {documentPreview && (
          <>
            <DialogTitle id="order-document-preview-title">{documentPreview.title}</DialogTitle>
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
