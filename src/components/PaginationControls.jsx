import {
  Box,
  Button,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'

export default function PaginationControls({ page, pageSize, totalItems, hasNextPage, isLoading, onChange }) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  return (
    <Box
      component="nav"
      aria-label="Pagination"
      sx={{
        mt: 0.75,
        px: { xs: 1, sm: 1.5 },
        py: 0.75,
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            size="small"
            variant="outlined"
            aria-label="Previous page"
            disabled={isLoading || page === 0}
            onClick={() => onChange(page - 1, pageSize)}
            sx={{ minWidth: 32, width: 32, height: 32, p: 0, borderRadius: 1.5 }}
          >
            <ChevronLeftIcon sx={{ fontSize: 18 }} />
          </Button>
          <Box
            aria-current="page"
            sx={{
              minWidth: 88,
              px: 0.75,
              textAlign: 'center',
            }}
          >
            <Typography variant="caption" fontWeight={700} sx={{ whiteSpace: 'nowrap' }}>
              Page {page + 1} of {totalPages}
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            aria-label="Next page"
            disabled={isLoading || !hasNextPage}
            onClick={() => onChange(page + 1, pageSize)}
            sx={{ minWidth: 32, width: 32, height: 32, p: 0, borderRadius: 1.5 }}
          >
            <ChevronRightIcon sx={{ fontSize: 18 }} />
          </Button>
        </Stack>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            Rows
          </Typography>
          <Select
            size="small"
            value={pageSize}
            disabled={isLoading}
            inputProps={{ 'aria-label': 'Rows per page' }}
            onChange={(event) => onChange(0, Number(event.target.value))}
            sx={{
              minWidth: 64,
              height: 32,
              borderRadius: 1.5,
              bgcolor: 'background.paper',
              '& .MuiSelect-select': { py: 0.5, fontSize: '0.75rem' },
            }}
          >
            {[10, 15, 20, 50].map((size) => (
              <MenuItem key={size} value={size}>{size}</MenuItem>
            ))}
          </Select>
        </Stack>
      </Stack>
    </Box>
  )
}
