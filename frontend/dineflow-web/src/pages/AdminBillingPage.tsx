import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, CreditCard, Loader2, RefreshCw } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  createRestaurantPlatformFeeCheckout,
  getRestaurantOperations,
  openRestaurantBillingPortal,
  startRestaurantSubscriptionCheckout,
  syncRestaurantBilling,
  type RestaurantBillingStanding,
  type RestaurantOperations,
} from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { useRestaurantPrinting } from '../printing/RestaurantPrintingContext'
import { publishOperationalStatusInvalidated } from '../lib/operationalNotifications'
import { formatMoney } from '../lib/formatMoney'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'

function formatMoment(value: string | null) {
  if (!value) return null

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' })
    .format(new Date(value))
}

/**
 * How long is left, in the words somebody reads once and acts on.
 *
 * <p>
 * Rounded down for the same reason the bell rounds down: this is time before a deadline, and a
 * number that overstates it costs somebody the day they thought they had.
 * </p>
 */
function describeRemaining(suspendsAt: string | null, now: number) {
  if (!suspendsAt) return null

  const remainingMs = Math.max(0, new Date(suspendsAt).getTime() - now)
  const hours = Math.floor(remainingMs / (60 * 60 * 1000))

  if (hours <= 1) return 'less than an hour'
  if (hours < 48) return `${hours} hours`

  return `${Math.floor(hours / 24)} days`
}

