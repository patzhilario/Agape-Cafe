import {
  Box,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'

export default function PaginationControls({ page, pageSize, hasNextPage, isLoading, onChange }) {
  return (
    <Stack
      direction="row"
      spacing={{ xs: 1, sm: 1.5 }}
      sx={{
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        py: 1,
      }}
    >
      <IconButton
        size="small"
        aria-label="Previous page"
        disabled={isLoading || page === 0}
        onClick={() => onChange(page - 1, pageSize)}
        sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}
      >
        <ChevronLeftIcon fontSize="small" />
      </IconButton>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Box
          sx={{
            px: 1.25,
            py: 0.6,
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
            bgcolor: 'background.paper',
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            Page <strong>{page + 1}</strong>
          </Typography>
        </Box>
        <FormControl size="small" sx={{ minWidth: 84 }}>
          <InputLabel id="pagination-page-size-label">Rows</InputLabel>
          <Select
            labelId="pagination-page-size-label"
            label="Rows"
            value={pageSize}
            disabled={isLoading}
            onChange={(event) => onChange(0, Number(event.target.value))}
            sx={{ borderRadius: 2, fontSize: '0.8125rem' }}
          >
            {[10, 15, 20, 50].map((size) => (
              <MenuItem key={size} value={size}>{size}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
      <IconButton
        size="small"
        aria-label="Next page"
        disabled={isLoading || !hasNextPage}
        onClick={() => onChange(page + 1, pageSize)}
        sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}
      >
        <ChevronRightIcon fontSize="small" />
      </IconButton>
    </Stack>
  )
}
