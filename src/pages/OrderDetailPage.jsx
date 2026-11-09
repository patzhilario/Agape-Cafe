import { useEffect, useState } from 'react'
import { Link as RouterLink, useLocation, useParams, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Container,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import RefreshIcon from '@mui/icons-material/Refresh'
import { useAuth } from '../features/auth/useAuth.js'
import {
  getCustomerOrder,
  submitOrderPaymentProof,
} from '../features/orders/orderData.js'
import { formatPrice } from '../features/public/publicData.js'
import { getCustomerBenefitRequest } from '../features/discounts/benefitData.js'
import { getSupabaseClient } from '../lib/supabaseClient.js'
import { formatOrderDate as formatDate } from '../features/orders/formatOrderDate.js'
import {
  EmptyPublicState,
  PublicDataError,
  PublicLoading,
} from '../components/public/PublicDataState.jsx'

function formatStatus(value) {
  return value
    .split('_')
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export default function OrderDetailPage() {
  const { orderId } = useParams()
  const { account } = useAuth()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [result, setResult] = useState({ id: '', order: null, error: '' })
  const [benefitResult, setBenefitResult] = useState({ id: '', request: null, error: '' })
  const [benefitReloadKey, setBenefitReloadKey] = useState(0)
  const [orderReloadKey, setOrderReloadKey] = useState(0)
  const [paymentProofFile, setPaymentProofFile] = useState(null)
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentProofError, setPaymentProofError] = useState('')
  const [paymentProofSuccess, setPaymentProofSuccess] = useState('')
  const [isSubmittingPaymentProof, setIsSubmittingPaymentProof] = useState(false)

  useEffect(() => {
    let active = true
    getCustomerOrder(orderId)
      .then((order) => {
        if (active) setResult({ id: orderId, order, error: '' })
      })
      .catch((error) => {
        console.error('Unable to load customer order details.', error)
        if (active) setResult({ id: orderId, order: null, error: error.message })
      })
    return () => {
      active = false
    }
  }, [orderId, orderReloadKey])

  useEffect(() => {
    let active = true
    getCustomerBenefitRequest(orderId)
      .then((request) => {
        if (active) setBenefitResult({ id: orderId, request, error: '' })
      })
      .catch((error) => {
        console.error('Unable to load benefit discount request.', error)
        if (active) setBenefitResult({ id: orderId, request: null, error: error.message })
      })
    return () => { active = false }
  }, [orderId, benefitReloadKey])

  const order = result.id === orderId ? result.order : null
  const errorMessage = result.id === orderId ? result.error : ''
  const isLoading = result.id !== orderId
  const benefitRequest = benefitResult.id === orderId ? benefitResult.request : null
  const benefitRequestError = benefitResult.id === orderId ? benefitResult.error : ''
  const paymentProof = order?.payment_proof?.[0]
  const isOnlinePayment = order?.payment?.method?.settlement_type === 'provider'
  const paymentMethodName = order?.payment?.payment_method_name || 'Online payment'
  const paymentProofNotice = !paymentProof && (
    location.state?.paymentProofError || (
      searchParams.get('proof') === 'needed'
        ? 'Your order was created, but the payment receipt could not be attached. Enter the reference number and upload it here.'
        : ''
    )
  )

  async function uploadPaymentProof(event) {
    event.preventDefault()
    setPaymentProofError('')
    setPaymentProofSuccess('')
    if (!paymentProofFile) {
      setPaymentProofError('Choose a payment screenshot or PDF first.')
      return
    }
    if (paymentReference.trim().length < 4 || paymentReference.trim().length > 50) {
      setPaymentProofError('Enter a payment reference number between 4 and 50 characters.')
      return
    }
    if (paymentProofFile.size > 10 * 1024 * 1024) {
      setPaymentProofError('The payment proof must be 10 MB or smaller.')
      return
    }
    const extensionByMime = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
    }
    const extension = extensionByMime[paymentProofFile.type]
    if (!extension) {
      setPaymentProofError('Use a JPG, PNG, WebP, or PDF payment proof.')
      return
    }
    const previousPath = paymentProof?.document_path
    const path = `${account.id}/${orderId}/proof-${crypto.randomUUID()}.${extension}`
    setIsSubmittingPaymentProof(true)
    let uploaded = false
    try {
      const { error } = await getSupabaseClient()
        .storage
        .from('order-payment-proofs')
        .upload(path, paymentProofFile, {
          contentType: paymentProofFile.type,
          upsert: false,
        })
      if (error) throw new Error(`Could not upload payment proof: ${error.message}`)
      uploaded = true
      await submitOrderPaymentProof(orderId, path, paymentReference.trim())
      if (previousPath) {
        const { error: removePreviousError } = await getSupabaseClient()
          .storage
          .from('order-payment-proofs')
          .remove([previousPath])
        if (removePreviousError) console.error('Unable to remove the replaced payment proof.', removePreviousError)
      }
      setPaymentProofFile(null)
      setPaymentProofSuccess('Payment proof submitted. The selected branch will verify it before marking the order paid.')
      setResult((current) => ({
        ...current,
        order: {
          ...current.order,
          payment_proof: [{
            status: 'pending',
            document_path: path,
            reference_number: paymentReference.trim(),
            created_at: new Date().toISOString(),
          }],
        },
      }))
    } catch (error) {
      console.error('Unable to submit payment proof.', error)
      if (uploaded) {
        const { error: cleanupError } = await getSupabaseClient()
          .storage
          .from('order-payment-proofs')
          .remove([path])
        if (cleanupError) console.error('Unable to remove the unlinked payment proof.', cleanupError)
      }
      setPaymentProofError(error.message)
    } finally {
      setIsSubmittingPaymentProof(false)
    }
  }

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 7 } }}>
      <Stack spacing={3}>
        <Button
          component={RouterLink}
          to="/customer/orders"
          startIcon={<ArrowBackIcon />}
          sx={{ alignSelf: 'flex-start' }}
        >
          Order history
        </Button>
        <Button
          startIcon={<RefreshIcon />}
          onClick={() => {
            setOrderReloadKey((key) => key + 1)
            setBenefitReloadKey((key) => key + 1)
          }}
          sx={{ alignSelf: 'flex-start' }}
        >
          Refresh order and discount status
        </Button>
        {searchParams.get('placed') === '1' && (
          <Alert severity="success">
            Order received.
          </Alert>
        )}
        {errorMessage && <PublicDataError message={errorMessage} />}
        {isLoading ? (
          <PublicLoading label="Loading order details…" />
        ) : errorMessage ? null : !order ? (
          <EmptyPublicState>This order was not found or is not available to this account.</EmptyPublicState>
        ) : (
          <Stack spacing={3}>
            <Box>
              <Typography variant="overline" color="primary">
                Agapé Café order
              </Typography>
              <Typography variant="h1">{order.order_number}</Typography>
              <Typography color="text.secondary">{formatDate(order.created_at)}</Typography>
            </Box>
            <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
              <Stack spacing={2}>
                <Typography variant="h6">Order status</Typography>
                <Typography>{formatStatus(order.status)}</Typography>
                <Divider />
                <Typography variant="h6">Pickup and contact</Typography>
                <Typography>{order.branch?.name}</Typography>
                {order.branch?.address && (
                  <Typography color="text.secondary">{order.branch.address}</Typography>
                )}
                <Typography>
                  {formatStatus(order.fulfillment_method)}
                  {order.dining_table?.label ? ` · Table ${order.dining_table.label}` : ''}
                </Typography>
                {order.fulfillment_method === 'delivery' && (
                  <>
                    <Typography>Delivery address: {order.delivery_address}</Typography>
                    {Number(order.delivery_fee) > 0 && (
                      <Typography>Café delivery charge: {formatPrice(order.delivery_fee)}</Typography>
                    )}
                    <Alert severity="info">
                      The delivery rider or booking fee is paid separately by the customer directly to the rider/service.
                    </Alert>
                  </>
                )}
                <Typography>{order.customer_phone}</Typography>
                {order.customer_note && (
                  <Typography color="text.secondary">Note: {order.customer_note}</Typography>
                )}
                {order.cancellation_reason && (
                  <Alert severity="warning">Cancellation reason: {order.cancellation_reason}</Alert>
                )}
                {benefitRequestError && (
                  <Alert severity="warning">
                    Benefit request status is unavailable. Apply the Phase 6
                    migration before using this feature.
                  </Alert>
                )}
                {benefitRequest && (
                  <Alert severity={benefitRequest.status === 'approved' ? 'success' : benefitRequest.status === 'rejected' ? 'error' : 'info'}>
                    {formatStatus(benefitRequest.benefit_type)} discount request: {formatStatus(benefitRequest.status)}
                    {benefitRequest.status === 'approved' && ` · Applied ${formatPrice(benefitRequest.discount_total)}`}
                    {benefitRequest.review_note && ` · ${benefitRequest.review_note}`}
                  </Alert>
                )}
              </Stack>
            </Paper>
            <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
              <Stack spacing={2}>
                <Typography variant="h6">Items and totals</Typography>
                {order.items.map((item) => (
                  <Box key={item.id}>
                    <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
                      <Typography>
                        {item.quantity} × {item.product_name}
                        {item.variant_name ? ` · ${item.variant_name}` : ''}
                        {item.serving_type && (
                          <span style={{ fontSize: '0.85em', opacity: 0.8, marginLeft: 6 }}>
                            ({item.serving_type === 'cup' ? 'Takeout Cup' : 'Glass / Mug'})
                          </span>
                        )}
                      </Typography>
                      <Typography>{formatPrice(item.line_total)}</Typography>
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      Unit price with selected options: {formatPrice(item.unit_price)} each
                    </Typography>
                    {item.addons?.map((addon) => (
                      <Typography key={`${item.id}-${addon.addon_name}`} variant="body2" color="text.secondary">
                        Add-on: {addon.addon_name} · {formatPrice(addon.unit_price)} each
                      </Typography>
                    ))}
                  </Box>
                ))}
                <Divider />
                <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
                  <Typography>Subtotal</Typography>
                  <Typography>{formatPrice(order.subtotal)}</Typography>
                </Stack>
                {order.fulfillment_method === 'delivery' && Number(order.delivery_fee) > 0 && (
                  <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
                    <Typography>Café delivery charge</Typography>
                    <Typography>{formatPrice(order.delivery_fee)}</Typography>
                  </Stack>
                )}
                {Number(order.discount_total) > 0 && (
                  <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
                    <Typography>Discounts</Typography>
                    <Typography>-{formatPrice(order.discount_total)}</Typography>
                  </Stack>
                )}
                <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="h6">Total</Typography>
                  <Typography variant="h6">{formatPrice(order.total)}</Typography>
                </Stack>
                {order.payment && (
                  <Alert severity="info">
                    {order.payment.payment_method_name}: {formatStatus(order.payment_status)}
                  </Alert>
                )}
                {isOnlinePayment && paymentProof && (
                  <Alert severity={paymentProof.status === 'approved' ? 'success' : paymentProof.status === 'rejected' ? 'error' : 'info'}>
                    Payment proof: {formatStatus(paymentProof.status)}
                    {paymentProof.reference_number ? ` · Reference: ${paymentProof.reference_number}` : ''}
                    {paymentProof.review_note ? ` · ${paymentProof.review_note}` : ''}
                  </Alert>
                )}
              </Stack>
            </Paper>
            {isOnlinePayment && order.payment_status === 'unpaid' && !['cancelled', 'completed'].includes(order.status) && (
              <Paper component="form" onSubmit={uploadPaymentProof} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
                <Stack spacing={2}>
                  <Typography variant="h6">{paymentMethodName} payment</Typography>
                  {paymentProofNotice && <Alert severity="warning">{paymentProofNotice}</Alert>}
                  {benefitRequest?.status === 'pending' && (
                    <Alert severity="info">
                      Your benefit ID is being verified. The branch will review your payment proof after confirming the discount and updated total.
                    </Alert>
                  )}
                  {paymentProof?.status === 'pending' && (
                    <Alert severity="info">
                      Payment proof received{paymentProof.reference_number ? ` · Reference: ${paymentProof.reference_number}` : ''}. No need to upload it again; the branch will verify your payment.
                    </Alert>
                  )}
                  {paymentProof?.status === 'approved' && (
                    <Alert severity="success">
                      Payment verified{paymentProof.reference_number ? ` · Reference: ${paymentProof.reference_number}` : ''}. Thank you!
                    </Alert>
                  )}
                  {paymentProof?.status === 'rejected' && paymentProof.review_note && (
                    <Alert severity="warning">{paymentProof.review_note}</Alert>
                  )}
                  {benefitRequest?.status !== 'pending' &&
                    !['pending', 'approved'].includes(paymentProof?.status) && (
                    <>
                      {(order.payment?.method?.qr_code_path || (
                        order.payment?.payment_method_code === 'gcash' ? order.branch?.gcash_qr_path : null
                      )) && (
                        <Box
                          component="img"
                          src={getSupabaseClient().storage.from('branch-payment-qr').getPublicUrl(
                            order.payment?.method?.qr_code_path || order.branch?.gcash_qr_path,
                          ).data.publicUrl}
                          alt={`${order.branch?.name} ${paymentMethodName} QR code`}
                          sx={{ width: 'min(100%, 280px)', maxHeight: 280, objectFit: 'contain', alignSelf: 'center' }}
                        />
                      )}
                      <Typography color="text.secondary">
                        {paymentProof?.status === 'rejected'
                          ? `Upload a new receipt for the current order total of ${formatPrice(order.total)} to ${order.branch?.name} using the QR above.`
                          : `Pay the current order total of ${formatPrice(order.total)} to ${order.branch?.name} using the QR above, then enter the reference number and upload your receipt.`}
                      </Typography>
                      {(!paymentProof || paymentProof.status === 'rejected') && (
                        <TextField
                          label={`${paymentMethodName} reference number`}
                          value={paymentReference}
                          onChange={(event) => setPaymentReference(event.target.value)}
                          required
                          slotProps={{ htmlInput: { maxLength: 50 } }}
                        />
                      )}
                      {paymentProofError && <Alert severity="error">{paymentProofError}</Alert>}
                      {paymentProofSuccess && <Alert severity="success">{paymentProofSuccess}</Alert>}
                      <Button
                        component="label"
                        variant="outlined"
                        fullWidth
                        sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                      >
                        {paymentProofFile?.name || (paymentProof?.status === 'rejected' ? 'Upload new payment proof' : 'Choose payment screenshot or PDF')}
                        <input
                          hidden
                          type="file"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          onChange={(event) => {
                            setPaymentProofFile(event.target.files?.[0] || null)
                            event.target.value = ''
                          }}
                        />
                      </Button>
                      <Button type="submit" variant="contained" disabled={isSubmittingPaymentProof || !paymentProofFile || paymentReference.trim().length < 4}>
                        {isSubmittingPaymentProof ? 'Uploading…' : 'Submit payment proof'}
                      </Button>
                    </>
                  )}
                </Stack>
              </Paper>
            )}
          </Stack>
        )}
      </Stack>
    </Container>
  )
}
