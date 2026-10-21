import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Container,
  FormControl,
  FormControlLabel,
  FormGroup,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { getSupabaseClient } from '../../lib/supabaseClient.js'
import { useAuth } from './useAuth.js'

const roles = [
  { value: 'customer', label: 'Customer' },
  { value: 'staff', label: 'Staff' },
  { value: 'branch_admin', label: 'Branch admin' },
  { value: 'super_admin', label: 'Super Admin' },
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
  const [assignments, setAssignments] = useState([])
  const [userPermissions, setUserPermissions] = useState([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedRole, setSelectedRole] = useState('customer')
  const [selectedBranches, setSelectedBranches] = useState([])
  const [selectedPermissions, setSelectedPermissions] = useState([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState('customer')
  const [inviteBranches, setInviteBranches] = useState([])
  const [invitePermissions, setInvitePermissions] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isInviting, setIsInviting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
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
        supabase.from('branches').select('id, name, is_active').order('name'),
        supabase.from('permissions').select('id, module_id, action').order('module_id'),
        supabase.from('user_roles').select('user_id, role'),
        supabase.from('user_branch_assignments').select('user_id, branch_id'),
        supabase.from('user_permissions').select('user_id, branch_id, permission_id'),
      ])

      const [
        loadedUsers,
        loadedBranches,
        loadedPermissions,
        loadedRoles,
        loadedAssignments,
        loadedUserPermissions,
      ] = results.map(unwrap)

      if (!isCurrent()) return
      setUsers(loadedUsers)
      setBranches(loadedBranches)
      setPermissions(loadedPermissions)
      setUserRoles(loadedRoles)
      setAssignments(loadedAssignments)
      setUserPermissions(loadedUserPermissions)

      if (!selectedUserIdRef.current && loadedUsers.length) {
        const firstUserId = loadedUsers[0].id
        setSelectedUserId(firstUserId)
        setSelectedRole(
          loadedRoles.find((userRole) => userRole.user_id === firstUserId)?.role || 'customer',
        )
        setSelectedBranches(
          loadedAssignments
            .filter((assignment) => assignment.user_id === firstUserId)
            .map((assignment) => assignment.branch_id),
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
      console.error('Unable to load staff access settings.', error)
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
  const currentRoles = userRoles
    .filter((userRole) => userRole.user_id === selectedUserId)
    .map((userRole) => userRole.role)
  const currentBranches = assignments
    .filter((assignment) => assignment.user_id === selectedUserId)
    .map((assignment) => assignment.branch_id)
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
      }, {}),
    [permissions],
  )
  const allPermissionIds = permissions.map((permission) => permission.id)
  const inviteNeedsBranchAccess = inviteRole === 'staff' || inviteRole === 'branch_admin'
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
  const needsBranchAccess = selectedRole === 'staff' || selectedRole === 'branch_admin'

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
      setErrorMessage('For safety, Super Admins cannot change their own access.')
      return
    }
    if (needsBranchAccess && selectedBranches.length === 0) {
      setErrorMessage('Assign at least one branch to this staff account.')
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
        branch_ids: needsBranchAccess ? selectedBranches : [],
        permission_ids: needsBranchAccess ? selectedPermissions : [],
      })
      if (error) throw error
      const refreshed = await loadAccessData()
      setSuccessMessage(
        refreshed
          ? `Access settings saved for ${selectedUser.email || 'the selected account'}.`
          : 'Access was saved, but the account list could not refresh. Reload this page to confirm the current settings.',
      )
    } catch (error) {
      console.error('Unable to save staff access settings.', error)
      setIsLoading(false)
      setErrorMessage(
        error.message === 'You cannot change your own account access.'
          ? error.message
          : 'Access settings could not be saved. Check that you are a Super Admin and review the selected branches and permissions.',
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
    if (inviteNeedsBranchAccess && inviteBranches.length === 0) {
      setErrorMessage('Assign at least one branch to this staff account.')
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
        branch_ids: inviteNeedsBranchAccess ? inviteBranches : [],
        permission_ids: inviteNeedsBranchAccess ? invitePermissions : [],
      })
      if (error) throw error

      const refreshed = await loadAccessData()
      const actionMessage =
        data === 'updated'
          ? `Access updated for ${inviteEmail.trim()}.`
          : `Access saved for ${inviteEmail.trim()}. The selected role will apply when they first sign in with that Google email.`
      setSuccessMessage(
        refreshed
          ? actionMessage
          : `${actionMessage} The account list could not refresh; reload this page to confirm.`,
      )
      setInviteEmail('')
      setInviteName('')
      setInviteBranches([])
      setInvitePermissions([])
    } catch (error) {
      console.error('Unable to add account access by email.', error)
      setErrorMessage(
        error.message ||
          'The account could not be added. Confirm that you are a Super Admin, the email is valid, and branch access is configured correctly.',
      )
    } finally {
      setIsInviting(false)
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
            Agapé Café · Super Admin
          </Typography>
          <Typography variant="h2">Account access</Typography>
          <Typography color="text.secondary">
            Assign a role, branch scope, and module actions. Changes are
            applied atomically and written to the audit trail.
          </Typography>
        </Box>
        <Alert severity="info">
          Add an email below to assign access before the user signs in. Existing
          accounts are updated immediately; new accounts receive the selected
          role on their first Google sign-in with that email.
        </Alert>
        {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        {successMessage && <Alert severity="success">{successMessage}</Alert>}
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2.5}>
            <Box>
              <Typography variant="h5">Add account by email</Typography>
              <Typography color="text.secondary">
                The name and role will be assigned to this exact email address.
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
                  if (role !== 'staff' && role !== 'branch_admin') {
                    setInviteBranches([])
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
                  <Typography variant="h6" gutterBottom>
                    Branch assignments
                  </Typography>
                  {!branches.length ? (
                    <Typography color="text.secondary">
                      Create a branch before assigning staff.
                    </Typography>
                  ) : (
                    <FormGroup>
                      {branches.map((branch) => (
                        <FormControlLabel
                          key={branch.id}
                          control={
                            <Checkbox
                              checked={inviteBranches.includes(branch.id)}
                              onChange={() =>
                                toggleSelection(branch.id, inviteBranches, setInviteBranches)
                              }
                            />
                          }
                          label={`${branch.name}${branch.is_active ? '' : ' · Inactive'}`}
                        />
                      ))}
                    </FormGroup>
                  )}
                </Paper>
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
                    Selected actions apply to every assigned branch.
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
                          {module.replaceAll('_', ' ')}
                        </Typography>
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
            <Button
              variant="contained"
              onClick={inviteUser}
              disabled={isInviting}
              startIcon={isInviting ? <CircularProgress size={18} color="inherit" /> : null}
              sx={{ alignSelf: 'flex-start' }}
            >
              Add account
            </Button>
          </Stack>
        </Paper>
        {!users.length ? (
          <Alert severity="info">
            No accounts have registered yet. You can preassign their access above.
          </Alert>
        ) : (
          <>
            <FormControl fullWidth>
              <InputLabel id="access-user-label">Account</InputLabel>
              <Select
                labelId="access-user-label"
                label="Account"
                value={selectedUserId}
                onChange={(event) => {
                  setSelectedUserId(event.target.value)
                  const targetUserId = event.target.value
                  setSelectedRole(
                    userRoles.find((userRole) => userRole.user_id === targetUserId)?.role ||
                      'customer',
                  )
                  setSelectedBranches(
                    assignments
                      .filter((assignment) => assignment.user_id === targetUserId)
                      .map((assignment) => assignment.branch_id),
                  )
                  setSelectedPermissions(
                    [
                      ...new Set(
                        userPermissions
                          .filter((permission) => permission.user_id === targetUserId)
                          .map((permission) => permission.permission_id),
                      ),
                    ],
                  )
                  setErrorMessage('')
                  setSuccessMessage('')
                }}
              >
                {users.map((user) => (
                  <MenuItem key={user.id} value={user.id}>
                    {user.display_name || user.email || user.id}
                    {user.email && user.display_name ? ` · ${user.email}` : ''}
                    {!user.is_active ? ' · Deactivated' : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {selectedUserId === account.id && (
              <Alert severity="info">
                Your own Super Admin access is protected from changes here.
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
                  <Typography variant="h6" gutterBottom>
                    Branch assignments
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Staff can view orders and reports only for the branch or branches selected here.
                  </Typography>
                  {!branches.length ? (
                    <Typography color="text.secondary">
                      Create an active branch before assigning staff.
                    </Typography>
                  ) : (
                    <FormGroup>
                      {branches.map((branch) => (
                        <FormControlLabel
                          key={branch.id}
                          control={
                            <Checkbox
                              checked={selectedBranches.includes(branch.id)}
                              onChange={() =>
                                toggleSelection(branch.id, selectedBranches, setSelectedBranches)
                              }
                            />
                          }
                          label={`${branch.name}${branch.is_active ? '' : ' · Inactive'}`}
                        />
                      ))}
                    </FormGroup>
                  )}
                </Paper>
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
                    These actions apply to each assigned branch. A module is
                    not available unless View is granted.
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
                    {Object.entries(permissionGroups).map(([module, modulePermissions]) => (
                      <Paper key={module} variant="outlined" sx={{ p: 1.5 }}>
                        <Typography fontWeight={700} sx={{ textTransform: 'capitalize' }}>
                          {module.replaceAll('_', ' ')}
                        </Typography>
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
                {selectedRole === 'super_admin'
                  ? 'Super Admins can access all branches and modules. Only another Super Admin can assign this role.'
                  : 'Customer accounts do not receive branch or administrative module permissions.'}
              </Alert>
            )}
            {selectedUserId !== account.id && (
              <Button
                variant="contained"
                onClick={saveAccess}
                disabled={isSaving || !selectedUserId}
                startIcon={isSaving ? <CircularProgress size={18} color="inherit" /> : null}
                sx={{ alignSelf: 'flex-start' }}
              >
                Save account access
              </Button>
            )}
            {selectedUserId && (
              <Typography variant="body2" color="text.secondary">
                Current access: {currentRoles.join(', ') || 'No role'}
                {currentBranches.length ? ` · ${currentBranches.length} branch(es)` : ''}
                {currentPermissionIds.length
                  ? ` · ${currentPermissionIds.length} module permission(s)`
                  : ''}
              </Typography>
            )}
          </>
        )}
      </Stack>
    </Container>
  )
}
