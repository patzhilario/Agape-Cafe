import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel, Stack, Typography } from '@mui/material'

export const DATA_POLICY_VERSION = '2026-11-12'

const sections = [
  ['Information collected', 'When you create an account, we collect your username, name, email address, and phone number. Your account also stores profile details you choose to add. When you place orders, we record ordered items, payment information, and delivery details when applicable. Discount requests may include supporting identification documents.'],
  ['How information is used', 'Your information is used to create and manage your account, verify your email, process orders and payments, arrange fulfillment, review discount eligibility, and respond to account or order concerns.'],
  ['Access and service providers', 'Authorized cafe staff can access information needed for their assigned work. The application uses Supabase for account authentication, database storage, and uploaded files. Payment services receive information needed to process your payment. If you choose Google to fill in signup details, your name and email are provided by Google.'],
  ['Storage and retention', 'Account details, order records, and uploaded files are stored through the application services. Requests to delete information may depend on records that must be kept for order, payment, or other applicable recordkeeping requirements.'],
  ['Your choices and requests', 'You can review and update available profile details from your account. For questions about your data, corrections, or requests to delete your account or information, contact the cafe using the contact details on the Visit page. Avoid uploading information that is unrelated to your order or discount request.'],
  ['Your agreement', 'By checking the agreement box and creating an account, you acknowledge that you have read this Data Policy and agree to the collection and use of your information for the account and ordering purposes described above. Opening or closing this policy does not select the agreement checkbox.'],
]

export default function DataPolicyDialog({ open, onClose, accepted, onAcceptedChange }) {
  return (
    <Dialog open={open} onClose={onClose} scroll="paper" fullWidth maxWidth="sm" aria-labelledby="data-policy-title">
      <DialogTitle id="data-policy-title">Data Policy</DialogTitle>
      <DialogContent dividers tabIndex={0}>
        <DialogContentText sx={{ mb: 2 }}>Please read how the cafe uses your information before creating an account.</DialogContentText>
        <Stack spacing={2.5}>
          {sections.map(([title, details]) => (
            <section key={title}>
              <Typography component="h3" variant="subtitle1" fontWeight={700}>{title}</Typography>
              <Typography variant="body2" color="text.secondary">{details}</Typography>
            </section>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, gap: 1, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <FormControlLabel
          sx={{ m: 0, flex: '1 1 220px', '& .MuiFormControlLabel-label': { fontSize: '.875rem' } }}
          control={<Checkbox checked={accepted} onChange={(event) => onAcceptedChange(event.target.checked)} />}
          label="I have read and agree to the Data Policy."
        />
        <Button variant="contained" onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  )
}
