import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useAuth } from '../auth/useAuth.js'
import { getAdminBranches } from './adminData.js'
import { getSupabaseClient } from '../../lib/supabaseClient.js'
import { formatPrice } from '../public/publicData.js'
import PaginationControls from '../../components/PaginationControls.jsx'
import DeleteConfirmationDialog from '../../components/DeleteConfirmationDialog.jsx'

const DEFAULT_PAGE_SIZE = 10

async function check(query) {
  const result = await query
  if (result.error) throw new Error(result.error.message)
  return result.data
}

async function loadMovementSummary(branchId) {
  const pageSize = 1000
  const summaries = new Map()
  const weekStart = new Date()
  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))
  const weekStartIso = weekStart.toISOString()
  let offset = 0

  while (true) {
    const page = await check(getSupabaseClient()
      .from('inventory_movements')
      .select('ingredient_id, movement_type, quantity_delta, created_at')
      .eq('branch_id', branchId)
      .order('created_at')
      .order('ingredient_id')
      .order('id')
      .range(offset, offset + pageSize - 1))

    for (const movement of page) {
      const summary = summaries.get(movement.ingredient_id) || {
        totalIn: 0,
        totalOut: 0,
        consumedThisWeek: 0,
        lastDeliveryAt: null,
      }
      const quantity = Number(movement.quantity_delta)
      if (quantity > 0) summary.totalIn += quantity
      if (movement.movement_type === 'receipt') {
        if (!summary.lastDeliveryAt || movement.created_at > summary.lastDeliveryAt) {
          summary.lastDeliveryAt = movement.created_at
        }
      }
      if (quantity < 0) summary.totalOut += Math.abs(quantity)
      if (
        ['manual_usage', 'order_consumption'].includes(movement.movement_type) &&
        movement.created_at >= weekStartIso
      ) {
        summary.consumedThisWeek += Math.abs(quantity)
      }
      summaries.set(movement.ingredient_id, summary)
    }

    if (page.length < pageSize) break
    offset += pageSize
  }

  return summaries
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function AdminInventoryPage() {
  const { account, hasPermission } = useAuth()
  const isSuperAdmin = account.roles.includes('super_admin')
  const canManageInventory = isSuperAdmin ||
    hasPermission('inventory', 'create') ||
    hasPermission('inventory', 'edit')
  const canEditInventory = isSuperAdmin || hasPermission('inventory', 'edit')
  const [branches, setBranches] = useState([])
  const [branchId, setBranchId] = useState('')
  const [ingredients, setIngredients] = useState([])
  const [stock, setStock] = useState([])
  const [stockBranchId, setStockBranchId] = useState('')
  const [thresholdEdits, setThresholdEdits] = useState({})
  const [movements, setMovements] = useState([])
  const [movementSummaries, setMovementSummaries] = useState(new Map())
  const [ingredientName, setIngredientName] = useState('')
  const [ingredientUnit, setIngredientUnit] = useState('')
  const [editingIngredient, setEditingIngredient] = useState(null)
  const [unitChangeConfirmationOpen, setUnitChangeConfirmationOpen] = useState(false)
  const [ingredientToArchive, setIngredientToArchive] = useState(null)
  const [ingredientToDelete, setIngredientToDelete] = useState(null)
  const [movementIngredientId, setMovementIngredientId] = useState('')
  const [movementType, setMovementType] = useState('receipt')
  const [movementQuantity, setMovementQuantity] = useState('')
  const [movementNote, setMovementNote] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [inventoryView, setInventoryView] = useState('stock')
  const [inventoryPage, setInventoryPage] = useState(0)
  const [inventoryPageSize, setInventoryPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [setupReloadKey, setSetupReloadKey] = useState(0)
  const [ingredientDialogOpen, setIngredientDialogOpen] = useState(false)
  const [movementDialogOpen, setMovementDialogOpen] = useState(false)
  const [ingredientSearch, setIngredientSearch] = useState('')
  const [historySearch, setHistorySearch] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([
      getAdminBranches(account),
      check(getSupabaseClient().from('ingredients').select('id, name, unit, is_active').order('name')),
    ])
      .then(([loadedBranches, loadedIngredients]) => {
        if (!active) return
        setBranches(asArray(loadedBranches))
        setIngredients(asArray(loadedIngredients))
        const assignedBranch = account.branchAssignments[0]?.branch_id
        setBranchId((current) => current || (isSuperAdmin ? '' : assignedBranch || ''))
      })
      .catch((error) => {
        console.error('Unable to load inventory setup.', error)
        if (active) setErrorMessage(error.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [account, isSuperAdmin, setupReloadKey])

  useEffect(() => {
    if (!branchId) {
      return undefined
    }
    let active = true
    Promise.all([
      check(getSupabaseClient().from('branch_inventory')
        .select('ingredient_id, quantity_on_hand, low_stock_threshold')
        .eq('branch_id', branchId)),
      check(getSupabaseClient().from('inventory_movements')
        .select('id, ingredient_id, movement_type, quantity_delta, unit_cost, note, created_at')
        .eq('branch_id', branchId)
        .order('created_at', { ascending: false })
        .limit(50)),
      loadMovementSummary(branchId),
    ])
      .then(([loadedStock, loadedMovements, loadedMovementSummaries]) => {
        if (active) {
          setStock(asArray(loadedStock))
          setThresholdEdits(Object.fromEntries(
            asArray(loadedStock).map((entry) => [
              entry.ingredient_id,
              String(entry.low_stock_threshold ?? 0),
            ]),
          ))
          setStockBranchId(branchId)
          setMovements(asArray(loadedMovements))
          setMovementSummaries(loadedMovementSummaries)
        }
      })
      .catch((error) => {
        console.error('Unable to load branch inventory.', error)
        if (active) setErrorMessage(error.message)
      })
    return () => { active = false }
  }, [branchId, reloadKey])

  const stockByIngredient = new Map(
    (stockBranchId === branchId ? asArray(stock) : []).map((entry) => [
      entry.ingredient_id,
      entry,
    ]),
  )
  const inventoryByIngredient = new Map([...stockByIngredient].map(([id, entry]) => [
    id,
    entry.quantity_on_hand,
  ]))
  const activeIngredients = asArray(ingredients).filter((ingredient) => ingredient.is_active)
  const filteredIngredients = useMemo(() => {
    const q = ingredientSearch.trim().toLowerCase()
    if (!q) return activeIngredients
    return activeIngredients.filter((i) => i.name.toLowerCase().includes(q))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingredients, ingredientSearch])
  const filteredMovements = useMemo(() => {
    const q = historySearch.trim().toLowerCase()
    if (!q) return movements
    return movements.filter((m) => {
      const ingredient = asArray(ingredients).find((i) => i.id === m.ingredient_id)
      return (
        (ingredient?.name || '').toLowerCase().includes(q) ||
        m.movement_type.replaceAll('_', ' ').toLowerCase().includes(q)
      )
    })
  }, [movements, ingredients, historySearch])
  const paginatedIngredients = filteredIngredients.slice(
    inventoryPage * inventoryPageSize,
    (inventoryPage + 1) * inventoryPageSize,
  )
  const lowStockIngredients = activeIngredients.filter((ingredient) => {
    const entry = stockByIngredient.get(ingredient.id)
    const threshold = Number(entry?.low_stock_threshold ?? 0)
    return threshold > 0 && Number(entry?.quantity_on_hand ?? 0) <= threshold
  })

  async function addIngredient(event, confirmUnitChange = false) {
    event?.preventDefault()
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      if (editingIngredient && ingredientUnit.trim() !== editingIngredient.unit && !confirmUnitChange) {
        const unitReferences = await Promise.all([
          check(getSupabaseClient().from('branch_inventory').select('ingredient_id').eq('ingredient_id', editingIngredient.id).limit(1)),
          check(getSupabaseClient().from('inventory_movements').select('ingredient_id').eq('ingredient_id', editingIngredient.id).limit(1)),
        ])
        if (unitReferences.some((rows) => rows.length)) {
          setUnitChangeConfirmationOpen(true)
          return
        }
      }
      const query = editingIngredient
        ? getSupabaseClient().from('ingredients')
          .update({ name: ingredientName.trim(), unit: ingredientUnit.trim() })
          .eq('id', editingIngredient.id)
        : getSupabaseClient().from('ingredients').insert({
          name: ingredientName.trim(),
          unit: ingredientUnit.trim(),
        })
      const result = await query
      if (result.error) throw new Error(result.error.message)
      const wasEditing = Boolean(editingIngredient)
      setIngredientName('')
      setIngredientUnit('')
      setEditingIngredient(null)
      setUnitChangeConfirmationOpen(false)
      setIngredientDialogOpen(false)
      setSuccessMessage(wasEditing ? 'Inventory item updated.' : 'Inventory item added to the catalog.')
      setSetupReloadKey((value) => value + 1)
      setReloadKey((value) => value + 1)
    } catch (error) {
      console.error('Unable to save inventory item.', error)
      setErrorMessage(error.message)
    } finally {
      setIsSaving(false)
    }
  }

  function openIngredientEditor(ingredient = null) {
    setEditingIngredient(ingredient)
    setIngredientName(ingredient?.name || '')
    setIngredientUnit(ingredient?.unit || '')
    setIngredientDialogOpen(true)
  }

  async function setIngredientActive(ingredient, isActive) {
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const { error } = await getSupabaseClient()
        .from('ingredients')
        .update({ is_active: isActive })
        .eq('id', ingredient.id)
      if (error) throw new Error(error.message)
      setIngredientToArchive(null)
      setSuccessMessage(isActive
        ? `${ingredient.name} restored to active inventory items.`
        : `${ingredient.name} archived. Previous stock and movement history are preserved.`)
      setSetupReloadKey((value) => value + 1)
      setReloadKey((value) => value + 1)
    } catch (error) {
      console.error('Unable to update inventory item status.', error)
      setErrorMessage(error.message)
    } finally {
      setIsSaving(false)
    }
  }

  async function deleteIngredientWithHistory() {
    if (!ingredientToDelete) return
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const { error } = await getSupabaseClient().rpc('admin_delete_inventory_item', {
        target_ingredient_id: ingredientToDelete.id,
      })
      if (error) throw new Error(error.message)
      const deletedName = ingredientToDelete.name
      setIngredientToDelete(null)
      setSuccessMessage(`${deletedName} and its related stock, recipes, and movement history were deleted.`)
      setSetupReloadKey((value) => value + 1)
      setReloadKey((value) => value + 1)
    } catch (error) {
      console.error('Unable to permanently delete inventory item and history.', error)
      setErrorMessage(error.message)
    } finally {
      setIsSaving(false)
    }
  }

  async function saveLowStockThreshold(ingredient) {
    const threshold = Number(thresholdEdits[ingredient.id] ?? 0)
    if (!Number.isFinite(threshold) || threshold < 0) {
      setErrorMessage('Enter a valid low-stock warning quantity of zero or more.')
      return
    }
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const { error } = await getSupabaseClient().rpc('admin_set_inventory_low_stock_threshold', {
        target_branch_id: branchId,
        target_ingredient_id: ingredient.id,
        target_threshold: threshold,
      })
      if (error) throw new Error(error.message)
      setSuccessMessage(
        threshold > 0
          ? `Low-stock warning set for ${ingredient.name}.`
          : `Low-stock warning turned off for ${ingredient.name}.`,
      )
      setReloadKey((value) => value + 1)
    } catch (error) {
      console.error('Unable to save low-stock threshold.', error)
      setErrorMessage(error.message)
    } finally {
      setIsSaving(false)
    }
  }

  async function addMovement(event) {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const amount = Number(movementQuantity)
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Enter a positive quantity. Waste is recorded as a negative adjustment.')
      }
      const delta = ['waste', 'manual_usage'].includes(movementType) ? -amount : amount
      const recordedUnitCost = movementType === 'receipt' ? Number(unitCost) / amount : null
      if (movementType === 'receipt' && (!unitCost.trim() || !Number.isFinite(recordedUnitCost) || recordedUnitCost < 0)) {
        throw new Error('Enter the total purchase cost for this restock.')
      }
      const { error } = await getSupabaseClient().rpc('record_inventory_movement', {
        target_branch_id: branchId,
        target_ingredient_id: movementIngredientId,
        movement: movementType,
        quantity_delta: delta,
        note: movementNote,
        unit_cost: recordedUnitCost,
      })
      if (error) throw new Error(error.message)
      setMovementQuantity('')
      setMovementNote('')
      setUnitCost('')
      setMovementDialogOpen(false)
      setSuccessMessage(movementType === 'manual_usage'
        ? 'Closing usage recorded and deducted from branch stock.'
        : movementType === 'receipt'
          ? 'Restock recorded with its purchase cost.'
          : 'Inventory adjustment recorded.')
      setReloadKey((value) => value + 1)
    } catch (error) {
      console.error('Unable to record inventory movement.', error)
      setErrorMessage(error.message)
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return <Stack sx={{ alignItems: 'center', py: 10 }}><CircularProgress /></Stack>
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack spacing={3}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 1.5, md: 2 }} sx={{ justifyContent: 'space-between', alignItems: { md: 'center' } }}>
          <Box>
          <Typography variant="overline" color="primary">Agapé Café · Operations</Typography>
          <Typography variant="h2">Inventory</Typography>
          <Typography color="text.secondary">
            Record restocks and closing usage manually. Orders do not change inventory automatically.
          </Typography>
          </Box>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            useFlexGap
            sx={{ width: { xs: '100%', md: 'auto' }, flexWrap: 'wrap', justifyContent: { md: 'flex-end' } }}
          >
            {inventoryView === 'stock' && isSuperAdmin && (
              <Button
                variant="outlined"
                onClick={() => openIngredientEditor()}
                sx={{ width: { xs: '100%', sm: 'auto' }, minHeight: 42 }}
              >
                Add item
              </Button>
            )}
            {inventoryView === 'stock' && (
              <Button
                variant="contained"
                onClick={() => setMovementDialogOpen(true)}
                disabled={!canManageInventory || !branchId}
                sx={{ width: { xs: '100%', sm: 'auto' }, minHeight: 42 }}
              >
                Add stock / record usage
              </Button>
            )}
          </Stack>
        </Stack>
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        {successMessage && <Alert severity="success">{successMessage}</Alert>}
        {!canManageInventory && (
          <Alert severity="info">You have view access only. Ask a Super Admin for Inventory create or edit permission to record stock movements.</Alert>
        )}
        <FormControl fullWidth required>
          <InputLabel id="inventory-branch-label">Branch</InputLabel>
          <Select
            labelId="inventory-branch-label"
            label="Branch"
            value={branchId}
            onChange={(event) => {
              setBranchId(event.target.value)
              setInventoryPage(0)
            }}
          >
            {branches.map((branch) => (
              <MenuItem key={branch.id} value={branch.id}>{branch.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Tabs
          value={inventoryView}
          onChange={(_, value) => {
            setInventoryView(value)
            setInventoryPage(0)
            setIngredientSearch('')
            setHistorySearch('')
          }}
          variant="scrollable"
          allowScrollButtonsMobile
          aria-label="Inventory sections"
        >
          <Tab value="stock" label="Stock & closing updates" />
          <Tab value="settings" label="Stock settings" />
          <Tab value="history" label="Movement history" />
        </Tabs>
        {inventoryView === 'stock' && (
        <>
        {lowStockIngredients.length > 0 ? (
          <Alert severity="warning">
            <strong>{lowStockIngredients.length} item(s) reached their alert level:</strong>
            {' '}{lowStockIngredients.map((ingredient) => {
              const entry = stockByIngredient.get(ingredient.id)
              return `${ingredient.name}: ${entry?.quantity_on_hand ?? 0} ${ingredient.unit} left (alert at ${entry?.low_stock_threshold ?? 0})`
            }).join('; ')}.
          </Alert>
        ) : (
          <Alert severity="info">
            Add a quantity using “Add stock / record usage.” The alert level is separate: 105 pcs in stock with an alert level of 100 pcs means 5 pcs above the warning.
          </Alert>
        )}
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Stack spacing={2}>
            <Box sx={{ px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 3 } }}>
              <Typography variant="h6">Items and current stock</Typography>
              <Typography variant="body2" color="text.secondary">
                Add a stock quantity when you receive supplies; record closing usage to subtract what was used. The alert level only warns you; it does not change stock.
              </Typography>
              <TextField
                size="small"
                fullWidth
                placeholder="Search items…"
                value={ingredientSearch}
                onChange={(event) => {
                  setIngredientSearch(event.target.value)
                  setInventoryPage(0)
                }}
                aria-label="Search inventory items"
                sx={{ mt: 1.5 }}
              />
            </Box>
            {activeIngredients.length ? (
              <TableContainer>
                <Table size="small" aria-label="Detailed inventory and stock movement summary" sx={{ minWidth: 1280 }}>
                  <TableHead
                    sx={{
                      bgcolor: 'primary.main',
                      '& .MuiTableCell-root': {
                        backgroundColor: 'primary.main',
                        color: 'primary.contrastText',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                      },
                    }}
                  >
                    <TableRow>
                      <TableCell>Item No.</TableCell>
                      <TableCell>Item Name</TableCell>
                      <TableCell>Unit</TableCell>
                      <TableCell align="right">Total In</TableCell>
                      <TableCell>Last Delivery Date</TableCell>
                      <TableCell align="right">Total Out</TableCell>
                      <TableCell align="right">Current Qty Left</TableCell>
                      <TableCell align="right">Consumed This Week</TableCell>
                      <TableCell>Status</TableCell>
                      {isSuperAdmin && <TableCell align="right">Actions</TableCell>}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {paginatedIngredients.map((ingredient, index) => {
                      const entry = stockByIngredient.get(ingredient.id)
                      const threshold = Number(entry?.low_stock_threshold ?? 0)
                      const quantity = Number(entry?.quantity_on_hand ?? 0)
                      const isOut = quantity <= 0
                      const isLow = threshold > 0 && quantity <= threshold
                      const summary = (stockBranchId === branchId && movementSummaries.get(ingredient.id)) || {
                        totalIn: 0,
                        totalOut: 0,
                        consumedThisWeek: 0,
                        lastDeliveryAt: null,
                      }
                      return (
                        <TableRow key={ingredient.id} hover>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            {String(inventoryPage * inventoryPageSize + index + 1).padStart(3, '0')}
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{ingredient.name}</TableCell>
                          <TableCell>{ingredient.unit}</TableCell>
                          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                            {summary.totalIn.toLocaleString(undefined, { maximumFractionDigits: 4 })} {ingredient.unit}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            {summary.lastDeliveryAt
                              ? new Date(summary.lastDeliveryAt).toLocaleDateString()
                              : '—'}
                          </TableCell>
                          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                            {summary.totalOut.toLocaleString(undefined, { maximumFractionDigits: 4 })} {ingredient.unit}
                          </TableCell>
                          <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontWeight: 700 }}>
                            {quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} {ingredient.unit}
                          </TableCell>
                          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                            {summary.consumedThisWeek.toLocaleString(undefined, { maximumFractionDigits: 4 })} {ingredient.unit}
                          </TableCell>
                          <TableCell>
                            <Stack spacing={0.75}>
                              <Chip
                                size="small"
                                color={isOut ? 'error' : isLow ? 'warning' : 'success'}
                                label={isOut ? 'Out of stock' : isLow ? 'Restock soon' : 'In stock'}
                                sx={{ alignSelf: 'flex-start' }}
                              />
                              <Typography variant="caption" color="text.secondary">
                                {threshold > 0
                                  ? `Alert at ${threshold} ${ingredient.unit} or less`
                                  : 'Low-stock alert off'}
                              </Typography>
                            </Stack>
                          </TableCell>
                          {isSuperAdmin && (
                            <TableCell align="right">
                              <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                                <Button size="small" onClick={() => openIngredientEditor(ingredient)}>Edit</Button>
                                <Button size="small" color="warning" onClick={() => setIngredientToArchive(ingredient)}>Archive</Button>
                                <Button size="small" color="error" onClick={() => {
                                  setErrorMessage('')
                                  setIngredientToDelete(ingredient)
                                }}>Delete</Button>
                              </Stack>
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : <Typography color="text.secondary" sx={{ px: 3, pb: 2 }}>{activeIngredients.length === 0 ? 'No inventory items have been configured.' : 'No items match your search.'}</Typography>}
          </Stack>
        </Paper>
        {filteredIngredients.length > 0 && (
          <PaginationControls
            page={inventoryPage}
            pageSize={inventoryPageSize}
            totalItems={filteredIngredients.length}
            hasNextPage={(inventoryPage + 1) * inventoryPageSize < filteredIngredients.length}
            isLoading={stockBranchId !== branchId}
            onChange={(nextPage, nextPageSize) => {
              setInventoryPage(nextPage)
              setInventoryPageSize(nextPageSize)
            }}
          />
        )}
        {isSuperAdmin && ingredients.some((ingredient) => !ingredient.is_active) && (
          <Accordion variant="outlined">
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              sx={{
                bgcolor: 'action.hover',
                '&:hover': { bgcolor: 'action.selected' },
                '&.Mui-expanded': { minHeight: 56, borderBottom: 1, borderColor: 'divider' },
              }}
            >
              <Box>
                <Typography fontWeight={700}>Archived items ({ingredients.filter((ingredient) => !ingredient.is_active).length})</Typography>
                <Typography variant="body2" color="text.secondary">Click to restore or manage archived items</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  Archived items cannot be used for new stock updates. Their old stock and movement history are kept.
                </Typography>
                <TableContainer>
                  <Table size="small" aria-label="Archived inventory items">
                    <TableHead>
                      <TableRow>
                        <TableCell>Item</TableCell>
                        <TableCell>Stock in selected branch</TableCell>
                        <TableCell align="right">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {ingredients.filter((ingredient) => !ingredient.is_active).map((ingredient) => (
                        <TableRow key={ingredient.id}>
                          <TableCell>{ingredient.name} ({ingredient.unit})</TableCell>
                          <TableCell>
                            {branchId ? `${inventoryByIngredient.get(ingredient.id) ?? 0} ${ingredient.unit}` : '—'}
                          </TableCell>
                          <TableCell align="right">
                            <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                              <Button size="small" onClick={() => openIngredientEditor(ingredient)}>Edit</Button>
                              <Button size="small" onClick={() => void setIngredientActive(ingredient, true)} disabled={isSaving}>Restore</Button>
                              <Button size="small" color="error" onClick={() => {
                                setErrorMessage('')
                                setIngredientToDelete(ingredient)
                              }}>Delete</Button>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Stack>
            </AccordionDetails>
          </Accordion>
        )}
        </>
        )}
        {inventoryView === 'settings' && (
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Stack spacing={2}>
              <Box sx={{ px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 3 } }}>
                <Typography variant="h6">Low-stock alert settings</Typography>
                <Typography variant="body2" color="text.secondary">
                  Set a warning quantity for each item at this branch. The alert only warns you; it does not change stock.
                </Typography>
                <TextField
                  size="small"
                  fullWidth
                  placeholder="Search items…"
                  value={ingredientSearch}
                  onChange={(event) => {
                    setIngredientSearch(event.target.value)
                    setInventoryPage(0)
                  }}
                  aria-label="Search inventory items"
                  sx={{ mt: 1.5 }}
                />
              </Box>
              {filteredIngredients.length ? (
                <>
                  <TableContainer>
                    <Table size="small" aria-label="Branch inventory alert settings" sx={{ minWidth: 680 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Item</TableCell>
                        <TableCell>Unit</TableCell>
                        <TableCell align="right">Current Qty Left</TableCell>
                        <TableCell>Alert me at or below</TableCell>
                        <TableCell align="right">Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {paginatedIngredients.map((ingredient) => {
                        const entry = stockByIngredient.get(ingredient.id)
                        const threshold = Number(entry?.low_stock_threshold ?? 0)
                        const quantity = Number(entry?.quantity_on_hand ?? 0)
                        return (
                          <TableRow key={ingredient.id}>
                            <TableCell sx={{ fontWeight: 600 }}>{ingredient.name}</TableCell>
                            <TableCell>{ingredient.unit}</TableCell>
                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                              {quantity} {ingredient.unit}
                            </TableCell>
                            <TableCell>
                              <TextField
                                size="small"
                                type="number"
                                label={`Alert level (${ingredient.unit})`}
                                aria-label={`Alert level in ${ingredient.unit} for ${ingredient.name}`}
                                value={thresholdEdits[ingredient.id] ?? String(threshold)}
                                onChange={(event) => setThresholdEdits((current) => ({
                                  ...current,
                                  [ingredient.id]: event.target.value,
                                }))}
                                disabled={!branchId || stockBranchId !== branchId || !canEditInventory || isSaving}
                                slotProps={{ htmlInput: { min: '0', step: '0.0001' } }}
                                sx={{ width: { xs: '100%', sm: 180 } }}
                              />
                            </TableCell>
                            <TableCell align="right">
                              <Button
                                size="small"
                                onClick={() => void saveLowStockThreshold(ingredient)}
                                disabled={!branchId || stockBranchId !== branchId || !canEditInventory || isSaving}
                              >
                                Save alert
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                    </Table>
                  </TableContainer>
                  <Box sx={{ px: 2, pb: 2 }}>
                    <PaginationControls
                      page={inventoryPage}
                      pageSize={inventoryPageSize}
                      totalItems={filteredIngredients.length}
                      hasNextPage={(inventoryPage + 1) * inventoryPageSize < filteredIngredients.length}
                      isLoading={stockBranchId !== branchId}
                      onChange={(nextPage, nextPageSize) => {
                        setInventoryPage(nextPage)
                        setInventoryPageSize(nextPageSize)
                      }}
                    />
                  </Box>
                </>
              ) : (
                <Typography color="text.secondary" sx={{ px: 3, pb: 2 }}>
                  {activeIngredients.length === 0 ? 'No active inventory items have been configured.' : 'No items match your search.'}
                </Typography>
              )}
              {!canEditInventory && (
                <Alert severity="info" sx={{ mx: 2, mb: 2 }}>
                  You have view access only. Ask a Super Admin for Inventory edit permission to change low-stock alerts.
                </Alert>
              )}
            </Stack>
          </Paper>
        )}
        {isSuperAdmin && (
          <Dialog open={ingredientDialogOpen} onClose={() => !isSaving && setIngredientDialogOpen(false)} fullWidth maxWidth="sm">
            <Box component="form" onSubmit={addIngredient}>
              <DialogTitle>{editingIngredient ? 'Edit inventory item' : 'Add inventory item'}</DialogTitle>
              <DialogContent>
                <Stack spacing={2} sx={{ pt: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    This creates the item and its unit only. To enter how many you have, save it, then choose “Add stock / record usage” and enter a restock quantity for the selected branch.
                  </Typography>
                  <TextField label="Item name" value={ingredientName} onChange={(event) => setIngredientName(event.target.value)} required slotProps={{ htmlInput: { maxLength: 120 } }} autoFocus />
                  <TextField
                    label="Unit (pcs, pack, g, ml, etc.)"
                    value={ingredientUnit}
                    onChange={(event) => setIngredientUnit(event.target.value)}
                    helperText={editingIngredient
                      ? 'You can rename this item anytime. Its unit can only change before it is used in stock or movement history.'
                      : 'Use one consistent unit for restocks and closing usage.'}
                    required
                    slotProps={{ htmlInput: { maxLength: 24 } }}
                  />
                </Stack>
              </DialogContent>
              <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button onClick={() => {
                  setIngredientDialogOpen(false)
                  setEditingIngredient(null)
                }} disabled={isSaving}>Cancel</Button>
                <Button type="submit" variant="contained" disabled={isSaving}>
                  {editingIngredient ? 'Save changes' : 'Add item'}
                </Button>
              </DialogActions>
            </Box>
          </Dialog>
        )}
        <Dialog
          open={Boolean(ingredientToArchive)}
          onClose={() => !isSaving && setIngredientToArchive(null)}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle>Archive inventory item?</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary">
              {ingredientToArchive?.name} will be hidden from new stock updates. Existing stock and movement history will be preserved. You can restore it later.
            </Typography>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setIngredientToArchive(null)} disabled={isSaving}>Keep item</Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => ingredientToArchive && void setIngredientActive(ingredientToArchive, false)}
              disabled={isSaving}
            >
              Archive item
            </Button>
          </DialogActions>
        </Dialog>
        <DeleteConfirmationDialog
          open={Boolean(ingredientToDelete)}
          title="Delete inventory item and its records?"
          itemName={ingredientToDelete?.name}
          itemType="inventory item"
          detail="Items with stock movement history or remaining stock are protected so financial and inventory records stay intact. For those items, use Archive instead."
          warning="If no history or stock remains, this also removes saved recipe links and zero-stock rows. Permanent deletion cannot be undone."
          errorMessage={errorMessage}
          isDeleting={isSaving}
          onCancel={() => setIngredientToDelete(null)}
          onConfirm={() => void deleteIngredientWithHistory()}
        />
        <Dialog
          open={unitChangeConfirmationOpen}
          onClose={() => !isSaving && setUnitChangeConfirmationOpen(false)}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>Change this item’s unit?</DialogTitle>
          <DialogContent>
            <Stack spacing={1}>
              <Typography variant="body2">
                {editingIngredient?.name}: {editingIngredient?.unit} → {ingredientUnit.trim()}
              </Typography>
              <Alert severity="warning">
                This changes the unit label only. Existing stock amounts and movement quantities will stay exactly the same and will now be shown using the new unit. No conversion will happen.
              </Alert>
              <Typography variant="body2" color="text.secondary">
                Continue only if the existing numbers are already correct for the new unit.
              </Typography>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setUnitChangeConfirmationOpen(false)} disabled={isSaving}>Go back</Button>
            <Button
              color="warning"
              variant="contained"
              onClick={() => void addIngredient(null, true)}
              disabled={isSaving || !ingredientUnit.trim() || ingredientUnit.trim() === editingIngredient?.unit}
            >
              {isSaving ? 'Saving…' : 'Change unit label'}
            </Button>
          </DialogActions>
        </Dialog>
        <Dialog open={movementDialogOpen} onClose={() => !isSaving && setMovementDialogOpen(false)} fullWidth maxWidth="sm">
          <Box component="form" onSubmit={addMovement}>
            <DialogTitle>Add stock or record usage</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  Branch: {branches.find((branch) => branch.id === branchId)?.name || 'Select a branch'}
                </Typography>
                <FormControl fullWidth required>
                  <InputLabel id="movement-ingredient-label">Inventory item</InputLabel>
                  <Select
                    labelId="movement-ingredient-label"
                    label="Inventory item"
                    value={movementIngredientId}
                    onChange={(event) => setMovementIngredientId(event.target.value)}
                  >
                    {ingredients.filter((ingredient) => ingredient.is_active).map((ingredient) => (
                      <MenuItem key={ingredient.id} value={ingredient.id}>{ingredient.name} ({ingredient.unit})</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl fullWidth>
                  <InputLabel id="movement-type-label">What are you recording?</InputLabel>
                  <Select
                    labelId="movement-type-label"
                    label="What are you recording?"
                    value={movementType}
                    onChange={(event) => {
                      setMovementType(event.target.value)
                      setUnitCost('')
                    }}
                  >
                    <MenuItem value="receipt">Add a restock (increases quantity)</MenuItem>
                    <MenuItem value="manual_usage">Record closing usage (subtracts quantity)</MenuItem>
                    <MenuItem value="waste">Record waste</MenuItem>
                    <MenuItem value="adjustment">Adjustment (increase)</MenuItem>
                  </Select>
                </FormControl>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    fullWidth
                    label="Quantity"
                    type="number"
                    value={movementQuantity}
                    onChange={(event) => setMovementQuantity(event.target.value)}
                    helperText={`${movementType === 'receipt' ? 'This amount will be added to' : 'This amount will be subtracted from'} ${ingredients.find((ingredient) => ingredient.id === movementIngredientId)?.name || 'the selected item'} stock (${ingredients.find((ingredient) => ingredient.id === movementIngredientId)?.unit || 'unit'}).`}
                    slotProps={{ htmlInput: { min: '0.0001', step: '0.0001' } }}
                    required
                  />
                  <TextField
                    fullWidth
                    label={movementType === 'receipt' ? 'Total purchase cost' : 'Total purchase cost (receipts only)'}
                    type="number"
                    value={unitCost}
                    onChange={(event) => setUnitCost(event.target.value)}
                    helperText={movementType === 'receipt'
                      ? 'Enter the full amount paid for this restock. The system calculates cost per unit.'
                      : 'Only a restock requires a purchase cost.'}
                    required={movementType === 'receipt'}
                    disabled={movementType !== 'receipt'}
                    slotProps={{ htmlInput: { min: '0', step: '0.01' } }}
                  />
                </Stack>
                <TextField
                  label={movementType === 'manual_usage' ? 'Closing note (optional)' : 'Note (optional)'}
                  value={movementNote}
                  onChange={(event) => setMovementNote(event.target.value)}
                  slotProps={{ htmlInput: { maxLength: 500 } }}
                />
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button onClick={() => setMovementDialogOpen(false)} disabled={isSaving}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={!canManageInventory || !branchId || !movementIngredientId || isSaving}>
                {movementType === 'manual_usage' ? 'Record closing usage' : 'Record movement'}
              </Button>
            </DialogActions>
          </Box>
        </Dialog>
        {inventoryView === 'history' && <Accordion variant="outlined" defaultExpanded>
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            sx={{
              bgcolor: 'action.hover',
              '&:hover': { bgcolor: 'action.selected' },
              '&.Mui-expanded': { minHeight: 56, borderBottom: 1, borderColor: 'divider' },
            }}
          >
            <Box>
              <Typography variant="h6">Stock history</Typography>
              <Typography variant="body2" color="text.secondary">Click to view recent stock changes</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1.5}>
              <TextField
                size="small"
                fullWidth
                placeholder="Search by item name or movement type…"
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                aria-label="Search movement history"
              />
              {filteredMovements.length ? (
                <TableContainer>
                  <Table size="small" aria-label="Recent inventory stock history">
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Item</TableCell>
                        <TableCell>Movement</TableCell>
                        <TableCell align="right">Quantity</TableCell>
                        <TableCell align="right">Unit cost</TableCell>
                        <TableCell align="right">Total cost</TableCell>
                        <TableCell>Note</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredMovements.map((movement) => {
                        const ingredient = ingredients.find((entry) => entry.id === movement.ingredient_id)
                        return (
                          <TableRow key={movement.id}>
                            <TableCell>{new Date(movement.created_at).toLocaleString()}</TableCell>
                            <TableCell>{ingredient?.name || 'Inventory item'}</TableCell>
                            <TableCell>{movement.movement_type.replaceAll('_', ' ')}</TableCell>
                            <TableCell align="right">{movement.quantity_delta} {ingredient?.unit || ''}</TableCell>
                            <TableCell align="right">{movement.unit_cost == null ? '—' : formatPrice(movement.unit_cost)}</TableCell>
                            <TableCell align="right">
                              {movement.unit_cost == null
                                ? '—'
                                : formatPrice(Math.abs(Number(movement.quantity_delta)) * Number(movement.unit_cost))}
                            </TableCell>
                            <TableCell>{movement.note || '—'}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography color="text.secondary">
                  {movements.length === 0 ? 'No inventory movements recorded for this branch.' : 'No movements match your search.'}
                </Typography>
              )}
            </Stack>
          </AccordionDetails>
        </Accordion>}
      </Stack>
    </Container>
  )
}

export default AdminInventoryPage
