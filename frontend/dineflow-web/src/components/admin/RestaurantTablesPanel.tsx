import { useEffect, useMemo, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowDownAZ, ArrowUpAZ, Armchair, Copy, ExternalLink, Pencil, Plus, QrCode, RefreshCw, Search, SlidersHorizontal, UsersRound, X } from 'lucide-react'
import { motion } from 'motion/react'
import { QRCodeSVG } from 'qrcode.react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  createRestaurantTable,
  getRestaurantTables,
  updateRestaurantTable,
  type Restaurant,
  type RestaurantTable,
} from '../../api/auth'
import { buildTablePublicUrl } from '../../lib/publicUrls'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../ui/form'
import { Input } from '../ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'

const tableSchema = z.object({
  tableNumber: z.string().trim().min(1, 'Table number is required.').max(40),
  capacity: z.number().int('Capacity must be a whole number.').min(1).max(100),
  isActive: z.boolean(),
})

type TableFormValues = z.infer<typeof tableSchema>
type TableSortKey = 'tableNumber' | 'capacity' | 'status' | 'updated'
type SortDirection = 'asc' | 'desc'
type TableStatusFilter = 'all' | 'active' | 'inactive'
type CapacityFilter = 'all' | 'small' | 'medium' | 'large' | 'extra-large'
type QrFilter = 'all' | 'available' | 'missing'

