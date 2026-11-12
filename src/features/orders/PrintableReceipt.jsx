import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { Alert, Box, Button, Stack, ToggleButton, ToggleButtonGroup } from '@mui/material'
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined'
import { formatPrice } from '../public/publicData.js'
import { formatOrderDate } from './formatOrderDate.js'
import { formatOrderStatus } from './orderStatus.js'
import { canPrintOrderReceipt, RECEIPT_UNAVAILABLE_MESSAGE } from './receiptEligibility.js'
import '../../pages/orderReceipt.css'

const logo = new URL('../../assets/logo.jpg', import.meta.url).href
const first = (value) => Array.isArray(value) ? value[0] : value

function Receipt({ order, paper, paperRef }) {
  const payment = first(order.payment)
  const proof = first(order.payment_proof)
  const paid = order.payment_status === 'paid'
  const status = paid ? 'PAID' : proof?.status === 'pending' ? 'AWAITING PAYMENT VERIFICATION' : formatOrderStatus(order.payment_status).toUpperCase()
  return (
    <article ref={paperRef} className={`order-receipt receipt-${paper}`} aria-label="Order receipt">
      <header className="receipt-brand">
        <img src={logo} alt="Agape Cafe" width="54" height="54" />
        <h1>{order.branch?.name || 'Agape Cafe'}</h1>
        {order.branch?.address && <p>{order.branch.address}</p>}
        {order.branch?.phone && <p>{order.branch.phone}</p>}
        <div className="receipt-document-name">ORDER RECEIPT</div>
      </header>
      <div className="receipt-status">{status}</div>
      <section className="receipt-meta">
        <div><span>Order</span><strong>{order.order_number}</strong></div>
        <div><span>Date</span><span>{formatOrderDate(order.created_at)}</span></div>
        <div><span>Source</span><span>{order.order_source === 'pos' ? 'Staff POS' : 'Online order'}</span></div>
        <div><span>Type</span><span>{formatOrderStatus(order.fulfillment_method)}</span></div>
        <div><span>Customer</span><span>{order.customer_name}</span></div>
        {order.customer_phone && <div><span>Phone</span><span>{order.customer_phone}</span></div>}
        {order.cashier?.display_name && <div><span>Cashier</span><span>{order.cashier.display_name}</span></div>}
        {order.fulfillment_method === 'delivery' && <div className="receipt-address"><span>Deliver to</span><span>{order.delivery_address}</span></div>}
      </section>
      <table className="receipt-items">
        <thead><tr><th>ITEM / QTY</th><th>AMOUNT</th></tr></thead>
        <tbody>{(order.items || []).map((item) => <tr key={item.id}>
          <td>
            <strong>{item.product_name}</strong>
            {item.variant_name && <small>{item.variant_name}</small>}
            {(item.addons || []).map((addon, index) => <small key={`${addon.addon_name}-${index}`}>+ {addon.addon_name}{Number(addon.unit_price) > 0 ? ` (${formatPrice(addon.unit_price)})` : ''}</small>)}
            <small>{item.quantity} x {formatPrice(item.unit_price)}</small>
          </td>
          <td>{formatPrice(item.line_subtotal ?? Number(item.unit_price) * item.quantity)}</td>
        </tr>)}</tbody>
      </table>
      <section className="receipt-totals">
        <div><span>Subtotal</span><span>{formatPrice(order.subtotal)}</span></div>
        {Number(order.discount_total) > 0 && <div><span>{order.pos_discount_type === 'pwd' ? 'PWD benefit discount' : order.pos_discount_type === 'senior_citizen' ? 'Senior benefit discount' : 'Discount'}</span><span>-{formatPrice(order.discount_total)}</span></div>}
        {order.fulfillment_method === 'delivery' && <div><span>Delivery fee</span><span>{Number(order.delivery_fee) ? formatPrice(order.delivery_fee) : 'FREE'}</span></div>}
        <div className="receipt-grand-total"><span>TOTAL</span><strong>{formatPrice(order.total)}</strong></div>
      </section>
      <section className="receipt-payment">
        <div><span>Payment method</span><span>{payment?.payment_method_name || 'E-payment'}</span></div>
        <div><span>{paid ? 'Amount paid' : 'Order amount'}</span><span>{formatPrice(payment?.amount ?? order.total)}</span></div>
        {order.cash_received != null && <div><span>Cash received</span><span>{formatPrice(order.cash_received)}</span></div>}
        {order.cash_change != null && <div><span>Change</span><span>{formatPrice(order.cash_change)}</span></div>}
        {proof?.reference_number && <div><span>Reference</span><span>{proof.reference_number}</span></div>}
        {!paid && <p>Payment has not been confirmed as paid.</p>}
      </section>
      <footer className="receipt-footer"><strong>Thank you for choosing us.</strong><p>A little love in every cup.</p><p>Keep this receipt for your order reference.</p></footer>
    </article>
  )
}

export default function PrintableReceipt({ order, initialPaper = 'thermal', autoPrint = false }) {
  if (!canPrintOrderReceipt(order)) return <Alert severity="info">{RECEIPT_UNAVAILABLE_MESSAGE}</Alert>
  return <AcceptedReceipt order={order} initialPaper={initialPaper} autoPrint={autoPrint} />
}

function AcceptedReceipt({ order, initialPaper, autoPrint }) {
  const [paper, setPaper] = useState(initialPaper)
  const [printHeight, setPrintHeight] = useState(297)
  const [printing, setPrinting] = useState(false)
  const preview = useRef(null)
  const printed = useRef('')
  const print = useCallback(async () => {
    setPrinting(true)
    try {
      await document.fonts.ready
      const img = preview.current?.querySelector('img')
      if (img && !img.complete) await img.decode().catch(() => {})
      flushSync(() => setPrintHeight(Math.ceil((preview.current?.scrollHeight || 1000) * 25.4 / 96) + 4))
      window.print()
    } finally { setPrinting(false) }
  }, [])
  useEffect(() => {
    if (!autoPrint || printed.current === order.id) return undefined
    const timer = window.setTimeout(() => { printed.current = order.id; void print() }, 100)
    return () => window.clearTimeout(timer)
  }, [autoPrint, order.id, print])
  return <Stack spacing={2}>
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
      <ToggleButtonGroup value={paper} exclusive onChange={(_, value) => value && setPaper(value)} size="small" aria-label="Receipt paper size">
        <ToggleButton value="thermal">80mm thermal</ToggleButton><ToggleButton value="a4">A4</ToggleButton>
      </ToggleButtonGroup>
      <Button variant="contained" startIcon={<PrintOutlinedIcon />} disabled={printing} onClick={print}>Print receipt</Button>
    </Stack>
    <Box sx={{ overflowX: 'auto', p: 1, bgcolor: '#eae5df', borderRadius: 2 }}><Receipt order={order} paper={paper} paperRef={preview} /></Box>
    {createPortal(<div id="receipt-print-root">
      <style>{`@media print { @page { size: ${paper === 'a4' ? 'A4' : `80mm ${printHeight}mm`}; margin: 0; } }`}</style>
      <Receipt order={order} paper={paper} />
    </div>, document.body)}
  </Stack>
}
