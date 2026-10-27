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
  getAvailableDiningTables,
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
  const [diningTables, setDiningTables] = useState([])
  const [diningTablesBranchId, setDiningTablesBranchId] = useState('')
  const [diningTableId, setDiningTableId] = useState('')
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
  const isOnsiteFulfillment = fulfillment === 'dine_in' || fulfillment === 'takeout'

  useEffect(() => {
    let active = true
    if (fulfillment !== 'dine_in' || !branchId) return () => { active = false }
    getAvailableDiningTables(branchId)
      .then((tables) => {
        if (!active) return
        setDiningTables(tables)
        setDiningTablesBranchId(branchId)
        setDiningTableId((current) => tables.some((table) => table.id === current) ? current : '')
      })
      .catch((error) => {
        console.error('Unable to load available dining tables.', error)
        if (active) setErrorMessage(error.message)
      })
    return () => { active = false }
  }, [branchId, fulfillment])

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
        const onlineOnly = fulfillment === 'delivery' || fulfillment === 'pickup'
        const availableMethods = onlineOnly
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
  const availableDiningTables = diningTablesBranchId === branchId ? diningTables : []
  const onlinePaymentMethods = branchPaymentMethods.filter(
    (method) => method.settlement_type === 'provider' && method.qr_code_path,
  )
  const canPayOnline = onlinePaymentMethods.length > 0
  const onlineOnly = fulfillment === 'delivery' || fulfillment === 'pickup'
  const availablePaymentMethods = onlineOnly
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
    const drinkCount = selectedBenefitItems
      .filter((item) => (item.categoryType || 'other') === 'drink')
      .reduce((sum, item) => sum + item.eligibleQuantity, 0)
    const foodCount = selectedBenefitItems
      .filter((item) => (item.categoryType || 'other') === 'food')
      .reduce((sum, item) => sum + item.eligibleQuantity, 0)
    const otherItems = selectedBenefitItems
      .filter((item) => !['drink', 'food'].includes(item.categoryType))

    if (drinkCount > 1 || foodCount > 1 || otherItems.length > 0) {
      if (drinkCount > 1 && foodCount > 1) {
        setErrorMessage('PWD/Senior Citizen discount is valid for a maximum of 1 drink and 1 food only.')
      } else if (drinkCount > 1) {
        setErrorMessage('PWD/Senior Citizen discount is valid for a maximum of 1 drink only.')
      } else if (foodCount > 1) {
        setErrorMessage('PWD/Senior Citizen discount is valid for a maximum of 1 food only.')
      } else if (otherItems.length > 0) {
        setErrorMessage('PWD/Senior Citizen discount only applies to drink and food items.')
      }
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
        onlineOnly
          ? `${fulfillment === 'delivery' ? 'Delivery' : 'Pick-up'} requires an enabled online QR payment method at the selected branch.`
          : 'Choose an available payment method.',
      )
      return
    }
    if (onlineOnly && selectedPaymentMethod.settlement_type !== 'provider') {
      setErrorMessage('Pick-up and delivery orders require an online QR payment method.')
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
    if (fulfillment === 'dine_in' && !diningTableId) {
      setErrorMessage('Choose the table where you are seated.')
      return
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
      diningTableId: fulfillment === 'dine_in' ? diningTableId : '',
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
        diningTableId: fulfillment === 'dine_in' ? diningTableId : null,
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
        if (fulfillment === 'dine_in') {
          getAvailableDiningTables(branchId)
            .then((tables) => {
              setDiningTables(tables)
              setDiningTablesBranchId(branchId)
              setDiningTableId((current) => tables.some((table) => table.id === current) ? current : '')
            })
            .catch((refreshError) => {
              console.error('Unable to refresh available dining tables after checkout failure.', refreshError)
            })
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
            Choose your branch and order details to continue.
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
            <Typography variant="subtitle1" fontWeight={700}>
              1. Choose a branch
            </Typography>
            <FormControl fullWidth required>
              <InputLabel id="checkout-branch-label">Branch</InputLabel>
              <Select
                labelId="checkout-branch-label"
                label="Branch"
                value={branches.some((branch) => branch.id === branchId) ? branchId : ''}
                onChange={(event) => {
                  setBranchId(event.target.value)
                  setPaymentMethodId('')
                  setDiningTableId('')
                  setDiningTablesBranchId('')
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
            {isOnsiteFulfillment && benefitPolicy?.is_active && (benefitPolicy.pwd_enabled || benefitPolicy.senior_citizen_enabled) && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1.5}>
                  <Typography variant="body2" color="text.secondary">
                    Available only for Dine-in or Take-out orders placed at the café. Staff will verify the ID before applying the discount.
                  </Typography>
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
                      {(() => {
                        const selectedDrinks = items
                          .filter((i) => (i.categoryType || 'other') === 'drink' && Number(benefitQuantities[getCartItemKey(i)] || 0) > 0)
                        const selectedFoods = items
                          .filter((i) => (i.categoryType || 'other') === 'food' && Number(benefitQuantities[getCartItemKey(i)] || 0) > 0)
                        const hasDrink = selectedDrinks.length > 0
                        const hasFood = selectedFoods.length > 0

                        return (
                          <>
                            <Alert severity="info" sx={{ fontSize: '0.85rem' }}>
                              Eligible items: You can apply the discount to <strong>up to 1 Drink and/or 1 Food</strong> for the cardholder.
                            </Alert>
                            <Stack spacing={1}>
                              {items.map((item) => {
                                const key = getCartItemKey(item)
                                const eligibleQuantity = Number(benefitQuantities[key] || 0)
                                const isDrink = (item.categoryType || 'other') === 'drink'
                                const isFood = (item.categoryType || 'other') === 'food'
                                const isOther = !isDrink && !isFood
                                const isChecked = eligibleQuantity > 0
                                // Disabled if it's "other", or if another drink is already selected, or another food is already selected
                                const isDisabled = isOther || (!isChecked && ((isDrink && hasDrink) || (isFood && hasFood)))

                                let helperText = ''
                                if (isOther) helperText = '(Not eligible: retail/other)'
                                else if (!isChecked && isDrink && hasDrink) helperText = '(1 drink already selected)'
                                else if (!isChecked && isFood && hasFood) helperText = '(1 food already selected)'

                                return (
                                  <Stack key={key} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
                                    <FormControlLabel
                                      control={
                                        <Checkbox
                                          checked={isChecked}
                                          disabled={isDisabled}
                                          onChange={(event) => setBenefitQuantities((current) => {
                                            if (!event.target.checked) {
                                              const next = { ...current }
                                              delete next[key]
                                              return next
                                            }
                                            return { ...current, [key]: 1 }
                                          })}
                                        />
                                      }
                                      label={
                                        <span>
                                          {item.productName}{item.variantName ? ` · ${item.variantName}` : ''}{' '}
                                          <span style={{ fontSize: '0.8em', opacity: 0.75, textTransform: 'uppercase' }}>
                                            [{isDrink ? 'Drink' : isFood ? 'Food' : 'Other'}]
                                          </span>
                                          {helperText && (
                                            <span style={{ fontSize: '0.78em', color: '#d32f2f', marginLeft: 6 }}>
                                              {helperText}
                                            </span>
                                          )}
                                        </span>
                                      }
                                    />
                                    {isChecked && (
                                      <TextField
                                        size="small"
                                        label="Discount qty (max 1)"
                                        type="number"
                                        value={eligibleQuantity}
                                        onChange={(event) => {
                                          const val = Math.min(1, Math.max(1, parseInt(event.target.value, 10) || 1))
                                          setBenefitQuantities((current) => ({
                                            ...current,
                                            [key]: val,
                                          }))
                                        }}
                                        slotProps={{ htmlInput: { min: 1, max: 1, step: 1 } }}
                                        sx={{ width: 140 }}
                                        required
                                      />
                                    )}
                                  </Stack>
                                )
                              })}
                            </Stack>
                          </>
                        )
                      })()}
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
            {!isOnsiteFulfillment && benefitPolicy?.is_active && (benefitPolicy.pwd_enabled || benefitPolicy.senior_citizen_enabled) && (
              <Alert severity="info">
                PWD/Senior Citizen discounts are available only for Dine-in or Take-out orders placed at the café.
              </Alert>
            )}
            {selectedBranch && (
              <Typography variant="body2" color="text.secondary">
                {selectedBranch.address}
              </Typography>
            )}
            <FormControl>
              <Typography variant="subtitle1" fontWeight={700}>
                2. How would you like your order?
              </Typography>
              <RadioGroup
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                  gap: 0.75,
                  mt: 1,
                  '& .MuiFormControlLabel-root': {
                    m: 0,
                    minWidth: 0,
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 2,
                    px: 1,
                    py: 0.5,
                  },
                }}
                value={fulfillment}
                onChange={(event) => {
                  const nextFulfillment = event.target.value
                  const nextMethods = nextFulfillment === 'delivery' || nextFulfillment === 'pickup'
                    ? onlinePaymentMethods
                    : branchPaymentMethods
                  setFulfillment(nextFulfillment)
                  setDiningTableId('')
                  if (nextFulfillment !== 'dine_in' && nextFulfillment !== 'takeout') {
                    setRequestBenefit(false)
                    setBenefitDocument(null)
                    setBenefitQuantities({})
                  }
                  if (!nextMethods.some((method) => method.id === paymentMethodId)) {
                    setPaymentMethodId(nextMethods[0]?.id || '')
                  }
                  setErrorMessage('')
                }}
              >
                <FormControlLabel value="dine_in" control={<Radio />} label="Dine-in" />
                <FormControlLabel
                  value="pickup"
                  control={<Radio />}
                  disabled={!canPayOnline}
                  label="Pick-up · Online payment"
                />
                <FormControlLabel value="takeout" control={<Radio />} label="Take-out" />
                <FormControlLabel
                  value="delivery"
                  control={<Radio />}
                  disabled={!selectedBranch?.delivery_enabled || !canPayOnline}
                  label={`Delivery · ${selectedBranch?.delivery_enabled
                    ? 'booking fee paid separately'
                    : 'Unavailable at this branch'}`}
                />
              </RadioGroup>
            </FormControl>
            {selectedBranch?.delivery_enabled && !canPayOnline && (
              <Alert severity="warning">
                Delivery requires at least one online QR payment method configured for this branch.
              </Alert>
            )}
            {fulfillment === 'dine_in' && (
              <FormControl fullWidth required>
                <InputLabel id="checkout-dining-table-label">Your table</InputLabel>
                <Select
                  labelId="checkout-dining-table-label"
                  label="Your table"
                  value={diningTableId}
                  onChange={(event) => setDiningTableId(event.target.value)}
                  disabled={!branchId || diningTablesBranchId !== branchId}
                >
                  <MenuItem value="" disabled>
                    {availableDiningTables.length
                      ? 'Choose the table where you are seated'
                      : 'No available tables. Ask staff or refresh the table list.'}
                  </MenuItem>
                  {availableDiningTables.map((table) => (
                    <MenuItem key={table.id} value={table.id}>{table.label}</MenuItem>
                  ))}
                </Select>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                  Choose the table where you are seated. It will be held for this order until staff closes or voids it.
                </Typography>
                <Button
                  type="button"
                  size="small"
                  sx={{ alignSelf: 'flex-start', mt: 0.5 }}
                  disabled={!branchId}
                  onClick={() => {
                    setDiningTablesBranchId('')
                    setDiningTableId('')
                    getAvailableDiningTables(branchId)
                      .then((tables) => {
                        setDiningTables(tables)
                        setDiningTablesBranchId(branchId)
                        setDiningTableId((current) => tables.some((table) => table.id === current) ? current : '')
                      })
                      .catch((error) => {
                        console.error('Unable to refresh available dining tables.', error)
                        setErrorMessage(error.message)
                      })
                  }}
                >
                  Refresh available tables
                </Button>
              </FormControl>
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
              3. Contact and payment
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
              <Typography variant="subtitle2" fontWeight={700}>Payment method</Typography>
              {isOnsiteFulfillment && (
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
                    <MenuItem value="">Select an online payment method</MenuItem>
                    {onlinePaymentMethods.map((method) => (
                      <MenuItem key={method.id} value={method.id}>
                        {method.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              {!availablePaymentMethods.length && fulfillment !== 'delivery' && (
                <Typography variant="body2" color="error">
                  {fulfillment === 'pickup'
                    ? 'No online payment methods are currently enabled for this branch.'
                    : 'No payment methods are currently enabled for this branch.'}
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
                        {item.variantName ? `Size: ${item.variantName}` : 'Base item'}
                        {item.servingType && (
                          <span> · {item.servingType === 'cup' ? 'Takeout Cup' : 'Glass / Mug'}</span>
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
                  <Typography variant="caption" color="text.secondary">
                    Pay the rider/booking fee separately through the delivery booking service; it is not part of your café order total.
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
                <Typography variant="subtitle1" fontWeight={700}>
                  {requestBenefit ? 'Estimated total after approval' : 'Estimated total'}
                </Typography>
                <Typography variant="h6" fontWeight={700}>
                  {formatPrice(Math.max(
                    0,
                    subtotal -
                      (requestBenefit ? estimatedBenefitDiscount : estimatedDiscount),
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
