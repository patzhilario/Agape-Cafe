import { validatePaymentReceipt } from '../features/orders/paymentReceipt.js'
import { getVariantLabel } from '../features/public/menuOptions.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
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
import { useAuth } from '../features/auth/useAuth.js'
import { useCart } from '../features/orders/useCart.js'
import { getCartItemKey } from '../features/orders/cartUtils.js'
import {
  createCustomerOrder,
  getAvailablePaymentMethods,
  getEligiblePromotions,
  submitOrderPaymentProof,
} from '../features/orders/orderData.js'
import { getPublicBranches, formatPrice } from '../features/public/publicData.js'
import { EmptyPublicState, PublicDataError } from '../components/public/PublicDataState.jsx'
import { getSupabaseClient } from '../lib/supabaseClient.js'

function calculatePromotionEstimate(promotion, items, subtotal) {
  if (!promotion) return 0
  const targets = promotion.promotion_products || []
  const eligibleSubtotal = items.reduce((total, item) => {
    const eligible = !targets.length || targets.some((target) => target.product_id === item.productId)
    if (!eligible) return total
    const productUnit = item.variantId ? item.variantPrice : item.productPrice
    return total + (productUnit + item.addons.reduce((sum, addon) => sum + addon.price, 0)) * item.quantity
  }, 0)

  if (subtotal < Number(promotion.minimum_purchase)) return 0
  let discount =
    promotion.discount_type === 'percentage'
      ? Math.round((eligibleSubtotal * Number(promotion.discount_value) + Number.EPSILON) * 100) / 100
      : Math.min(Number(promotion.discount_value), eligibleSubtotal)
  if (promotion.max_discount) discount = Math.min(discount, Number(promotion.max_discount))
  return Math.min(discount, eligibleSubtotal)
}

