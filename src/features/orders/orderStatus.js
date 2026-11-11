export function formatOrderStatus(status) {
  if (status === 'preparing') return 'Orders preparing'
  if (status === 'ready') return 'Orders Ready'
  return (status || '').split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}
