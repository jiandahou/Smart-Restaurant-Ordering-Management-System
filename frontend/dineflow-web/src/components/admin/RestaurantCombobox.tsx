import { useMemo, useState, type ComponentProps } from 'react'
import { ChevronsUpDown, Loader2 } from 'lucide-react'
import type { Restaurant } from '../../api/auth'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'

type RestaurantComboboxProps = Omit<ComponentProps<typeof Button>, 'value' | 'onChange'> & {
  value: string
  restaurants: Restaurant[]
  loading?: boolean
  placeholder?: string
  loadingText?: string
  onValueChange: (value: string) => void
}

export function RestaurantCombobox({
  value,
  restaurants,
  loading = false,
  disabled,
  placeholder = 'Select restaurant',
  loadingText = 'Loading restaurants...',
  className,
  onValueChange,
  ...buttonProps
}: RestaurantComboboxProps) {
  const [open, setOpen] = useState(false)
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
  const selectedRestaurant = restaurantOptions.find((restaurant) => restaurant.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('restaurant-combobox-trigger', className)}
          disabled={disabled || loading}
          {...buttonProps}
        >
          <span>{selectedRestaurant?.name ?? (loading ? loadingText : placeholder)}</span>
          {loading ? <Loader2 size={16} className="spinner" /> : <ChevronsUpDown size={16} />}
        </Button>
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
                  data-checked={restaurant.id === value}
                  onSelect={() => {
                    onValueChange(restaurant.id)
                    setOpen(false)
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
  )
}
