import { useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { History, KeyRound, LockOpen, Pencil, Trash2, UserCheck, UserX } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  deleteUser,
  sendUserPasswordReset,
  unlockUser,
  updateUser,
  updateUserStatus,
  type ManagedUserRole,
  type Restaurant,
  type UserListItem,
} from '../../api/auth'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../ui/form'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { RestaurantCombobox } from './RestaurantCombobox'
import { canManageUser, roleRank, userRoleLabels } from './userRoles'

const managedRoles = ['RestaurantOwner', 'Admin', 'Staff', 'Customer'] as const satisfies readonly ManagedUserRole[]

const updateUserSchema = z.object({
  fullName: z.string(),
  email: z.email('Enter a valid email address.'),
  restaurantId: z.string(),
  role: z.enum(managedRoles),
})

type UpdateUserFormValues = z.infer<typeof updateUserSchema>

type UserRowActionsProps = {
  user: UserListItem
  currentUserId?: string
  currentUserRank: number
  isPlatformOwner: boolean
  availableRoles: ManagedUserRole[]
  restaurants: Restaurant[]
  onUsersChanged: () => Promise<void> | void
}

export function UserRowActions({
  user,
  currentUserId,
  currentUserRank,
  isPlatformOwner,
  availableRoles,
  restaurants,
  onUsersChanged,
}: UserRowActionsProps) {
  const [updateOpen, setUpdateOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const canManage = canManageUser(user, currentUserId, currentUserRank)
  const deleteConfirmValue = user.email ?? user.id
  const roleOptions = useMemo(
    () => availableRoles.filter((role) => roleRank[role] < currentUserRank),
    [availableRoles, currentUserRank],
  )
  const currentRole = (user.roles.find((role): role is ManagedUserRole =>
    managedRoles.includes(role as ManagedUserRole),
  ) ?? 'Customer')

  const form = useForm<UpdateUserFormValues>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      fullName: user.fullName ?? '',
      email: user.email ?? '',
      restaurantId: user.restaurantId ?? '',
      role: currentRole,
    },
  })

  useEffect(() => {
    if (!updateOpen) {
      return
    }

    form.reset({
      fullName: user.fullName ?? '',
      email: user.email ?? '',
      restaurantId: user.restaurantId ?? '',
      role: currentRole,
    })
  }, [currentRole, form, updateOpen, user])

  const selectedRole = useWatch({ control: form.control, name: 'role' })
  const needsRestaurantId = isPlatformOwner && selectedRole !== 'Customer'

  const handleUpdate = async (values: UpdateUserFormValues) => {
    if (roleRank[values.role] >= currentUserRank) {
      form.setError('role', {
        message: 'Choose a role lower than your own.',
      })
      return
    }

    if (needsRestaurantId && !values.restaurantId.trim()) {
      form.setError('restaurantId', {
        message: 'Restaurant is required for restaurant users.',
      })
      return
    }

    try {
      const response = await updateUser(user.id, {
        email: values.email.trim(),
        fullName: values.fullName.trim(),
        restaurantId: needsRestaurantId ? values.restaurantId.trim() : undefined,
        role: values.role,
      })

      toast.success('User updated', {
        description: response.message,
      })
      setUpdateOpen(false)
      await onUsersChanged()
    } catch (updateError) {
      toast.error('Could not update user', {
        description: updateError instanceof Error ? updateError.message : 'Failed to update user',
      })
    }
  }

  const handleDelete = async () => {
    try {
      const response = await deleteUser(user.id)

      toast.success('User deleted', {
        description: response.message,
      })
      await onUsersChanged()
    } catch (deleteError) {
      toast.error('Could not delete user', {
        description: deleteError instanceof Error ? deleteError.message : 'Failed to delete user',
      })
    }
  }

  const handleSendReset = async () => {
    setBusy(true)

    try {
      const response = await sendUserPasswordReset(user.id)
      toast.success('Reset link sent', { description: response.message })
    } catch (error) {
      toast.error('Could not send the reset link', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleStatusChange = async (isDisabled: boolean) => {
    setBusy(true)

    try {
      const response = await updateUserStatus(user.id, isDisabled)
      toast.success(isDisabled ? 'Account disabled' : 'Account enabled', { description: response.message })
      await onUsersChanged()
    } catch (error) {
      toast.error('Could not change the account status', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setBusy(false)
    }
  }

  const handleUnlock = async () => {
    setBusy(true)

    try {
      const response = await unlockUser(user.id)
      toast.success('Account unlocked', { description: response.message })
      await onUsersChanged()
    } catch (error) {
      toast.error('Could not unlock the account', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setBusy(false)
    }
  }

  if (!canManage) {
    return <span className="muted-action">No access</span>
  }

  return (
    <div className="row-actions">
      <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label={`Update ${user.email ?? 'user'}`}>
            <Pencil size={16} />
          </Button>
        </DialogTrigger>
        <DialogContent className="create-user-dialog">
          <DialogHeader>
            <DialogTitle>Update user</DialogTitle>
            <DialogDescription>Only lower-permission roles are available for your account.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form className="form-grid" onSubmit={form.handleSubmit(handleUpdate)}>
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <Input placeholder="Jane Smith" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" placeholder="jane@restaurant.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {/*
                * Password is deliberately not editable here. An admin typing a password has to
                * read it out to the user, and now knows their credential. A reset link expires on
                * its own and never passes through anyone else's hands.
                */}
              <div className="user-reset-password-row">
                <div>
                  <span>Password</span>
                  <small>Send the user a reset link instead of setting one for them.</small>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || !user.email}
                  title={user.email ? undefined : 'This account has no email address'}
                  onClick={() => void handleSendReset()}
                >
                  <KeyRound size={15} />
                  Send reset link
                </Button>
              </div>
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent position="popper">
                        {roleOptions.map((role) => (
                          <SelectItem key={role} value={role}>
                            {userRoleLabels[role]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {needsRestaurantId && (
                <FormField
                  control={form.control}
                  name="restaurantId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Restaurant</FormLabel>
                      <FormControl>
                        <RestaurantCombobox
                          value={field.value}
                          restaurants={restaurants}
                          onValueChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <Button type="submit" disabled={form.formState.isSubmitting || roleOptions.length === 0}>
                <Pencil size={18} />
                {form.formState.isSubmitting ? 'Updating user' : 'Update user'}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Locked by failed sign-ins is a different problem from deliberately disabled, so the
          recovery action shown depends on which one it is. */}
      {user.isLockedOut && !user.isDisabled && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={busy}
          aria-label={`Unlock ${user.email ?? 'user'}`}
          title="Clear the failed sign-in lockout"
          onClick={() => void handleUnlock()}
        >
          <LockOpen size={16} />
        </Button>
      )}

      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={busy}
        aria-label={user.isDisabled ? `Enable ${user.email ?? 'user'}` : `Disable ${user.email ?? 'user'}`}
        title={user.isDisabled ? 'Enable this account' : 'Disable sign-in without deleting the account'}
        onClick={() => void handleStatusChange(!user.isDisabled)}
      >
        {user.isDisabled ? <UserCheck size={16} /> : <UserX size={16} />}
      </Button>

      <Button asChild type="button" variant="outline" size="icon">
        <Link
          to={`/admin/reports?q=${encodeURIComponent(user.id)}`}
          aria-label={`View activity for ${user.email ?? 'user'}`}
          title="View this user's audit activity"
        >
          <History size={16} />
        </Link>
      </Button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="destructive" size="icon" aria-label={`Delete ${user.email ?? 'user'}`}>
            <Trash2 size={16} />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes {user.email ?? 'this user'} and cannot be undone. Audit entries
              that reference them will no longer resolve to an account — disabling keeps that history
              intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Typing the address makes an irreversible click deliberate rather than reflexive. */}
          <div className="delete-confirm-field">
            <label htmlFor={`delete-confirm-${user.id}`}>
              Type <strong>{deleteConfirmValue}</strong> to confirm
            </label>
            <Input
              id={`delete-confirm-${user.id}`}
              value={deleteConfirmation}
              autoComplete="off"
              onChange={(event) => setDeleteConfirmation(event.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirmation('')}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteConfirmation.trim() !== deleteConfirmValue}
              onClick={() => void handleDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