const emptyTable: TableFormValues = {
  tableNumber: '',
  capacity: 2,
  isActive: true,
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

async function copyText(value: string, successMessage: string) {
  await navigator.clipboard.writeText(value)
  toast.success(successMessage)
}

function TablePublicAccessDialog({ table }: { table: RestaurantTable }) {
  if (!table.qrToken) {
    return null
  }

  const publicUrl = buildTablePublicUrl(table.qrToken)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label={`Open QR access for ${table.tableNumber}`} title="Public table access">
          <QrCode size={16} />
        </Button>
      </DialogTrigger>
      <DialogContent className="restaurant-table-dialog">
        <DialogHeader>
          <DialogTitle>Table {table.tableNumber} public access</DialogTitle>
          <DialogDescription>Use this QR code or link for customer dine-in ordering at this table.</DialogDescription>
        </DialogHeader>
        <div className="restaurant-public-card">
          <div className="restaurant-public-card-copy">
            <div className="restaurant-public-card-body">
              <div>
                <span>Table URL</span>
                <strong>Customer ordering entry for {table.tableNumber}</strong>
              </div>
              <code>{publicUrl}</code>
              <div className="restaurant-table-qr">
                <QrCode size={18} />
                <div><span>QR token</span><code>{table.qrToken}</code></div>
              </div>
            </div>
            <div className="restaurant-public-card-actions">
              <Button type="button" variant="outline" size="sm" onClick={() => void copyText(publicUrl, 'Table URL copied')}>
                <Copy size={15} />
                Copy link
              </Button>
              <Button type="button" variant="secondary" size="sm" asChild>
                <a href={publicUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={15} />
                  Open
                </a>
              </Button>
            </div>
          </div>
          <div className="restaurant-public-card-qr">
            <QRCodeSVG value={publicUrl} size={132} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type TableFormDialogProps = {
  restaurantId: string
  table?: RestaurantTable
  onSaved: () => Promise<void> | void
}

function TableFormDialog({ restaurantId, table, onSaved }: TableFormDialogProps) {
  const [open, setOpen] = useState(false)
  const editing = Boolean(table)
  const form = useForm<TableFormValues>({
    resolver: zodResolver(tableSchema),
    defaultValues: emptyTable,
  })

  useEffect(() => {
    if (open) {
      form.reset(table ? {
        tableNumber: table.tableNumber,
        capacity: table.capacity,
        isActive: table.isActive,
      } : emptyTable)
    }
  }, [form, open, table])

  const handleSubmit = async (values: TableFormValues) => {
    try {
      const payload = {
        tableNumber: values.tableNumber.trim(),
        capacity: values.capacity,
        isActive: values.isActive,
      }
      const response = table
        ? await updateRestaurantTable(table.id, payload)
        : await createRestaurantTable(restaurantId, payload)
      toast.success(table ? 'Table updated' : 'Table created', { description: response.message })
      setOpen(false)
      await onSaved()
    } catch (error) {
      toast.error(table ? 'Could not update table' : 'Could not create table', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button type="button" variant="outline" size="icon" aria-label={`Edit table ${table?.tableNumber}`} title="Edit table">
            <Pencil size={16} />
          </Button>
        ) : (
          <Button type="button"><Plus size={18} />Create table</Button>
        )}
      </DialogTrigger>
      <DialogContent className="restaurant-table-dialog">
        <DialogHeader>
          <DialogTitle>{table ? `Edit table ${table.tableNumber}` : 'Create table'}</DialogTitle>
          <DialogDescription>
            {table ? 'Update seating capacity and whether this table can receive orders.' : 'Add a table to the selected restaurant. QR setup can be added later.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="restaurant-form" onSubmit={form.handleSubmit(handleSubmit)}>
            <div className="restaurant-form-grid">
              <FormField
                control={form.control}
                name="tableNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Table number</FormLabel>
                    <FormControl><Input placeholder="T1" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="capacity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Capacity</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        step={1}
                        {...field}
                        onChange={(event) => field.onChange(event.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="restaurant-status-field restaurant-form-wide">
                    <div>
                      <FormLabel>Table available</FormLabel>
                      <p>Inactive tables cannot be resolved for customer ordering.</p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Table active status" />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
            {table?.qrToken && (
              <div className="restaurant-table-qr">
                <QrCode size={18} />
                <div><span>QR token</span><code>{table.qrToken}</code></div>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving table' : table ? 'Save changes' : 'Create table'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

type RestaurantTablesPanelProps = {
  restaurants: Restaurant[]
  restaurantsLoading: boolean
  canSelectRestaurant: boolean
}

export function RestaurantTablesPanel({ restaurants, restaurantsLoading, canSelectRestaurant }: RestaurantTablesPanelProps) {
  const [restaurantId, setRestaurantId] = useState('')
  const [tables, setTables] = useState<RestaurantTable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<TableStatusFilter>('all')
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>('all')
  const [qrFilter, setQrFilter] = useState<QrFilter>('all')
  const [sort, setSort] = useState<{ key: TableSortKey; direction: SortDirection }>({ key: 'tableNumber', direction: 'asc' })

  const selectedRestaurantId = restaurantId || restaurants[0]?.id || ''
  const selectedRestaurant = restaurants.find((restaurant) => restaurant.id === selectedRestaurantId)

  const loadTables = async (showToast = false) => {
    if (!selectedRestaurantId) {
      setTables([])
      return
    }

    setLoading(true)
    setError(null)
    try {
      setTables(await getRestaurantTables(selectedRestaurantId))
      if (showToast) toast.success('Restaurant tables refreshed')
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load restaurant tables.'
      setError(message)
      toast.error('Could not load restaurant tables', { description: message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true

    if (!selectedRestaurantId) {
      return () => { active = false }
    }

    getRestaurantTables(selectedRestaurantId)
      .then((items) => { if (active) setTables(items) })
      .catch((loadError) => {
        if (!active) return
        const message = loadError instanceof Error ? loadError.message : 'Failed to load restaurant tables.'
        setError(message)
        toast.error('Could not load restaurant tables', { description: message })
      })
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false }
  }, [selectedRestaurantId])

  const filteredTables = useMemo(() => {
    const term = search.trim().toLowerCase()
    const direction = sort.direction === 'asc' ? 1 : -1

    return tables
      .filter((table) => !term || table.tableNumber.toLowerCase().includes(term))
      .filter((table) => statusFilter === 'all' || (statusFilter === 'active' ? table.isActive : !table.isActive))
      .filter((table) => {
        if (capacityFilter === 'small') return table.capacity <= 2
        if (capacityFilter === 'medium') return table.capacity >= 3 && table.capacity <= 4
        if (capacityFilter === 'large') return table.capacity >= 5 && table.capacity <= 6
        if (capacityFilter === 'extra-large') return table.capacity >= 7
        return true
      })
      .filter((table) => qrFilter === 'all' || (qrFilter === 'available' ? Boolean(table.qrToken) : !table.qrToken))
      .toSorted((first, second) => {
        if (sort.key === 'capacity') return (first.capacity - second.capacity) * direction
        if (sort.key === 'status') return (Number(first.isActive) - Number(second.isActive)) * direction
        if (sort.key === 'updated') return ((first.updatedAt ?? first.createdAt).localeCompare(second.updatedAt ?? second.createdAt)) * direction
        return first.tableNumber.localeCompare(second.tableNumber, undefined, { numeric: true }) * direction
      })
  }, [capacityFilter, qrFilter, search, sort, statusFilter, tables])

  const hasActiveFilters = search.trim() !== '' || statusFilter !== 'all' || capacityFilter !== 'all' || qrFilter !== 'all'
  const activeTableDropdownFilterCount = [
    statusFilter !== 'all',
    capacityFilter !== 'all',
    qrFilter !== 'all',
  ].filter(Boolean).length
  const selectedStatusFilterLabel = statusFilter === 'active' ? 'Active' : statusFilter === 'inactive' ? 'Inactive' : ''
  const selectedCapacityFilterLabel =
    capacityFilter === 'small'
      ? '1-2 seats'
      : capacityFilter === 'medium'
        ? '3-4 seats'
        : capacityFilter === 'large'
          ? '5-6 seats'
          : capacityFilter === 'extra-large'
            ? '7+ seats'
            : ''
  const selectedQrFilterLabel = qrFilter === 'available' ? 'QR available' : qrFilter === 'missing' ? 'QR missing' : ''
  const SortIcon = sort.direction === 'asc' ? ArrowDownAZ : ArrowUpAZ

  const updateSort = (key: TableSortKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  const resetFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setCapacityFilter('all')
    setQrFilter('all')
  }
  const renderTableActions = (table: RestaurantTable) => (
    <div className="row-actions">
      {table.qrToken ? <TablePublicAccessDialog table={table} /> : null}
      <TableFormDialog restaurantId={table.restaurantId} table={table} onSaved={() => loadTables()} />
    </div>
  )

  return (
    <Card id="restaurant-tables">
      <CardHeader className="section-header">
        <div className="admin-page-title">
          <Armchair size={22} />
          <div>
            <CardTitle>Restaurant Tables</CardTitle>
            <CardDescription>View and maintain seating for the selected restaurant.</CardDescription>
          </div>
        </div>
        <div className="section-actions">
          {selectedRestaurantId && <TableFormDialog restaurantId={selectedRestaurantId} onSaved={() => loadTables()} />}
          <Button type="button" variant="secondary" onClick={() => void loadTables(true)} disabled={loading || !selectedRestaurantId}>
            <RefreshCw size={18} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="restaurant-tables-content">
        <div className="restaurant-table-tools restaurant-table-filter-tools">
          {canSelectRestaurant && (
            <div className="restaurant-table-selector-row">
              <Select
                value={selectedRestaurantId}
                onValueChange={(value) => {
                  setRestaurantId(value)
                  resetFilters()
                  setLoading(true)
                  setError(null)
                }}
                disabled={restaurantsLoading || restaurants.length === 0}
              >
                <SelectTrigger><SelectValue placeholder="Select restaurant" /></SelectTrigger>
                <SelectContent position="popper">
                  {restaurants.map((restaurant) => (
                    <SelectItem key={restaurant.id} value={restaurant.id}>{restaurant.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="restaurant-table-context-row">
            <div className="directory-search">
              <Search size={16} />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter by table number" />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="icon" className="restaurant-filter-trigger" aria-label="Filter tables">
                  <SlidersHorizontal size={16} />
                  {activeTableDropdownFilterCount > 0 && (
                    <span className="restaurant-filter-count">{activeTableDropdownFilterCount}</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="restaurant-filter-popover" align="end">
                <div className="restaurant-filter-popover-header">
                  <strong>Filters</strong>
                  <Button type="button" variant="ghost" size="xs" onClick={resetFilters} disabled={!hasActiveFilters}>
                    <X size={13} />
                    Clear all
                  </Button>
                </div>
                <div className="restaurant-filter-fields">
                  <div className="restaurant-filter-field">
                    <span>Status</span>
                    <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as TableStatusFilter)}>
                      <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="restaurant-filter-field">
                    <span>Capacity</span>
                    <Select value={capacityFilter} onValueChange={(value) => setCapacityFilter(value as CapacityFilter)}>
                      <SelectTrigger><SelectValue placeholder="Capacity" /></SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="all">All capacities</SelectItem>
                        <SelectItem value="small">1-2 seats</SelectItem>
                        <SelectItem value="medium">3-4 seats</SelectItem>
                        <SelectItem value="large">5-6 seats</SelectItem>
                        <SelectItem value="extra-large">7+ seats</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="restaurant-filter-field">
                    <span>QR status</span>
                    <Select value={qrFilter} onValueChange={(value) => setQrFilter(value as QrFilter)}>
                      <SelectTrigger><SelectValue placeholder="QR status" /></SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="all">All QR statuses</SelectItem>
                        <SelectItem value="available">QR available</SelectItem>
                        <SelectItem value="missing">QR missing</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="restaurant-table-inline-filters">
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as TableStatusFilter)}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Select value={capacityFilter} onValueChange={(value) => setCapacityFilter(value as CapacityFilter)}>
              <SelectTrigger><SelectValue placeholder="Capacity" /></SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="all">All capacities</SelectItem>
                <SelectItem value="small">1-2 seats</SelectItem>
                <SelectItem value="medium">3-4 seats</SelectItem>
                <SelectItem value="large">5-6 seats</SelectItem>
                <SelectItem value="extra-large">7+ seats</SelectItem>
              </SelectContent>
            </Select>
            <Select value={qrFilter} onValueChange={(value) => setQrFilter(value as QrFilter)}>
              <SelectTrigger><SelectValue placeholder="QR status" /></SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="all">All QR statuses</SelectItem>
                <SelectItem value="available">QR available</SelectItem>
                <SelectItem value="missing">QR missing</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="icon" onClick={resetFilters} disabled={!hasActiveFilters} title="Clear filters" aria-label="Clear table filters">
              <X size={16} />
            </Button>
          </div>

          {hasActiveFilters && (
            <div className="restaurant-filter-chips" aria-label="Active table filters">
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
              {capacityFilter !== 'all' && (
                <button type="button" className="restaurant-filter-chip" onClick={() => setCapacityFilter('all')} title={`Capacity: ${selectedCapacityFilterLabel}`}>
                  <span>Capacity: {selectedCapacityFilterLabel}</span>
                  <X size={13} />
                </button>
              )}
              {qrFilter !== 'all' && (
                <button type="button" className="restaurant-filter-chip" onClick={() => setQrFilter('all')} title={`QR: ${selectedQrFilterLabel}`}>
                  <span>QR: {selectedQrFilterLabel}</span>
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

        {selectedRestaurant && <p className="restaurant-table-scope">Showing tables for <strong>{selectedRestaurant.name}</strong></p>}
        {error && <p className="form-error">{error}</p>}
        {selectedRestaurantId && loading ? (
          <div className="restaurant-loading" aria-live="polite">
            <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.9, ease: 'linear', repeat: Infinity }}>
              <RefreshCw size={18} />
            </motion.span>
            Loading restaurant tables...
          </div>
        ) : (
          <>
          <div className="table-wrap restaurant-tables-table-wrap">
            <table className="data-table restaurant-tables-table">
              <thead>
                <tr>
                  <th><button type="button" className="sort-button" onClick={() => updateSort('tableNumber')}>Table {sort.key === 'tableNumber' && <SortIcon size={15} />}</button></th>
                  <th><button type="button" className="sort-button" onClick={() => updateSort('capacity')}>Capacity {sort.key === 'capacity' && <SortIcon size={15} />}</button></th>
                  <th><button type="button" className="sort-button" onClick={() => updateSort('status')}>Status {sort.key === 'status' && <SortIcon size={15} />}</button></th>
                  <th>QR</th>
                  <th><button type="button" className="sort-button" onClick={() => updateSort('updated')}>Updated {sort.key === 'updated' && <SortIcon size={15} />}</button></th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTables.map((table) => (
                  <tr key={table.id}>
                    <td><span className="table-name"><Armchair size={16} />{table.tableNumber}</span></td>
                    <td><span className="restaurant-table-capacity"><UsersRound size={15} />{table.capacity}</span></td>
                    <td><Badge variant={table.isActive ? 'secondary' : 'destructive'}>{table.isActive ? 'Active' : 'Inactive'}</Badge></td>
                    <td>
                      {table.qrToken ? (
                        <span className="restaurant-table-qr-status" title={table.qrToken}><QrCode size={15} />Available</span>
                      ) : <span className="table-subtext">Not configured</span>}
                    </td>
                    <td>{table.updatedAt ? formatDate(table.updatedAt) : 'Not updated'}</td>
                    <td>
                      {renderTableActions(table)}
                    </td>
                  </tr>
                ))}
                {filteredTables.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      {!selectedRestaurantId ? 'Select a restaurant to view its tables.' : hasActiveFilters ? 'No tables match the current filters.' : 'This restaurant has no tables yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="restaurant-mobile-list restaurant-table-mobile-list" aria-label="Restaurant tables">
            {filteredTables.map((table) => (
              <article className="restaurant-mobile-card restaurant-table-mobile-card" key={table.id}>
                <header className="restaurant-mobile-card-header">
                  <span className="restaurant-mobile-avatar">
                    <Armchair size={18} />
                  </span>
                  <div className="restaurant-mobile-primary">
                    <strong title={`Table ${table.tableNumber}`}>Table {table.tableNumber}</strong>
                    <span>{table.capacity} seats</span>
                  </div>
                  <Badge variant={table.isActive ? 'secondary' : 'destructive'}>{table.isActive ? 'Active' : 'Inactive'}</Badge>
                </header>
                <div className="restaurant-mobile-meta-grid">
                  <div className="restaurant-mobile-meta">
                    <UsersRound size={15} />
                    <div>
                      <span>Capacity</span>
                      <strong>{table.capacity} seats</strong>
                    </div>
                  </div>
                  <div className="restaurant-mobile-meta">
                    <QrCode size={15} />
                    <div>
                      <span>QR</span>
                      <strong title={table.qrToken ?? undefined}>{table.qrToken ? 'Available' : 'Not configured'}</strong>
                    </div>
                  </div>
                  <div className="restaurant-mobile-meta">
                    <RefreshCw size={15} />
                    <div>
                      <span>Updated</span>
                      <strong>{table.updatedAt ? formatDate(table.updatedAt) : 'Not updated'}</strong>
                    </div>
                  </div>
                </div>
                <div className="restaurant-mobile-actions">
                  {renderTableActions(table)}
                </div>
              </article>
            ))}
            {filteredTables.length === 0 && (
              <div className="restaurant-mobile-empty">
                {!selectedRestaurantId ? 'Select a restaurant to view its tables.' : hasActiveFilters ? 'No tables match the current filters.' : 'This restaurant has no tables yet.'}
              </div>
            )}
          </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
