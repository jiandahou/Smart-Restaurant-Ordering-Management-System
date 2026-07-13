import { useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CircleDollarSign,
  GripVertical,
  ImageIcon,
  ImageUp,
  Layers3,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  Utensils,
  X,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  archiveMenuOption,
  archiveMenuOptionGroup,
  createMenuCategory,
  createMenuItem,
  createMenuOption,
  createMenuOptionGroup,
  deleteMenuCategory,
  deleteMenuItem,
  deleteMenuOption,
  deleteMenuOptionGroup,
  getAdminMenuCategories,
  getAdminMenuItems,
  getRestaurants,
  reorderMenuCategories,
  reorderMenuItems,
  updateMenuCategory,
  updateMenuItem,
  updateMenuItemAvailability,
  updateMenuOption,
  updateMenuOptionGroup,
  updateMenuItemSoldOut,
  uploadMenuItemImage,
  type MenuCategory,
  type MenuItem,
  type MenuOption,
  type MenuOptionGroup,
  type Restaurant,
} from '../api/auth'
import { resolvePublicAssetUrl } from '../api/publicMenu'
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
} from '../components/ui/alert-dialog'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form'
import { Input } from '../components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Switch } from '../components/ui/switch'
import { Textarea } from '../components/ui/textarea'

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required.').max(100),
  description: z.string().trim().max(500).optional(),
  displayOrder: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
})

const itemSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required.').max(150),
  description: z.string().trim().max(1_000).optional(),
  price: z.number().min(0.01, 'Price must be at least 0.01.').max(1_000_000),
  imageUrl: z.string().trim().max(2_048).refine(
    (value) => !value || value.startsWith('/') || URL.canParse(value),
    'Enter a valid image URL.',
  ),
  displayOrder: z.number().int().min(0).max(10_000),
  isAvailable: z.boolean(),
  isSoldOut: z.boolean(),
})

const optionGroupSchema = z.object({
  name: z.string().trim().min(1, 'Group name is required.').max(120),
  isRequired: z.boolean(),
  minSelections: z.number().int().min(0).max(100),
  maxSelections: z.number().int().min(1).max(100),
  displayOrder: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
}).superRefine((value, context) => {
  if (value.isRequired && value.minSelections < 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Required groups need at least 1 minimum selection.',
      path: ['minSelections'],
    })
  }

  if (value.minSelections > value.maxSelections) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Minimum selections cannot exceed maximum selections.',
      path: ['maxSelections'],
    })
  }
})

const optionSchema = z.object({
  name: z.string().trim().min(1, 'Option name is required.').max(140),
  priceAdjustment: z.number().min(-1_000_000).max(1_000_000),
  adjustmentType: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  maxQuantity: z.number().int().min(1).max(100),
  displayOrder: z.number().int().min(0).max(10_000),
  isAvailable: z.boolean(),
}).superRefine((value, context) => {
  if (value.adjustmentType === 1 && value.priceAdjustment > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Remove adjustments must be zero or negative.',
      path: ['priceAdjustment'],
    })
  }

  if (value.adjustmentType !== 1 && value.priceAdjustment < 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Add and replace adjustments must be zero or positive.',
      path: ['priceAdjustment'],
    })
  }
})

type CategoryFormValues = z.infer<typeof categorySchema>
type ItemFormValues = z.infer<typeof itemSchema>
type OptionGroupFormValues = z.infer<typeof optionGroupSchema>
type OptionFormValues = z.infer<typeof optionSchema>
type CategoryStatusFilter = 'all' | 'active' | 'inactive'
type MenuOptionPreset = {
  id: string
  label: string
  description: string
  group: Pick<OptionGroupFormValues, 'name' | 'isRequired' | 'minSelections' | 'maxSelections'>
  options: Array<Pick<OptionFormValues, 'name' | 'priceAdjustment' | 'adjustmentType' | 'maxQuantity'>>
}

const maximumMenuImageBytes = 8 * 1024 * 1024
const allowedMenuImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

const emptyCategory: CategoryFormValues = {
  name: '',
  description: '',
  displayOrder: 0,
  isActive: true,
}

const emptyItem: ItemFormValues = {
  name: '',
  description: '',
  price: 0.01,
  imageUrl: '',
  displayOrder: 0,
  isAvailable: true,
  isSoldOut: false,
}

const emptyOptionGroup: OptionGroupFormValues = {
  name: '',
  isRequired: false,
  minSelections: 0,
  maxSelections: 1,
  displayOrder: 0,
  isActive: true,
}

const emptyOption: OptionFormValues = {
  name: '',
  priceAdjustment: 0,
  adjustmentType: 0,
  maxQuantity: 1,
  displayOrder: 0,
  isAvailable: true,
}

const menuOptionPresets: MenuOptionPreset[] = [
  {
    id: 'dietary-requests',
    label: 'Dietary requests',
    description: 'Halal, vegetarian, vegan, gluten-free.',
    group: {
      name: 'Dietary requests',
      isRequired: false,
      minSelections: 0,
      maxSelections: 4,
    },
    options: [
      { name: 'Halal request', priceAdjustment: 0, adjustmentType: 0, maxQuantity: 1 },
      { name: 'Vegetarian request', priceAdjustment: 0, adjustmentType: 0, maxQuantity: 1 },
      { name: 'Vegan request', priceAdjustment: 0, adjustmentType: 0, maxQuantity: 1 },
      { name: 'Gluten-free request', priceAdjustment: 0, adjustmentType: 0, maxQuantity: 1 },
    ],
  },
  {
    id: 'spice-level',
    label: 'Spice level',
    description: 'Mild through extra hot.',
    group: {
      name: 'Spice level',
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
    },
    options: [
      { name: 'Mild', priceAdjustment: 0, adjustmentType: 0, maxQuantity: 1 },
      { name: 'Medium', priceAdjustment: 0, adjustmentType: 0, maxQuantity: 1 },
      { name: 'Hot', priceAdjustment: 0, adjustmentType: 0, maxQuantity: 1 },
      { name: 'Extra hot', priceAdjustment: 0, adjustmentType: 0, maxQuantity: 1 },
    ],
  },
  {
    id: 'size',
    label: 'Size',
    description: 'Regular, large, family.',
    group: {
      name: 'Size',
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
    },
    options: [
      { name: 'Regular', priceAdjustment: 0, adjustmentType: 0, maxQuantity: 1 },
      { name: 'Large', priceAdjustment: 4, adjustmentType: 0, maxQuantity: 1 },
      { name: 'Family', priceAdjustment: 10, adjustmentType: 0, maxQuantity: 1 },
    ],
  },
  {
    id: 'add-ons',
    label: 'Add-ons',
    description: 'Sauce, cheese, sides.',
    group: {
      name: 'Add-ons',
      isRequired: false,
      minSelections: 0,
      maxSelections: 3,
    },
    options: [
      { name: 'Extra sauce', priceAdjustment: 1.5, adjustmentType: 0, maxQuantity: 2 },
      { name: 'Extra cheese', priceAdjustment: 2, adjustmentType: 0, maxQuantity: 2 },
      { name: 'Side salad', priceAdjustment: 4, adjustmentType: 0, maxQuantity: 1 },
      { name: 'Garlic bread', priceAdjustment: 5, adjustmentType: 0, maxQuantity: 1 },
    ],
  },
  {
    id: 'cooking-preference',
    label: 'Cooking preference',
    description: 'Less salt, no onion, well done.',
    group: {
      name: 'Cooking preference',
      isRequired: false,
      minSelections: 0,
      maxSelections: 2,
    },
    options: [
      { name: 'Less salt', priceAdjustment: 0, adjustmentType: 0, maxQuantity: 1 },
      { name: 'No onion', priceAdjustment: 0, adjustmentType: 0, maxQuantity: 1 },
      { name: 'No coriander', priceAdjustment: 0, adjustmentType: 0, maxQuantity: 1 },
      { name: 'Well done', priceAdjustment: 0, adjustmentType: 0, maxQuantity: 1 },
    ],
  },
]

function sortMenuItems(items: MenuItem[]) {
  return items.toSorted(
    (first, second) => first.displayOrder - second.displayOrder || first.name.localeCompare(second.name),
  )
}

function sortMenuCategories(categories: MenuCategory[]) {
  return categories.toSorted(
    (first, second) => first.displayOrder - second.displayOrder || first.name.localeCompare(second.name),
  )
}

