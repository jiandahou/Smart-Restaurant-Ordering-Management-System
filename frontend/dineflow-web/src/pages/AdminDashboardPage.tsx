import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Armchair,
  ChevronDown,
  ClipboardList,
  Copy,
  CreditCard,
  ExternalLink,
  LayoutDashboard,
  LogIn,
  QrCode,
  RefreshCw,
  Store,
  Utensils,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  getAdminOrders,
  getRestaurants,
  getRestaurantTables,
  type AdminOrder,
  type AuthUser,
  type Restaurant,
  type RestaurantTable,
} from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog'
import { buildTablePublicUrl, buildTakeawayPublicUrl } from '../lib/publicUrls'
import { getOrderStats } from '../lib/orderStats'

type DashboardRestaurant = Pick<Restaurant, 'id' | 'name' | 'isActive' | 'currency'>

const demoLoginEnabled = import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true'
const demoSeedPassword = import.meta.env.VITE_DEMO_SEED_PASSWORD || 'DineFlow123!'

const demoIdentities = [
  {
    label: 'Restaurant owner',
    email: 'owner.one@dineflow.test',
    role: 'RestaurantOwner',
  },
  {
    label: 'Admin',
    email: 'admin.one.a@dineflow.test',
    role: 'Admin',
  },
  {
    label: 'Staff',
    email: 'staff.one.a@dineflow.test',
    role: 'Staff',
  },
  {
    label: 'Customer',
    email: 'customer.one@dineflow.test',
    role: 'Customer',
  },
]

function formatMoney(amount: number, currencyCode?: string | null) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: (currencyCode || 'AUD').toUpperCase(),
  }).format(amount)
}

async function copyText(value: string, successMessage: string) {
  await navigator.clipboard.writeText(value)
  toast.success(successMessage)
}

function hasRole(user: AuthUser | null, role: string) {
  return Boolean(user?.roles.includes(role))
}

function getScopedRestaurantFromOrders(user: AuthUser | null, orders: AdminOrder[]): DashboardRestaurant | null {
  const restaurantId = user?.restaurantId ?? orders.find((order) => order.restaurantId)?.restaurantId

  if (!restaurantId) {
    return null
  }

  const matchingOrder = orders.find((order) => order.restaurantId === restaurantId)

  return {
    id: restaurantId,
    name: matchingOrder?.restaurantName || 'Assigned restaurant',
    isActive: true,
    currency: matchingOrder?.currency || 'AUD',
  }
}

