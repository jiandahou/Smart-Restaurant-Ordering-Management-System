import { useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { MailCheck, ShieldPlus } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  createRestaurantUser,
  type CreateRestaurantUserRole,
  type Restaurant,
} from '../../api/auth'
import { RestaurantCombobox } from './RestaurantCombobox'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
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
import { Switch } from '../ui/switch'
import { creatableRoles, roleRank, userRoleLabels } from './userRoles'

const temporaryPasswordSchema = z
  .string()
  .min(6, 'Password must be at least 6 characters.')
  .regex(/[0-9]/, 'Password must include a number.')
  .regex(/[a-z]/, 'Password must include a lowercase letter.')
  .regex(/[A-Z]/, 'Password must include an uppercase letter.')
  .regex(/[^a-zA-Z0-9]/, 'Password must include a symbol.')

const createUserSchema = z.object({
  fullName: z.string(),
  email: z.email('Enter a valid email address.'),
  password: z.string(),
  sendPasswordSetupEmail: z.boolean(),
  restaurantId: z.string(),
  role: z.enum(creatableRoles),
}).superRefine((values, context) => {
  if (values.sendPasswordSetupEmail) {
    return
  }

  const passwordResult = temporaryPasswordSchema.safeParse(values.password)
  if (!passwordResult.success) {
    context.addIssue({
      code: 'custom',
      path: ['password'],
      message: passwordResult.error.issues[0]?.message ?? 'Enter a valid temporary password.',
    })
  }
})

type CreateUserFormValues = z.infer<typeof createUserSchema>

type CreateUserCardProps = {
  availableRoles: CreateRestaurantUserRole[]
  currentUserRank: number
  needsRestaurantId: boolean
  restaurantId?: string | null
  restaurants: Restaurant[]
  restaurantsLoading?: boolean
  restaurantLoadError?: string | null
  onUserCreated: () => Promise<void> | void
}

function CreateUserForm({
  availableRoles,
  currentUserRank,
  needsRestaurantId,
  restaurantId,
  restaurants,
  restaurantsLoading = false,
  restaurantLoadError,
  onUserCreated,
}: CreateUserCardProps) {
  const form = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      fullName: '',
      email: '',
      password: '',
      sendPasswordSetupEmail: true,
      restaurantId: restaurantId ?? '',
      role: 'Staff',
    },
  })
  const sendPasswordSetupEmail = useWatch({
    control: form.control,
    name: 'sendPasswordSetupEmail',
  })

  useEffect(() => {
    const currentRole = form.getValues('role')

    if (availableRoles.length > 0 && !availableRoles.includes(currentRole)) {
      form.setValue('role', availableRoles[availableRoles.length - 1], {
        shouldDirty: true,
        shouldValidate: true,
      })
    }
  }, [availableRoles, form])

  const handleSubmit = async (values: CreateUserFormValues) => {
    if (roleRank[values.role] >= currentUserRank) {
      form.setError('role', {
        message: 'Choose a role lower than your own.',
      })
      toast.error('Could not create user', {
        description: 'You can only create users with lower permissions than your own.',
      })
      return
    }

    if (needsRestaurantId && !values.restaurantId.trim()) {
      form.setError('restaurantId', {
        message: 'Restaurant ID is required.',
      })
      toast.error('Could not create user', {
        description: 'Restaurant ID is required for platform scoped user creation.',
      })
      return
    }

    try {
      const response = await createRestaurantUser({
        email: values.email.trim(),
        password: values.sendPasswordSetupEmail ? '' : values.password,
        sendPasswordSetupEmail: values.sendPasswordSetupEmail,
        fullName: values.fullName.trim() || undefined,
        restaurantId: needsRestaurantId ? values.restaurantId.trim() : undefined,
        role: values.role,
      })

      toast.success(response.passwordSetupEmailSent ? 'Invitation sent' : 'User created', {
        description: response.message,
      })
      form.reset({
        fullName: '',
        email: '',
        password: '',
        sendPasswordSetupEmail: true,
        restaurantId: restaurantId ?? values.restaurantId,
        role: form.getValues('role'),
      })
      await onUserCreated()
    } catch (createUserError) {
      toast.error('Could not create user', {
        description: createUserError instanceof Error ? createUserError.message : 'Failed to create user',
      })
    }
  }

  return (
    <Form {...form}>
      <form className="form-grid" onSubmit={form.handleSubmit(handleSubmit)}>
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
          name="sendPasswordSetupEmail"
          render={({ field }) => (
            <FormItem className="create-user-password-delivery">
              <div>
                <FormLabel>Send password setup email</FormLabel>
                <p>The user receives a secure one-hour link and chooses their own password.</p>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={(checked) => {
                    field.onChange(checked)
                    if (checked) {
                      form.clearErrors('password')
                      form.setValue('password', '', { shouldDirty: true })
                    }
                  }}
                  aria-label="Send password setup email"
                />
              </FormControl>
            </FormItem>
          )}
        />
        {!sendPasswordSetupEmail ? (
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Temporary password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" placeholder="ChangeMe123!" {...field} />
                </FormControl>
                <p className="create-user-password-help">Share this password securely and ask the user to change it after signing in.</p>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Role</FormLabel>
              <Select value={field.value} onValueChange={field.onChange} disabled={availableRoles.length === 0}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent position="popper">
                  {availableRoles.map((role) => (
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
                    loading={restaurantsLoading}
                    onValueChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
                {restaurantLoadError && <p className="form-error" role="alert">{restaurantLoadError}</p>}
              </FormItem>
            )}
          />
        )}

        <Button
          type="submit"
          disabled={
            form.formState.isSubmitting ||
            availableRoles.length === 0 ||
            (needsRestaurantId && (restaurantsLoading || restaurants.length === 0))
          }
        >
          {sendPasswordSetupEmail ? <MailCheck size={18} /> : <ShieldPlus size={18} />}
          {form.formState.isSubmitting
            ? sendPasswordSetupEmail ? 'Sending invitation' : 'Creating user'
            : sendPasswordSetupEmail ? 'Create and send invitation' : 'Create user'}
        </Button>
      </form>
    </Form>
  )
}

export function CreateUserCard(props: CreateUserCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create user</CardTitle>
        <CardDescription>Only lower-permission roles are available for your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <CreateUserForm {...props} />
      </CardContent>
    </Card>
  )
}

export function CreateUserDialog(props: CreateUserCardProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button">
          <ShieldPlus size={18} />
          Create user
        </Button>
      </DialogTrigger>
      <DialogContent className="create-user-dialog">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>Only lower-permission roles are available for your account.</DialogDescription>
        </DialogHeader>
        <CreateUserForm {...props} />
      </DialogContent>
    </Dialog>
  )
}
