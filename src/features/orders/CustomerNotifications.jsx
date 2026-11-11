import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Badge, Box, Button, IconButton, Menu, MenuItem, Snackbar, Typography } from '@mui/material'
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined'
import { getSupabaseClient } from '../../lib/supabaseClient.js'

export default function CustomerNotifications({ customerId }) {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [anchor, setAnchor] = useState(null)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState('')
  const shown = useRef(new Set())

  useEffect(() => {
    let active = true
    let pending = false
    async function refresh() {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      try {
        const { data, error: loadError, count } = await getSupabaseClient()
          .from('customer_notifications')
          .select('id, order_id, event_type, title, message, created_at', { count: 'exact' })
          .eq('customer_id', customerId)
          .is('read_at', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(50)
        if (loadError) throw loadError
        if (!active) return
        setError('')
        setNotifications(data || [])
        setUnreadCount(count ?? data?.length ?? 0)
        const unseen = (data || []).filter((item) => !shown.current.has(item.id))
        if (unseen.length) {
          setNotice(unseen[0])
          unseen.forEach((item) => {
            shown.current.add(item.id)
            window.dispatchEvent(new CustomEvent('customer-order-update', { detail: { orderId: item.order_id } }))
          })
        }
      } catch (loadError) {
        if (active) setError('Could not load notifications. Please try again.')
        console.error('Unable to load customer notifications.', loadError)
      } finally {
        pending = false
      }
    }
    void refresh()
    const interval = window.setInterval(refresh, 15_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('refresh-customer-notifications', refresh)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('refresh-customer-notifications', refresh)
    }
  }, [customerId])

  async function markRead(item) {
    const { error: saveError } = await getSupabaseClient().rpc('mark_customer_notification_read', {
      target_notification_id: item?.id || null,
    })
    if (saveError) {
      setError('Could not mark notifications as read. Please try again.')
      return false
    }
    setNotifications((current) => item ? current.filter((entry) => entry.id !== item.id) : [])
    setUnreadCount((current) => item ? Math.max(0, current - 1) : 0)
    window.dispatchEvent(new Event('refresh-customer-notifications'))
    return true
  }

  async function openOrder(item) {
    await markRead(item)
    setAnchor(null)
    setNotice(null)
    navigate(`/customer/orders/${item.order_id}`)
    window.dispatchEvent(new CustomEvent('customer-order-update', { detail: { orderId: item.order_id } }))
  }

  return (
    <>
      <IconButton color="primary" aria-label={`Notifications, ${unreadCount} unread`} onClick={(event) => setAnchor(event.currentTarget)} aria-haspopup="menu" aria-expanded={Boolean(anchor)}>
        <Badge badgeContent={unreadCount} color="error" max={99}><NotificationsOutlinedIcon /></Badge>
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { width: 360, maxWidth: 'calc(100vw - 24px)', maxHeight: 440 } } }}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography fontWeight={700}>Notifications</Typography>
          {unreadCount > 0 && <Button size="small" onClick={() => { void markRead(null); setNotice(null) }}>Mark all as read</Button>}
          {error && <Alert severity="error">{error}</Alert>}
          {!error && !notifications.length && <Typography color="text.secondary">No unread notifications.</Typography>}
        </Box>
        {notifications.map((item) => (
          <MenuItem key={item.id} onClick={() => { void openOrder(item) }} sx={{ whiteSpace: 'normal', alignItems: 'flex-start' }}>
            <Box><Typography fontWeight={700}>{item.title}</Typography><Typography variant="body2">{item.message}</Typography></Box>
          </MenuItem>
        ))}
      </Menu>
      <Snackbar open={Boolean(notice)} onClose={(_, reason) => { if (reason !== 'clickaway') setNotice(null) }} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={notice?.event_type.includes('rejected') ? 'warning' : 'info'} onClose={() => setNotice(null)} action={<Button color="inherit" onClick={() => { void openOrder(notice) }}>View order</Button>} sx={{ width: '100%' }}>
          <strong>{notice?.title}</strong> {notice?.message}
        </Alert>
      </Snackbar>
    </>
  )
}
