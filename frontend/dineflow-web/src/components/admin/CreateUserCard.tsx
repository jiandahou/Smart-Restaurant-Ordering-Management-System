import { useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronsUpDown, Loader2, ShieldPlus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  createRestaurantUser,
  getRestaurants,
  type CreateRestaurantUserRole,
  type ManagedUserRole,
  type Restaurant,
} from '../../api/auth'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command'
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
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

export const roleRank: Record<ManagedUserRole | 'PlatformOwner', number> = {
  PlatformOwner: 4,
  RestaurantOwner: 3,
  Admin: 2,
  Staff: 1,
  Customer: 0,
}

export const creatableRoles = ['RestaurantOwner', 'Admin', 'Staff'] as const satisfies readonly CreateRestaurantUserRole[]

const createUserSchema = z.object({
  fullName: z.string(),
  email: z.email('Enter a valid email address.'),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters.')
    .regex(/[0-9]/, 'Password must include a number.')
    .regex(/[a-z]/, 'Password must include a lowercase letter.')
    .regex(/[A-Z]/, 'Password must include an uppercase letter.')
    .regex(/[^a-zA-Z0-9]/, 'Password must include a symbol.'),
  restaurantId: z.string(),
  role: z.enum(creatableRoles),
})

type CreateUserFormValues = z.infer<typeof createUserSchema>

type CreateUserCardProps = {
  availableRoles: CreateRestaurantUserRole[]
  currentUserRank: number
  needsRestaurantId: boolean
  restaurantId?: string | null
  onUserCreated: () => Promise<void> | void
}

function CreateUserForm({
  availableRoles,
  currentUserRank,
  needsRestaurantId,
  restaurantId,
  onUserCreated,
}: CreateUserCardProps) {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [restaurantsLoading, setRestaurantsLoading] = useState(false)
  const [restaurantComboboxOpen, setRestaurantComboboxOpen] = useState(false)

  const form = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      fullName: '',
      email: '',
      password: '',
      restaurantId: restaurantId ?? '',
      role: 'Staff',
    },
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

  useEffect(() => {
    if (!needsRestaurantId) {
      return
    }

    let active = true
    setRestaurantsLoading(true)

    getRestaurants()
      .then((items) => {
        if (active) {
          setRestaurants(items)
        }
      })
      .catch((loadError) => {
        toast.error('Could not load restaurants', {
          description: loadError instanceof Error ? loadError.message : 'Restaurant list failed to load',
        })
      })
      .finally(() => {
        if (active) {
          setRestaurantsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [needsRestaurantId])

  const restaurantOptions = useMemo(() => {
    return restaurants
      .toSorted((first, second) => first.name.localeCompare(second.name))
      .map((restaurant) => ({
        ...restaurant,
        searchValue: [restaurant.name, restaurant.address, restaurant.phone, restaurant.currency, restaurant.id]
          .filter(Boolean)
          .join(' '),
      }))
  }, [restaurants])

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
        password: values.password,
        fullName: values.fullName.trim() || undefined,
        restaurantId: needsRestaurantId ? values.restaurantId.trim() : undefined,
        role: values.role,
      })

      toast.success('User created', {
        description: response.message,
      })
      form.reset({
        fullName: '',
        email: '',
        password: '',
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
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Temporary password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" placeholder="ChangeMe123!" {...field} />
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
              <Select value={field.value} onValueChange={field.onChange} disabled={availableRoles.length === 0}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent position="popper">
                  {availableRoles.map((role) => (
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
                <Popover open={restaurantComboboxOpen} onOpenChange={setRestaurantComboboxOpen}>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={restaurantComboboxOpen}
                        className="restaurant-combobox-trigger"
                        disabled={restaurantsLoading}
                      >
                        <span>
                          {(() => {
                            const selectedRestaurant = restaurantOptions.find(
                              (restaurant) => restaurant.id === field.value,
                            )

                            if (selectedRestaurant) {
                              return selectedRestaurant.name
                            }

                            return restaurantsLoading ? 'Loading restaurants...' : 'Select restaurant'
                          })()}
                        </span>
                        {restaurantsLoading ? <Loader2 size={16} className="spinner" /> : <ChevronsUpDown size={16} />}
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="restaurant-combobox-content" align="start">
                    <Command>
                      <CommandInput placeholder="Search restaurants..." />
                      <CommandList>
                        <CommandEmpty>No restaurants found.</CommandEmpty>
                        <CommandGroup>
                          {restaurantOptions.map((restaurant) => (
                            <CommandItem
                              key={restaurant.id}
                              value={restaurant.searchValue}
                              data-checked={restaurant.id === field.value}
                              onSelect={() => {
                                field.onChange(restaurant.id)
                                setRestaurantComboboxOpen(false)
                              }}
                            >
                              <div className="restaurant-combobox-option">
                                <strong>{restaurant.name}</strong>
                                <span>{restaurant.address}</span>
                                <code>{restaurant.id}</code>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <Button type="submit" disabled={form.formState.isSubmitting || availableRoles.length === 0}>
          <ShieldPlus size={18} />
          {form.formState.isSubmitting ? 'Creating user' : 'Create user'}
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
