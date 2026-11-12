import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Checkbox, Chip, CircularProgress, Collapse, Container, Divider, FormControlLabel, MenuItem, Pagination, Paper, Stack, TextField, Typography } from '@mui/material'
import { useAuth } from '../auth/useAuth.js'
import { getPublicBranches, getPublicProducts, formatPrice } from '../public/publicData.js'
import { getEligiblePromotions } from '../orders/orderData.js'
import { getCartItemKey } from '../orders/cartUtils.js'
import { getBenefitPolicy } from '../discounts/benefitData.js'
import { getOrderReceipt } from '../orders/receiptData.js'
import { getSupabaseClient } from '../../lib/supabaseClient.js'
import QuantityStepper from '../../components/public/QuantityStepper.jsx'
import ProductExtras from '../../components/public/ProductExtras.jsx'
import PrintableReceipt from '../orders/PrintableReceipt.jsx'
import { defaultPOSItem, mergePOSItems, posUnitPrice, estimatePOSDiscount, roundMoney } from './posUtils.js'

const MENU_PAGE_SIZE = 6

export default function StaffPOSPage() {
  const { hasPermission } = useAuth()
  const canCreate = hasPermission('orders', 'create') && hasPermission('orders', 'view')
  const canPay = canCreate && hasPermission('orders', 'edit')
  const canBenefit = hasPermission('promotions', 'approve')
  const [store, setStore] = useState(null)
  const [products, setProducts] = useState([])
  const [methods, setMethods] = useState([])
  const [policy, setPolicy] = useState(null)
  const [promotions, setPromotions] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [menuPage, setMenuPage] = useState(0)
  const [items, setItems] = useState([])
  const [expandedKey, setExpandedKey] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [fulfillment, setFulfillment] = useState('dine_in')
  const [address, setAddress] = useState('')
  const [methodId, setMethodId] = useState('')
  const [cashReceived, setCashReceived] = useState('')
  const [qrVerified, setQrVerified] = useState(false)
  const [discountType, setDiscountType] = useState('none')
  const [promotionId, setPromotionId] = useState('')
  const [beneficiaryName, setBeneficiaryName] = useState('')
  const [beneficiaryId, setBeneficiaryId] = useState('')
  const [idVerified, setIdVerified] = useState(false)
  const [paper, setPaper] = useState('thermal')
  const [printAfterPayment, setPrintAfterPayment] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const [sale, setSale] = useState(null)
  const [receiptError, setReceiptError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const attempt = useRef(null)

  useEffect(() => {
    if (!canCreate) return undefined
    let active = true
    async function load() {
      const [stores, menu, benefitPolicy] = await Promise.all([getPublicBranches({ refresh: true }), getPublicProducts({ refresh: true }), getBenefitPolicy()])
      if (!stores[0]) throw new Error('Store settings are unavailable.')
      const [payments, offers] = await Promise.all([
        getSupabaseClient().from('payment_methods').select('id, code, name, settlement_type, qr_code_path, instructions').eq('branch_id', stores[0].id).eq('is_active', true).or('settlement_type.eq.provider,code.eq.pos_cash').order('name'),
        getEligiblePromotions(menu.map((product) => product.id)),
      ])
      if (payments.error) throw payments.error
      if (!active) return
      setStore(stores[0]); setProducts(menu); setMethods(payments.data || []); setPolicy(benefitPolicy); setPromotions(offers.filter((offer) => offer.max_uses_per_customer == null))
      setMethodId((current) => payments.data.some((method) => method.id === current) ? current : payments.data.find((method) => method.code === 'pos_cash')?.id || payments.data[0]?.id || '')
    }
    load().catch((loadError) => { if (active) setError(loadError.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [canCreate, reloadKey])

  const subtotal = roundMoney(items.reduce((sum, item) => sum + posUnitPrice(item) * item.quantity, 0))
  const fee = fulfillment === 'delivery' ? Number(store?.delivery_fee || 0) : 0
  const promotion = promotions.find((offer) => offer.id === promotionId)
  const discount = estimatePOSDiscount(items, discountType, policy, promotion)
  const total = roundMoney(Math.max(0, subtotal - discount) + fee)
  const selectedMethod = methods.find((method) => method.id === methodId)
  const isCash = selectedMethod?.code === 'pos_cash'
  const benefit = ['pwd', 'senior_citizen'].includes(discountType)
  const locked = saving || uncertain || Boolean(sale)
  const categories = useMemo(() => [...new Set(products.map((product) => product.category?.name).filter(Boolean))], [products])
  const filteredProducts = products.filter((product) => (!category || product.category?.name === category) && `${product.name} ${product.category?.name || ''}`.toLowerCase().includes(search.toLowerCase()))
  const menuPageCount = Math.max(1, Math.ceil(filteredProducts.length / MENU_PAGE_SIZE))
  const currentMenuPage = Math.min(menuPage, menuPageCount - 1)
  const visibleProducts = filteredProducts.slice(currentMenuPage * MENU_PAGE_SIZE, (currentMenuPage + 1) * MENU_PAGE_SIZE)


  function changeItems(next, expanded) {
    if (locked) return
    try { setItems(mergePOSItems(next)); setError(''); if (expanded) setExpandedKey(getCartItemKey(expanded)) }
    catch (changeError) { setError(changeError.message) }
  }
  function updateItem(index, patch) {
    const updated = { ...items[index], ...patch }
    updated.eligibleQuantity = Math.min(updated.quantity, updated.eligibleQuantity)
    changeItems(items.map((item, current) => current === index ? updated : item), expandedKey === getCartItemKey(items[index]) ? updated : null)
  }
  function newSale() {
    if (saving || uncertain) return
    setSale(null); setReceiptError(''); setItems([]); setName(''); setPhone(''); setAddress(''); setFulfillment('dine_in')
    setCashReceived(''); setQrVerified(false); setDiscountType('none'); setPromotionId(''); setBeneficiaryName(''); setBeneficiaryId(''); setIdVerified(false); setError(''); setExpandedKey(''); attempt.current = null
    setReloadKey((value) => value + 1)
  }
  async function loadReceipt(id) {
    setReceiptError('')
    try {
      const order = await getOrderReceipt(id)
      if (!order) throw new Error('The saved receipt is unavailable. Retry loading the receipt.')
      setSale({ id, order })
    } catch (loadError) { setReceiptError(loadError.message) }
  }
  async function completeSale(event) {
    event.preventDefault(); setError('')
    if (!canPay) { setError('Ask the Admin for Orders edit permission to take payment.'); return }
    if (!store?.is_active || !items.length || !selectedMethod) { setError('The store must be open, with items and a payment method selected.'); return }
    if (fulfillment === 'delivery' && (!/^[+()\d\s.-]{7,40}$/.test(phone.trim()) || address.trim().length < 8)) { setError('Enter a delivery address and contact phone.'); return }
    if (isCash && (!/^\d{1,10}(\.\d{1,2})?$/.test(cashReceived) || Number(cashReceived) < total)) { setError('Enter cash received covering the total.'); return }
    if (!isCash && !qrVerified) { setError('Verify the QR payment against the store account first.'); return }
    if (benefit) {
      if (!canBenefit || !idVerified || !beneficiaryName.trim() || beneficiaryId.trim().length < 3) { setError('Verify the customer ID in person and fill in the beneficiary details.'); return }
      if (discount <= 0) { setError('Select an eligible drink or food in the basket.'); return }
      if (['drink', 'food'].some((type) => items.filter((item) => item.categoryType === type).reduce((sum, item) => sum + item.eligibleQuantity, 0) > 1)) { setError('Select at most one drink and one food for the beneficiary.'); return }
    }
    const payload = {
      guest_name: name.trim(), guest_phone: phone.trim(), fulfillment, method_id: methodId,
      cart_items: items.map((item) => ({ product_id: item.productId, variant_id: item.variantId || null, addon_ids: item.addons.map((addon) => addon.id), quantity: item.quantity, serving_type: item.servingType, eligible_quantity: benefit ? item.eligibleQuantity : 0 })),
      quoted_total: total, expected_delivery_fee: fee, cash_tendered: isCash ? Number(cashReceived) : null, qr_verified: !isCash && qrVerified,
      delivery_address: fulfillment === 'delivery' ? address.trim() : null, promotion_id: discountType === 'promotion' ? promotionId || null : null,
      benefit: benefit ? discountType : null, beneficiary_name: benefit ? beneficiaryName.trim() : null, beneficiary_id: benefit ? beneficiaryId.trim() : null, id_verified: benefit && idVerified,
    }
    const fingerprint = JSON.stringify(payload)
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { id: crypto.randomUUID(), fingerprint }
    setSaving(true)
    try {
      const { data: orderId, error: saveError } = await getSupabaseClient().rpc('complete_pos_sale', { ...payload, request_id: attempt.current.id })
      if (saveError) throw saveError
      setSale({ id: orderId, order: null }); setUncertain(false); attempt.current = null
      await loadReceipt(orderId)
    } catch (saveError) {
      if (!saveError.code || !/^(P\d|PGRST|22|23|42)/.test(saveError.code)) {
        setUncertain(true); setError('Payment could not be confirmed. Retry this same sale; the request is protected against duplicate orders and payment records.')
      } else {
        setUncertain(false); attempt.current = null
        setError(saveError.code === 'PGRST202' ? 'Apply the updated POS database migration before taking payment.' : saveError.message)
        if (/total changed|Delivery fee changed/.test(saveError.message)) { setQrVerified(false); setReloadKey((value) => value + 1) }
      }
    } finally { setSaving(false) }
  }

  if (!canCreate) return <Container sx={{ py: 4 }}><Alert severity="info">Ask the Admin for Orders view and create permissions to use POS.</Alert></Container>
  if (loading) return <Container sx={{ py: 6 }}><CircularProgress /></Container>
  return <Container maxWidth="xl" sx={{ py: { xs: 2, md: 3 } }}>
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}><Box sx={{ minWidth: 0 }}><Typography variant="overline" color="primary">Counter workspace</Typography><Typography variant="h2">Point of sale</Typography><Typography color="text.secondary">Tap items. Apply discounts. Take payment and print here.</Typography></Box><Button variant="outlined" onClick={newSale} disabled={saving || uncertain}>New sale</Button></Stack>
      {error && <Alert severity="error" action={!locked && <Button color="inherit" onClick={() => setReloadKey((value) => value + 1)}>Refresh</Button>}>{error}</Alert>}
      {!canPay && <Alert severity="info">Orders edit permission is required to complete payment.</Alert>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1.2fr) minmax(390px,1fr)' }, gap: 2.5, alignItems: 'start' }}>
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <TextField label="Search menu" value={search} onChange={(event) => { setSearch(event.target.value); setMenuPage(0) }} disabled={locked} fullWidth size="small" />
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}><Chip label="All items" disabled={locked} onClick={() => { setCategory(''); setMenuPage(0) }} color={!category ? 'primary' : 'default'} />{categories.map((value) => <Chip key={value} label={value} title={value} disabled={locked} sx={{ maxWidth: '100%' }} onClick={() => { setCategory(value); setMenuPage(0) }} color={category === value ? 'primary' : 'default'} />)}</Stack>
          {!visibleProducts.length && <Alert severity="info">No available items match this search.</Alert>}
          <Box aria-label="POS menu items" sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,minmax(0,1fr))', md: 'repeat(3,minmax(0,1fr))' }, gap: 1.5, minWidth: 0 }}>
            {visibleProducts.map((product) => <Button
              key={product.id} aria-label={`Add ${product.name}`} title={`${product.name} - ${formatPrice(product.variants[0]?.price ?? product.price)}`}
              disabled={locked || !store?.is_active} onClick={() => changeItems([...items, defaultPOSItem(product)])} variant="outlined"
              sx={{ p: { xs: 1.5, sm: 2 }, width: '100%', minWidth: 0, height: 140, overflow: 'hidden', borderRadius: 2.5, textAlign: 'left', display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'space-between', gap: .5, bgcolor: 'background.paper', textTransform: 'none', whiteSpace: 'normal' }}
            >
              <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0, maxWidth: '100%' }}>{product.category?.name || 'Menu'}</Typography>
              <Typography fontWeight={700} sx={{ minWidth: 0, maxWidth: '100%', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere', lineHeight: 1.35, fontSize: { xs: '.875rem', sm: '1rem' } }}>{product.name}</Typography>
              <Typography variant="body2" fontWeight={700} noWrap sx={{ minWidth: 0, maxWidth: '100%' }}>{formatPrice(product.variants[0]?.price ?? product.price)}</Typography>
            </Button>)}
          </Box>
          {filteredProducts.length > 0 && <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">{currentMenuPage * MENU_PAGE_SIZE + 1}-{Math.min((currentMenuPage + 1) * MENU_PAGE_SIZE, filteredProducts.length)} of {filteredProducts.length} items</Typography>
            <Pagination aria-label="POS menu pages" count={menuPageCount} page={currentMenuPage + 1} onChange={(_, page) => setMenuPage(page - 1)} size="small" siblingCount={0} disabled={locked} />
          </Stack>}
        </Stack>
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 3, minWidth: 0, overflowWrap: 'anywhere', '& .MuiFormControl-root': { minWidth: 0, maxWidth: '100%' }, '& .MuiFormControlLabel-label': { minWidth: 0, overflowWrap: 'anywhere' } }}>
          {sale ? <Stack spacing={2}>
            <Alert severity="success">Payment recorded. {sale.order?.order_number || 'Loading saved receipt...'}</Alert>
            <Button variant="contained" onClick={newSale}>Start next sale</Button>
            {receiptError && <Alert severity="error" action={<Button color="inherit" onClick={() => loadReceipt(sale.id)}>Reload receipt</Button>}>{receiptError}</Alert>}
            {sale.order ? <PrintableReceipt key={sale.id} order={sale.order} initialPaper={paper} autoPrint={printAfterPayment} /> : !receiptError && <CircularProgress />}
          </Stack> : <Box component="form" onSubmit={completeSale}><Stack spacing={1.75}>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="h5">Current sale</Typography><Chip size="small" label={`${items.reduce((sum,item) => sum + item.quantity,0)} items`} /></Stack>
            {!items.length && <Typography color="text.secondary">Tap a menu item to add it directly.</Typography>}
            {items.map((item,index) => { const key = getCartItemKey(item); const product = products.find((entry) => entry.id === item.productId); return <Box key={key} sx={{ py: 1, minWidth: 0, borderBottom: 1, borderColor: 'divider' }}>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}><Typography fontWeight={700} sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{item.productName}</Typography><Typography fontWeight={700} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{formatPrice(posUnitPrice(item)*item.quantity)}</Typography></Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>{[item.variantName,...item.addons.map((addon)=>addon.name)].filter(Boolean).join(' / ')} {formatPrice(posUnitPrice(item))} each</Typography>
              <Stack direction="row" useFlexGap sx={{ justifyContent: 'space-between', alignItems: 'center', mt: .75, gap: 1, flexWrap: 'wrap' }}><QuantityStepper value={item.quantity} label={`POS quantity for ${item.productName}`} onChange={(quantity) => updateItem(index,{quantity})} /><Stack direction="row">{(product?.variants.length>0 || product?.addons.length>0) && <Button size="small" disabled={locked} onClick={() => setExpandedKey(expandedKey===key?'':key)}>Options</Button>}<Button size="small" disabled={locked} color="inherit" onClick={() => changeItems(items.filter((_,current)=>current!==index))}>Remove</Button></Stack></Stack>
              <Collapse in={expandedKey===key}><Stack spacing={1.5} sx={{ pt: 1.5 }}>
                {!!product?.variants.length && <TextField select size="small" label="Size / option" value={item.variantId} disabled={locked} onChange={(event) => { const variant=product.variants.find((option)=>option.id===event.target.value); updateItem(index,{variantId:variant.id,variantName:variant.name,variantPrice:variant.price}) }}>{product.variants.map((variant)=><MenuItem key={variant.id} value={variant.id}>{variant.name} - {formatPrice(variant.price)}</MenuItem>)}</TextField>}
                <ProductExtras options={product?.addons || []} selectedIds={item.addons.map((addon)=>addon.id)} onChange={(ids) => { if (!locked) updateItem(index,{addons:product.addons.filter((addon)=>ids.includes(addon.id))}) }} />
              </Stack></Collapse>
              {benefit && ['food','drink'].includes(item.categoryType) && <FormControlLabel control={<Checkbox checked={item.eligibleQuantity>0} disabled={locked} onChange={(event)=>updateItem(index,{eligibleQuantity:event.target.checked?1:0})} />} label="1 unit for beneficiary" />}
            </Box> })}
            <TextField select size="small" label="Order type" value={fulfillment} disabled={locked} onChange={(event)=>setFulfillment(event.target.value)}><MenuItem value="dine_in">Dine-in</MenuItem><MenuItem value="pickup">Pick-up</MenuItem><MenuItem value="delivery">Delivery</MenuItem></TextField>
            <Stack direction={{ xs:'column',sm:'row' }} spacing={1}><TextField fullWidth size="small" label="Customer name (optional)" value={name} disabled={locked} onChange={(event)=>setName(event.target.value)} slotProps={{htmlInput:{maxLength:120}}} /><TextField fullWidth size="small" label={fulfillment==='delivery'?'Contact phone':'Phone (optional)'} value={phone} required={fulfillment==='delivery'} disabled={locked} onChange={(event)=>setPhone(event.target.value)} slotProps={{htmlInput:{maxLength:40}}} /></Stack>
            {fulfillment==='delivery' && <TextField size="small" label="Delivery address" value={address} onChange={(event)=>setAddress(event.target.value)} required disabled={locked} multiline slotProps={{htmlInput:{minLength:8,maxLength:500}}} />}
            <Divider />
            <TextField select size="small" label="Discount" value={discountType} disabled={locked} onChange={(event)=>{setDiscountType(event.target.value);setIdVerified(false)}}><MenuItem value="none">No discount</MenuItem><MenuItem value="promotion">Promotion</MenuItem><MenuItem value="pwd" disabled={!canBenefit || !policy?.is_active || !policy?.pwd_enabled || policy.vat_registration==='not_configured'}>PWD benefit</MenuItem><MenuItem value="senior_citizen" disabled={!canBenefit || !policy?.is_active || !policy?.senior_citizen_enabled || policy.vat_registration==='not_configured'}>Senior Citizen benefit</MenuItem></TextField>
            {!canBenefit && <Typography variant="caption" color="text.secondary">Ask the Admin to enable Approve under POS in Module permissions to apply PWD/Senior benefits.</Typography>}
            {(!policy?.is_active || policy?.vat_registration==='not_configured') && <Typography variant="caption" color="text.secondary">The Admin must configure the store benefit policy before PWD/Senior discounts are available.</Typography>}
            {discountType==='promotion' && <TextField select size="small" label="Promotion" value={promotionId} required disabled={locked} onChange={(event)=>setPromotionId(event.target.value)}>{promotions.map((offer)=><MenuItem key={offer.id} value={offer.id}>{offer.name}</MenuItem>)}</TextField>}
            {benefit && <Stack spacing={1}><Typography variant="caption">Select at most 1 drink and 1 food in the basket for the beneficiary. Store benefit policy determines the discount.</Typography><TextField size="small" label="Beneficiary name" value={beneficiaryName} required disabled={locked} onChange={(event)=>setBeneficiaryName(event.target.value)} slotProps={{htmlInput:{maxLength:120}}} /><TextField size="small" label="ID number" value={beneficiaryId} required disabled={locked} onChange={(event)=>setBeneficiaryId(event.target.value)} slotProps={{htmlInput:{maxLength:80}}} /><FormControlLabel control={<Checkbox checked={idVerified} onChange={(event)=>setIdVerified(event.target.checked)} disabled={locked} />} label="Customer present; I checked the original ID" /></Stack>}
            <Stack spacing={.75}><Stack direction="row" sx={{justifyContent:'space-between'}}><Typography>Subtotal</Typography><Typography>{formatPrice(subtotal)}</Typography></Stack>{discount>0 && <Stack direction="row" sx={{justifyContent:'space-between'}}><Typography>Discount</Typography><Typography>-{formatPrice(discount)}</Typography></Stack>}{fulfillment==='delivery' && <Stack direction="row" sx={{justifyContent:'space-between'}}><Typography>Delivery fee</Typography><Typography>{fee?formatPrice(fee):'Free'}</Typography></Stack>}<Stack direction="row" sx={{justifyContent:'space-between'}}><Typography variant="h5">Total</Typography><Typography variant="h5">{formatPrice(total)}</Typography></Stack></Stack>
            <Divider />
            <TextField select size="small" label="Payment" value={methodId} disabled={locked} onChange={(event)=>{setMethodId(event.target.value);setQrVerified(false)}}>{methods.map((method)=><MenuItem key={method.id} value={method.id}>{method.name}</MenuItem>)}</TextField>
            {isCash ? <Stack spacing={1}><TextField label="Cash received (PHP)" type="number" size="small" value={cashReceived} onChange={(event)=>setCashReceived(event.target.value)} required disabled={locked} slotProps={{htmlInput:{min:total,step:.01,max:9999999999.99}}} /><Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}><Button size="small" disabled={locked} onClick={()=>setCashReceived(total.toFixed(2))}>Exact amount</Button>{[100,500,1000].map((amount)=><Button key={amount} size="small" disabled={locked || amount<total} onClick={()=>setCashReceived(String(amount))}>{formatPrice(amount)}</Button>)}</Stack><Stack direction="row" sx={{justifyContent:'space-between'}}><Typography fontWeight={700}>Change</Typography><Typography fontWeight={700}>{formatPrice(Math.max(0,Number(cashReceived||0)-total))}</Typography></Stack></Stack> : selectedMethod && <Stack spacing={1}>{selectedMethod.qr_code_path && <Box component="img" src={getSupabaseClient().storage.from('branch-payment-qr').getPublicUrl(selectedMethod.qr_code_path).data.publicUrl} alt={`${selectedMethod.name} payment QR`} sx={{width:160,height:160,objectFit:'contain',alignSelf:'center'}} />}<FormControlLabel control={<Checkbox checked={qrVerified} onChange={(event)=>setQrVerified(event.target.checked)} disabled={locked} />} label="QR payment received in the store account" /></Stack>}
            <Stack direction="row" spacing={1} useFlexGap sx={{alignItems:'center',flexWrap:'wrap'}}><FormControlLabel control={<Checkbox checked={printAfterPayment} onChange={(event)=>setPrintAfterPayment(event.target.checked)} disabled={locked} />} label="Print after payment" /><TextField select size="small" label="Paper" value={paper} disabled={locked} onChange={(event)=>setPaper(event.target.value)} sx={{minWidth:130}}><MenuItem value="thermal">80mm</MenuItem><MenuItem value="a4">A4</MenuItem></TextField></Stack>
            <Button type="submit" variant="contained" size="large" disabled={saving || !canPay || !items.length || !methodId || !store?.is_active}>{saving?'Completing payment...':uncertain?'Retry same payment':printAfterPayment?'Pay & print receipt':'Complete payment'}</Button>
          </Stack></Box>}
        </Paper>
      </Box>
    </Stack>
  </Container>
}
