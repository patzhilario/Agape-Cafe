import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
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
  TextField,
  Typography,
} from '@mui/material'
import { getSupabaseClient } from '../../lib/supabaseClient.js'
import { useAuth } from './useAuth.js'
import PaginationControls from '../../components/PaginationControls.jsx'

const DEFAULT_ACCOUNT_PAGE_SIZE = 10

const roles = [
  { value: 'customer', label: 'Customer' },
  { value: 'staff', label: 'Staff' },
  { value: 'admin', label: 'Admin' },
]

function unwrap(result) {
  if (result.error) throw new Error(result.error.message)
  return result.data
}

export default function AccessManagementPage() {
  const { account } = useAuth()
  const [users, setUsers] = useState([])
  const [branches, setBranches] = useState([])
  const [permissions, setPermissions] = useState([])
  const [userRoles, setUserRoles] = useState([])
  const [userPermissions, setUserPermissions] = useState([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedRole, setSelectedRole] = useState('customer')
  const [selectedPermissions, setSelectedPermissions] = useState([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState('customer')
  const [invitePermissions, setInvitePermissions] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isInviting, setIsInviting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [accessDialogOpen, setAccessDialogOpen] = useState(false)
  const [accountToDelete, setAccountToDelete] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [accountPage, setAccountPage] = useState(0)
  const [accountPageSize, setAccountPageSize] = useState(DEFAULT_ACCOUNT_PAGE_SIZE)
  const [accountSearch, setAccountSearch] = useState('')
  const [accountRoleFilter, setAccountRoleFilter] = useState('')
  const selectedUserIdRef = useRef(selectedUserId)

  useEffect(() => {
    selectedUserIdRef.current = selectedUserId
  }, [selectedUserId])

  const loadAccessData = useCallback(async (isCurrent = () => true) => {
    try {
      const supabase = getSupabaseClient()
      const results = await Promise.all([
        supabase
          .from('profiles')
          .select('id, email, display_name, is_active')
          .order('display_name'),
        supabase.rpc('get_store_branch'),
        supabase.from('permissions').select('id, module_id, action').order('module_id'),
        supabase.from('user_roles').select('user_id, role'),
        supabase.from('user_permissions').select('user_id, branch_id, permission_id'),
      ])

      const [
        loadedUsers,
        loadedBranches,
        loadedPermissions,
        loadedRoles,
        loadedUserPermissions,
      ] = results.map(unwrap)

      if (!isCurrent()) return
      setUsers(loadedUsers)
      setBranches(loadedBranches)
      setPermissions(loadedPermissions)
      setUserRoles(loadedRoles)
      setUserPermissions(loadedUserPermissions)

      if (!selectedUserIdRef.current && loadedUsers.length) {
        const firstUserId = loadedUsers[0].id
        setSelectedUserId(firstUserId)
        setSelectedRole(
          loadedRoles.find((userRole) => userRole.user_id === firstUserId)?.role || 'customer',
        )
        setSelectedPermissions(
          [
            ...new Set(
              loadedUserPermissions
                .filter((permission) => permission.user_id === firstUserId)
                .map((permission) => permission.permission_id),
            ),
          ],
        )
      }
      return true
    } catch (error) {
      console.error('Unable to load account management data.', error)
      if (isCurrent()) {
        setErrorMessage(
          'Access settings could not be loaded. Confirm the Phase 1 and Phase 2 migrations are applied.',
        )
      }
      return false
    } finally {
      if (isCurrent()) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => loadAccessData(() => active))
    return () => {
      active = false
    }
  }, [loadAccessData])

  const selectedUser = users.find((user) => user.id === selectedUserId)
  const filteredUsers = useMemo(() => {
    const query = accountSearch.trim().toLowerCase()
    return users.filter((user) => {
      const role = userRoles.find((userRole) => userRole.user_id === user.id)?.role || 'customer'
      const matchesSearch =
        !query ||
        user.display_name?.toLowerCase().includes(query) ||
        user.email?.toLowerCase().includes(query)
      return matchesSearch && (!accountRoleFilter || role === accountRoleFilter)
    })
  }, [accountRoleFilter, accountSearch, userRoles, users])
  const visibleAccountPage = Math.min(
    accountPage,
    Math.max(0, Math.ceil(filteredUsers.length / accountPageSize) - 1),
  )
  const pageUsers = filteredUsers.slice(
    visibleAccountPage * accountPageSize,
    (visibleAccountPage + 1) * accountPageSize,
  )
  const currentRoles = userRoles
    .filter((userRole) => userRole.user_id === selectedUserId)
    .map((userRole) => userRole.role)
  const currentPermissionIds = [
    ...new Set(
      userPermissions
        .filter((permission) => permission.user_id === selectedUserId)
        .map((permission) => permission.permission_id),
    ),
  ]
  const permissionGroups = useMemo(
    () =>
      permissions.reduce((groups, permission) => {
        groups[permission.module_id] = [...(groups[permission.module_id] || []), permission]
        return groups
      }, {
        pos: permissions.filter((permission) =>
          (permission.module_id === 'orders' && ['view', 'create', 'edit'].includes(permission.action)) ||
          (permission.module_id === 'promotions' && permission.action === 'approve'),
        ),
      }),
    [permissions],
  )
  const allPermissionIds = permissions.map((permission) => permission.id)
  const inviteNeedsBranchAccess = inviteRole === 'staff'
  const allPermissionsSelected =
    allPermissionIds.length > 0 &&
    allPermissionIds.every((permissionId) => selectedPermissions.includes(permissionId))
  const somePermissionsSelected = selectedPermissions.some((permissionId) =>
    allPermissionIds.includes(permissionId),
  )
  const allInvitePermissionsSelected =
    allPermissionIds.length > 0 &&
    allPermissionIds.every((permissionId) => invitePermissions.includes(permissionId))
  const someInvitePermissionsSelected = invitePermissions.some((permissionId) =>
    allPermissionIds.includes(permissionId),
  )
  const needsBranchAccess = selectedRole === 'staff'

  function toggleSelection(value, selected, setSelected) {
    setSelected(
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    )
  }

  async function saveAccess() {
    if (!selectedUserId || !selectedUser) return
    if (selectedUserId === account.id) {
      setErrorMessage('For safety, Admins cannot change their own access.')
      return
    }
    if (needsBranchAccess && !branches.length) {
      setErrorMessage('Store details are unavailable. Please refresh and try again.')
      return
    }

    setIsSaving(true)
    setIsLoading(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('admin_set_staff_access', {
        target_user_id: selectedUserId,
        new_role: selectedRole,
        branch_ids: needsBranchAccess ? branches.map((store) => store.id) : [],
        permission_ids: needsBranchAccess ? selectedPermissions : [],
      })
      if (error) throw error
      const refreshed = await loadAccessData()
      setSuccessMessage(
        refreshed
          ? `Access settings saved for ${selectedUser.email || 'the selected account'}.`
          : 'Access was saved, but the account list could not refresh. Reload this page to confirm the current settings.',
      )
      setAccessDialogOpen(false)
    } catch (error) {
      console.error('Unable to save account access settings.', error)
      setIsLoading(false)
      setErrorMessage(
        error.message === 'You cannot change your own account access.'
          ? error.message
          : 'Access settings could not be saved. Check that you are an Admin and review the selected permissions.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function inviteUser() {
    if (!inviteEmail.trim() || !inviteName.trim()) {
      setErrorMessage('Enter the user’s name and email address.')
      return
    }
    if (inviteNeedsBranchAccess && !branches.length) {
      setErrorMessage('Store details are unavailable. Please refresh and try again.')
      return
    }

    setIsInviting(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('admin_invite_user_access', {
        target_email: inviteEmail.trim(),
        target_display_name: inviteName.trim(),
        new_role: inviteRole,
        branch_ids: inviteNeedsBranchAccess ? branches.map((store) => store.id) : [],
        permission_ids: inviteNeedsBranchAccess ? invitePermissions : [],
      })
      if (error) throw error

      const refreshed = await loadAccessData()
      const actionMessage =
        data === 'updated'
          ? `Access updated for ${inviteEmail.trim()}.`
          : `Access saved for ${inviteEmail.trim()}. The selected role will apply when they create and verify an account with that email.`
      setSuccessMessage(
        refreshed
          ? actionMessage
          : `${actionMessage} The account list could not refresh; reload this page to confirm.`,
      )
      setInviteEmail('')
      setInviteName('')
      setInvitePermissions([])
      setInviteDialogOpen(false)
    } catch (error) {
      console.error('Unable to add account access by email.', error)
      setErrorMessage(
        error.message ||
          'The account could not be added. Confirm that you are an Admin, the email is valid, and permissions are configured correctly.',
      )
    } finally {
      setIsInviting(false)
    }
  }

  async function deleteAccount() {
    if (!accountToDelete || accountToDelete.id === account.id) return

    setIsDeleting(true)
    setIsLoading(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const { error } = await getSupabaseClient().rpc('admin_delete_user_account', {
        target_user_id: accountToDelete.id,
      })
      if (error) throw error

      const deletedEmail = accountToDelete.email
      if (selectedUserId === accountToDelete.id) {
        selectedUserIdRef.current = ''
        setSelectedUserId('')
      }
      setAccountToDelete(null)
      const refreshed = await loadAccessData()
      setSuccessMessage(
        refreshed
          ? `Account ${deletedEmail || ''} deleted.`
          : `Account ${deletedEmail || ''} was deleted, but the account list could not refresh. Reload this page to confirm.`,
      )
    } catch (error) {
      console.error('Unable to delete account.', error)
      setIsLoading(false)
      setAccountToDelete(null)
      setErrorMessage(
        error.message ||
          'The account could not be deleted. Confirm that you are an Admin and that the account has no retained business records.',
      )
    } finally {
      setIsDeleting(false)
    }
  }

  if (isLoading) {
    return (
      <Stack sx={{ alignItems: 'center', py: 10 }} spacing={2}>
        <CircularProgress />
        <Typography color="text.secondary">Loading account access…</Typography>
      </Stack>
    )
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="primary">
            Agapé Café · Admin
          </Typography>
          <Typography variant="h2">Account Management</Typography>
          <Typography color="text.secondary">
            Manage accounts, assign roles and
            module actions. Changes are applied atomically and written to the audit trail.
          </Typography>
        </Box>
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        {successMessage && <Alert severity="success">{successMessage}</Alert>}
        <Button variant="contained" sx={{ alignSelf: 'flex-start' }} onClick={() => setInviteDialogOpen(true)}>
          Add account
        </Button>
        <Dialog open={inviteDialogOpen} onClose={() => !isInviting && setInviteDialogOpen(false)} fullWidth maxWidth="md">
          <DialogTitle>Add account by email</DialogTitle>
          <DialogContent dividers>
          <Stack spacing={2.5}>
            <Box>
              <Typography color="text.secondary">
                Existing accounts are updated immediately. New accounts receive this role at sign-up with the invited email.
              </Typography>
            </Box>
            <TextField
              required
              fullWidth
              label="Full name"
              value={inviteName}
              onChange={(event) => setInviteName(event.target.value)}
              inputProps={{ maxLength: 120 }}
            />
            <TextField
              required
              fullWidth
              type="email"
              label="Email address"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
            />
            <FormControl fullWidth>
              <InputLabel id="invite-role-label">Role</InputLabel>
              <Select
                labelId="invite-role-label"
                label="Role"
                value={inviteRole}
                onChange={(event) => {
                  const role = event.target.value
                  setInviteRole(role)
                  if (role !== 'staff') {
                    setInvitePermissions([])
                  }
                }}
              >
                {roles.map((role) => (
                  <MenuItem key={role.value} value={role.value}>
                    {role.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {inviteNeedsBranchAccess && (
              <>

                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="h6">Module permissions</Typography>
                  <FormControlLabel
                    sx={{ ml: 0 }}
                    control={
                      <Checkbox
                        checked={allInvitePermissionsSelected}
                        indeterminate={
                          !allInvitePermissionsSelected && someInvitePermissionsSelected
                        }
                        disabled={!allPermissionIds.length}
                        onChange={(event) =>
                          setInvitePermissions(
                            event.target.checked ? allPermissionIds : [],
                          )
                        }
                      />
                    }
                    label="Select all module permissions"
                  />
                  <Typography color="text.secondary" sx={{ mb: 2 }}>
                    Selected actions apply to the store.
                  </Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: '1fr',
                        md: 'repeat(2, minmax(0, 1fr))',
                      },
                      gap: 1.5,
                    }}
                  >
                    {Object.entries(permissionGroups).map(([module, modulePermissions]) => (
                      <Paper key={module} variant="outlined" sx={{ p: 1.5 }}>
                        <Typography fontWeight={700} sx={{ textTransform: 'capitalize' }}>
                          {module === 'pos' ? 'POS' : module.replaceAll('_', ' ')}
                        </Typography>
                        {module === 'pos' && (
                          <Typography variant="caption" color="text.secondary">
                            Approve allows PWD / Senior Citizen discounts (shared with Promotions).
                          </Typography>
                        )}
                        <FormGroup row>
                          {modulePermissions.map((permission) => (
                            <FormControlLabel
                              key={permission.id}
                              control={
                                <Checkbox
                                  size="small"
                                  checked={invitePermissions.includes(permission.id)}
                                  onChange={() =>
                                    toggleSelection(
                                      permission.id,
                                      invitePermissions,
                                      setInvitePermissions,
                                    )
                                  }
                                />
                              }
                              label={permission.action}
                            />
                          ))}
                        </FormGroup>
                      </Paper>
                    ))}
                  </Box>
                </Paper>
              </>
            )}
          </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button onClick={() => setInviteDialogOpen(false)} disabled={isInviting}>Cancel</Button>
            <Button
              variant="contained"
              onClick={inviteUser}
              disabled={isInviting}
              startIcon={isInviting ? <CircularProgress size={18} color="inherit" /> : null}
            >
              {isInviting ? 'Saving…' : 'Add account'}
            </Button>
          </DialogActions>
        </Dialog>
        {!users.length ? (
          <Alert severity="info">
            No accounts have registered yet. You can preassign their access above.
          </Alert>
        ) : (
          <>
            <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1.5}
                useFlexGap
                sx={{ alignItems: { md: 'center' }, flexWrap: 'wrap' }}
              >
                <TextField
                  fullWidth
                  size="small"
                  label="Search by name or email"
                  value={accountSearch}
                  onChange={(event) => {
                    setAccountSearch(event.target.value)
                    setAccountPage(0)
                  }}
                  sx={{ flex: '1 1 280px' }}
                />
                <FormControl size="small" sx={{ width: { xs: '100%', md: 220 }, flexShrink: 0 }}>
                  <InputLabel id="account-role-filter-label">Filter by role</InputLabel>
                  <Select
                    labelId="account-role-filter-label"
                    label="Filter by role"
                    value={accountRoleFilter}
                    onChange={(event) => {
                      setAccountRoleFilter(event.target.value)
                      setAccountPage(0)
                    }}
                  >
                    <MenuItem value="">All roles</MenuItem>
                    {roles.map((role) => (
                      <MenuItem key={role.value} value={role.value}>{role.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
            </Paper>
            {filteredUsers.length ? (
              <>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small" aria-label="Accounts and access" sx={{ minWidth: 850 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Name</TableCell>
                        <TableCell>Email</TableCell>
                        <TableCell>Role</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell align="right">Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {pageUsers.map((user) => {
                        const role = userRoles.find((userRole) => userRole.user_id === user.id)?.role || 'customer'
                        return (
                          <TableRow key={user.id} hover>
                            <TableCell sx={{ fontWeight: 700 }}>{user.display_name || '—'}</TableCell>
                            <TableCell>{user.email || '—'}</TableCell>
                            <TableCell>{roles.find((item) => item.value === role)?.label || role}</TableCell>
                            <TableCell>{user.is_active ? 'Active' : 'Deactivated'}</TableCell>
                            <TableCell align="right">
                              <Stack direction="row" spacing={1} justifyContent="flex-end">
                                <Button
                                  size="small"
                                  variant="outlined"
                                  disabled={user.id === account.id}
                                  onClick={() => {
                                    setSelectedUserId(user.id)
                                    setSelectedRole(role)
                                    setSelectedPermissions([...new Set(userPermissions
                                      .filter((permission) => permission.user_id === user.id)
                                      .map((permission) => permission.permission_id))])
                                    setErrorMessage('')
                                    setSuccessMessage('')
                                    setAccessDialogOpen(true)
                                  }}
                                >
                                  Edit access
                                </Button>
                                <Button
                                  size="small"
                                  color="error"
                                  disabled={user.id === account.id}
                                  onClick={() => {
                                    setAccountToDelete(user)
                                    setErrorMessage('')
                                    setSuccessMessage('')
                                  }}
                                >
                                  Delete
                                </Button>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
                <PaginationControls
                  page={visibleAccountPage}
                  pageSize={accountPageSize}
                  totalItems={filteredUsers.length}
                  hasNextPage={(visibleAccountPage + 1) * accountPageSize < filteredUsers.length}
                  isLoading={isLoading}
                  onChange={(nextPage, nextPageSize) => {
                    setAccountPage(nextPage)
                    setAccountPageSize(nextPageSize)
                  }}
                />
              </>
            ) : (
              <Alert severity="info">No accounts match these filters.</Alert>
            )}
            <Dialog open={accessDialogOpen} onClose={() => !isSaving && setAccessDialogOpen(false)} fullWidth maxWidth="md">
              <DialogTitle>Edit account access{selectedUser?.email ? ` · ${selectedUser.email}` : ''}</DialogTitle>
              <DialogContent dividers>
                <Stack spacing={2.5} sx={{ pt: 1 }}>
            {selectedUserId === account.id && (
              <Alert severity="info">
                Your own Admin access is protected from changes here.
              </Alert>
            )}
            <FormControl fullWidth>
              <InputLabel id="access-role-label">Role</InputLabel>
              <Select
                labelId="access-role-label"
                label="Role"
                value={selectedRole}
                onChange={(event) => setSelectedRole(event.target.value)}
              >
                {roles.map((role) => (
                  <MenuItem key={role.value} value={role.value}>
                    {role.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {needsBranchAccess && (
              <>

                <Paper variant="outlined" sx={{ p: 2.5 }}>
                  <Typography variant="h6">Module permissions</Typography>
                  <FormControlLabel
                    sx={{ ml: 0 }}
                    control={
                      <Checkbox
                        checked={allPermissionsSelected}
                        indeterminate={!allPermissionsSelected && somePermissionsSelected}
                        disabled={!allPermissionIds.length}
                        onChange={(event) =>
                          setSelectedPermissions(event.target.checked ? allPermissionIds : [])
                        }
                      />
                    }
                    label="Select all module permissions"
                  />
                  <Typography color="text.secondary" sx={{ mb: 2 }}>
                    These actions apply to the store. A module is
                    not available unless View is granted.
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
                    {Object.entries(permissionGroups).map(([module, modulePermissions]) => (
                      <Paper key={module} variant="outlined" sx={{ p: 1.5 }}>
                        <Typography fontWeight={700} sx={{ textTransform: 'capitalize' }}>
                          {module === 'pos' ? 'POS' : module.replaceAll('_', ' ')}
                        </Typography>
                        {module === 'pos' && (
                          <Typography variant="caption" color="text.secondary">
                            Approve allows PWD / Senior Citizen discounts (shared with Promotions).
                          </Typography>
                        )}
                        <FormGroup row>
                          {modulePermissions.map((permission) => (
                            <FormControlLabel
                              key={permission.id}
                              control={
                                <Checkbox
                                  size="small"
                                  checked={selectedPermissions.includes(permission.id)}
                                  onChange={() =>
                                    toggleSelection(
                                      permission.id,
                                      selectedPermissions,
                                      setSelectedPermissions,
                                    )
                                  }
                                />
                              }
                              label={permission.action}
                            />
                          ))}
                        </FormGroup>
                      </Paper>
                    ))}
                  </Box>
                </Paper>
              </>
            )}
            {!needsBranchAccess && (
              <Alert severity="info">
                {selectedRole === 'admin'
                  ? 'Admins can access all modules. Only another Admin can assign this role.'
                  : 'Customer accounts do not receive administrative module permissions.'}
              </Alert>
            )}
            {selectedUserId && (
              <Typography variant="body2" color="text.secondary">
                Current access: {currentRoles.map((role) => roles.find((item) => item.value === role)?.label || role).join(', ') || 'No role'}
                {currentPermissionIds.length
                  ? ` · ${currentPermissionIds.length} module permission(s)`
                  : ''}
              </Typography>
            )}
                </Stack>
              </DialogContent>
              <DialogActions sx={{ px: 3, py: 2 }}>
                <Button onClick={() => setAccessDialogOpen(false)} disabled={isSaving}>Cancel</Button>
                {selectedUserId !== account.id && (
                  <Button
                    variant="contained"
                    onClick={saveAccess}
                    disabled={isSaving || !selectedUserId}
                    startIcon={isSaving ? <CircularProgress size={18} color="inherit" /> : null}
                  >
                    Save account access
                  </Button>
                )}
              </DialogActions>
            </Dialog>
            <Dialog
              open={Boolean(accountToDelete)}
              onClose={() => !isDeleting && setAccountToDelete(null)}
              fullWidth
              maxWidth="xs"
            >
              <DialogTitle>Delete account?</DialogTitle>
              <DialogContent>
                <Typography>
                  Permanently delete {accountToDelete?.email || 'this account'}? This cannot be undone.
                  Existing orders and financial records will remain, but will no longer be linked to
                  this account.
                </Typography>
              </DialogContent>
              <DialogActions sx={{ px: 3, py: 2 }}>
                <Button onClick={() => setAccountToDelete(null)} disabled={isDeleting}>
                  Cancel
                </Button>
                <Button
                  color="error"
                  variant="contained"
                  onClick={deleteAccount}
                  disabled={isDeleting || !accountToDelete}
                  startIcon={isDeleting ? <CircularProgress size={18} color="inherit" /> : null}
                >
                  {isDeleting ? 'Deleting…' : 'Delete account'}
                </Button>
              </DialogActions>
            </Dialog>
          </>
        )}
      </Stack>
    </Container>
  )
}