export default function CheckoutPage({ panel = false }) {
  const navigate = useNavigate()
  const { account } = useAuth()
  const { items, branchId, subtotal, setBranchId, clearCart } = useCart()
  const [branches, setBranches] = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])
  const [paymentMethodsBranchId, setPaymentMethodsBranchId] = useState('')
  const [promotions, setPromotions] = useState([])
  const [phone, setPhone] = useState(account.phone || '')
  const [deliveryAddress, setDeliveryAddress] = useState(account.address || '')
  const [note, setNote] = useState('')
  const [fulfillment, setFulfillment] = useState('dine_in')
  const [paymentMethodId, setPaymentMethodId] = useState('')
  const [paymentProofFile, setPaymentProofFile] = useState(null)
  const [promotionId, setPromotionId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [loadError, setLoadError] = useState('')
  const [dataKey, setDataKey] = useState('')
  const [optionsReloadKey, setOptionsReloadKey] = useState(0)
  const [checkoutDataReloadKey, setCheckoutDataReloadKey] = useState(0)
  const requestRef = useRef({ fingerprint: '', id: '' })

  const productIds = useMemo(
    () => [...new Set(items.map((item) => item.productId))],
    [items],
  )
  const activePromotion = promotions.find((promotion) => promotion.id === promotionId)
  const estimatedDiscount = calculatePromotionEstimate(activePromotion, items, subtotal)
  useEffect(() => {
    let active = true
    getPublicBranches({ refresh: true })
      .then((loadedBranches) => {
        if (!active) return
        setBranches(loadedBranches)
        setBranchId(loadedBranches[0]?.id || '')
      })
      .catch((error) => {
        console.error('Unable to load checkout options.', error)
        if (active) setLoadError(error.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [optionsReloadKey, setBranchId])

  useEffect(() => {
    let active = true
    if (!branchId) return () => { active = false }
    getAvailablePaymentMethods(branchId)
      .then((methods) => {
        if (!active) return
        setPaymentMethods(methods)
        setPaymentMethodsBranchId(branchId)
        const availableMethods = methods.filter((method) => method.settlement_type === 'provider' && method.qr_code_path)
        setPaymentMethodId((current) =>
          availableMethods.some((method) => method.id === current)
            ? current
            : availableMethods[0]?.id ||
              '',
        )
      })
      .catch((error) => {
        console.error('Unable to load branch payment methods.', error)
        if (active) setLoadError(error.message)
      })
    return () => { active = false }
  }, [branchId, fulfillment, optionsReloadKey])

  useEffect(() => {
    if (!branchId || !productIds.length) return undefined
    let active = true
    const nextKey = `${branchId}:${productIds.slice().sort().join(',')}`
    getEligiblePromotions(productIds)
      .then((loadedPromotions) => {
        if (!active) return
        setPromotions(loadedPromotions)
        if (promotionId && !loadedPromotions.some((promotion) => promotion.id === promotionId)) {
          setPromotionId('')
        }
        setDataKey(nextKey)
      })
      .catch((error) => {
        console.error('Unable to load checkout promotions.', error)
        if (active) setLoadError(error.message)
      })
    return () => {
      active = false
    }
  }, [branchId, productIds, promotionId, checkoutDataReloadKey])

  const selectedBranch = branches.find((branch) => branch.id === branchId)
  const branchPaymentMethods = paymentMethodsBranchId === branchId ? paymentMethods : []
  const onlinePaymentMethods = branchPaymentMethods.filter(
    (method) => method.settlement_type === 'provider' && method.qr_code_path,
  )
  const deliveryFee = fulfillment === 'delivery' ? Number(selectedBranch?.delivery_fee || 0) : 0
  const estimatedTotal = Math.max(0, subtotal - estimatedDiscount) + deliveryFee
  const canPayOnline = onlinePaymentMethods.length > 0
  const availablePaymentMethods = onlinePaymentMethods
  const selectedPaymentMethod = availablePaymentMethods.find((method) => method.id === paymentMethodId)
  const expectedDataKey = `${branchId}:${productIds.slice().sort().join(',')}`
  const branchDataLoading = Boolean(branchId && productIds.length && dataKey !== expectedDataKey)

  useEffect(() => {
    if (!isLoading && branchId && !branches.some((branch) => branch.id === branchId)) {
      setBranchId('')
      setDataKey('')
    }
  }, [branchId, branches, isLoading, setBranchId])

  async function submitOrder(event) {
    event.preventDefault()
    setErrorMessage('')

    if (!items.length) {
      setErrorMessage('Your cart is empty. Add menu items before checkout.')
      return
    }
    if (!branchId) {
      setErrorMessage('Store details are still loading. Please try again.')
      return
    }
    if (!selectedBranch?.is_active) {
      setErrorMessage('The cafe is currently closed for new orders.')
      return
    }
    if (!paymentMethodId) {
      setErrorMessage('No e-payment method is currently configured. Please contact the store.')
      return
    }
    const selectedPaymentMethod = availablePaymentMethods.find((method) => method.id === paymentMethodId)
    if (!selectedPaymentMethod) {
      setErrorMessage('Choose an available e-payment method.')
      return
    }
    if (selectedPaymentMethod.settlement_type !== 'provider') {
      setErrorMessage('All orders require an e-payment method with a QR code.')
      return
    }
    if (selectedPaymentMethod.settlement_type === 'provider' && !selectedPaymentMethod.qr_code_path) {
      setErrorMessage(`${selectedPaymentMethod.name} QR is not set up for the store.`)
      return
    }
    try {
      await validatePaymentReceipt(paymentProofFile)
    } catch (error) {
      setErrorMessage(error.message)
      return
    }
    if (fulfillment === 'delivery') {
      if (!selectedBranch?.delivery_enabled) {
        setErrorMessage('Delivery is not available from the store.')
        return
      }
      if (deliveryAddress.trim().length < 8 || deliveryAddress.trim().length > 500) {
        setErrorMessage('Enter a delivery address between 8 and 500 characters.')
        return
      }
    }
    if (branchDataLoading) {
      setErrorMessage('Wait for the selected menu availability check to finish.')
      return
    }
    if (!/^[+()\d\s.-]{7,40}$/.test(phone.trim())) {
      setErrorMessage('Enter a valid contact phone number.')
      return
    }

    const requestPayload = {
      branchId,
      fulfillment,
      deliveryAddress: fulfillment === 'delivery' ? deliveryAddress.trim() : '',
      paymentMethodId,
      expectedDeliveryFee: deliveryFee,
      phone: phone.trim(),
      note: note.trim(),
      promotionId,
      items: items.map((item) => ({
        key: getCartItemKey(item),
        quantity: item.quantity,
      })),
    }
    const fingerprint = JSON.stringify(requestPayload)
    if (requestRef.current.fingerprint !== fingerprint) {
      requestRef.current = {
        fingerprint,
        id: crypto.randomUUID(),
      }
    }

    setIsSubmitting(true)
    let createdOrderId = ''
    let paymentProofPath = ''
    let paymentProofSubmitted = false
    try {
      const orderId = await createCustomerOrder({
        fulfillment,
        expectedDeliveryFee: deliveryFee,
        deliveryAddress: fulfillment === 'delivery' ? deliveryAddress.trim() : '',
        paymentMethodId,
        requestId: requestRef.current.id,
        phone: phone.trim(),
        note: note.trim(),
        promotionId,
        items: items.map((item) => ({ ...item, servingType: item.categoryType === 'drink' ? 'cup' : item.servingType })),
      })
      createdOrderId = orderId
      if (selectedPaymentMethod?.settlement_type === 'provider') {
        paymentProofPath = `${account.id}/${orderId}/proof-${crypto.randomUUID()}.jpg`
        const { error: uploadError } = await getSupabaseClient()
          .storage
          .from('order-payment-proofs')
          .upload(paymentProofPath, paymentProofFile, {
            contentType: paymentProofFile.type,
            upsert: false,
          })
          if (uploadError) throw new Error(`Order was created, but the payment receipt could not be uploaded: ${uploadError.message}`)
          await submitOrderPaymentProof(orderId, paymentProofPath)
        paymentProofSubmitted = true
      }
      clearCart()
      requestRef.current = { fingerprint: '', id: '' }
      navigate(`/customer/orders/${orderId}?placed=1`, { replace: true })
    } catch (error) {
      if (createdOrderId) {
        if (paymentProofPath && !paymentProofSubmitted) {
          const { error: cleanupError } = await getSupabaseClient()
            .storage
            .from('order-payment-proofs')
            .remove([paymentProofPath])
          if (cleanupError) console.error('Unable to remove the unlinked payment proof.', cleanupError)
        }
        clearCart()
        requestRef.current = { fingerprint: '', id: '' }
        navigate(`/customer/orders/${createdOrderId}?placed=1&proof=needed`, {
          replace: true,
          state: { paymentProofError: error.message },
        })
      } else {
        setErrorMessage(error.message)
        if (error.message.startsWith('Delivery fee changed.')) {
          setPaymentProofFile(null)
          try {
            const stores = await getPublicBranches({ refresh: true })
            setBranches(stores)
          } catch (refreshError) {
            setLoadError(refreshError.message)
          }
        }

      }
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <Stack sx={{ alignItems: 'center', py: 10 }} spacing={2}>
        <CircularProgress />
        <Typography color="text.secondary">Preparing secure checkout…</Typography>
      </Stack>
    )
  }

  if (!items.length) {
    return (
      <Container maxWidth="md" sx={{ py: 8 }}>
        <EmptyPublicState>Your cart is empty.</EmptyPublicState>
        <Button component={RouterLink} to="/menu" variant="contained">
          Browse menu
        </Button>
      </Container>
    )
  }

  return (
    <Container
      maxWidth={panel ? false : 'md'}
      sx={{
        py: panel ? 2 : { xs: 5, md: 8 },
        px: panel ? 0 : undefined,
        width: panel ? '100%' : undefined,
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <Stack spacing={panel ? 2.5 : 3}>
        <Box sx={{ pb: panel ? 1 : 0 }}>
          <Typography variant="overline" color="primary" sx={{ letterSpacing: 1.5 }}>
            Agapé Café · Secure checkout
          </Typography>
          <Typography variant={panel ? 'h4' : 'h1'} fontWeight={700}>Place your order</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Complete your order details to continue.
          </Typography>
        </Box>
        {loadError && (
          <PublicDataError
            message={loadError}
            onRetry={() => {
              setLoadError('')
              setIsLoading(true)
              setDataKey('')
              setOptionsReloadKey((key) => key + 1)
              setCheckoutDataReloadKey((key) => key + 1)
            }}
          />
        )}
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        <Box
          component="form"
          onSubmit={submitOrder}
          sx={{
            display: 'grid',
            gridTemplateColumns: panel ? 'minmax(0, 1fr)' : { xs: '1fr', md: '1.15fr .85fr' },
            gap: panel ? 2.5 : 3,
            minWidth: 0,
          }}
        >
          <Stack spacing={2.25}>
            {selectedBranch && (
              <Typography variant="body2" color="text.secondary">
                {selectedBranch.address}
              </Typography>
            )}
            <FormControl fullWidth size="small">
              <InputLabel id="checkout-fulfillment-label">Order type</InputLabel>
              <Select
                labelId="checkout-fulfillment-label"
                label="Order type"
                value={fulfillment}
                onChange={(event) => { setFulfillment(event.target.value); setErrorMessage('') }}
              >
                <MenuItem value="dine_in">Dine-in</MenuItem>
                <MenuItem value="pickup">Pick-up</MenuItem>
                <MenuItem value="delivery" disabled={!selectedBranch?.delivery_enabled}>Delivery</MenuItem>
              </Select>
            </FormControl>
            {!canPayOnline && (
              <Alert severity="warning">
                Orders require at least one online QR payment method configured for the store.
              </Alert>
            )}
            {fulfillment === 'delivery' && (
              <TextField
                label="Delivery address"
                value={deliveryAddress}
                onChange={(event) => setDeliveryAddress(event.target.value)}
                required
                autoComplete="street-address"
                multiline
                minRows={2}
                slotProps={{ htmlInput: { minLength: 8, maxLength: 500 } }}
                helperText="Enter the complete address and any useful landmark."
              />
            )}
            <Typography variant="subtitle1" fontWeight={700}>
              Contact and payment
            </Typography>
            <TextField
              label="Contact phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              autoComplete="tel"
              type="tel"
              required
              slotProps={{
                htmlInput: { maxLength: 40 },
              }}
              helperText="The store may contact you about your order."
            />
            <TextField
              label="Note for the café (optional)"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              multiline
              minRows={2}
              slotProps={{ htmlInput: { maxLength: 500 } }}
              helperText={`${note.length}/500`}
            />
            <Box>
              <Typography variant="subtitle2" fontWeight={700}>Payment method</Typography>
              {availablePaymentMethods.length > 0 && (
                <FormControl fullWidth required size="small" sx={{ mt: 1.5 }}>
                  <InputLabel id="checkout-payment-label" shrink>
                    Payment method
                  </InputLabel>
                  <Select
                    labelId="checkout-payment-label"
                    label="Payment method"
                    value={selectedPaymentMethod?.id || ''}
                    displayEmpty
                    onChange={(event) => {
                      setPaymentMethodId(event.target.value)
                      setErrorMessage('')
                    }}
                  >
                    {availablePaymentMethods.map((method) => (
                      <MenuItem key={method.id} value={method.id}>
                        {method.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              {!availablePaymentMethods.length && (
                <Typography variant="body2" color="error">
                  Ordering is unavailable until an online QR payment method is configured for the store.
                </Typography>
              )}
            </Box>
            {selectedPaymentMethod?.settlement_type === 'provider' && selectedPaymentMethod.qr_code_path && (
              <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                  Scan {selectedBranch?.name || 'the cafe'}’s {selectedPaymentMethod.name} QR
                </Typography>
                <Box
                  component="img"
                  src={getSupabaseClient().storage.from('branch-payment-qr').getPublicUrl(selectedPaymentMethod.qr_code_path).data.publicUrl}
                  alt={`${selectedBranch?.name || 'the cafe'} ${selectedPaymentMethod.name} QR code`}
                  sx={{ width: 'min(100%, 280px)', maxHeight: 280, objectFit: 'contain' }}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Scan and pay using the QR code, then upload the JPEG receipt below. The order total includes any delivery fee.
                </Typography>
                <Stack spacing={1.5} sx={{ mt: 2, textAlign: 'left' }}>
                  <Button
                    component="label"
                    variant="outlined"
                    fullWidth
                    sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                  >
                    {paymentProofFile?.name || 'Upload payment receipt or screenshot'}
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
                  <Typography variant="caption" color="text.secondary">
                    JPEG (.jpg or .jpeg) only · up to 10 MB
                  </Typography>
                </Stack>
              </Paper>
            )}
            {!!selectedPaymentMethod?.instructions && (
              <Alert severity="info">
                {selectedPaymentMethod.instructions}
              </Alert>
            )}
            <FormControl fullWidth>
              <InputLabel id="checkout-promotion-label">Promotion (optional)</InputLabel>
              <Select
                labelId="checkout-promotion-label"
                label="Promotion (optional)"
                value={promotions.some((promotion) => promotion.id === promotionId) ? promotionId : ''}
                onChange={(event) => setPromotionId(event.target.value)}
              >
                <MenuItem value="">No promotion</MenuItem>
                {promotions.map((promotion) => (
                  <MenuItem key={promotion.id} value={promotion.id}>
                    {promotion.name}
                    {promotion.discount_type === 'percentage'
                      ? ` · ${promotion.discount_value}% off`
                      : ` · ${formatPrice(promotion.discount_value)} off`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {branchId && branchDataLoading && (
              <Alert severity="info">Preparing checkout details…</Alert>
            )}
            <Button
              component={RouterLink}
              to="/menu"
              sx={{ alignSelf: 'flex-start' }}
            >
              Back to menu
            </Button>
          </Stack>
          <Paper
            variant="outlined"
            sx={{
              p: { xs: 2, sm: 2.5 },
              alignSelf: 'start',
              borderRadius: 3,
              bgcolor: '#fbf8f3',
              position: panel ? 'static' : { md: 'sticky' },
              top: 24,
            }}
          >
            <Stack spacing={2}>
              <Box>
                <Typography variant="h6" fontWeight={700}>Order summary</Typography>
                <Typography variant="body2" color="text.secondary">
                  {items.reduce((sum, item) => sum + item.quantity, 0)} items
                </Typography>
              </Box>
              {items.map((item) => {
                const basePrice = item.variantId ? item.variantPrice : item.productPrice
                const addonsTotal = item.addons.reduce((sum, addon) => sum + addon.price, 0)
                const unit = basePrice +
                  addonsTotal
                return (
                  <Stack
                    key={getCartItemKey(item)}
                    spacing={0.75}
                    sx={{ pb: 1.5, borderBottom: 1, borderColor: 'divider' }}
                  >
                    <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                      {item.productName}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        {item.variantName ? `${getVariantLabel(item.categoryType)}: ${item.variantName}` : 'Base item'}
                        {item.servingType && (
                          <span> · {item.categoryType === 'drink' ? 'Cup' : item.servingType}</span>
                        )}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {formatPrice(basePrice)}
                      </Typography>
                    </Stack>
                    {item.addons.length > 0 && (
                      <Stack spacing={0.25}>
                        <Typography variant="caption" color="text.secondary" fontWeight={700}>
                          ADD-ONS
                        </Typography>
                        {item.addons.map((addon) => (
                          <Stack key={addon.id} direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
                            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                              {addon.name}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                              {addon.price ? `${formatPrice(addon.price)} each` : ''}
                            </Typography>
                          </Stack>
                        ))}
                        <Typography variant="caption" color="text.secondary">
                          Add-ons total: {formatPrice(addonsTotal)} each
                        </Typography>
                      </Stack>
                    )}
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', pt: 0.25 }}>
                      <Typography variant="body2" color="text.secondary">
                        {item.quantity} × {formatPrice(unit)}
                      </Typography>
                      <Typography fontWeight={600}>{formatPrice(unit * item.quantity)}</Typography>
                    </Stack>
                  </Stack>
                )
              })}
              <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
                <Typography>Estimated subtotal</Typography>
                <Typography>{formatPrice(subtotal)}</Typography>
              </Stack>
              {fulfillment === 'delivery' && (
                <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
                  <Typography>Delivery fee</Typography>
                  <Typography>{deliveryFee > 0 ? formatPrice(deliveryFee) : 'Free'}</Typography>
                </Stack>
              )}
              {estimatedDiscount > 0 && (
                <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
                  <Typography>Estimated promotion</Typography>
                  <Typography>-{formatPrice(estimatedDiscount)}</Typography>
                </Stack>
              )}
              <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
                <Typography variant="subtitle1" fontWeight={700}>
                  Estimated total
                </Typography>
                <Typography variant="h6" fontWeight={700}>
                  {formatPrice(estimatedTotal)}
                </Typography>
              </Stack>
              <Alert severity="info">
                The server rechecks menu availability, prices, discounts and total.
                Online QR payments are verified by staff before the order is marked paid.
              </Alert>
              <Button
                type="submit"
                variant="contained"
                size="large"
                fullWidth
                disabled={
                  isSubmitting ||
                  branchDataLoading ||
                  !branchId ||
                  !selectedPaymentMethod ||
                  (selectedPaymentMethod?.settlement_type === 'provider' && !selectedPaymentMethod.qr_code_path)
                }
                startIcon={isSubmitting ? <CircularProgress size={18} color="inherit" /> : null}
              >
                {isSubmitting
                  ? 'Submitting order…'
                  : 'Place order'}
              </Button>
            </Stack>
          </Paper>
        </Box>
      </Stack>
    </Container>
  )
}
