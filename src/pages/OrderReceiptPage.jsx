import { useEffect, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { Alert, Box, Button, CircularProgress, Container, Stack, Typography } from '@mui/material'
import { getOrderReceipt } from '../features/orders/receiptData.js'
import PrintableReceipt from '../features/orders/PrintableReceipt.jsx'
import { useAuth } from '../features/auth/useAuth.js'

export default function OrderReceiptPage() {
  const { orderId } = useParams()
  const { canAccessWorkspace } = useAuth()
  const [result, setResult] = useState({ id: '', order: null, error: '' })
  useEffect(() => {
    let active = true
    getOrderReceipt(orderId).then((order) => { if (active) setResult({ id: orderId, order, error: '' }) })
      .catch((error) => { if (active) setResult({ id: orderId, order: null, error: error.message }) })
    return () => { active = false }
  }, [orderId])
  const order = result.id === orderId ? result.order : null
  return <Container maxWidth="md" sx={{ py: 4 }}><Stack spacing={3}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
      <Box><Typography variant="h3">Receipt</Typography><Typography color="text.secondary">Choose your paper size, then print or save as PDF.</Typography></Box>
      <Button component={RouterLink} to={canAccessWorkspace() ? '/admin/orders' : `/customer/orders/${orderId}`}>Back to orders</Button>
    </Stack>
    {result.id !== orderId ? <CircularProgress /> : result.error ? <Alert severity="error">{result.error}</Alert> : !order ? <Alert severity="info">Receipt not found or unavailable to this account.</Alert> : <PrintableReceipt order={order} />}
  </Stack></Container>
}
