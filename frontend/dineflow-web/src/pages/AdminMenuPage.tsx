import { useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import {
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
  Search,
  Trash2,
  Utensils,
  X,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  createMenuCategory,
  createMenuItem,
  deleteMenuCategory,
  deleteMenuItem,
  getAdminMenuCategories,
  getAdminMenuItems,
  getRestaurants,
  reorderMenuCategories,
  reorderMenuItems,
  updateMenuCategory,
  updateMenuItem,
  updateMenuItemAvailability,
  updateMenuItemSoldOut,
  uploadMenuItemImage,
  type MenuCategory,
  type MenuItem,
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

type CategoryFormValues = z.infer<typeof categorySchema>
type ItemFormValues = z.infer<typeof itemSchema>
type CategoryStatusFilter = 'all' | 'active' | 'inactive'

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
      .filter((item) => !term || [item.name, item.description ?? ''].some((value) => value.toLowerCase().includes(term)))
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
          <div className="table-wrap">
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
                    <td><div className="menu-item-name">{resolvePublicAssetUrl(item.imageUrl) ? <img src={resolvePublicAssetUrl(item.imageUrl) ?? undefined} alt="" /> : <span><ImageIcon size={17} /></span>}<div><strong>{item.name}</strong><small>{item.description || 'No description'}</small></div></div></td>
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
  const isCategoryReorderDisabled = loading || reorderingCategories || hasFilters || orderedCategories.length < 2

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
      <Card>
        <CardHeader className="section-header">
          <div className="admin-page-title"><Utensils size={22} /><div><CardTitle>Menu Management</CardTitle><CardDescription>Manage restaurant categories, menu items, visibility, and sold-out state.</CardDescription></div></div>
          <div className="section-actions">
            {selectedRestaurantId && <CategoryFormDialog restaurantId={selectedRestaurantId} onSaved={() => loadCategories()} />}
            <Button type="button" variant="secondary" onClick={() => void loadCategories(true)} disabled={!selectedRestaurantId || loading}><RefreshCw size={18} />Refresh</Button>
          </div>
        </CardHeader>
        <CardContent className="menu-management-content">
          <div className="menu-directory-tools">
            <Select value={selectedRestaurantId} onValueChange={(value) => { setRestaurantId(value); setCategories([]); setLoading(true); setSearch(''); setStatusFilter('all') }} disabled={restaurants.length === 0}>
              <SelectTrigger><SelectValue placeholder="Select restaurant" /></SelectTrigger>
              <SelectContent position="popper">{restaurants.map((restaurant) => <SelectItem key={restaurant.id} value={restaurant.id}>{restaurant.name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="directory-search"><Search size={16} /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter categories" /></div>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as CategoryStatusFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger><SelectContent position="popper"><SelectItem value="all">All statuses</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="icon" disabled={!hasFilters} onClick={() => { setSearch(''); setStatusFilter('all') }} title="Clear filters" aria-label="Clear filters"><X size={16} /></Button>
          </div>
          {selectedRestaurant && <p className="restaurant-table-scope">Managing menu for <strong>{selectedRestaurant.name}</strong></p>}
          {loading ? (
            <div className="restaurant-loading"><motion.span animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}><RefreshCw size={18} /></motion.span>Loading menu categories...</div>
          ) : (
            <div className="menu-category-list">
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
