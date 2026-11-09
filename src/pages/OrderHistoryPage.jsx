import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box,
  Button,
  Chip,
  Container,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { getCustomerOrders } from '../features/orders/orderData.js'
import { formatOrderDate as formatDate } from '../features/orders/formatOrderDate.js'
import PaginationControls from '../components/PaginationControls.jsx'
import { formatPrice } from '../features/public/publicData.js'
import {
  EmptyPublicState,
  PublicDataError,
  PublicLoading,
} from '../components/public/PublicDataState.jsx'

const DEFAULT_PAGE_SIZE = 10

function formatStatus(value) {
  return value
    .split('_')
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export default function OrderHistoryPage() {
  const [orders, setOrders] = useState([])
  const [totalOrderCount, setTotalOrderCount] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    getCustomerOrders(page, pageSize)
      .then(({ data, count }) => {
        if (active) {
          setOrders(data)
          setTotalOrderCount(count)
          setErrorMessage('')
        }
      })
      .catch((error) => {
        console.error('Unable to load customer order history.', error)
        if (active) setErrorMessage(error.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [page, pageSize, reloadKey])

  return (
    <Container maxWidth="md" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="primary">
            Agapé Café · Customer account
          </Typography>
          <Typography variant="h1">Order history</Typography>
        </Box>
        {errorMessage && (
          <PublicDataError
            message={errorMessage}
            onRetry={() => {
              setIsLoading(true)
              setPage(0)
              setReloadKey((key) => key + 1)
            }}
          />
        )}
        {isLoading ? (
          <PublicLoading label="Loading your orders…" />
        ) : orders.length || page > 0 ? (
          <>
            {orders.length ? (
              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2.5 }}>
                <Table size="small" aria-label="Your order history" sx={{ minWidth: 820 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Order</TableCell>
                      <TableCell>Date</TableCell>
                      <TableCell>Branch</TableCell>
                      <TableCell>Items</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Payment</TableCell>
                      <TableCell align="right">Total</TableCell>
                      <TableCell align="right">Details</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id} hover>
                        <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {order.order_number}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {formatDate(order.created_at)}
                        </TableCell>
                        <TableCell>{order.branch?.name || 'Agapé Café'}</TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {(order.items || []).reduce((sum, item) => sum + item.quantity, 0)} item(s)
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatStatus(order.fulfillment_method)}
                            {order.dining_table?.label ? ` · Table ${order.dining_table.label}` : ''}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            color={order.status === 'cancelled' ? 'error' : order.status === 'completed' ? 'success' : 'primary'}
                            label={formatStatus(order.status)}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          <Chip
                            color={order.payment_status === 'paid' ? 'success' : 'default'}
                            label={formatStatus(order.payment_status)}
                            size="small"
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontWeight: 700 }}>
                          {formatPrice(order.total)}
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            component={RouterLink}
                            to={`/customer/orders/${order.id}`}
                            size="small"
                            variant="outlined"
                            sx={{ whiteSpace: 'nowrap' }}
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : <EmptyPublicState>No orders remain on this page.</EmptyPublicState>}
            <PaginationControls
              page={page}
              pageSize={pageSize}
              totalItems={totalOrderCount}
              hasNextPage={orders.length === pageSize}
              isLoading={isLoading}
              onChange={(nextPage, nextPageSize) => {
                setIsLoading(true)
                setPage(nextPage)
                setPageSize(nextPageSize)
              }}
            />
          </>
        ) : (
          <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
            <EmptyPublicState>You do not have any orders yet.</EmptyPublicState>
            <Button component={RouterLink} to="/menu" variant="contained">
              Explore the menu
            </Button>
          </Stack>
        )}
      </Stack>
    </Container>
  )
}
