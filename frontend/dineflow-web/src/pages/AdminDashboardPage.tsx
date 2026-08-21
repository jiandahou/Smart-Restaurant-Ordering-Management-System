import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import {
  Armchair,
  ChevronDown,
  ClipboardList,
  Copy,
  CreditCard,
  ExternalLink,
  LayoutDashboard,
  QrCode,
  RefreshCw,
  Store,
  Utensils,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  getAdminOrders,
  getAdminOrderSummary,
  getCurrentRestaurantTradingStatus,
  getRestaurants,
  getRestaurantTables,
  type AdminOrder,
  type AdminOrderSummary,
  type AuthUser,
  type Restaurant,
  type RestaurantTable,
  type RestaurantTradingStatus,
} from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { formatMoney } from '../lib/formatMoney'
import { describeRevenue } from '../lib/revenueByCurrency'
import { Badge } from '../components/ui/badge'
import { OrderStatusBadge } from '../components/orders/OrderStatusBadge'
import { PaymentStatusBadge } from '../components/orders/PaymentStatusBadge'
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
import {
  OrderingPauseControl,
  RestaurantOpeningHoursPanel,
  RestaurantSpecialCalendarPanel,
  RestaurantStatusBanner,
} from '../components/restaurant/openingHours'
import { DashboardCanvas } from '../components/dashboard/DashboardCanvas'
import { WatchedMenuItemsWidget } from '../components/dashboard/WatchedMenuItemsWidget'
import type { DashboardWidget } from '../components/dashboard/dashboardLayout'

/** The panels need the whole entity (schedule JSON + availability), not just the summary bits. */
const dashboardErrorToastId = 'dashboard-load-error'

type DashboardRestaurant = Restaurant

/**
 * Whether customers can order right now.
 *
 * <p>The raw <c>acceptingOrders</c> column still reads false after a timed pause has expired — the
 * effective answer lives in <c>availability</c>, which is what the public and staff endpoints
 * report. Reading the column left the dashboard showing Paused while orders were already arriving.
 * </p>
 */
function isAcceptingOrders(restaurant: DashboardRestaurant): boolean {
  return restaurant.availability?.acceptingOrders ?? restaurant.acceptingOrders
}

async function copyText(value: string, successMessage: string) {
  await navigator.clipboard.writeText(value)
  toast.success(successMessage)
}