function PublicMenuCard({
  restaurant,
  canShowTableUrls,
}: {
  restaurant: DashboardRestaurant
  canShowTableUrls: boolean
}) {
  const url = buildTakeawayPublicUrl(restaurant.id)
  const [open, setOpen] = useState(false)
  const [tables, setTables] = useState<RestaurantTable[]>([])
  const [loadingTables, setLoadingTables] = useState(false)
  const [tablesLoaded, setTablesLoaded] = useState(false)
  const [tablesError, setTablesError] = useState<string | null>(null)

  const loadTables = async () => {
    if (!canShowTableUrls || tablesLoaded || loadingTables) {
      return
    }

    setLoadingTables(true)
    setTablesError(null)

    try {
      setTables(await getRestaurantTables(restaurant.id))
      setTablesLoaded(true)
    } catch (error) {
      setTablesError(error instanceof Error ? error.message : 'Table loading failed.')
    } finally {
      setLoadingTables(false)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      void loadTables()
    }
  }

  const tablesWithUrls = tables
    .filter((table) => table.isActive && table.qrToken)
    .toSorted((first, second) => first.tableNumber.localeCompare(second.tableNumber, undefined, { numeric: true }))

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange} className="dashboard-url-card">
      <div className="dashboard-url-card-main">
        <CollapsibleTrigger asChild disabled={!canShowTableUrls}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="dashboard-url-expand"
            aria-label={open ? `Collapse ${restaurant.name} table URLs` : `Expand ${restaurant.name} table URLs`}
            title={canShowTableUrls ? 'Show table URLs' : 'Table URLs are available to admin roles only'}
          >
            <ChevronDown size={17} />
          </Button>
        </CollapsibleTrigger>
        <div>
          <div className="dashboard-url-card-title">
            <Store size={17} />
            <strong>{restaurant.name}</strong>
            <Badge variant={restaurant.isActive ? 'secondary' : 'outline'}>
              {restaurant.isActive ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          <code>{url}</code>
        </div>
        <div className="dashboard-card-actions">
          <Button type="button" variant="outline" size="sm" onClick={() => void copyText(url, 'Public menu URL copied')}>
            <Copy size={15} />
            Copy
          </Button>
          <QrCodeDialogButton
            title={`${restaurant.name} QR code`}
            description="Scan to open this restaurant public menu."
            url={url}
          />
          <Button type="button" variant="secondary" size="sm" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink size={15} />
              Open
            </a>
          </Button>
        </div>
      </div>
      {canShowTableUrls && (
        <CollapsibleContent>
          <div className="dashboard-table-url-panel">
            {loadingTables && <div className="dashboard-empty-state">Loading table URLs...</div>}
            {tablesError && <p className="form-error">{tablesError}</p>}
            {!loadingTables && !tablesError && tablesWithUrls.map((table) => {
              const tableUrl = buildTablePublicUrl(table.qrToken!)

              return (
                <div key={table.id} className="dashboard-table-url-row">
                  <div>
                    <span className="dashboard-table-url-title">
                      <Armchair size={15} />
                      <strong>Table {table.tableNumber}</strong>
                      <small>{table.capacity} seats</small>
                    </span>
                    <code>{tableUrl}</code>
                  </div>
                  <div className="dashboard-card-actions">
                    <Button type="button" variant="outline" size="sm" onClick={() => void copyText(tableUrl, `Table ${table.tableNumber} URL copied`)}>
                      <Copy size={15} />
                      Copy
                    </Button>
                    <QrCodeDialogButton
                      title={`Table ${table.tableNumber} QR code`}
                      description={`Scan to open table ${table.tableNumber} ordering.`}
                      url={tableUrl}
                    />
                    <Button type="button" variant="secondary" size="sm" asChild>
                      <a href={tableUrl} target="_blank" rel="noreferrer">
                        <ExternalLink size={15} />
                        Open
                      </a>
                    </Button>
                  </div>
                </div>
              )
            })}
            {!loadingTables && !tablesError && tablesLoaded && tablesWithUrls.length === 0 && (
              <div className="dashboard-empty-state">No active table URLs are available for this restaurant.</div>
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

function QrCodeDialogButton({
  title,
  description,
  url,
}: {
  title: string
  description: string
  url: string
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <QrCode size={15} />
          QR
        </Button>
      </DialogTrigger>
      <DialogContent className="dashboard-qr-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="dashboard-qr-dialog-body">
          <QRCodeSVG value={url} size={220} />
          <code>{url}</code>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="dashboard-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

function DemoIdentitySwitcher() {
  const { loginUser } = useAuth()
  const navigate = useNavigate()
  const [switchingEmail, setSwitchingEmail] = useState<string | null>(null)

  const switchIdentity = async (email: string, role: string) => {
    setSwitchingEmail(email)

    try {
      await loginUser(email, demoSeedPassword)
      toast.success(`Switched to ${role}`)
      navigate(role === 'Customer' ? '/me' : '/admin')
    } catch (error) {
      toast.error('Could not switch identity', {
        description: error instanceof Error ? error.message : 'Seed login failed.',
      })
    } finally {
      setSwitchingEmail(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="admin-page-title">
          <LogIn size={22} />
          <div>
            <CardTitle>Demo identity switcher</CardTitle>
            <CardDescription>Quickly check the seeded roles without leaving the console.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="dashboard-identity-grid">
          {demoIdentities.map((identity) => (
            <button
              key={identity.email}
              type="button"
              className="dashboard-identity-card"
              onClick={() => void switchIdentity(identity.email, identity.role)}
              disabled={switchingEmail !== null}
            >
              <span>{identity.label}</span>
              <strong>{identity.email}</strong>
              <small>{switchingEmail === identity.email ? 'Signing in...' : identity.role}</small>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function AdminDashboardPage() {
  const { user } = useAuth()
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [restaurants, setRestaurants] = useState<DashboardRestaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isPlatformOwner = hasRole(user, 'PlatformOwner')
  const isStaff = hasRole(user, 'Staff') && !hasRole(user, 'Admin') && !hasRole(user, 'RestaurantOwner') && !isPlatformOwner
  const canLoadRestaurantDirectory = !isStaff

  const loadDashboard = useCallback(async (showToast = false) => {
    setLoading(true)
    setError(null)

    try {
      const loadedOrders = await getAdminOrders()
      setOrders(loadedOrders)

      if (canLoadRestaurantDirectory) {
        const loadedRestaurants = await getRestaurants()
        setRestaurants(loadedRestaurants)
      } else {
        const scopedRestaurant = getScopedRestaurantFromOrders(user, loadedOrders)
        setRestaurants(scopedRestaurant ? [scopedRestaurant] : [])
      }

      if (showToast) {
        toast.success('Dashboard refreshed')
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Dashboard loading failed.'
      setError(message)
      toast.error('Could not load dashboard', { description: message })
    } finally {
      setLoading(false)
    }
  }, [canLoadRestaurantDirectory, user])

  useEffect(() => {
    void Promise.resolve().then(() => loadDashboard())
  }, [loadDashboard])

  const activeRestaurants = useMemo(
    () => restaurants
      .filter((restaurant) => restaurant.isActive)
      .toSorted((first, second) => first.name.localeCompare(second.name))
      .slice(0, isPlatformOwner ? 4 : 1),
    [isPlatformOwner, restaurants],
  )

  const scopedCurrency = activeRestaurants[0]?.currency || orders[0]?.currency || 'AUD'
  const stats = useMemo(() => getOrderStats(orders), [orders])
  const recentOrders = orders.slice(0, 5)

  return (
    <main className="content-grid dashboard-page">
      <Card>
        <CardHeader>
          <div className="section-header">
            <div className="admin-page-title">
              <LayoutDashboard size={22} />
              <div>
                <CardTitle>Dashboard</CardTitle>
                <CardDescription>
                  {isPlatformOwner
                    ? 'Platform shortcuts, restaurant access, and live operations.'
                    : isStaff
                      ? 'Your order queue, payment context, and reserved staff actions.'
                      : 'Restaurant shortcuts, order activity, and payment context.'}
                </CardDescription>
              </div>
            </div>
            <Button type="button" variant="secondary" onClick={() => void loadDashboard(true)} disabled={loading}>
              <RefreshCw size={18} />
              {loading ? 'Refreshing' : 'Refresh'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="dashboard-stack">
          {error && <p className="form-error">{error}</p>}
          <div className="dashboard-metrics-grid">
            <MetricCard label="Orders" value={stats.total} detail="Visible to this role" />
            <MetricCard label="Kitchen active" value={stats.activeKitchen} detail="Pending through ready" />
            <MetricCard label="Paid" value={stats.paid} detail={formatMoney(stats.revenue, scopedCurrency)} />
            <MetricCard label="Awaiting payment" value={stats.pendingPayment} detail={`${stats.payable} payable`} />
          </div>
        </CardContent>
      </Card>

      <div className="dashboard-two-column">
        <Card>
          <CardHeader>
            <div className="admin-page-title">
              <Utensils size={22} />
              <div>
                <CardTitle>{isPlatformOwner ? 'Public restaurant URLs' : 'Restaurant menu URL'}</CardTitle>
                <CardDescription>
                  {isPlatformOwner
                    ? 'Open or copy a few active restaurant menu links for quick checks.'
                    : 'Open or copy the assigned restaurant public ordering entry.'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="dashboard-url-list">
              {activeRestaurants.map((restaurant) => (
                <PublicMenuCard
                  key={restaurant.id}
                  restaurant={restaurant}
                  canShowTableUrls={canLoadRestaurantDirectory}
                />
              ))}
              {!loading && activeRestaurants.length === 0 && (
                <div className="dashboard-empty-state">No active restaurant URL is available for this account.</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="admin-page-title">
              <ClipboardList size={22} />
              <div>
                <CardTitle>{isStaff ? 'Staff order panel' : 'Recent orders'}</CardTitle>
                <CardDescription>
                  {isStaff
                    ? 'Order processing controls are reserved for the next task.'
                    : 'A quick read on the newest visible orders.'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="dashboard-order-list">
              {recentOrders.map((order) => (
                <div key={order.id} className="dashboard-order-row">
                  <div>
                    <strong>{order.orderNumber}</strong>
                    <span>{order.restaurantName || 'Assigned restaurant'} - {order.tableNumber ? `Table ${order.tableNumber}` : order.orderType}</span>
                  </div>
                  <div className="dashboard-order-state">
                    <Badge variant="secondary">{order.status}</Badge>
                    <Badge variant={order.paymentStatus === 'Paid' ? 'default' : 'outline'}>{order.paymentStatus}</Badge>
                  </div>
                  {isStaff && (
                    <Button type="button" variant="outline" size="sm" disabled>
                      Process soon
                    </Button>
                  )}
                </div>
              ))}
              {!loading && recentOrders.length === 0 && (
                <div className="dashboard-empty-state">No orders are visible yet.</div>
              )}
            </div>
            <div className="dashboard-card-footer">
              <Button type="button" variant="secondary" asChild>
                <Link to="/admin/orders">
                  <ClipboardList size={16} />
                  Open orders
                </Link>
              </Button>
              {!isStaff && (
                <Button type="button" variant="outline" asChild>
                  <Link to="/admin/payments">
                    <CreditCard size={16} />
                    Open payments
                  </Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {isPlatformOwner && demoLoginEnabled && <DemoIdentitySwitcher />}
    </main>
  )
}
