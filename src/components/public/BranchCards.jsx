import { useState } from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined'
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined'
import LocalPhoneOutlinedIcon from '@mui/icons-material/LocalPhoneOutlined'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'
import { formatOperatingHours } from '../../features/public/publicData.js'
import { EmptyPublicState } from './PublicDataState.jsx'

function getMapQuery(branch) {
  if (branch.map_url) {
    try {
      const mapUrl = new URL(branch.map_url)
      const query = mapUrl.searchParams.get('query') || mapUrl.searchParams.get('q')
      if (query) return query

      const coordinates =
        mapUrl.href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) ||
        mapUrl.href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
      if (coordinates) return `${coordinates[1]},${coordinates[2]}`

      const place = mapUrl.pathname.match(/\/place\/([^/]+)/)
      if (place) return decodeURIComponent(place[1].replaceAll('+', ' '))
    } catch (error) {
      console.error(`Unable to parse the map link for ${branch.name}.`, error)
    }
  }

  return branch.address || branch.name
}

function getMapLink(branch) {
  return branch.map_url ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(getMapQuery(branch))}`
}

function BranchCard({ branch }) {
  const hours = formatOperatingHours(branch.operating_hours)
  const [mapOpen, setMapOpen] = useState(false)
  const mapQuery = getMapQuery(branch)
  const mapEmbedUrl =
    `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`
  const mapLink = getMapLink(branch)

  return (
    <>
      <Card
        variant="outlined"
        sx={{
          height: '100%',
          overflow: 'hidden',
          borderColor: 'rgba(67, 48, 34, 0.12)',
          borderRadius: 3,
          transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
          '&:hover': {
            transform: 'translateY(-4px)',
            borderColor: 'primary.light',
            boxShadow: '0 14px 36px rgba(57, 35, 23, 0.10)',
          },
        }}
      >
        <Box sx={{ height: 7, bgcolor: 'primary.main' }} />
        <CardContent sx={{ p: { xs: 2.5, sm: 3 }, '&:last-child': { pb: 3 } }}>
          <Stack spacing={2.25} sx={{ height: '100%' }}>
            <Box>
              <Typography variant="overline" color="primary" sx={{ letterSpacing: '.12em' }}>
                AGAPÉ CAFÉ · BRANCH
              </Typography>
              <Typography variant="h5" sx={{ mt: 0.25, fontWeight: 750 }}>
                {branch.name}
              </Typography>
            </Box>
            <Stack spacing={1.25}>
              {branch.address && (
                <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
                  <PlaceOutlinedIcon color="primary" fontSize="small" sx={{ mt: 0.25 }} />
                  <Typography variant="body2" color="text.secondary">
                    {branch.address}
                  </Typography>
                </Stack>
              )}
              {hours && (
                <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
                  <AccessTimeOutlinedIcon color="primary" fontSize="small" sx={{ mt: 0.25 }} />
                  <Typography variant="body2" color="text.secondary">{hours}</Typography>
                </Stack>
              )}
              {branch.phone && (
                <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                  <LocalPhoneOutlinedIcon color="primary" fontSize="small" />
                  <Typography
                    component="a"
                    href={`tel:${branch.phone}`}
                    variant="body2"
                    color="text.primary"
                    sx={{ textDecoration: 'none', '&:hover': { color: 'primary.main' } }}
                  >
                    {branch.phone}
                  </Typography>
                </Stack>
              )}
              {branch.email && (
                <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }}>
                  <EmailOutlinedIcon color="primary" fontSize="small" />
                  <Typography
                    component="a"
                    href={`mailto:${branch.email}`}
                    variant="body2"
                    color="text.primary"
                    sx={{
                      minWidth: 0,
                      overflowWrap: 'anywhere',
                      textDecoration: 'none',
                      '&:hover': { color: 'primary.main' },
                    }}
                  >
                    {branch.email}
                  </Typography>
                </Stack>
              )}
            </Stack>
            <Box sx={{ flex: 1 }} />
            <Divider />
            <Button
              variant="contained"
              startIcon={<PlaceOutlinedIcon />}
              onClick={() => setMapOpen(true)}
              sx={{ alignSelf: 'flex-start', borderRadius: 2 }}
            >
              View location
            </Button>
          </Stack>
        </CardContent>
      </Card>
      <Dialog
        open={mapOpen}
        onClose={() => setMapOpen(false)}
        fullWidth
        maxWidth="md"
        aria-labelledby={`branch-map-title-${branch.id}`}
        slotProps={{ paper: { sx: { overflow: 'hidden', borderRadius: 3 } } }}
      >
        <DialogTitle id={`branch-map-title-${branch.id}`} sx={{ pb: 0.5 }}>
          {branch.name}
        </DialogTitle>
        <DialogContent sx={{ pt: 1.5 }}>
          {branch.address && <Typography color="text.secondary" sx={{ mb: 2 }}>{branch.address}</Typography>}
          <Box
            component="iframe"
            title={`Map showing ${branch.name}`}
            src={mapEmbedUrl}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            sx={{
              display: 'block',
              width: '100%',
              height: { xs: 320, sm: 440 },
              border: 0,
              borderRadius: 1,
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setMapOpen(false)}>Close</Button>
          <Button
            component="a"
            href={mapLink}
            target="_blank"
            rel="noreferrer"
            endIcon={<OpenInNewIcon />}
          >
            Open in Google Maps
          </Button>
        </DialogActions>
      </Dialog>
    </>
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