function StandingBadge({ billing }: { billing: RestaurantBillingStanding }) {
  const tone = billing.standing === 'Suspended'
    ? 'error'
    : billing.standing === 'PastDue'
      ? 'warning'
      : 'ok'

  const label = billing.standing === 'Suspended'
    ? 'Online ordering paused'
    : billing.standing === 'PastDue'
      ? 'Payment due'
      : billing.standing === 'Current'
        ? 'Paid up'
        : 'No charge'

  return (
    <span className="billing-standing-badge" data-tone={tone}>
      {tone === 'ok' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
      {label}
    </span>
  )
}

/**
 * What this restaurant owes the platform, and the one button that settles it.
 *
 * <p>
 * Its own page rather than a tab inside the restaurant admin dialog, because the person who has to
 * pay is a restaurant owner arriving from a warning that says their ordering is about to stop. That
 * warning needs somewhere to send them. A dialog reached by searching a list of restaurants is not
 * a place you can link to.
 * </p>
 */
export function AdminBillingPage() {
  const { user } = useAuth()
  const printing = useRestaurantPrinting()
  const [searchParams, setSearchParams] = useSearchParams()
  const restaurantId = user?.restaurantId ?? printing.activeRestaurantId ?? null
  const [operations, setOperations] = useState<RestaurantOperations | null>(null)
  // Nothing to wait for when there is no restaurant, so the page starts settled rather than
  // flashing a spinner it would have to clear synchronously.
  const [loading, setLoading] = useState(Boolean(restaurantId))
  const [startingCheckout, setStartingCheckout] = useState(false)
  // The countdown has to move. A page left open on "13 days" for a week is worse than no
  // countdown, because it is a number somebody will act on.
  const [now, setNow] = useState(() => Date.now())
  const returnHandledRef = useRef<string | null>(null)

  const load = useCallback(async () => {
    if (!restaurantId) return

    try {
      setOperations(await getRestaurantOperations(restaurantId))
    } catch (error) {
      toast.error('Could not load billing', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setLoading(false)
    }
  }, [restaurantId])

  useEffect(() => {
    // Off an await, so the state it sets lands after this effect rather than cascading out of it.
    void (async () => {
      await load()
    })()
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // Returning from Stripe. The truth arrives by webhook moments later, so this refetches rather
  // than claiming the payment landed. Guarded by a ref and done off an await, the same shape the
  // restaurants page uses for this return, so a re-render cannot replay it.
  useEffect(() => {
    const result = searchParams.get('platformFee')
    if (!result || returnHandledRef.current === result) return

    returnHandledRef.current = result
    void (async () => {
      if (result === 'success') {
        toast.success('Payment submitted', {
          description: 'Stripe confirmation can take a moment. This page updates itself.',
        })
        publishOperationalStatusInvalidated(restaurantId ?? undefined)
        await load()
      } else if (result === 'cancelled') {
        toast.info('Checkout cancelled', { description: 'No charge was made.' })
      }

      const next = new URLSearchParams(searchParams)
      next.delete('platformFee')
      setSearchParams(next, { replace: true })
    })()
  }, [searchParams, setSearchParams, load, restaurantId])

  const billing = operations?.billing ?? null
  const remaining = useMemo(
    () => describeRemaining(billing?.suspendsAt ?? null, now),
    [billing?.suspendsAt, now],
  )

  /**
   * Hands the browser to Stripe, or explains why there was nothing to hand it.
   *
   * <p>
   * Shared by the activation fee, the subscription and the portal, because to the person clicking
   * they are one action — settle this — and three copies of the same handler is three chances for
   * one of them to swallow an error the others report.
   * </p>
   */
  const goToStripe = async (
    start: (id: string) => Promise<{ checkoutUrl?: string | null; message?: string }>,
    failureTitle: string,
  ) => {
    if (!restaurantId) return
    setStartingCheckout(true)

    try {
      const response = await start(restaurantId)
      if (response.checkoutUrl) {
        window.location.assign(response.checkoutUrl)
        return
      }

      toast.info(response.message ?? 'Nothing to do.')
      await load()
    } catch (error) {
      toast.error(failureTitle, {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setStartingCheckout(false)
    }
  }

  const syncFromStripe = async () => {
    if (!restaurantId) return
    setStartingCheckout(true)

    try {
      await syncRestaurantBilling(restaurantId)
      publishOperationalStatusInvalidated(restaurantId)
      await load()
      toast.success('Checked with Stripe')
    } catch (error) {
      toast.error('Could not check with Stripe', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setStartingCheckout(false)
    }
  }

  const owes = billing !== null
    && (billing.standing === 'PastDue' || billing.standing === 'Suspended')

  return (
    <div className="admin-billing">
      <h1 className="admin-billing-title">Platform billing</h1>

      {loading ? (
        <div className="admin-billing-loading">
          <Loader2 className="animate-spin" size={20} />
          <span>Loading billing…</span>
        </div>
      ) : !restaurantId || !billing ? (
        <Card>
          <CardHeader>
            <CardDescription>
              This account is not assigned to a restaurant, so there is nothing to bill. Open a
              restaurant from the Restaurants page to see its platform charges.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
      <Card>
        <CardHeader>
          <div className="admin-billing-heading">
            <div>
              <CardTitle>
                What {operations?.name ?? 'this restaurant'} pays DineFlow
              </CardTitle>
              <CardDescription>
                Separate from Stripe's own processing fees, and from what your customers pay you.
              </CardDescription>
            </div>
            <StandingBadge billing={billing} />
          </div>
        </CardHeader>

        <CardContent className="admin-billing-body">
          {billing.standing === 'Suspended' ? (
            <p className="admin-billing-alert" data-tone="error">
              <AlertTriangle size={16} />
              <span>
                Customers cannot order online right now. Your orders, history and settings are
                untouched — paying reopens ordering straight away.
              </span>
            </p>
          ) : null}

          {billing.standing === 'PastDue' && remaining ? (
            <p className="admin-billing-alert" data-tone="warning">
              <AlertTriangle size={16} />
              <span>
                Online ordering stops in <strong>{remaining}</strong>
                {billing.suspendsAt ? ` — ${formatMoment(billing.suspendsAt)}` : null}.
              </span>
            </p>
          ) : null}

          <dl className="admin-billing-facts">
            <div>
              <dt>Charge</dt>
              <dd>
                {billing.model === 'OneTimeActivation'
                  ? 'One-time activation fee'
                  : billing.model === 'Subscription'
                    ? 'Subscription'
                    : 'Nothing — this restaurant is not charged'}
              </dd>
            </div>
            {owes && billing.amountDueCents > 0 ? (
              <div>
                <dt>Amount due</dt>
                <dd>
                  <strong>{formatMoney(billing.amountDueCents / 100, billing.currency)}</strong>
                </dd>
              </div>
            ) : null}
            {billing.standing === 'Current' ? (
              <div>
                <dt>Status</dt>
                <dd>Settled. Nothing is outstanding.</dd>
              </div>
            ) : null}
          </dl>

          <div className="admin-billing-actions">
            {billing.model === 'OneTimeActivation' && billing.standing !== 'Current' ? (
              <Button
                type="button"
                onClick={() => void goToStripe(createRestaurantPlatformFeeCheckout, 'Could not start checkout')}
                disabled={startingCheckout}
              >
                {startingCheckout ? <Loader2 className="animate-spin" size={16} /> : <CreditCard size={16} />}
                Pay activation fee
              </Button>
            ) : null}

            {billing.model === 'Subscription' && billing.standing !== 'Current' ? (
              <Button
                type="button"
                onClick={() => void goToStripe(startRestaurantSubscriptionCheckout, 'Could not start subscription')}
                disabled={startingCheckout}
              >
                {startingCheckout ? <Loader2 className="animate-spin" size={16} /> : <CreditCard size={16} />}
                Start subscription
              </Button>
            ) : null}

            {/* Cards, invoices and cancellation all live in Stripe's portal, so no card number
                ever reaches DineFlow and the invoice history is already there. */}
            {billing.model === 'Subscription' && operations?.billing.factsSyncedAt !== null ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void goToStripe(openRestaurantBillingPortal, 'Could not open billing portal')}
                disabled={startingCheckout}
              >
                Manage billing
              </Button>
            ) : null}

            {/* For the payment whose webhook never arrived. The sweep finds it within the hour;
                somebody who has already paid should not have to wait that long to be believed. */}
            <Button
              type="button"
              variant="outline"
              onClick={() => void syncFromStripe()}
              disabled={startingCheckout}
            >
              <RefreshCw size={16} />
              Check with Stripe
            </Button>
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  )
}
