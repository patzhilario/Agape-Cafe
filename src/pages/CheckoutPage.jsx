import { useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Container,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
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
import { getBenefitPolicy } from '../features/discounts/benefitData.js'
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
  const [fulfillment, setFulfillment] = useState('pickup')
  const [paymentMethodId, setPaymentMethodId] = useState('')
  const [paymentProofFile, setPaymentProofFile] = useState(null)
  const [paymentReference, setPaymentReference] = useState('')
  const [promotionId, setPromotionId] = useState('')
  const [benefitPolicy, setBenefitPolicy] = useState(null)
  const [requestBenefit, setRequestBenefit] = useState(false)
  const [benefitType, setBenefitType] = useState('senior_citizen')
  const [benefitQuantities, setBenefitQuantities] = useState({})
  const [benefitDocument, setBenefitDocument] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [loadError, setLoadError] = useState('')
  const [dataKey, setDataKey] = useState('')
  const [optionsReloadKey, setOptionsReloadKey] = useState(0)
  const [checkoutDataReloadKey, setCheckoutDataReloadKey] = useState(0)
  const requestRef = useRef({ fingerprint: '', id: '', benefitId: '' })

  const productIds = useMemo(
    () => [...new Set(items.map((item) => item.productId))],
    [items],
  )
  const activePromotion = promotions.find((promotion) => promotion.id === promotionId)
  const estimatedDiscount = calculatePromotionEstimate(activePromotion, items, subtotal)
  const selectedBenefitItems = items
    .map((item) => ({
      ...item,
      eligibleQuantity: Number(benefitQuantities[getCartItemKey(item)] || 0),
    }))
    .filter((item) => item.eligibleQuantity > 0)
  const estimatedBenefitDiscount = requestBenefit && benefitPolicy
    ? selectedBenefitItems.reduce((total, item) => {
      const unitPrice = (item.variantId ? item.variantPrice : item.productPrice) +
        item.addons.reduce((sum, addon) => sum + addon.price, 0)
      const eligibleGross = Math.round((unitPrice * item.eligibleQuantity + Number.EPSILON) * 100) / 100
      const discountPercent = Number(benefitPolicy.discount_percent)
      const eligibleNet = Math.round(
        (eligibleGross / (1 + Number(benefitPolicy.vat_rate) / 100) + Number.EPSILON) * 100,
      ) / 100
      const lineDiscount = benefitPolicy.vat_registration === 'vat_registered'
        ? eligibleGross - Math.round(
          (eligibleNet * (1 - discountPercent / 100) + Number.EPSILON) * 100,
        ) / 100
        : Math.round((eligibleGross * discountPercent / 100 + Number.EPSILON) * 100) / 100
      return total + lineDiscount
    }, 0)
    : 0

  useEffect(() => {
    let active = true
    Promise.all([getPublicBranches(), getBenefitPolicy()])
      .then(([loadedBranches, loadedBenefitPolicy]) => {
        if (!active) return
        setBranches(loadedBranches)
        setBenefitPolicy(loadedBenefitPolicy)
        setBenefitType(loadedBenefitPolicy.pwd_enabled ? 'pwd' : 'senior_citizen')
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
  }, [optionsReloadKey])

  useEffect(() => {
    let active = true
    if (!branchId) return () => { active = false }
    getAvailablePaymentMethods(branchId)
      .then((methods) => {
        if (!active) return
        setPaymentMethods(methods)
        setPaymentMethodsBranchId(branchId)
        const availableMethods = fulfillment === 'delivery'
          ? methods.filter((method) => method.settlement_type === 'provider' && method.qr_code_path)
          : methods
        setPaymentMethodId((current) =>
          availableMethods.some((method) => method.id === current)
            ? current
            : availableMethods.find((method) => method.settlement_type === 'pay_at_branch')?.id ||
              availableMethods[0]?.id ||
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
  const canPayOnline = onlinePaymentMethods.length > 0
  const availablePaymentMethods = fulfillment === 'delivery'
    ? onlinePaymentMethods
    : branchPaymentMethods
  const selectedPaymentMethod = availablePaymentMethods.find((method) => method.id === paymentMethodId)
  const expectedDataKey = `${branchId}:${productIds.slice().sort().join(',')}`
  const branchDataLoading = Boolean(branchId && productIds.length && dataKey !== expectedDataKey)

  useEffect(() => {
    if (fulfillment === 'delivery' && selectedBranch && !selectedBranch.delivery_enabled) {
      setFulfillment('pickup')
    }
  }, [fulfillment, selectedBranch])

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
      setErrorMessage('Choose a branch before placing your order.')
      return
    }
    if (!paymentMethodId) {
      setErrorMessage('No payment method is currently configured.')
      return
    }
    if (requestBenefit && promotionId) {
      setErrorMessage('PWD/Senior Citizen benefits cannot be combined with a promotion. Remove the promotion to continue.')
      return
    }
    if (requestBenefit && !selectedBenefitItems.length) {
      setErrorMessage('Select at least one item for the eligible person.')
      return
    }
    if (selectedBenefitItems.some((item) =>
      !Number.isInteger(item.eligibleQuantity) || item.eligibleQuantity > item.quantity,
    )) {
      setErrorMessage('Eligible quantities must be whole numbers and cannot exceed the cart quantity.')
      return
    }
    if (requestBenefit && !benefitDocument) {
      setErrorMessage('Upload a clear PWD or Senior Citizen ID image or PDF.')
      return
    }
    const allowedIdTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (requestBenefit && benefitDocument) {
      if (benefitDocument.size > 10 * 1024 * 1024) {
        setErrorMessage('The ID file must be 10 MB or smaller.')
        return
      }
      if (!allowedIdTypes.includes(benefitDocument.type)) {
        setErrorMessage('Use a JPG, PNG, WebP, or PDF ID file.')
        return
      }
    }
    const selectedPaymentMethod = availablePaymentMethods.find((method) => method.id === paymentMethodId)
    if (!selectedPaymentMethod) {
      setErrorMessage(
        fulfillment === 'delivery'
          ? 'Delivery requires an enabled online QR payment method at the selected branch.'
          : 'Choose an available payment method.',
      )
      return
    }
    if (fulfillment === 'delivery' && selectedPaymentMethod.settlement_type !== 'provider') {
      setErrorMessage('Delivery orders require an online QR payment method.')
      return
    }
    if (selectedPaymentMethod.settlement_type === 'provider' && !selectedPaymentMethod.qr_code_path) {
      setErrorMessage(`${selectedPaymentMethod.name} QR is not set up for this branch.`)
      return
    }
    if (selectedPaymentMethod.settlement_type === 'provider') {
      if (!paymentReference.trim() || paymentReference.trim().length < 4 || paymentReference.trim().length > 50) {
        setErrorMessage('Enter a payment reference number between 4 and 50 characters.')
        return
      }
      if (!paymentProofFile) {
        setErrorMessage('Upload your payment receipt or screenshot.')
        return
      }
      if (paymentProofFile.size > 10 * 1024 * 1024) {
        setErrorMessage('The payment receipt must be 10 MB or smaller.')
        return
      }
      if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(paymentProofFile.type)) {
        setErrorMessage('Use a JPG, PNG, WebP, or PDF payment receipt.')
        return
      }
    }
    if (requestBenefit && benefitPolicy?.vat_registration === 'not_configured') {
      setErrorMessage('Discount requests are unavailable until the shop VAT policy is configured.')
      return
    }
    if (fulfillment === 'delivery') {
      if (!selectedBranch?.delivery_enabled) {
        setErrorMessage('Delivery is not available from the selected branch.')
        return
      }
      if (deliveryAddress.trim().length < 8 || deliveryAddress.trim().length > 500) {
        setErrorMessage('Enter a delivery address between 8 and 500 characters.')
        return
      }
    }
    if (branchDataLoading) {
      setErrorMessage('Wait for the selected branch availability check to finish.')
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
      phone: phone.trim(),
      note: note.trim(),
      promotionId,
      benefitType: requestBenefit ? benefitType : '',
      eligibleItems: selectedBenefitItems.map((item) => [getCartItemKey(item), item.eligibleQuantity]),
      benefitFile: benefitDocument ? `${benefitDocument.name}:${benefitDocument.size}:${benefitDocument.lastModified}` : '',
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
        benefitId: requestBenefit ? crypto.randomUUID() : '',
      }
    }

    setIsSubmitting(true)
    let uploadedDocument = false
    const fileExtension = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
    }[benefitDocument?.type]
    const benefitDocumentPath = requestBenefit
      ? `${account.id}/${requestRef.current.benefitId}/proof.${fileExtension}`
      : null
    const paymentProofExtension = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
    }[paymentProofFile?.type]
    let createdOrderId = ''
    let paymentProofPath = ''
    let paymentProofSubmitted = false
    try {
      if (requestBenefit) {
        const { error } = await getSupabaseClient()
          .storage
          .from('benefit-documents')
          .upload(benefitDocumentPath, benefitDocument, {
            contentType: benefitDocument.type,
            upsert: false,
          })
        if (error) throw new Error(`Could not upload the private ID document: ${error.message}`)
        uploadedDocument = true
      }
      const orderId = await createCustomerOrder({
        branchId,
        fulfillment,
        deliveryAddress: fulfillment === 'delivery' ? deliveryAddress.trim() : '',
        paymentMethodId,
        requestId: requestRef.current.id,
        phone: phone.trim(),
        note: note.trim(),
        promotionId,
        items,
        benefitRequest: requestBenefit ? {
          requestId: requestRef.current.benefitId,
          benefitType,
          items: selectedBenefitItems.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            addonIds: item.addons.map((addon) => addon.id),
            quantity: item.eligibleQuantity,
          })),
          documentPath: benefitDocumentPath,
        } : null,
      })
      createdOrderId = orderId
      if (selectedPaymentMethod?.settlement_type === 'provider') {
        paymentProofPath = `${account.id}/${orderId}/proof-${crypto.randomUUID()}.${paymentProofExtension}`
        const { error: uploadError } = await getSupabaseClient()
          .storage
          .from('order-payment-proofs')
          .upload(paymentProofPath, paymentProofFile, {
            contentType: paymentProofFile.type,
            upsert: false,
          })
          if (uploadError) throw new Error(`Order was created, but the payment receipt could not be uploaded: ${uploadError.message}`)
          await submitOrderPaymentProof(orderId, paymentProofPath, paymentReference.trim())
        paymentProofSubmitted = true
      }
      clearCart()
      requestRef.current = { fingerprint: '', id: '', benefitId: '' }
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
        requestRef.current = { fingerprint: '', id: '', benefitId: '' }
        navigate(`/customer/orders/${createdOrderId}?placed=1&proof=needed`, {
          replace: true,
          state: { paymentProofError: error.message },
        })
      } else {
        if (uploadedDocument) {
          const { error: cleanupError } = await getSupabaseClient()
            .storage
            .from('benefit-documents')
            .remove([benefitDocumentPath])
          if (cleanupError) console.error('Unable to remove the unlinked ID document.', cleanupError)
        }
        setErrorMessage(error.message)
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
        py: panel ? 1 : { xs: 5, md: 8 },
        px: panel ? 0 : undefined,
        width: panel ? '100%' : undefined,
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="primary">
            Agapé Café · Secure checkout
          </Typography>
          <Typography variant={panel ? 'h3' : 'h1'}>Place your order</Typography>
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
            gap: 3,
            minWidth: 0,
          }}
        >
          <Stack spacing={2.5}>
            <FormControl fullWidth required>
              <InputLabel id="checkout-branch-label">Branch</InputLabel>
              <Select
                labelId="checkout-branch-label"
                label="Branch"
                value={branches.some((branch) => branch.id === branchId) ? branchId : ''}
                onChange={(event) => {
                  setBranchId(event.target.value)
                  setPaymentMethodId('')
                  setDataKey('')
                  setLoadError('')
                }}
              >
                {branches.map((branch) => (
                  <MenuItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {benefitPolicy?.is_active && (benefitPolicy.pwd_enabled || benefitPolicy.senior_citizen_enabled) && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={requestBenefit}
                        disabled={benefitPolicy.vat_registration === 'not_configured'}
                        onChange={(event) => {
                          setRequestBenefit(event.target.checked)
                          if (event.target.checked) setPromotionId('')
                          if (!event.target.checked) {
                            setBenefitDocument(null)
                            setBenefitQuantities({})
                          }
                        }}
                      />
                    }
                    label="PWD or Senior Citizen discount"
                  />
                  {requestBenefit && (
                    <>
                      <Alert severity="info">
                        Upload the beneficiary’s ID and select only quantities for their exclusive use. The discount below is an estimate; staff must verify the ID before applying it. If paying online, wait for approval before paying.
                      </Alert>
                      <FormControl fullWidth>
                        <InputLabel id="checkout-benefit-type">Benefit type</InputLabel>
                        <Select
                          labelId="checkout-benefit-type"
                          label="Benefit type"
                          value={benefitType}
                          onChange={(event) => setBenefitType(event.target.value)}
                        >
                          {benefitPolicy.pwd_enabled && <MenuItem value="pwd">PWD</MenuItem>}
                          {benefitPolicy.senior_citizen_enabled && <MenuItem value="senior_citizen">Senior Citizen</MenuItem>}
                        </Select>
                      </FormControl>
                      <Stack spacing={1}>
                        {items.map((item) => {
                          const key = getCartItemKey(item)
                          const eligibleQuantity = Number(benefitQuantities[key] || 0)
                          return (
                            <Stack key={key} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
                              <FormControlLabel
                                control={
                                  <Checkbox
                                    checked={eligibleQuantity > 0}
                                    onChange={(event) => setBenefitQuantities((current) => {
                                      if (!event.target.checked) {
                                        const next = { ...current }
                                        delete next[key]
                                        return next
                                      }
                                      return { ...current, [key]: item.quantity }
                                    })}
                                  />
                                }
                                label={`${item.productName}${item.variantName ? ` · ${item.variantName}` : ''}`}
                              />
                              {eligibleQuantity > 0 && (
                                <TextField
                                  label={`Eligible quantity (max ${item.quantity})`}
                                  type="number"
                                  value={eligibleQuantity}
                                  onChange={(event) => setBenefitQuantities((current) => ({
                                    ...current,
                                    [key]: event.target.value,
                                  }))}
                                  slotProps={{ htmlInput: { min: 1, max: item.quantity, step: 1 } }}
                                  required
                                />
                              )}
                            </Stack>
                          )
                        })}
                      </Stack>
                      <Button
                        component="label"
                        variant="outlined"
                        fullWidth
                        sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                      >
                        {benefitDocument?.name || 'Upload PWD/Senior Citizen ID'}
                        <input
                          hidden
                          type="file"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          onChange={(event) => {
                            setBenefitDocument(event.target.files?.[0] || null)
                            event.target.value = ''
                          }}
                        />
                      </Button>
                      <Stack spacing={0.5}>
                        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                          <Typography>Estimated discount ({benefitPolicy.discount_percent}%)</Typography>
                          <Typography>-{formatPrice(estimatedBenefitDiscount)}</Typography>
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          The final discount is calculated by the system after ID verification.
                        </Typography>
                      </Stack>
                    </>
                  )}
                  {benefitPolicy.vat_registration === 'not_configured' && (
                    <Alert severity="warning">
                      Discount requests are temporarily unavailable while the café configures its tax policy.
                    </Alert>
                  )}
                </Stack>
              </Paper>
            )}
            {selectedBranch && (
              <Typography variant="body2" color="text.secondary">
                {selectedBranch.address}
              </Typography>
            )}
            <FormControl>
              <Typography variant="subtitle1" fontWeight={700}>How would you like your order?</Typography>
              <RadioGroup
                value={fulfillment}
                onChange={(event) => {
                  const nextFulfillment = event.target.value
                  const nextMethods = nextFulfillment === 'delivery'
                    ? onlinePaymentMethods
                    : branchPaymentMethods
                  setFulfillment(nextFulfillment)
                  if (!nextMethods.some((method) => method.id === paymentMethodId)) {
                    setPaymentMethodId(nextMethods[0]?.id || '')
                  }
                  setErrorMessage('')
                }}
              >
                <FormControlLabel value="pickup" control={<Radio />} label="Pick-up" />
                <FormControlLabel
                  value="delivery"
                  control={<Radio />}
                  disabled={!selectedBranch?.delivery_enabled || !canPayOnline}
                  label={`Delivery · ${selectedBranch?.delivery_enabled
                    ? Number(selectedBranch.delivery_fee) ? formatPrice(selectedBranch.delivery_fee) : 'No café delivery charge'
                    : 'Unavailable at this branch'}`}
                />
              </RadioGroup>
            </FormControl>
            {selectedBranch?.delivery_enabled && !canPayOnline && (
              <Alert severity="warning">
                Delivery requires at least one online QR payment method configured for this branch.
              </Alert>
            )}
            {fulfillment === 'delivery' && (
              <>
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
                <Alert severity="info">
                  The delivery rider or booking fee is paid by the customer directly to the rider/service. It is separate from the café’s order total.
                </Alert>
              </>
            )}
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
              helperText="The selected branch may contact you about your order."
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
              <Typography variant="subtitle1" fontWeight={700}>Payment method</Typography>
              {fulfillment === 'pickup' && (
                <>
                  {availablePaymentMethods.some((method) => method.settlement_type === 'pay_at_branch') && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Pay at branch
                    </Typography>
                  )}
                  <RadioGroup
                    value={selectedPaymentMethod?.settlement_type === 'pay_at_branch' ? paymentMethodId : ''}
                    onChange={(event) => {
                      setPaymentMethodId(event.target.value)
                      setErrorMessage('')
                    }}
                  >
                    {availablePaymentMethods
                      .filter((method) => method.settlement_type === 'pay_at_branch')
                      .map((method) => (
                        <FormControlLabel
                          key={method.id}
                          value={method.id}
                          control={<Radio />}
                          label={method.name}
                        />
                      ))}
                  </RadioGroup>
                </>
              )}
              {onlinePaymentMethods.length > 0 && (
                <FormControl fullWidth required size="small" sx={{ mt: 1.5 }}>
                  <InputLabel id="checkout-online-payment-label" shrink>
                    Online payment
                  </InputLabel>
                  <Select
                    labelId="checkout-online-payment-label"
                    label="Online payment"
                    value={selectedPaymentMethod?.settlement_type === 'provider' ? paymentMethodId : ''}
                    displayEmpty
                    onChange={(event) => {
                      setPaymentMethodId(event.target.value)
                      setErrorMessage('')
                    }}
                  >
                    {fulfillment === 'pickup' && <MenuItem value="">Select an online payment method</MenuItem>}
                    {onlinePaymentMethods.map((method) => (
                      <MenuItem key={method.id} value={method.id}>
                        {method.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              {!availablePaymentMethods.length && fulfillment === 'pickup' && (
                <Typography variant="body2" color="error">
                  No payment methods are currently enabled for this branch.
                </Typography>
              )}
              {!availablePaymentMethods.length && fulfillment === 'delivery' && (
                <Typography variant="body2" color="error">
                  Delivery is unavailable until an online QR payment method is configured for this branch.
                </Typography>
              )}
            </Box>
            {selectedPaymentMethod?.settlement_type === 'provider' && selectedPaymentMethod.qr_code_path && (
              <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                  Scan {selectedBranch.name}’s {selectedPaymentMethod.name} QR
                </Typography>
                <Box
                  component="img"
                  src={getSupabaseClient().storage.from('branch-payment-qr').getPublicUrl(selectedPaymentMethod.qr_code_path).data.publicUrl}
                  alt={`${selectedBranch.name} ${selectedPaymentMethod.name} QR code`}
                  sx={{ width: 'min(100%, 280px)', maxHeight: 280, objectFit: 'contain' }}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Scan and pay using the QR code, then provide the payment reference and upload the receipt below.
                  {requestBenefit && ' Your PWD/Senior discount will be verified by the branch.'}
                </Typography>
                <Stack spacing={1.5} sx={{ mt: 2, textAlign: 'left' }}>
                  <TextField
                    label={`${selectedPaymentMethod.name} reference number`}
                    value={paymentReference}
                    onChange={(event) => setPaymentReference(event.target.value)}
                    required
                    slotProps={{ htmlInput: { maxLength: 50 } }}
                  />
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
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={(event) => {
                        setPaymentProofFile(event.target.files?.[0] || null)
                        event.target.value = ''
                      }}
                    />
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                    JPG, PNG, WebP, or PDF · up to 10 MB
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
                disabled={requestBenefit}
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
          <Paper variant="outlined" sx={{ p: 2.5, alignSelf: 'start' }}>
            <Stack spacing={2}>
              <Typography variant="h6">Order summary</Typography>
              {items.map((item) => {
                const basePrice = item.variantId ? item.variantPrice : item.productPrice
                const addonsTotal = item.addons.reduce((sum, addon) => sum + addon.price, 0)
                const unit = basePrice +
                  addonsTotal
                return (
                  <Stack key={getCartItemKey(item)} spacing={0.75}>
                    <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                      {item.productName}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        {item.variantName ? `Size: ${item.variantName}` : 'Base item'}
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
                              {addon.price ? `${formatPrice(addon.price)} each` : 'Included'}
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
                <>
                  <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
                    <Typography>Café delivery charge</Typography>
                    <Typography>{formatPrice(selectedBranch?.delivery_fee || 0)}</Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    Rider/booking fees are paid separately by the customer and are not included above.
                  </Typography>
                </>
              )}
              {requestBenefit && estimatedBenefitDiscount > 0 && (
                <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
                  <Typography>Estimated benefit discount</Typography>
                  <Typography>-{formatPrice(estimatedBenefitDiscount)}</Typography>
                </Stack>
              )}
              {!requestBenefit && estimatedDiscount > 0 && (
                <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
                  <Typography>Estimated promotion</Typography>
                  <Typography>-{formatPrice(estimatedDiscount)}</Typography>
                </Stack>
              )}
              <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
                <Typography variant="h6">{requestBenefit ? 'Estimated total after approval' : 'Estimated total'}</Typography>
                <Typography variant="h6">
                  {formatPrice(Math.max(
                    0,
                    subtotal -
                      (requestBenefit ? estimatedBenefitDiscount : estimatedDiscount) +
                      (fulfillment === 'delivery' ? Number(selectedBranch?.delivery_fee || 0) : 0),
                  ))}
                </Typography>
              </Stack>
              <Alert severity="info">
                The server rechecks menu availability, prices, discounts and total.
                {requestBenefit
                  ? ' Staff must verify the ID before the discount becomes final and payment can be made.'
                  : ' Online QR payments are verified by staff before the order is marked paid.'}
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
                  : requestBenefit
                    ? 'Place order for discount review'
                    : 'Place order'}
              </Button>
            </Stack>
          </Paper>
        </Box>
      </Stack>
    </Container>
  )
}