function moveMenuItem(items: MenuItem[], draggedItemId: string, targetItemId: string) {
  const orderedItems = [...items]
  const draggedIndex = orderedItems.findIndex((item) => item.id === draggedItemId)
  const targetIndex = orderedItems.findIndex((item) => item.id === targetItemId)

  if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
    return items
  }

  const [draggedItem] = orderedItems.splice(draggedIndex, 1)
  orderedItems.splice(targetIndex, 0, draggedItem)

  return orderedItems.map((item, index) => ({
    ...item,
    displayOrder: (index + 1) * 10,
  }))
}

function moveMenuCategory(categories: MenuCategory[], draggedCategoryId: string, targetCategoryId: string) {
  const orderedCategories = [...categories]
  const draggedIndex = orderedCategories.findIndex((category) => category.id === draggedCategoryId)
  const targetIndex = orderedCategories.findIndex((category) => category.id === targetCategoryId)

  if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
    return categories
  }

  const [draggedCategory] = orderedCategories.splice(draggedIndex, 1)
  orderedCategories.splice(targetIndex, 0, draggedCategory)

  return orderedCategories.map((category, index) => ({
    ...category,
    displayOrder: (index + 1) * 10,
  }))
}

function moveOrderedEntries<T extends { id: string; displayOrder: number }>(
  entries: T[],
  draggedEntryId: string,
  targetEntryId: string,
) {
  const orderedEntries = [...entries]
  const draggedIndex = orderedEntries.findIndex((entry) => entry.id === draggedEntryId)
  const targetIndex = orderedEntries.findIndex((entry) => entry.id === targetEntryId)

  if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
    return entries
  }

  const [draggedEntry] = orderedEntries.splice(draggedIndex, 1)
  orderedEntries.splice(targetIndex, 0, draggedEntry)

  return orderedEntries.map((entry, index) => ({
    ...entry,
    displayOrder: (index + 1) * 10,
  }))
}

function getSelectionRule(group: MenuOptionGroup) {
  if (group.minSelections === group.maxSelections) {
    return group.minSelections === 1 ? 'Choose 1' : `Choose ${group.minSelections}`
  }

  if (group.minSelections === 0) {
    return `Up to ${group.maxSelections}`
  }

  return `Choose ${group.minSelections}-${group.maxSelections}`
}

function getAdjustmentLabel(option: MenuOption, money: Intl.NumberFormat) {
  if (option.adjustmentType === 2) {
    return `Set ${money.format(option.priceAdjustment)}`
  }

  if (option.priceAdjustment === 0) {
    return 'Included'
  }

  if (option.adjustmentType === 1 || option.priceAdjustment < 0) {
    return money.format(option.priceAdjustment)
  }

  return `+${money.format(option.priceAdjustment)}`
}

function itemMatchesSearch(item: MenuItem, term: string) {
  if (!term) {
    return true
  }

  const optionText = (item.optionGroups ?? [])
    .flatMap((group) => [group.name, ...group.options.map((option) => option.name)])

  return [item.name, item.description ?? '', ...optionText]
    .some((value) => value.toLowerCase().includes(term))
}

function getNextDisplayOrder(items: Array<{ displayOrder: number }>) {
  return items.reduce((highest, item) => Math.max(highest, item.displayOrder), 0) + 10
}

