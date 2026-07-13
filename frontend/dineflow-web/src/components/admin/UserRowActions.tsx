import { useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Pencil, Trash2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { deleteUser, updateUser, type ManagedUserRole, type Restaurant, type UserListItem } from '../../api/auth'
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
import { roleRank } from './CreateUserCard'
import { RestaurantCombobox } from './RestaurantCombobox'

const managedRoles = ['RestaurantOwner', 'Admin', 'Staff', 'Customer'] as const satisfies readonly ManagedUserRole[]

const updateUserSchema = z.object({
  fullName: z.string(),
  email: z.email('Enter a valid email address.'),
  password: z
    .string()
    .optional()
    .refine(
      (value) =>
        !value ||
        (value.length >= 6 &&
          /[0-9]/.test(value) &&
          /[a-z]/.test(value) &&
          /[A-Z]/.test(value) &&
          /[^a-zA-Z0-9]/.test(value)),
      'Password must be 6+ characters and include upper, lower, number, and symbol.',
    ),
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

export function canManageUser(targetUser: UserListItem, currentUserId: string | undefined, currentUserRank: number) {
  const targetRank = Math.max(
    -1,
    ...targetUser.roles.map((role) => roleRank[role as keyof typeof roleRank] ?? -1),
  )

  return targetUser.id !== currentUserId && targetRank < currentUserRank
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
  const canManage = canManageUser(user, currentUserId, currentUserRank)
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
      password: '',
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
      password: '',
      restaurantId: user.restaurantId ?? '',
      role: currentRole,
    })
  }, [currentRole, form, updateOpen, user])

  const selectedRole = form.watch('role')
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
        password: values.password?.trim() || undefined,
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
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" placeholder="Leave blank to keep current" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
                            {role}
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
              This will permanently delete {user.email ?? 'this user'} and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
