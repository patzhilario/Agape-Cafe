import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box,
  Button,
  Chip,
  Container,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { getCustomerOrders } from '../features/orders/orderData.js'
import PaginationControls from '../components/PaginationControls.jsx'
import { formatPrice } from '../features/public/publicData.js'
import {
  EmptyPublicState,
  PublicDataError,
  PublicLoading,
} from '../components/public/PublicDataState.jsx'

const DEFAULT_PAGE_SIZE = 10

function formatDate(value) {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatStatus(value) {
  return value
    .split('_')
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export default function OrderHistoryPage() {
  const [orders, setOrders] = useState([])
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    getCustomerOrders(page, pageSize)
      .then((data) => {
        if (active) {
          setOrders(data)
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
            {orders.map((order) => (
              <Paper key={order.id} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
                <Stack spacing={1.5}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
                  >
                    <Box>
                      <Typography variant="h6">{order.order_number}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {formatDate(order.created_at)} · {order.branch?.name || 'Agapé Café'}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                      <Chip label={formatStatus(order.status)} size="small" />
                      <Chip
                        label={`Payment ${formatStatus(order.payment_status)}`}
                        size="small"
                        variant="outlined"
                      />
                    </Stack>
                  </Stack>
                  <Stack spacing={0.5}>
                    {order.items?.map((item) => (
                      <Box key={item.id}>
                        <Typography>
                          {item.quantity} × {item.product_name}
                          {item.variant_name ? ` · ${item.variant_name}` : ''}
                          {' · '}{formatPrice(item.line_total)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Unit price with selected options: {formatPrice(item.unit_price)} each
                        </Typography>
                        {item.addons?.length > 0 && (
                          <Typography variant="body2" color="text.secondary">
                            Add-ons: {item.addons.map((addon) =>
                              `${addon.addon_name} (${formatPrice(addon.unit_price)} each)`,
                            ).join(', ')}
                          </Typography>
                        )}
                      </Box>
                    ))}
                    <Typography variant="body2" color="text.secondary">
                      {order.items?.length || 0} item line(s) · {formatStatus(order.fulfillment_method)}
                      {order.dining_table?.label ? ` · Table ${order.dining_table.label}` : ''}
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
                    <Typography fontWeight={700}>Order total</Typography>
                    <Typography fontWeight={700}>{formatPrice(order.total)}</Typography>
                  </Stack>
                  <Button
                    component={RouterLink}
                    to={`/customer/orders/${order.id}`}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    View order
                  </Button>
                </Stack>
              </Paper>
            ))}
            {!orders.length && (
              <EmptyPublicState>No orders remain on this page.</EmptyPublicState>
            )}
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
