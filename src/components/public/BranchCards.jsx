import { useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
      <Box
        component="article"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(220px, .8fr) minmax(0, 1.2fr) auto' },
          gap: { xs: 2, md: 4 },
          alignItems: 'center',
          py: { xs: 3, md: 4 },
          borderTop: '1px solid rgba(67, 48, 34, 0.18)',
          '&:last-of-type': { borderBottom: '1px solid rgba(67, 48, 34, 0.18)' },
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mb: 1 }}>
            <PlaceOutlinedIcon color="primary" fontSize="small" />
            <Typography variant="overline" color="primary" sx={{ letterSpacing: '.14em' }}>
              AGAPÉ CAFÉ · LOCATION
            </Typography>
          </Stack>
          <Typography
            component="h2"
            sx={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: { xs: '1.7rem', md: '2rem' },
              fontWeight: 400,
              letterSpacing: '-.03em',
              lineHeight: 1.2,
              overflowWrap: 'anywhere',
            }}
          >
            {branch.name}
          </Typography>
          {branch.address && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', mt: 1.25 }}>
              <PlaceOutlinedIcon color="action" fontSize="small" sx={{ mt: 0.2 }} />
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.65 }}>
                {branch.address}
              </Typography>
            </Stack>
          )}
        </Box>
        <Stack spacing={1.5} sx={{ minWidth: 0 }}>
          {hours && (
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
              <AccessTimeOutlinedIcon color="primary" fontSize="small" sx={{ mt: 0.25 }} />
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                {hours}
              </Typography>
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
          {!hours && !branch.phone && !branch.email && (
            <Typography variant="body2" color="text.secondary">
              Contact details are not available for this location.
            </Typography>
          )}
        </Stack>
        <Button
          variant="outlined"
          endIcon={<OpenInNewIcon />}
          onClick={(event) => {
            event.currentTarget.blur()
            setMapOpen(true)
          }}
          sx={{ minHeight: 42, justifySelf: { md: 'end' }, whiteSpace: 'nowrap' }}
        >
          View on map
        </Button>
      </Box>
      <Dialog
        open={mapOpen}
        onClose={() => setMapOpen(false)}
        disableRestoreFocus
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
    return <EmptyPublicState>Store details will be available soon.</EmptyPublicState>
  }

  return (
    <Box>
      {branches.map((branch) => (
        <BranchCard key={branch.id} branch={branch} />
      ))}
    </Box>
  )
}
