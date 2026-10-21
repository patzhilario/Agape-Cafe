import {
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material'

export default function PaginationControls({ page, pageSize, hasNextPage, isLoading, onChange }) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      sx={{ alignItems: 'center', justifyContent: 'center' }}
    >
      <Button
        variant="outlined"
        disabled={isLoading || page === 0}
        onClick={() => onChange(page - 1, pageSize)}
      >
        Previous
      </Button>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          Page {page + 1}
        </Typography>
        <FormControl size="small" sx={{ minWidth: 104 }}>
          <InputLabel id="pagination-page-size-label">Rows</InputLabel>
          <Select
            labelId="pagination-page-size-label"
            label="Rows"
            value={pageSize}
            disabled={isLoading}
            onChange={(event) => onChange(0, Number(event.target.value))}
          >
            {[10, 15, 20, 50].map((size) => (
              <MenuItem key={size} value={size}>{size} per page</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
      <Button
        variant="outlined"
        disabled={isLoading || !hasNextPage}
        onClick={() => onChange(page + 1, pageSize)}
      >
        Next
      </Button>
    </Stack>
  )
}