function hasRole(user: AuthUser | null, role: string) {
  return Boolean(user?.roles.includes(role))
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
            {/* The column keeps whatever the pause wrote; availability is what customers get once
                the pause window has passed. */}
            <Badge variant={isAcceptingOrders(restaurant) ? 'outline' : 'destructive'}>
              {isAcceptingOrders(restaurant) ? 'Accepting' : 'Paused'}
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

function MetricCard({
  label,
  value,
  detail,
  tone,
  unavailable = false,
}: {
  label: string
  value: string | number
  detail: string
  tone: 'orders' | 'kitchen' | 'paid' | 'payment'
  /** The load failed, so there is no figure — as opposed to a figure that happens to be zero. */
  unavailable?: boolean
}) {
  return (
    <div className={`dashboard-metric dashboard-metric-${tone}`}>
      <span className="dashboard-metric-label">{label}</span>
      <strong>{unavailable ? '—' : value}</strong>
      <small>{unavailable ? 'Could not be loaded' : detail}</small>
    </div>
  )
}

export function AdminDashboardPage() {
  const { user } = useAuth()
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [stats, setStats] = useState<AdminOrderSummary>({
    total: 0,
    activeKitchen: 0,
    paid: 0,
    pendingPayment: 0,
    failedPayment: 0,
    payable: 0,
    revenue: [],
  })
  const [restaurants, setRestaurants] = useState<DashboardRestaurant[]>([])
  const [tradingStatus, setTradingStatus] = useState<RestaurantTradingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadInFlightRef = useRef(false)

  const isPlatformOwner = hasRole(user, 'PlatformOwner')
  const isStaff = hasRole(user, 'Staff') && !hasRole(user, 'Admin') && !hasRole(user, 'RestaurantOwner') && !isPlatformOwner
  const canLoadRestaurantDirectory = !isStaff

  const loadDashboard = useCallback(async (showToast = false) => {
    // Set synchronously in the handler: the disabled attribute only lands on the render that
    // follows the click, which left an ~86ms window for a second click to start a second load.
    if (loadInFlightRef.current) {
      return
    }

    loadInFlightRef.current = true
    setLoading(true)
    setError(null)

    try {
      const [loadedOrders, loadedStats] = await Promise.all([
        getAdminOrders({ pageSize: 5, sortBy: 'createdAt', sortDirection: 'desc' }),
        getAdminOrderSummary(),
      ])
      setOrders(loadedOrders.items)
      setStats(loadedStats)

      if (canLoadRestaurantDirectory) {
        const loadedRestaurants = await getRestaurants()
        setRestaurants(loadedRestaurants)
        setTradingStatus(null)
      } else {
        // Staff can't reach the admin restaurant API, so they get the read-only trading status.
        setRestaurants([])
        setTradingStatus(await getCurrentRestaurantTradingStatus().catch(() => null))
      }

      if (showToast) {
        toast.success('Dashboard refreshed')
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Dashboard loading failed.'
      setError(message)
      // A fixed id: React mounts effects twice in development, and two identical toasts stacked up.
      toast.error('Could not load dashboard', { id: dashboardErrorToastId, description: message })
    } finally {
      loadInFlightRef.current = false
      setLoading(false)
    }
  }, [canLoadRestaurantDirectory])

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
  // Zeros after a failed load read as "a quiet day", which is the one thing they do not mean.
  const loadFailed = Boolean(error) && !loading
  const metricsScopeLabel = isPlatformOwner ? 'Across all restaurants' : 'Visible to this role'
  const primaryRestaurant = activeRestaurants[0] ?? null
  // Admin roles get availability off the full entity; staff get it from the read-only endpoint.
  const dashboardAvailability = primaryRestaurant?.availability ?? tradingStatus?.availability ?? null
  const dashboardRestaurantName = primaryRestaurant?.name ?? tradingStatus?.name
  const recentOrders = orders.slice(0, 5)
  const dashboardRoleLabel = isPlatformOwner
    ? 'Platform owner'
    : isStaff
      ? 'Staff workspace'
      : hasRole(user, 'RestaurantOwner')
        ? 'Restaurant owner'
        : 'Admin workspace'

  const updateRestaurantInState = useCallback((restaurant: Restaurant) => {
    setRestaurants((current) =>
      current.map((item) => (item.id === restaurant.id ? restaurant : item)),
    )
  }, [])

  const canEditSchedule = canLoadRestaurantDirectory && restaurants.length > 0
  const dashboardWidgets = useMemo<DashboardWidget[]>(() => {
    // Registry order and the first allowed size together form the default layout: two 1x1 cards
    // side by side, then the two schedule editors full width beneath them.
    const registry: DashboardWidget[] = [
      {
        id: 'recent-orders',
        title: isStaff ? 'Staff order panel' : 'Recent orders',
        allowedSizes: [{ w: 1, h: 1 }, { w: 1, h: 2 }, { w: 2, h: 1 }],
        render: () => (
          <RecentOrdersWidget isStaff={isStaff} recentOrders={recentOrders} loading={loading} />
        ),
      },
      {
        id: 'public-urls',
        title: isPlatformOwner ? 'Public restaurant URLs' : 'Restaurant menu URL',
        allowedSizes: [{ w: 1, h: 1 }, { w: 1, h: 2 }, { w: 2, h: 1 }],
        render: () => (
          <PublicUrlsWidget
            isPlatformOwner={isPlatformOwner}
            activeRestaurants={activeRestaurants}
            canShowTableUrls={canLoadRestaurantDirectory}
            loading={loading}
          />
        ),
      },
    ]

    // The schedule editors and the menu watch list write through admin-only endpoints, so staff
    // never see them.
    if (canEditSchedule) {
      registry.push(
        {
          id: 'watched-menu-items',
          title: 'Watched menu items',
          allowedSizes: [{ w: 2, h: 1 }, { w: 1, h: 1 }, { w: 1, h: 2 }],
          render: () => (
            <WatchedMenuItemsWidget
              restaurantId={primaryRestaurant?.id ?? null}
              restaurantName={primaryRestaurant?.name ?? null}
              currency={primaryRestaurant?.currency ?? scopedCurrency}
            />
          ),
        },
        {
          id: 'opening-hours',
          title: 'Opening hours',
          allowedSizes: [{ w: 2, h: 1 }, { w: 2, h: 2 }, { w: 1, h: 2 }],
          render: () => (
            <RestaurantOpeningHoursPanel
              restaurants={restaurants}
              restaurantsLoading={loading}
              canSelectRestaurant={isPlatformOwner}
              onSaved={() => loadDashboard()}
              onRestaurantUpdated={updateRestaurantInState}
            />
          ),
        },
        {
          id: 'special-calendar',
          title: 'Special calendar',
          allowedSizes: [{ w: 2, h: 1 }, { w: 2, h: 2 }, { w: 1, h: 2 }],
          render: () => (
            <RestaurantSpecialCalendarPanel
              restaurants={restaurants}
              restaurantsLoading={loading}
              canSelectRestaurant={isPlatformOwner}
              onSaved={() => loadDashboard()}
              onRestaurantUpdated={updateRestaurantInState}
            />
          ),
        },
      )
    }

    return registry
  }, [
    activeRestaurants,
    canEditSchedule,
    canLoadRestaurantDirectory,
    isPlatformOwner,
    isStaff,
    loadDashboard,
    loading,
    primaryRestaurant,
    recentOrders,
    restaurants,
    scopedCurrency,
    updateRestaurantInState,
  ])

  return (
    <main className="content-grid dashboard-page">
      <Card id="dashboard-summary" className="dashboard-hero-card">
        <CardHeader>
          <div className="section-header">
            <div className="admin-page-title dashboard-hero-title">
              <LayoutDashboard size={22} />
              <div>
                <div className="dashboard-title-row">
                  <CardTitle asChild><h1>Dashboard</h1></CardTitle>
                  <Badge variant="outline">{dashboardRoleLabel}</Badge>
                </div>
                <CardDescription>
                  {isPlatformOwner
                    ? 'Platform shortcuts, restaurant access, and live operations.'
                    : isStaff
                      ? 'Your order queue, payment context, and reserved staff actions.'
                      : 'Restaurant shortcuts, order activity, and payment context.'}
                </CardDescription>
              </div>
            </div>
            <div className="dashboard-hero-actions">
              <Button
                type="button"
                variant="secondary"
                className="dashboard-refresh-button"
                onClick={() => void loadDashboard(true)}
                disabled={loading}
              >
                <RefreshCw size={18} />
                {loading ? 'Refreshing' : 'Refresh'}
              </Button>
            </div>
          </div>
        </CardHeader>
        {/*
          * Trading status and metrics stay pinned here rather than becoming draggable widgets:
          * they answer "are we open" and "how busy are we", which should never be reordered away
          * from the top or accidentally hidden.
          */}
        <CardContent className="dashboard-stack dashboard-hero-content">
          {error && <p className="form-error">{error}</p>}

          <RestaurantStatusBanner
            availability={dashboardAvailability}
            name={isPlatformOwner ? dashboardRestaurantName : undefined}
          />

          {primaryRestaurant && canLoadRestaurantDirectory ? (
            <OrderingPauseControl
              restaurant={primaryRestaurant}
              // Named because the metrics under it are platform-wide: without it, "Close
              // restaurant" sitting above "ORDERS 113 across 12 restaurants" reads as closing
              // the platform.
              showRestaurantName={isPlatformOwner}
              onRestaurantUpdated={updateRestaurantInState}
            />
          ) : null}

          <div className="dashboard-metrics-grid">
            <MetricCard unavailable={loadFailed} label="Orders" value={stats.total} detail={metricsScopeLabel} tone="orders" />
            <MetricCard unavailable={loadFailed} label="Kitchen active" value={stats.activeKitchen} detail="Pending through ready" tone="kitchen" />
            <MetricCard
              label="Paid"
              value={stats.paid}
              detail={describeRevenue(stats.revenue)}
              tone="paid"
              unavailable={loadFailed}
            />
            <MetricCard unavailable={loadFailed} label="Awaiting payment" value={stats.pendingPayment} detail={`${stats.payable} payable`} tone="payment" />
          </div>
        </CardContent>
      </Card>

      <DashboardCanvas
        key={user?.id ?? 'anonymous'}
        widgets={dashboardWidgets}
        storageScope={user?.id ?? 'anonymous'}
      />
    </main>
  )
}

/** Each widget below is registered in AdminDashboardPage and placed by DashboardCanvas. */
function PublicUrlsWidget({
  isPlatformOwner,
  activeRestaurants,
  canShowTableUrls,
  loading,
}: {
  isPlatformOwner: boolean
  activeRestaurants: DashboardRestaurant[]
  canShowTableUrls: boolean
  loading: boolean
}) {
  return (
    <Card className="dashboard-panel-card">
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
                  canShowTableUrls={canShowTableUrls}
                />
              ))}
              {!loading && activeRestaurants.length === 0 && (
                <div className="dashboard-empty-state">
                  {canShowTableUrls
                    ? 'No active restaurant URL is available for this account.'
                    : 'Menu URLs are managed by your restaurant admin. Ask them for the link to share with customers.'}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
  )
}

function RecentOrdersWidget({
  isStaff,
  recentOrders,
  loading,
}: {
  isStaff: boolean
  recentOrders: AdminOrder[]
  loading: boolean
}) {
  return (
        <Card className="dashboard-panel-card">
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
                  <div className="dashboard-order-copy">
                    <strong>{order.orderNumber}</strong>
                    <span>
                      {order.restaurantName || 'Assigned restaurant'} · {order.tableNumber ? `Table ${order.tableNumber}` : order.orderType}
                    </span>
                  </div>
                  <strong className="dashboard-order-total">{formatMoney(order.totalAmount, order.currency)}</strong>
                  <div className="dashboard-order-state">
                    <OrderStatusBadge status={order.status} paymentStatus={order.paymentStatus} />
                    <PaymentStatusBadge status={order.paymentStatus} />
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
  )
}
