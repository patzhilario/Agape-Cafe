import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'

export default function DeleteConfirmationDialog({
  open,
  title = 'Delete this data?',
  itemName,
  itemType = 'item',
  detail,
  warning = 'This action cannot be undone.',
  errorMessage = '',
  isDeleting = false,
  onCancel,
  onConfirm,
}) {
  return (
    <Dialog
      open={open}
      onClose={() => !isDeleting && onCancel()}
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography variant="body2">
            Permanently delete <strong>{itemName}</strong> {itemType}?
          </Typography>
          {detail && <Typography variant="body2" color="text.secondary">{detail}</Typography>}
          {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
          <Alert severity="warning">{warning}</Alert>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} disabled={isDeleting}>Cancel</Button>
        <Button
          color="error"
          variant="contained"
          onClick={onConfirm}
          disabled={isDeleting}
        >
          {isDeleting ? 'Deleting…' : 'Delete permanently'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
