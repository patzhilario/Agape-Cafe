import { IconButton, Stack, Typography } from '@mui/material'
import RemoveIcon from '@mui/icons-material/Remove'
import AddIcon from '@mui/icons-material/Add'

export default function QuantityStepper({ value, onChange, label = 'Quantity', max = 20 }) {
  return (
    <Stack
      direction="row"
      spacing={0.5}
      sx={{ alignItems: 'center', border: 1, borderColor: 'divider', borderRadius: 2, width: 'fit-content' }}
    >
      <IconButton
        size="small"
        aria-label={`Decrease ${label.toLowerCase()}`}
        disabled={value <= 1}
        onClick={() => onChange(Math.max(1, value - 1))}
      >
        <RemoveIcon fontSize="small" />
      </IconButton>
      <Typography component="span" aria-live="polite" sx={{ minWidth: 2, textAlign: 'center', fontWeight: 700 }}>
        {value}
      </Typography>
      <IconButton
        size="small"
        aria-label={`Increase ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <AddIcon fontSize="small" />
      </IconButton>
    </Stack>
  )
}
