import { validatePaymentReceipt } from '../features/orders/paymentReceipt.js'
import { formatOrderStatus } from '../features/orders/orderStatus.js'
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
  const [paymentProofError, setPaymentProofError] = useState('')
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

  useEffect(() => {
    const refresh = (event) => {
      if (event.detail?.orderId === orderId) setOrderReloadKey((key) => key + 1)
    }
    window.addEventListener('customer-order-update', refresh)
    return () => window.removeEventListener('customer-order-update', refresh)
  }, [orderId])

  const order = result.id === orderId ? result.order : null
  const errorMessage = result.id === orderId ? result.error : ''
  const isLoading = result.id !== orderId
  const benefitRequest = benefitResult.id === orderId ? benefitResult.request : null
  const benefitRequestError = benefitResult.id === orderId ? benefitResult.error : ''
  const paymentProof = Array.isArray(order?.payment_proof) ? order.payment_proof[0] : order?.payment_proof
  const isOnlinePayment = order?.payment?.method?.settlement_type === 'provider'
  const paymentMethodName = order?.payment?.payment_method_name || 'Online payment'
  const isPaymentVerified = order?.payment_status === 'paid' || paymentProof?.status === 'approved'
  const needsPaymentReceipt = isOnlinePayment && order?.payment_status === 'unpaid' && !isPaymentVerified &&
    !['cancelled', 'completed'].includes(order?.status) && (!paymentProof || paymentProof.status === 'rejected')
  const paymentProofNotice = !paymentProof && (
    location.state?.paymentProofError || (
      searchParams.get('proof') === 'needed'
        ? 'Your order was created, but the payment receipt could not be attached. Upload the JPEG receipt here.'
        : ''
    )
  )

  async function uploadPaymentProof(event) {
    event.preventDefault()
    setPaymentProofError('')
    try {
      await validatePaymentReceipt(paymentProofFile)
    } catch (error) {
      setPaymentProofError(error.message)
      return
    }
    const previousPath = paymentProof?.document_path
    const path = `${account.id}/${orderId}/proof-${crypto.randomUUID()}.jpg`
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
      await submitOrderPaymentProof(orderId, path)
      if (previousPath) {
        const { error: removePreviousError } = await getSupabaseClient()
          .storage
          .from('order-payment-proofs')
          .remove([previousPath])
        if (removePreviousError) console.error('Unable to remove the replaced payment proof.', removePreviousError)
      }
      setPaymentProofFile(null)
      setResult((current) => ({
        ...current,
        order: {
          ...current.order,
          payment_proof: [{
            status: 'pending',
            document_path: path,
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
        {order && <Button component={RouterLink} to={`/receipt/${order.id}`} target="_blank" rel="noopener noreferrer" variant="outlined" sx={{ alignSelf: 'flex-start' }}>Print receipt</Button>}
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
                <Typography>{formatOrderStatus(order.status)}</Typography>
                <Divider />
                <Typography variant="h6">Order type and contact</Typography>

                <Typography>
                  {formatStatus(order.fulfillment_method)}
                </Typography>
                {order.fulfillment_method === 'delivery' && (
                  <>
                    <Typography>Delivery address: {order.delivery_address}</Typography>
                    <Typography>Delivery fee: {Number(order.delivery_fee) > 0 ? formatPrice(order.delivery_fee) : 'Free'}</Typography>
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
                            ({item.serving_type === 'cup' ? 'Cup' : 'Glass / Mug'})
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
                {order.fulfillment_method === 'delivery' && (
                  <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
                    <Typography>Delivery fee</Typography>
                    <Typography>{Number(order.delivery_fee) > 0 ? formatPrice(order.delivery_fee) : 'Free'}</Typography>
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
                  <Alert severity={isPaymentVerified ? 'success' : paymentProof?.status === 'rejected' ? 'warning' : 'info'}>
                    {paymentMethodName}: {isPaymentVerified
                      ? 'Payment verified. Thank you!'
                      : paymentProof?.status === 'pending'
                        ? 'Receipt received. Awaiting verification. No need to pay again or upload another receipt.'
                        : formatStatus(order.payment_status)}
                  </Alert>
                )}
                {isOnlinePayment && paymentProof?.status === 'rejected' && (
                  <Alert severity="warning">
                    Payment receipt rejected{paymentProof.review_note ? `: ${paymentProof.review_note}` : '.'}
                    {' '}Upload a clearer or corrected JPEG receipt below. If you already paid, do not pay again unless the store instructs you to.
                  </Alert>
                )}
                {needsPaymentReceipt && benefitRequest?.status === 'pending' && (
                  <Alert severity="info">Wait for the store to verify your benefit discount before uploading payment proof.</Alert>
                )}
              </Stack>
            </Paper>
            {needsPaymentReceipt && benefitRequest?.status !== 'pending' && (
              <Paper component="form" onSubmit={uploadPaymentProof} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
                <Stack spacing={2}>
                  <Typography variant="h6">{paymentProof?.status === 'rejected' ? 'Replace rejected receipt' : 'Upload payment receipt'}</Typography>
                  {paymentProofNotice && <Alert severity="warning">{paymentProofNotice}</Alert>}
                  {paymentProofError && <Alert severity="error">{paymentProofError}</Alert>}
                  <Typography color="text.secondary">
                    Attach the JPEG receipt for your {paymentMethodName} payment of {formatPrice(order.total)}.
                    If you already paid, upload your existing receipt. Do not pay again.
                  </Typography>
                  <Button
                    component="label"
                    variant="outlined"
                    fullWidth
                    sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                  >
                    {paymentProofFile?.name || (paymentProof?.status === 'rejected' ? 'Upload new payment proof' : 'Choose JPEG payment receipt')}
                    <input
                      hidden
                      type="file"
                      accept="image/jpeg,.jpg,.jpeg"
                      onChange={(event) => {
                        setPaymentProofFile(event.target.files?.[0] || null)
                        event.target.value = ''
                      }}
                    />
                  </Button>
                  <Button type="submit" variant="contained" disabled={isSubmittingPaymentProof || !paymentProofFile}>
                    {isSubmittingPaymentProof ? 'Uploading…' : 'Submit payment proof'}
                  </Button>
                </Stack>
              </Paper>
            )}
          </Stack>
        )}
      </Stack>
    </Container>
  )
}