function OptionGroupFormDialog({
  item,
  group,
  onSaved,
}: {
  item: MenuItem
  group?: MenuOptionGroup
  onSaved: () => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const form = useForm<OptionGroupFormValues>({ resolver: zodResolver(optionGroupSchema), defaultValues: emptyOptionGroup })

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      form.reset(group ? {
        name: group.name,
        isRequired: group.isRequired,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        displayOrder: group.displayOrder,
        isActive: group.isActive,
      } : {
        ...emptyOptionGroup,
        displayOrder: getNextDisplayOrder(item.optionGroups ?? []),
      })
    }

    setOpen(nextOpen)
  }

  const handleSubmit = async (values: OptionGroupFormValues) => {
    try {
      const payload = {
        name: values.name.trim(),
        isRequired: values.isRequired,
        minSelections: values.minSelections,
        maxSelections: values.maxSelections,
        displayOrder: values.displayOrder,
      }

      if (group) {
        await updateMenuOptionGroup(item.id, group.id, { ...payload, isActive: values.isActive })
      } else {
        await createMenuOptionGroup(item.id, payload)
      }

      toast.success(group ? 'Option group updated' : 'Option group added')
      handleOpenChange(false)
      await onSaved()
    } catch (error) {
      toast.error(group ? 'Could not update option group' : 'Could not add option group', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {group ? (
          <Button type="button" variant="ghost" size="icon" className="menu-option-icon-button" title="Edit option group" aria-label={`Edit ${group.name}`}>
            <Pencil size={13} />
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" className="menu-option-add-button">
            <Plus size={14} />Add group
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="menu-dialog menu-option-dialog">
        <DialogHeader>
          <DialogTitle>{group ? 'Edit option group' : `Add options to ${item.name}`}</DialogTitle>
          <DialogDescription>Group related customer choices such as spice level, sides, toppings, or size.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="restaurant-form" onSubmit={form.handleSubmit(handleSubmit)}>
            <div className="restaurant-form-grid">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="restaurant-form-wide">
                  <FormLabel>Group name</FormLabel>
                  <FormControl><Input placeholder="Add-ons" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="minSelections" render={({ field }) => (
                <FormItem>
                  <FormLabel>Minimum</FormLabel>
                  <FormControl><Input type="number" min={0} max={100} {...field} onChange={(event) => field.onChange(event.target.valueAsNumber)} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="maxSelections" render={({ field }) => (
                <FormItem>
                  <FormLabel>Maximum</FormLabel>
                  <FormControl><Input type="number" min={1} max={100} {...field} onChange={(event) => field.onChange(event.target.valueAsNumber)} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="displayOrder" render={({ field }) => (
                <FormItem>
                  <FormLabel>Display order</FormLabel>
                  <FormControl><Input type="number" min={0} max={10_000} {...field} onChange={(event) => field.onChange(event.target.valueAsNumber)} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="isRequired" render={({ field }) => (
                <FormItem className="menu-switch-field">
                  <div><FormLabel>Required</FormLabel><p>Customers must choose from this group.</p></div>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="isActive" render={({ field }) => (
                <FormItem className="menu-switch-field">
                  <div><FormLabel>Active</FormLabel><p>Inactive groups are hidden from ordering.</p></div>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Saving' : group ? 'Save group' : 'Add group'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function MenuOptionFormDialog({
  item,
  group,
  option,
  onSaved,
}: {
  item: MenuItem
  group: MenuOptionGroup
  option?: MenuOption
  onSaved: () => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const form = useForm<OptionFormValues>({ resolver: zodResolver(optionSchema), defaultValues: emptyOption })

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      form.reset(option ? {
        name: option.name,
        priceAdjustment: option.priceAdjustment,
        adjustmentType: option.adjustmentType,
        maxQuantity: option.maxQuantity,
        displayOrder: option.displayOrder,
        isAvailable: option.isAvailable,
      } : {
        ...emptyOption,
        displayOrder: getNextDisplayOrder(group.options ?? []),
      })
    }

    setOpen(nextOpen)
  }

  const handleSubmit = async (values: OptionFormValues) => {
    try {
      const payload = {
        name: values.name.trim(),
        priceAdjustment: values.priceAdjustment,
        adjustmentType: values.adjustmentType,
        maxQuantity: values.maxQuantity,
        displayOrder: values.displayOrder,
      }

      if (option) {
        await updateMenuOption(item.id, group.id, option.id, { ...payload, isAvailable: values.isAvailable })
      } else {
        await createMenuOption(item.id, group.id, payload)
      }

      toast.success(option ? 'Option updated' : 'Option added')
      handleOpenChange(false)
      await onSaved()
    } catch (error) {
      toast.error(option ? 'Could not update option' : 'Could not add option', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {option ? (
          <Button type="button" variant="ghost" size="icon" className="menu-option-icon-button" title="Edit option" aria-label={`Edit ${option.name}`}>
            <Pencil size={12} />
          </Button>
        ) : (
          <Button type="button" variant="secondary" size="sm" className="menu-option-add-button">
            <Plus size={14} />Option
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="menu-dialog menu-option-dialog">
        <DialogHeader>
          <DialogTitle>{option ? 'Edit option' : `Add option to ${group.name}`}</DialogTitle>
          <DialogDescription>Set the label, price behavior, order, and whether customers can select it.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="restaurant-form" onSubmit={form.handleSubmit(handleSubmit)}>
            <div className="restaurant-form-grid">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="restaurant-form-wide">
                  <FormLabel>Option name</FormLabel>
                  <FormControl><Input placeholder="Extra sauce" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="adjustmentType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Price type</FormLabel>
                  <Select value={String(field.value)} onValueChange={(value) => field.onChange(Number(value) as 0 | 1 | 2)}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent position="popper">
                      <SelectItem value="0">Add</SelectItem>
                      <SelectItem value="1">Remove</SelectItem>
                      <SelectItem value="2">Replace</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="priceAdjustment" render={({ field }) => (
                <FormItem>
                  <FormLabel>Price adjustment</FormLabel>
                  <FormControl><Input type="number" step={0.01} {...field} onChange={(event) => field.onChange(event.target.valueAsNumber)} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="maxQuantity" render={({ field }) => (
                <FormItem>
                  <FormLabel>Max quantity</FormLabel>
                  <FormControl><Input type="number" min={1} max={100} {...field} onChange={(event) => field.onChange(event.target.valueAsNumber)} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="displayOrder" render={({ field }) => (
                <FormItem>
                  <FormLabel>Display order</FormLabel>
                  <FormControl><Input type="number" min={0} max={10_000} {...field} onChange={(event) => field.onChange(event.target.valueAsNumber)} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="isAvailable" render={({ field }) => (
                <FormItem className="menu-switch-field">
                  <div><FormLabel>Available</FormLabel><p>Unavailable options remain in admin but cannot be chosen.</p></div>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Saving' : option ? 'Save option' : 'Add option'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function MenuOptionPresetPicker({
  item,
  onSaved,
}: {
  item: MenuItem
  onSaved: () => Promise<void> | void
}) {
  const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>()
  const [applyingPresetId, setApplyingPresetId] = useState<string | null>(null)

  const applyPreset = async (presetId: string) => {
    const preset = menuOptionPresets.find((candidate) => candidate.id === presetId)

    if (!preset) {
      setSelectedPresetId(undefined)
      return
    }

    const normalizedGroupNames = new Set(
      (item.optionGroups ?? []).map((group) => group.name.trim().toLowerCase()),
    )

    if (normalizedGroupNames.has(preset.group.name.trim().toLowerCase())) {
      toast.error(`${preset.label} already exists`, {
        description: `${item.name} already has a "${preset.group.name}" option group.`,
      })
      setSelectedPresetId(undefined)
      return
    }

    setApplyingPresetId(preset.id)

    try {
      const createdGroup = await createMenuOptionGroup(item.id, {
        ...preset.group,
        name: preset.group.name.trim(),
        displayOrder: getNextDisplayOrder(item.optionGroups ?? []),
      })

      await Promise.all(preset.options.map((option, index) => createMenuOption(item.id, createdGroup.id, {
        ...option,
        name: option.name.trim(),
        displayOrder: (index + 1) * 10,
      })))

      toast.success(`${preset.label} added`, {
        description: `Created ${preset.options.length} options for ${item.name}.`,
      })
      await onSaved()
    } catch (error) {
      toast.error('Could not add preset', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setApplyingPresetId(null)
      setSelectedPresetId(undefined)
    }
  }

  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId)
    void applyPreset(presetId)
  }

  return (
    <Select value={selectedPresetId} onValueChange={handlePresetChange} disabled={Boolean(applyingPresetId)}>
      <SelectTrigger
        size="sm"
        className="menu-option-preset-trigger"
        aria-label={`Add option preset to ${item.name}`}
      >
        <Layers3 size={13} aria-hidden="true" />
        <SelectValue placeholder={applyingPresetId ? 'Adding preset' : 'Quick preset'} />
      </SelectTrigger>
      <SelectContent align="end" position="popper" className="menu-option-preset-content">
        {menuOptionPresets.map((preset) => (
          <SelectItem key={preset.id} value={preset.id} textValue={preset.label}>
            <span className="menu-option-preset-option">
              <span>{preset.label}</span>
              <small>{preset.description}</small>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function MenuItemOptionSummary({
  item,
  money,
  onChanged,
}: {
  item: MenuItem
  money: Intl.NumberFormat
  onChanged: () => Promise<void> | void
}) {
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null)
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null)
  const [draggedOption, setDraggedOption] = useState<{ groupId: string; optionId: string } | null>(null)
  const [dropTargetOptionId, setDropTargetOptionId] = useState<string | null>(null)
  const [reorderingOptions, setReorderingOptions] = useState(false)
  const groups = [...(item.optionGroups ?? [])]
    .sort((first, second) => first.displayOrder - second.displayOrder || first.name.localeCompare(second.name))

  const resetGroupDragState = () => {
    setDraggedGroupId(null)
    setDropTargetGroupId(null)
  }

  const resetOptionDragState = () => {
    setDraggedOption(null)
    setDropTargetOptionId(null)
  }

  const reorderGroups = async (targetGroupId: string) => {
    if (!draggedGroupId || draggedGroupId === targetGroupId || reorderingOptions) {
      resetGroupDragState()
      return
    }

    const reorderedGroups = moveOrderedEntries(groups, draggedGroupId, targetGroupId)

    if (reorderedGroups === groups) {
      resetGroupDragState()
      return
    }

    setReorderingOptions(true)
    resetGroupDragState()

    try {
      await Promise.all(reorderedGroups.map((group) => updateMenuOptionGroup(item.id, group.id, {
        name: group.name,
        isRequired: group.isRequired,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        displayOrder: group.displayOrder,
        isActive: group.isActive,
      })))
      toast.success('Option group order updated')
      await onChanged()
    } catch (error) {
      toast.error('Could not reorder option groups', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
      await onChanged()
    } finally {
      setReorderingOptions(false)
    }
  }

  const reorderOptions = async (group: MenuOptionGroup, targetOptionId: string) => {
    if (
      !draggedOption ||
      draggedOption.groupId !== group.id ||
      draggedOption.optionId === targetOptionId ||
      reorderingOptions
    ) {
      resetOptionDragState()
      return
    }

    const orderedOptions = [...group.options]
      .sort((first, second) => first.displayOrder - second.displayOrder || first.name.localeCompare(second.name))
    const reorderedOptions = moveOrderedEntries(orderedOptions, draggedOption.optionId, targetOptionId)

    if (reorderedOptions === orderedOptions) {
      resetOptionDragState()
      return
    }

    setReorderingOptions(true)
    resetOptionDragState()

    try {
      await Promise.all(reorderedOptions.map((option) => updateMenuOption(item.id, group.id, option.id, {
        name: option.name,
        priceAdjustment: option.priceAdjustment,
        adjustmentType: option.adjustmentType,
        maxQuantity: option.maxQuantity,
        displayOrder: option.displayOrder,
        isAvailable: option.isAvailable,
      })))
      toast.success('Option order updated')
      await onChanged()
    } catch (error) {
      toast.error('Could not reorder options', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
      await onChanged()
    } finally {
      setReorderingOptions(false)
    }
  }

  const archiveGroup = async (group: MenuOptionGroup) => {
    try {
      await archiveMenuOptionGroup(item.id, group.id)
      toast.success('Option group archived')
      await onChanged()
    } catch (error) {
      toast.error('Could not archive option group', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    }
  }

  const enableGroup = async (group: MenuOptionGroup) => {
    try {
      await updateMenuOptionGroup(item.id, group.id, {
        name: group.name,
        isRequired: group.isRequired,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        displayOrder: group.displayOrder,
        isActive: true,
      })
      toast.success('Option group restored')
      await onChanged()
    } catch (error) {
      toast.error('Could not restore option group', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    }
  }

  const deleteGroup = async (group: MenuOptionGroup) => {
    try {
      await deleteMenuOptionGroup(item.id, group.id)
      toast.success('Option group deleted')
      await onChanged()
    } catch (error) {
      toast.error('Could not delete option group', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    }
  }

  const archiveOption = async (group: MenuOptionGroup, option: MenuOption) => {
    try {
      await archiveMenuOption(item.id, group.id, option.id)
      toast.success('Option archived')
      await onChanged()
    } catch (error) {
      toast.error('Could not archive option', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    }
  }

  const enableOption = async (group: MenuOptionGroup, option: MenuOption) => {
    try {
      await updateMenuOption(item.id, group.id, option.id, {
        name: option.name,
        priceAdjustment: option.priceAdjustment,
        adjustmentType: option.adjustmentType,
        maxQuantity: option.maxQuantity,
        displayOrder: option.displayOrder,
        isAvailable: true,
      })
      toast.success('Option restored')
      await onChanged()
    } catch (error) {
      toast.error('Could not restore option', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    }
  }

  const deleteOption = async (group: MenuOptionGroup, option: MenuOption) => {
    try {
      await deleteMenuOption(item.id, group.id, option.id)
      toast.success('Option deleted')
      await onChanged()
    } catch (error) {
      toast.error('Could not delete option', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    }
  }

  if (groups.length === 0) {
    return (
      <div className="menu-option-summary is-empty">
        <span className="menu-option-empty">No option groups yet</span>
        <div className="menu-option-summary-actions">
          <MenuOptionPresetPicker item={item} onSaved={onChanged} />
          <OptionGroupFormDialog item={item} onSaved={onChanged} />
        </div>
      </div>
    )
  }

  const optionCount = groups.reduce((total, group) => total + group.options.length, 0)

  return (
    <div className="menu-option-summary" aria-label={`${item.name} option groups`}>
      <div className="menu-option-summary-header">
        <div className="menu-option-summary-meta">
          <Badge variant="outline">{groups.length} groups</Badge>
          <span>{optionCount} options</span>
        </div>
        <div className="menu-option-summary-actions">
          <MenuOptionPresetPicker item={item} onSaved={onChanged} />
          <OptionGroupFormDialog item={item} onSaved={onChanged} />
        </div>
      </div>
      <div className="menu-option-group-list">
        {groups.map((group) => (
          <div
            key={group.id}
            className={[
              'menu-option-group-card',
              group.isActive ? '' : 'is-inactive',
              groups.length > 1 ? 'is-draggable' : '',
              draggedGroupId === group.id ? 'is-dragging' : '',
              dropTargetGroupId === group.id ? 'is-drop-target' : '',
            ].filter(Boolean).join(' ')}
            onDragEnter={() => {
              if (draggedGroupId && draggedGroupId !== group.id) {
                setDropTargetGroupId(group.id)
              }
            }}
            onDragOver={(event) => {
              if (draggedGroupId) {
                event.preventDefault()
              }
            }}
            onDrop={(event) => {
              if (!draggedGroupId) {
                return
              }

              event.preventDefault()
              void reorderGroups(group.id)
            }}
          >
            <div className="menu-option-group-header">
              <div className="menu-option-group-title">
                <button
                  type="button"
                  className="menu-option-drag-handle"
                  draggable={!reorderingOptions && groups.length > 1}
                  disabled={reorderingOptions || groups.length < 2}
                  title={groups.length < 2 ? 'Add another option group to reorder.' : 'Drag to reorder option groups.'}
                  aria-label={`Reorder ${group.name}`}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    setDraggedGroupId(group.id)
                  }}
                  onDragEnd={resetGroupDragState}
                >
                  <GripVertical size={12} />
                </button>
                <strong>{group.name}</strong>
                <span>{getSelectionRule(group)}</span>
                <Badge
                  variant="outline"
                  className={group.isRequired ? 'menu-option-state-badge is-required' : 'menu-option-state-badge is-optional'}
                >
                  {group.isRequired ? 'Required' : 'Optional'}
                </Badge>
                {!group.isActive && <Badge variant="destructive">Inactive</Badge>}
              </div>
              <div className="menu-option-actions">
                <MenuOptionFormDialog item={item} group={group} onSaved={onChanged} />
                <OptionGroupFormDialog item={item} group={group} onSaved={onChanged} />
                {group.isActive ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" className="menu-option-icon-button is-danger" title="Archive option group" aria-label={`Archive ${group.name}`}>
                        <Archive size={12} />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Archive {group.name}?</AlertDialogTitle>
                        <AlertDialogDescription>This hides the group from future ordering. Existing order history keeps its snapshots.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={() => void archiveGroup(group)}>Archive group</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <>
                    <Button type="button" variant="ghost" size="icon" className="menu-option-icon-button is-enable" title="Restore option group" aria-label={`Restore ${group.name}`} onClick={() => void enableGroup(group)}>
                      <RotateCcw size={12} />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" className="menu-option-icon-button is-danger" title="Delete option group" aria-label={`Delete ${group.name}`}>
                          <Trash2 size={12} />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete {group.name}?</AlertDialogTitle>
                          <AlertDialogDescription>This permanently removes the group and its options from this menu item. Existing order history keeps its snapshots.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction variant="destructive" onClick={() => void deleteGroup(group)}>Delete group</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                )}
              </div>
            </div>
            <div className="menu-option-chip-list">
              {group.options
                .toSorted((first, second) => first.displayOrder - second.displayOrder || first.name.localeCompare(second.name))
                .map((option) => (
                  <span
                    key={option.id}
                    className={[
                      'menu-option-chip',
                      option.isAvailable ? '' : 'is-unavailable',
                      group.options.length > 1 ? 'is-draggable' : '',
                      draggedOption?.optionId === option.id ? 'is-dragging' : '',
                      dropTargetOptionId === option.id ? 'is-drop-target' : '',
                    ].filter(Boolean).join(' ')}
                    onDragEnter={(event) => {
                      event.stopPropagation()
                      if (draggedOption?.groupId === group.id && draggedOption.optionId !== option.id) {
                        setDropTargetOptionId(option.id)
                      }
                    }}
                    onDragOver={(event) => {
                      if (draggedOption?.groupId === group.id) {
                        event.preventDefault()
                        event.stopPropagation()
                      }
                    }}
                    onDrop={(event) => {
                      if (draggedOption?.groupId !== group.id) {
                        return
                      }

                      event.preventDefault()
                      event.stopPropagation()
                      void reorderOptions(group, option.id)
                    }}
                  >
                    <button
                      type="button"
                      className="menu-option-drag-handle"
                      draggable={!reorderingOptions && group.options.length > 1}
                      disabled={reorderingOptions || group.options.length < 2}
                      title={group.options.length < 2 ? 'Add another option to reorder.' : 'Drag to reorder options.'}
                      aria-label={`Reorder ${option.name}`}
                      onDragStart={(event) => {
                        event.stopPropagation()
                        event.dataTransfer.effectAllowed = 'move'
                        setDraggedOption({ groupId: group.id, optionId: option.id })
                      }}
                      onDragEnd={(event) => {
                        event.stopPropagation()
                        resetOptionDragState()
                      }}
                    >
                      <GripVertical size={11} />
                    </button>
                    <span className="menu-option-chip-copy">
                      <strong>{option.name}</strong>
                      <small>{getAdjustmentLabel(option, money)}</small>
                      {option.maxQuantity > 1 && <small>max {option.maxQuantity}</small>}
                      {!option.isAvailable && <small>unavailable</small>}
                    </span>
                    <span className="menu-option-chip-actions">
                      <MenuOptionFormDialog item={item} group={group} option={option} onSaved={onChanged} />
                      {option.isAvailable ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" className="menu-option-icon-button is-danger" title="Archive option" aria-label={`Archive ${option.name}`}>
                              <Archive size={12} />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Archive {option.name}?</AlertDialogTitle>
                              <AlertDialogDescription>This hides the option from future ordering while preserving historical order snapshots.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction variant="destructive" onClick={() => void archiveOption(group, option)}>Archive option</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
                        <>
                          <Button type="button" variant="ghost" size="icon" className="menu-option-icon-button is-enable" title="Restore option" aria-label={`Restore ${option.name}`} onClick={() => void enableOption(group, option)}>
                            <RotateCcw size={12} />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button type="button" variant="ghost" size="icon" className="menu-option-icon-button is-danger" title="Delete option" aria-label={`Delete ${option.name}`}>
                                <Trash2 size={12} />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete {option.name}?</AlertDialogTitle>
                                <AlertDialogDescription>This permanently removes the option from this menu item. Existing order history keeps its snapshots.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction variant="destructive" onClick={() => void deleteOption(group, option)}>Delete option</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      )}
                    </span>
                  </span>
                ))}
              {group.options.length === 0 && <span className="menu-option-empty">No options in this group</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CategoryFormDialog({
  restaurantId,
  category,
  onSaved,
}: {
  restaurantId: string
  category?: MenuCategory
  onSaved: () => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const form = useForm<CategoryFormValues>({ resolver: zodResolver(categorySchema), defaultValues: emptyCategory })

  useEffect(() => {
    if (!open) return
    form.reset(category ? {
      name: category.name,
      description: category.description ?? '',
      displayOrder: category.displayOrder,
      isActive: category.isActive,
    } : emptyCategory)
  }, [category, form, open])

  const handleSubmit = async (values: CategoryFormValues) => {
    try {
      const payload = {
        name: values.name.trim(),
        description: values.description?.trim() || null,
        displayOrder: values.displayOrder,
        isActive: values.isActive,
      }
      const response = category
        ? await updateMenuCategory(category.id, payload)
        : await createMenuCategory({ restaurantId, ...payload })
      toast.success(category ? 'Category updated' : 'Category created', { description: response.message })
      setOpen(false)
      await onSaved()
    } catch (error) {
      toast.error(category ? 'Could not update category' : 'Could not create category', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {category ? (
          <Button type="button" variant="outline" size="icon" title="Edit category" aria-label={`Edit ${category.name}`}>
            <Pencil size={16} />
          </Button>
        ) : (
          <Button type="button"><Plus size={18} />Create category</Button>
        )}
      </DialogTrigger>
      <DialogContent className="menu-dialog">
        <DialogHeader>
          <DialogTitle>{category ? 'Edit category' : 'Create category'}</DialogTitle>
          <DialogDescription>Categories organize the menu and control the order shown to customers.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="restaurant-form" onSubmit={form.handleSubmit(handleSubmit)}>
            <div className="restaurant-form-grid">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="restaurant-form-wide">
                  <FormLabel>Name</FormLabel>
                  <FormControl><Input placeholder="Main dishes" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="displayOrder" render={({ field }) => (
                <FormItem>
                  <FormLabel>Display order</FormLabel>
                  <FormControl><Input type="number" min={0} max={10_000} {...field} onChange={(event) => field.onChange(event.target.valueAsNumber)} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="isActive" render={({ field }) => (
                <FormItem className="menu-switch-field">
                  <div><FormLabel>Active</FormLabel><p>Inactive categories are hidden from the public menu.</p></div>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem className="restaurant-form-wide">
                  <FormLabel>Description</FormLabel>
                  <FormControl><Textarea rows={3} placeholder="Optional category description" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Saving' : category ? 'Save changes' : 'Create category'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function ItemFormDialog({
  restaurantId,
  category,
  item,
  onSaved,
}: {
  restaurantId: string
  category: MenuCategory
  item?: MenuItem
  onSaved: () => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null)
  const [removeImage, setRemoveImage] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [imageInputKey, setImageInputKey] = useState(0)
  const form = useForm<ItemFormValues>({ resolver: zodResolver(itemSchema), defaultValues: emptyItem })

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      form.reset(item ? {
        name: item.name,
        description: item.description ?? '',
        price: item.price,
        imageUrl: item.imageUrl ?? '',
        displayOrder: item.displayOrder,
        isAvailable: item.isAvailable,
        isSoldOut: item.isSoldOut,
      } : emptyItem)
      setRemoveImage(false)
      setImageInputKey((current) => current + 1)
    }

    setImageFile(null)
    setLocalPreviewUrl(null)
    setImageError(null)
    setOpen(nextOpen)
  }

  useEffect(() => () => {
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl)
  }, [localPreviewUrl])

  const displayedImageUrl = localPreviewUrl ?? (removeImage ? '' : resolvePublicAssetUrl(item?.imageUrl ?? null) ?? '')

  const handleImageChange = (file?: File) => {
    setImageError(null)

    if (!file) {
      setImageFile(null)
      setLocalPreviewUrl(null)
      return
    }

    if (!allowedMenuImageTypes.has(file.type)) {
      setImageFile(null)
      setLocalPreviewUrl(null)
      setImageError('Choose a JPG, PNG, or WebP image.')
      return
    }

    if (file.size > maximumMenuImageBytes) {
      setImageFile(null)
      setLocalPreviewUrl(null)
      setImageError('Menu image must be 8MB or smaller.')
      return
    }

    setImageFile(file)
    setLocalPreviewUrl(URL.createObjectURL(file))
    setRemoveImage(false)
  }

  const clearImage = () => {
    setImageFile(null)
    setLocalPreviewUrl(null)
    setRemoveImage(true)
    setImageError(null)
    setImageInputKey((current) => current + 1)
  }

  const handleSubmit = async (values: ItemFormValues) => {
    try {
      let imageUrl = removeImage ? null : values.imageUrl.trim() || null

      if (imageFile) {
        const upload = await uploadMenuItemImage(restaurantId, imageFile)
        imageUrl = upload.imageUrl
      }

      const payload = {
        categoryId: category.id,
        name: values.name.trim(),
        description: values.description?.trim() || null,
        price: values.price,
        imageUrl,
        isAvailable: values.isAvailable,
        isSoldOut: values.isSoldOut,
        displayOrder: values.displayOrder,
      }
      const response = item
        ? await updateMenuItem(item.id, payload)
        : await createMenuItem({ restaurantId, ...payload })
      toast.success(item ? 'Menu item updated' : 'Menu item created', { description: response.message })
      handleOpenChange(false)
      await onSaved()
    } catch (error) {
      toast.error(item ? 'Could not update menu item' : 'Could not create menu item', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {item ? (
          <Button type="button" variant="outline" size="icon" title="Edit item" aria-label={`Edit ${item.name}`}><Pencil size={16} /></Button>
        ) : (
          <Button type="button" variant="outline"><Plus size={17} />Create item</Button>
        )}
      </DialogTrigger>
      <DialogContent className="menu-dialog menu-item-dialog">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit menu item' : `Create item in ${category.name}`}</DialogTitle>
          <DialogDescription>Set customer-facing details, price, visibility, and stock state.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="restaurant-form" onSubmit={form.handleSubmit(handleSubmit)}>
            <div className="restaurant-form-grid">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="restaurant-form-wide"><FormLabel>Name</FormLabel><FormControl><Input placeholder="Grilled salmon" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="price" render={({ field }) => (
                <FormItem><FormLabel>Price</FormLabel><FormControl><Input type="number" min={0.01} step={0.01} {...field} onChange={(event) => field.onChange(event.target.valueAsNumber)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="displayOrder" render={({ field }) => (
                <FormItem><FormLabel>Display order</FormLabel><FormControl><Input type="number" min={0} max={10_000} {...field} onChange={(event) => field.onChange(event.target.valueAsNumber)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem className="restaurant-form-wide"><FormLabel>Description</FormLabel><FormControl><Textarea rows={3} placeholder="Ingredients and customer-facing description" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="restaurant-form-wide menu-image-field">
                <div className="menu-image-field-header">
                  <div>
                    <FormLabel>Menu image</FormLabel>
                    <p>JPG, PNG, or WebP. Maximum 8MB.</p>
                  </div>
                  {displayedImageUrl && (
                    <Button type="button" variant="ghost" size="sm" onClick={clearImage} disabled={form.formState.isSubmitting}>
                      <X size={15} />Remove
                    </Button>
                  )}
                </div>
                <div className="menu-image-picker">
                  <div className="menu-image-preview">
                    {displayedImageUrl ? <img src={displayedImageUrl} alt="Menu item preview" /> : <ImageIcon size={28} />}
                  </div>
                  <div className="menu-image-input">
                    <label htmlFor={`menu-image-${item?.id ?? category.id}`}><ImageUp size={17} />Choose image</label>
                    <Input
                      key={imageInputKey}
                      id={`menu-image-${item?.id ?? category.id}`}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={form.formState.isSubmitting}
                      onChange={(event) => handleImageChange(event.target.files?.[0])}
                    />
                    <span>{imageFile?.name ?? (displayedImageUrl ? 'Current image will be kept.' : 'No image selected.')}</span>
                    <span className="text-xs text-muted-foreground">JPG, PNG or WebP · Max 8 MB</span>
                  </div>
                </div>
                {imageError && <p className="menu-image-error">{imageError}</p>}
              </div>
              <FormField control={form.control} name="isAvailable" render={({ field }) => (
                <FormItem className="menu-switch-field"><div><FormLabel>Available</FormLabel><p>Controls public menu visibility.</p></div><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="isSoldOut" render={({ field }) => (
                <FormItem className="menu-switch-field"><div><FormLabel>Sold out</FormLabel><p>Keep visible but prevent ordering.</p></div><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>
              )} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting || Boolean(imageError)}>{form.formState.isSubmitting ? (imageFile ? 'Uploading image' : 'Saving') : item ? 'Save changes' : 'Create item'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function CategoryMenuSection({
  restaurantId,
  category,
  currency,
  onCategoriesChanged,
  categoryReorderDisabled,
  categoryDragTitle,
}: {
  restaurantId: string
  category: MenuCategory
  currency: string
  onCategoriesChanged: () => Promise<void> | void
  categoryReorderDisabled: boolean
  categoryDragTitle: string
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null)
  const [dropTargetItemId, setDropTargetItemId] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)

  const loadItems = async (showToast = false) => {
    setLoading(true)
    try {
      setItems(await getAdminMenuItems(restaurantId, category.id))
      setLoaded(true)
      if (showToast) toast.success(`${category.name} refreshed`)
    } catch (error) {
      toast.error('Could not load menu items', { description: error instanceof Error ? error.message : 'The request failed.' })
    } finally {
      setLoading(false)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen && !loaded) void loadItems()
  }

  const orderedItems = useMemo(() => sortMenuItems(items), [items])

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase()
    return orderedItems
      .filter((item) => itemMatchesSearch(item, term))
  }, [orderedItems, search])

  const isReorderDisabled = loading || reordering || search.trim() !== '' || orderedItems.length < 2

  const resetDragState = () => {
    setDraggedItemId(null)
    setDropTargetItemId(null)
  }

  const handleDrop = async (targetItemId: string, overrideDraggedItemId?: string) => {
    const sourceItemId = overrideDraggedItemId ?? draggedItemId

    if (!sourceItemId || sourceItemId === targetItemId || isReorderDisabled) {
      resetDragState()
      return
    }

    const previousItems = items
    const reorderedItems = moveMenuItem(orderedItems, sourceItemId, targetItemId)

    if (reorderedItems === orderedItems) {
      resetDragState()
      return
    }

    setItems(reorderedItems)
    setReordering(true)
    resetDragState()

    try {
      const response = await reorderMenuItems({
        categoryId: category.id,
        itemIds: reorderedItems.map((item) => item.id),
      })
      toast.success('Menu order updated', { description: response.message })
    } catch (error) {
      setItems(previousItems)
      toast.error('Could not reorder menu items', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setReordering(false)
    }
  }

  const handleStepMove = async (itemId: string, direction: 'up' | 'down') => {
    if (isReorderDisabled) {
      return
    }

    const currentIndex = orderedItems.findIndex((item) => item.id === itemId)
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedItems.length) {
      return
    }

    await handleDrop(orderedItems[targetIndex].id, itemId)
  }

  const toggleAvailability = async (item: MenuItem, isAvailable: boolean) => {
    try {
      const response = await updateMenuItemAvailability(item.id, isAvailable)
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, isAvailable } : entry))
      toast.success(response.message)
    } catch (error) {
      toast.error('Could not change availability', { description: error instanceof Error ? error.message : 'The request failed.' })
    }
  }

  const toggleSoldOut = async (item: MenuItem, isSoldOut: boolean) => {
    try {
      const response = await updateMenuItemSoldOut(item.id, isSoldOut)
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, isSoldOut } : entry))
      toast.success(response.message)
    } catch (error) {
      toast.error('Could not change sold-out status', { description: error instanceof Error ? error.message : 'The request failed.' })
    }
  }

  const removeItem = async (item: MenuItem) => {
    try {
      const response = await deleteMenuItem(item.id)
      setItems((current) => current.filter((entry) => entry.id !== item.id))
      toast.success('Menu item deleted', { description: response.message })
    } catch (error) {
      toast.error('Could not delete menu item', { description: error instanceof Error ? error.message : 'The request failed.' })
    }
  }

  const removeCategory = async () => {
    try {
      const response = await deleteMenuCategory(category.id)
      toast.success('Category deleted', { description: response.message })
      await onCategoriesChanged()
    } catch (error) {
      toast.error('Could not delete category', { description: error instanceof Error ? error.message : 'The request failed.' })
    }
  }

  const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency })

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange} className="menu-category-section">
      <div className="menu-category-row">
        <button
          type="button"
          className="menu-reorder-handle menu-category-reorder-handle"
          disabled={categoryReorderDisabled}
          aria-label={`Reorder ${category.name}`}
          title={categoryDragTitle}
        >
          <GripVertical size={16} />
        </button>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" className="menu-category-trigger">
            <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.16 }}><ChevronDown size={18} /></motion.span>
            <span className="menu-category-name"><strong>{category.name}</strong><small>{category.description || 'No description'}</small></span>
          </Button>
        </CollapsibleTrigger>
        <span className="menu-category-order">Order {category.displayOrder}</span>
        <Badge variant={category.isActive ? 'secondary' : 'destructive'}>{category.isActive ? 'Active' : 'Inactive'}</Badge>
        <div className="row-actions">
          <CategoryFormDialog restaurantId={restaurantId} category={category} onSaved={onCategoriesChanged} />
          <AlertDialog>
            <AlertDialogTrigger asChild><Button type="button" variant="destructive" size="icon" title="Delete category" aria-label={`Delete ${category.name}`}><Trash2 size={16} /></Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>Delete {category.name}?</AlertDialogTitle><AlertDialogDescription>The category can only be deleted when it contains no menu items.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void removeCategory()}>Delete category</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <CollapsibleContent className="menu-category-content">
        <div className="menu-items-toolbar">
          <div className="directory-search"><Search size={16} /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${category.name}`} /></div>
          <ItemFormDialog restaurantId={restaurantId} category={category} onSaved={() => loadItems()} />
          <Button type="button" variant="secondary" size="icon" onClick={() => void loadItems(true)} disabled={loading} title="Refresh items" aria-label="Refresh items"><RefreshCw size={16} /></Button>
        </div>
        {loading ? (
          <div className="menu-items-loading"><motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}><RefreshCw size={18} /></motion.span>Loading menu items...</div>
        ) : (
          <>
          <div className="table-wrap menu-items-table-wrap">
            <table className="data-table menu-items-table">
              <thead><tr><th>Reorder</th><th>Item</th><th>Price</th><th>Available</th><th>Sold out</th><th>Order</th><th>Actions</th></tr></thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr
                    key={item.id}
                    className={[
                      'menu-item-row',
                      !isReorderDisabled ? 'is-draggable' : '',
                      draggedItemId === item.id ? 'is-dragging' : '',
                      dropTargetItemId === item.id ? 'is-drop-target' : '',
                    ].filter(Boolean).join(' ')}
                    draggable={!isReorderDisabled}
                    onDragStart={() => setDraggedItemId(item.id)}
                    onDragEnter={() => {
                      if (!isReorderDisabled && draggedItemId && draggedItemId !== item.id) {
                        setDropTargetItemId(item.id)
                      }
                    }}
                    onDragOver={(event) => {
                      if (!isReorderDisabled) {
                        event.preventDefault()
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      void handleDrop(item.id)
                    }}
                    onDragEnd={resetDragState}
                  >
                    <td>
                      <button
                        type="button"
                        className="menu-reorder-handle"
                        disabled={isReorderDisabled}
                        aria-label={`Reorder ${item.name}`}
                        title={
                          search.trim()
                            ? 'Clear search to reorder menu items.'
                            : orderedItems.length < 2
                              ? 'Add more items to reorder this category.'
                              : 'Drag to reorder items.'
                        }
                      >
                        <GripVertical size={16} />
                      </button>
                    </td>
                    <td>
                      <div className="menu-item-cell">
                        <div className="menu-item-name">
                          {resolvePublicAssetUrl(item.imageUrl) ? (
                            <img src={resolvePublicAssetUrl(item.imageUrl) ?? undefined} alt="" />
                          ) : (
                            <span><ImageIcon size={17} /></span>
                          )}
                          <div>
                            <strong>{item.name}</strong>
                            <small>{item.description || 'No description'}</small>
                          </div>
                        </div>
                        <MenuItemOptionSummary item={item} money={money} onChanged={() => loadItems()} />
                      </div>
                    </td>
                    <td><span className="menu-price"><CircleDollarSign size={15} />{money.format(item.price)}</span></td>
                    <td><Switch checked={item.isAvailable} onCheckedChange={(value) => void toggleAvailability(item, value)} aria-label={`${item.name} availability`} /></td>
                    <td><Switch checked={item.isSoldOut} onCheckedChange={(value) => void toggleSoldOut(item, value)} aria-label={`${item.name} sold out status`} /></td>
                    <td>
                      <div className="menu-order-controls">
                        <span>{item.displayOrder}</span>
                        <div className="menu-order-buttons">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={isReorderDisabled || orderedItems[0]?.id === item.id}
                            onClick={() => void handleStepMove(item.id, 'up')}
                            title={search.trim() ? 'Clear search to move menu items.' : 'Move item up'}
                            aria-label={`Move ${item.name} up`}
                          >
                            <ArrowUp size={15} />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={isReorderDisabled || orderedItems[orderedItems.length - 1]?.id === item.id}
                            onClick={() => void handleStepMove(item.id, 'down')}
                            title={search.trim() ? 'Clear search to move menu items.' : 'Move item down'}
                            aria-label={`Move ${item.name} down`}
                          >
                            <ArrowDown size={15} />
                          </Button>
                        </div>
                      </div>
                    </td>
                    <td><div className="row-actions"><ItemFormDialog restaurantId={restaurantId} category={category} item={item} onSaved={() => loadItems()} /><AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="destructive" size="icon" title="Delete item" aria-label={`Delete ${item.name}`}><Trash2 size={16} /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {item.name}?</AlertDialogTitle><AlertDialogDescription>This permanently removes the menu item. Existing order records remain unchanged.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void removeItem(item)}>Delete item</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></td>
                  </tr>
                ))}
                {filteredItems.length === 0 && <tr><td colSpan={7} className="empty-cell">{search.trim() ? 'No menu items match this search.' : 'This category has no menu items yet.'}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="restaurant-mobile-list menu-item-mobile-list" aria-label={`${category.name} menu items`}>
            {filteredItems.map((item) => {
              const imageUrl = resolvePublicAssetUrl(item.imageUrl)
              const optionGroupCount = item.optionGroups.length
              const optionCount = item.optionGroups.reduce((total, group) => total + group.options.length, 0)
              const reorderTitle = search.trim()
                ? 'Clear search to reorder menu items.'
                : orderedItems.length < 2
                  ? 'Add more items to reorder this category.'
                  : 'Drag to reorder items.'

              return (
                <article
                  key={item.id}
                  className={[
                    'restaurant-mobile-card',
                    'menu-item-mobile-card',
                    !isReorderDisabled ? 'is-draggable' : '',
                    draggedItemId === item.id ? 'is-dragging' : '',
                    dropTargetItemId === item.id ? 'is-drop-target' : '',
                  ].filter(Boolean).join(' ')}
                  draggable={!isReorderDisabled}
                  onDragStart={() => setDraggedItemId(item.id)}
                  onDragEnter={() => {
                    if (!isReorderDisabled && draggedItemId && draggedItemId !== item.id) {
                      setDropTargetItemId(item.id)
                    }
                  }}
                  onDragOver={(event) => {
                    if (!isReorderDisabled) {
                      event.preventDefault()
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    void handleDrop(item.id)
                  }}
                  onDragEnd={resetDragState}
                >
                  <header className="restaurant-mobile-card-header menu-item-mobile-card-header">
                    <span className="menu-item-mobile-image">
                      {imageUrl ? <img src={imageUrl} alt="" /> : <ImageIcon size={18} />}
                    </span>
                    <div className="restaurant-mobile-primary">
                      <strong title={item.name}>{item.name}</strong>
                      <span title={item.description || undefined}>{item.description || 'No description'}</span>
                    </div>
                    <Badge variant={item.isAvailable && !item.isSoldOut ? 'secondary' : item.isSoldOut ? 'destructive' : 'outline'}>
                      {item.isSoldOut ? 'Sold out' : item.isAvailable ? 'Live' : 'Hidden'}
                    </Badge>
                  </header>

                  <div className="restaurant-mobile-meta-grid menu-item-mobile-meta-grid">
                    <div className="restaurant-mobile-meta">
                      <CircleDollarSign size={15} />
                      <div>
                        <span>Price</span>
                        <strong>{money.format(item.price)}</strong>
                      </div>
                    </div>
                    <div className="restaurant-mobile-meta">
                      <Layers3 size={15} />
                      <div>
                        <span>Options</span>
                        <strong>{optionGroupCount} group{optionGroupCount === 1 ? '' : 's'}</strong>
                        <small>{optionCount} option{optionCount === 1 ? '' : 's'}</small>
                      </div>
                    </div>
                    <div className="restaurant-mobile-meta">
                      <Utensils size={15} />
                      <div>
                        <span>Available</span>
                        <Switch checked={item.isAvailable} onCheckedChange={(value) => void toggleAvailability(item, value)} aria-label={`${item.name} availability`} />
                      </div>
                    </div>
                    <div className="restaurant-mobile-meta">
                      <Archive size={15} />
                      <div>
                        <span>Sold out</span>
                        <Switch checked={item.isSoldOut} onCheckedChange={(value) => void toggleSoldOut(item, value)} aria-label={`${item.name} sold out status`} />
                      </div>
                    </div>
                  </div>

                  <MenuItemOptionSummary item={item} money={money} onChanged={() => loadItems()} />

                  <div className="restaurant-mobile-actions menu-item-mobile-actions">
                    <div className="menu-order-controls">
                      <button
                        type="button"
                        className="menu-reorder-handle"
                        disabled={isReorderDisabled}
                        aria-label={`Reorder ${item.name}`}
                        title={reorderTitle}
                      >
                        <GripVertical size={16} />
                      </button>
                      <span>{item.displayOrder}</span>
                      <div className="menu-order-buttons">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isReorderDisabled || orderedItems[0]?.id === item.id}
                          onClick={() => void handleStepMove(item.id, 'up')}
                          title={search.trim() ? 'Clear search to move menu items.' : 'Move item up'}
                          aria-label={`Move ${item.name} up`}
                        >
                          <ArrowUp size={15} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isReorderDisabled || orderedItems[orderedItems.length - 1]?.id === item.id}
                          onClick={() => void handleStepMove(item.id, 'down')}
                          title={search.trim() ? 'Clear search to move menu items.' : 'Move item down'}
                          aria-label={`Move ${item.name} down`}
                        >
                          <ArrowDown size={15} />
                        </Button>
                      </div>
                    </div>
                    <div className="row-actions">
                      <ItemFormDialog restaurantId={restaurantId} category={category} item={item} onSaved={() => loadItems()} />
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button type="button" variant="destructive" size="icon" title="Delete item" aria-label={`Delete ${item.name}`}>
                            <Trash2 size={16} />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {item.name}?</AlertDialogTitle>
                            <AlertDialogDescription>This permanently removes the menu item. Existing order records remain unchanged.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={() => void removeItem(item)}>Delete item</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </article>
              )
            })}
            {filteredItems.length === 0 && (
              <div className="restaurant-mobile-empty">
                {search.trim() ? 'No menu items match this search.' : 'This category has no menu items yet.'}
              </div>
            )}
          </div>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function AdminMenuPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [restaurantId, setRestaurantId] = useState('')
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<CategoryStatusFilter>('all')
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null)
  const [dropTargetCategoryId, setDropTargetCategoryId] = useState<string | null>(null)
  const [reorderingCategories, setReorderingCategories] = useState(false)

  const selectedRestaurantId = restaurantId || restaurants[0]?.id || ''
  const selectedRestaurant = restaurants.find((restaurant) => restaurant.id === selectedRestaurantId)

  const loadCategories = async (showToast = false) => {
    if (!selectedRestaurantId) return
    setLoading(true)
    try {
      setCategories(await getAdminMenuCategories(selectedRestaurantId))
      if (showToast) toast.success('Menu categories refreshed')
    } catch (error) {
      toast.error('Could not load menu categories', { description: error instanceof Error ? error.message : 'The request failed.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    getRestaurants()
      .then((items) => setRestaurants(items))
      .catch((error) => toast.error('Could not load restaurants', { description: error instanceof Error ? error.message : 'The request failed.' }))
  }, [])

  useEffect(() => {
    let active = true

    if (!selectedRestaurantId) {
      return () => { active = false }
    }

    getAdminMenuCategories(selectedRestaurantId)
      .then((items) => {
        if (active) setCategories(items)
      })
      .catch((error) => {
        if (!active) return
        toast.error('Could not load menu categories', {
          description: error instanceof Error ? error.message : 'The request failed.',
        })
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => { active = false }
  }, [selectedRestaurantId])

  const orderedCategories = useMemo(() => sortMenuCategories(categories), [categories])

  const filteredCategories = useMemo(() => {
    const term = search.trim().toLowerCase()
    return orderedCategories
      .filter((category) => !term || [category.name, category.description ?? ''].some((value) => value.toLowerCase().includes(term)))
      .filter((category) => statusFilter === 'all' || (statusFilter === 'active' ? category.isActive : !category.isActive))
  }, [orderedCategories, search, statusFilter])

  const hasFilters = search.trim() !== '' || statusFilter !== 'all'
  const selectedStatusFilterLabel = statusFilter === 'active' ? 'Active' : statusFilter === 'inactive' ? 'Inactive' : ''
  const activeDropdownFilterCount = statusFilter !== 'all' ? 1 : 0
  const isCategoryReorderDisabled = loading || reorderingCategories || hasFilters || orderedCategories.length < 2

  const resetFilters = () => {
    setSearch('')
    setStatusFilter('all')
  }

  const resetCategoryDragState = () => {
    setDraggedCategoryId(null)
    setDropTargetCategoryId(null)
  }

  const handleCategoryDrop = async (targetCategoryId: string) => {
    if (!draggedCategoryId || draggedCategoryId === targetCategoryId || isCategoryReorderDisabled) {
      resetCategoryDragState()
      return
    }

    const previousCategories = categories
    const reorderedCategories = moveMenuCategory(orderedCategories, draggedCategoryId, targetCategoryId)

    if (reorderedCategories === orderedCategories) {
      resetCategoryDragState()
      return
    }

    setCategories(reorderedCategories)
    setReorderingCategories(true)
    resetCategoryDragState()

    try {
      const response = await reorderMenuCategories({
        restaurantId: selectedRestaurantId,
        categoryIds: reorderedCategories.map((category) => category.id),
      })
      toast.success('Category order updated', { description: response.message })
    } catch (error) {
      setCategories(previousCategories)
      toast.error('Could not reorder categories', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setReorderingCategories(false)
    }
  }

  return (
    <main className="content-grid">
      <Card id="menu-categories">
        <CardHeader className="section-header">
          <div className="admin-page-title"><Utensils size={22} /><div><CardTitle>Menu Management</CardTitle><CardDescription>Manage restaurant categories, menu items, visibility, and sold-out state.</CardDescription></div></div>
          <div className="section-actions">
            {selectedRestaurantId && <CategoryFormDialog restaurantId={selectedRestaurantId} onSaved={() => loadCategories()} />}
            <Button type="button" variant="secondary" onClick={() => void loadCategories(true)} disabled={!selectedRestaurantId || loading}><RefreshCw size={18} />Refresh</Button>
          </div>
        </CardHeader>
        <CardContent className="menu-management-content">
          <div className="menu-directory-tools restaurant-filter-tools">
            <div className="menu-directory-restaurant-row restaurant-table-selector-row">
              <Select
                value={selectedRestaurantId}
                onValueChange={(value) => {
                  setRestaurantId(value)
                  setCategories([])
                  setLoading(true)
                  resetFilters()
                }}
                disabled={restaurants.length === 0}
              >
                <SelectTrigger><SelectValue placeholder="Select restaurant" /></SelectTrigger>
                <SelectContent position="popper">
                  {restaurants.map((restaurant) => <SelectItem key={restaurant.id} value={restaurant.id}>{restaurant.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="menu-directory-filter-row">
              <div className="restaurant-filter-search-row menu-directory-search-row">
                <div className="directory-search">
                  <Search size={16} />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter categories" />
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="restaurant-filter-trigger"
                      aria-label="Filter menu categories"
                    >
                      <SlidersHorizontal size={16} />
                      {activeDropdownFilterCount > 0 && (
                        <span className="restaurant-filter-count">{activeDropdownFilterCount}</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="restaurant-filter-popover menu-filter-popover" align="end">
                    <div className="restaurant-filter-popover-header">
                      <strong>Filters</strong>
                      <Button type="button" variant="ghost" size="xs" onClick={resetFilters} disabled={!hasFilters}>
                        <X size={13} />
                        Clear all
                      </Button>
                    </div>
                    <div className="restaurant-filter-fields">
                      <div className="restaurant-filter-field">
                        <span>Status</span>
                        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as CategoryStatusFilter)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent position="popper">
                            <SelectItem value="all">All statuses</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="restaurant-inline-filters menu-directory-inline-filters">
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as CategoryStatusFilter)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="button" variant="ghost" size="icon" disabled={!hasFilters} onClick={resetFilters} title="Clear filters" aria-label="Clear filters">
                  <X size={16} />
                </Button>
              </div>
            </div>

            {hasFilters && (
              <div className="restaurant-filter-chips menu-filter-chips" aria-label="Active menu filters">
                {search.trim() && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => setSearch('')} title={`Search: ${search.trim()}`}>
                    <span>Search: {search.trim()}</span>
                    <X size={13} />
                  </button>
                )}
                {statusFilter !== 'all' && (
                  <button type="button" className="restaurant-filter-chip" onClick={() => setStatusFilter('all')} title={`Status: ${selectedStatusFilterLabel}`}>
                    <span>Status: {selectedStatusFilterLabel}</span>
                    <X size={13} />
                  </button>
                )}
                <button type="button" className="restaurant-filter-chip restaurant-filter-chip-clear" onClick={resetFilters}>
                  <X size={13} />
                  <span>Clear all</span>
                </button>
              </div>
            )}
          </div>
          {selectedRestaurant && <p className="restaurant-table-scope">Managing menu for <strong>{selectedRestaurant.name}</strong></p>}
          {loading ? (
            <div className="restaurant-loading"><motion.span animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}><RefreshCw size={18} /></motion.span>Loading menu categories...</div>
          ) : (
            <div id="menu-items" className="menu-category-list">
              {filteredCategories.map((category) => (
                <div
                  key={category.id}
                  className={[
                    'menu-category-shell',
                    !isCategoryReorderDisabled ? 'is-draggable' : '',
                    draggedCategoryId === category.id ? 'is-dragging' : '',
                    dropTargetCategoryId === category.id ? 'is-drop-target' : '',
                  ].filter(Boolean).join(' ')}
                  draggable={!isCategoryReorderDisabled}
                  onDragStart={() => setDraggedCategoryId(category.id)}
                  onDragEnter={() => {
                    if (!isCategoryReorderDisabled && draggedCategoryId && draggedCategoryId !== category.id) {
                      setDropTargetCategoryId(category.id)
                    }
                  }}
                  onDragOver={(event) => {
                    if (!isCategoryReorderDisabled) {
                      event.preventDefault()
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    void handleCategoryDrop(category.id)
                  }}
                  onDragEnd={resetCategoryDragState}
                >
                  <CategoryMenuSection
                    restaurantId={selectedRestaurantId}
                    category={category}
                    currency={selectedRestaurant?.currency ?? 'AUD'}
                    onCategoriesChanged={() => loadCategories()}
                    categoryReorderDisabled={isCategoryReorderDisabled}
                    categoryDragTitle={
                      hasFilters
                        ? 'Clear filters to reorder categories.'
                        : orderedCategories.length < 2
                          ? 'Add more categories to reorder them.'
                          : 'Drag to reorder categories.'
                    }
                  />
                </div>
              ))}
              {filteredCategories.length === 0 && <div className="menu-empty-state"><Layers3 size={26} /><strong>{hasFilters ? 'No matching categories' : 'No menu categories yet'}</strong><span>{hasFilters ? 'Clear the filters to see the full menu.' : 'Create the first category to begin building this restaurant menu.'}</span></div>}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
