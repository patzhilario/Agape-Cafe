import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useAuth } from '../auth/useAuth.js'
import { getBenefitPolicy, saveBenefitPolicy } from './benefitData.js'

export default function AdminBenefitPolicyPage() {
  const { account } = useAuth()
  const [policy, setPolicy] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    getBenefitPolicy()
      .then((data) => {
        if (active) {
          setPolicy({
            ...data,
            discount_percent: String(data.discount_percent),
            vat_rate: String(data.vat_rate),
          })
        }
      })
      .catch((error) => {
        console.error('Unable to load benefit policy.', error)
        if (active) setErrorMessage(error.message)
      })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [reloadKey])

  async function savePolicy(event) {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      if (policy.vat_registration === 'not_configured') {
        throw new Error('Select the business VAT registration status before enabling approvals.')
      }
      await saveBenefitPolicy(policy)
      setSuccessMessage('Benefit discount policy saved and audited.')
      setReloadKey((key) => key + 1)
    } catch (error) {
      console.error('Unable to save benefit discount policy.', error)
      setErrorMessage(error.message)
    } finally { setIsSaving(false) }
  }

  if (!account.roles.includes('super_admin')) {
    return (
      <Container maxWidth="md" sx={{ py: 8 }}>
        <Alert severity="warning">Only a Super Admin can configure the benefit discount policy.</Alert>
      </Container>
    )
  }
  if (isLoading) return <Stack sx={{ alignItems: 'center', py: 10 }}><CircularProgress /></Stack>

  return (
    <Container maxWidth="md" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="primary">Agapé Café · Super Admin</Typography>
          <Typography variant="h2">Benefit discount policy</Typography>
          <Typography color="text.secondary">
            Philippine law provides at least a 20% discount and applicable VAT
            exemption for eligible restaurant purchases made for the exclusive
            use of the qualified PWD or Senior Citizen. Confirm the café’s VAT
            registration and current BIR receipt/accounting treatment with your
            accountant before enabling approvals.
          </Typography>
        </Box>
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        {successMessage && <Alert severity="success">{successMessage}</Alert>}
        {!policy ? (
          <Alert severity="warning">
            Apply the Phase 6 migration before configuring benefit discounts.
          </Alert>
        ) : (
          <Paper component="form" onSubmit={savePolicy} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack spacing={2.5}>
              <Typography variant="h6">Applicable rule settings</Typography>
              <FormControlLabel
                control={<Switch checked={policy.is_active} onChange={(event) => setPolicy((current) => ({ ...current, is_active: event.target.checked }))} />}
                label="Accept benefit discount requests"
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Discount percentage"
                  type="number"
                  value={policy.discount_percent}
                  onChange={(event) => setPolicy((current) => ({ ...current, discount_percent: event.target.value }))}
                  slotProps={{ htmlInput: { min: '20', max: '100', step: '0.01' } }}
                  required
                />
                <TextField
                  label="VAT rate (%)"
                  type="number"
                  value={policy.vat_rate}
                  onChange={(event) => setPolicy((current) => ({ ...current, vat_rate: event.target.value }))}
                  slotProps={{ htmlInput: { min: '0', max: '30', step: '0.01' } }}
                  required
                />
                <FormControl fullWidth required>
                  <InputLabel id="benefit-vat-status">Business VAT status</InputLabel>
                  <Select
                    labelId="benefit-vat-status"
                    label="Business VAT status"
                    value={policy.vat_registration}
                    onChange={(event) => setPolicy((current) => ({ ...current, vat_registration: event.target.value }))}
                  >
                    <MenuItem value="not_configured" disabled>Choose VAT registration status</MenuItem>
                    <MenuItem value="vat_registered">VAT-registered</MenuItem>
                    <MenuItem value="non_vat">Non-VAT registered</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
              <FormControlLabel
                control={<Switch checked={policy.pwd_enabled} onChange={(event) => setPolicy((current) => ({ ...current, pwd_enabled: event.target.checked }))} />}
                label="Accept PWD discount requests"
              />
              <FormControlLabel
                control={<Switch checked={policy.senior_citizen_enabled} onChange={(event) => setPolicy((current) => ({ ...current, senior_citizen_enabled: event.target.checked }))} />}
                label="Accept Senior Citizen discount requests"
              />
              <Alert severity="info">
                PWD and Senior Citizen discounts do not stack with promotions.
                For VAT-registered businesses, approval removes the configured
                VAT component from selected eligible lines and applies the
                configured discount to their VAT-exclusive amount. For non-VAT
                businesses, it applies the discount to the selected line amount.
                Prices/receipts and special cases should be validated with your accountant.
              </Alert>
              <Button type="submit" variant="contained" disabled={isSaving}>
                {isSaving ? 'Saving policy…' : 'Save policy'}
              </Button>
            </Stack>
          </Paper>
        )}
      </Stack>
    </Container>
  )
}
