import { Box, Card, CardContent, Stack, Typography } from '@mui/material'
import { formatOperatingHours } from '../../features/public/publicData.js'
import { EmptyPublicState } from './PublicDataState.jsx'

function BranchCard({ branch }) {
  const hours = formatOperatingHours(branch.operating_hours)

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={1.25}>
          <Typography variant="h6">{branch.name}</Typography>
          {branch.address && <Typography color="text.secondary">{branch.address}</Typography>}
          {hours && (
            <Typography variant="body2" color="text.secondary">
              {hours}
            </Typography>
          )}
          {branch.phone && (
            <Typography component="a" href={`tel:${branch.phone}`} color="primary">
              {branch.phone}
            </Typography>
          )}
          {branch.email && (
            <Typography component="a" href={`mailto:${branch.email}`} color="primary">
              {branch.email}
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}

export default function BranchCards({ branches }) {
  if (!branches.length) {
    return <EmptyPublicState>No active branches have been published yet.</EmptyPublicState>
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, 1fr)' },
        gap: 2,
      }}
    >
      {branches.map((branch) => (
        <BranchCard key={branch.id} branch={branch} />
      ))}
    </Box>
  )
}
