import { Box, Checkbox, FormControlLabel, Paper, Stack, Typography } from '@mui/material'
import { formatPrice } from '../../features/public/publicData.js'
import { getExtraGroups } from '../../features/public/menuOptions.js'

export default function ProductExtras({ options, selectedIds, onChange }) {
  return getExtraGroups(options).map((group) => (
    <Box key={group.kind}>
      <Typography variant="h6" fontWeight={700}>{group.title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
        Optional. Select any you like.
      </Typography>
      <Stack spacing={1}>
        {group.options.map((option) => {
          const selected = selectedIds.includes(option.id)
          return (
            <Paper key={option.id} variant="outlined" sx={{
              borderRadius: 2.5,
              borderColor: selected ? 'primary.main' : 'divider',
              bgcolor: selected ? 'rgba(91, 57, 39, 0.05)' : 'background.paper',
            }}>
              <FormControlLabel
                control={<Checkbox checked={selected} onChange={(event) => onChange(
                  event.target.checked
                    ? [...selectedIds, option.id]
                    : selectedIds.filter((id) => id !== option.id),
                )} />}
                label={
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{option.name}</Typography>
                    {option.price > 0 && (
                      <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap', pr: 1 }}>
                        +{formatPrice(option.price)}
                      </Typography>
                    )}
                  </Stack>
                }
                sx={{ m: 0, width: '100%', minHeight: 56, pl: 0.5, pr: 0.5 }}
              />
            </Paper>
          )
        })}
      </Stack>
    </Box>
  ))
}
