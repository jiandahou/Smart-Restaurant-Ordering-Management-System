import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleCheck, CircleX, ClipboardList, Clock, Loader2, RefreshCw, Utensils } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { confirmStripeCheckoutSession } from '../api/auth'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { confirmationDelaysMs, isTerminalConfirmationFailure } from '../lib/paymentConfirmationPolling'
import { getSafeMenuReturnPath } from '../lib/customerMenuNavigation'

type PaymentResultPageProps = {
  result: 'success' | 'cancelled'
}

export function PaymentResultPage({ result }: PaymentResultPageProps) {
  const [searchParams] = useSearchParams()
  const isSuccess = result === 'success'
  const rawSessionId = searchParams.get('session_id')?.trim() ?? ''
  // Stripe substitutes {CHECKOUT_SESSION_ID} on redirect, so anything that is not a cs_ id means
  // the return URL was built wrong (FS-003: the placeholder used to arrive percent-encoded).
  // Confirming with it can only 400, and retrying that left the page spinning forever.
  const sessionId = rawSessionId.startsWith('cs_') ? rawSessionId : ''
  const menuReturnPath = getSafeMenuReturnPath(searchParams.get('returnTo'))
  // Derived, not stored: whether there is anything to confirm is fixed by the URL this page was
  // opened with, so it belongs in the first render rather than in an effect that corrects it.
  const unusableSessionMessage = !isSuccess || sessionId
    ? ''
    : rawSessionId
      ? 'This return link did not carry a usable Stripe session id, so the payment could not be confirmed here. Your order updates automatically from Stripe.'
      : 'The Stripe Checkout Session id is missing. Your order will still update from the payment notification.'
  const [confirmation, setConfirmation] = useState<
    'confirming' | 'confirmed' | 'processing' | 'failed' | 'unmatched'
  >(isSuccess && !unusableSessionMessage ? 'confirming' : 'failed')
  const [confirmationMessage, setConfirmationMessage] = useState('')
  // Set while a run is in flight, so a tab regaining focus or a second click cannot start a
  // parallel one that races the first to set the outcome.
  const runningRef = useRef(false)

  /**
   * Asks Stripe until it answers or the budget runs out.
   *
   * <p>
   * Exhausting the budget is not a failure and must not read as one — the payment has almost
   * certainly gone through, and the order updates from the webhook regardless. It ends in a state
   * that says so and offers another look, rather than a spinner that never stops.
   * </p>
   */
  const confirmPayment = useCallback(async (signal?: { cancelled: boolean }) => {
    if (!sessionId || runningRef.current) {
      return
    }

    runningRef.current = true
    setConfirmation((current) =>
      current === 'confirmed' || current === 'unmatched' ? current : 'confirming',
    )

    try {
      for (const delay of confirmationDelaysMs) {
        if (delay > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delay))
        }

        if (signal?.cancelled) return

        try {
          const response = await confirmStripeCheckoutSession(sessionId)
          if (signal?.cancelled) return

          setConfirmationMessage(response.message)

          if (response.confirmed) {
            setConfirmation('confirmed')
            return
          }
        } catch (error) {
          if (signal?.cancelled) return
          setConfirmationMessage(
            error instanceof Error
              ? error.message
              : 'We could not confirm the payment yet. Your order will update automatically.',
          )

          // The answer has arrived and it is final. Spending the rest of the budget on it leaves a
          // spinner over a settled result and makes the customer wait to be told what was already
          // true on the first attempt.
          if (isTerminalConfirmationFailure(error)) {
            setConfirmation('unmatched')
            return
          }
        }
      }

      if (!signal?.cancelled) {
        setConfirmation((current) =>
          current === 'confirmed' || current === 'unmatched' ? current : 'processing',
        )
      }
    } finally {
      runningRef.current = false
    }
  }, [sessionId])

  useEffect(() => {
    if (!isSuccess || !sessionId) {
      return
    }

    const signal = { cancelled: false }

    void confirmPayment(signal)

    // Releasing the in-flight flag as well as cancelling, so that a remount starts a run of its own
    // rather than finding one that is still marked as running but has been told to stop. Refusing
    // to start a second run for a session left the page with no live run at all, and therefore no
    // way to ever reach an outcome — neither a confirmation nor the "check again" the customer is
    // owed when Stripe really has not settled yet.
    return () => {
      signal.cancelled = true
      runningRef.current = false
    }
  }, [confirmPayment, isSuccess, sessionId])

  // People switch away from the tab while paying, and mobile browsers suspend timers in background
  // tabs — so the budget can expire without any of it being spent watching. Coming back is the
  // single best moment to look again.
  useEffect(() => {
    if (!isSuccess || !sessionId) {
      return
    }

    const recheckOnReturn = () => {
      if (document.visibilityState === 'visible') {
        void confirmPayment()
      }
    }

    document.addEventListener('visibilitychange', recheckOnReturn)

    return () => document.removeEventListener('visibilitychange', recheckOnReturn)
  }, [confirmPayment, isSuccess, sessionId])

  const paymentConfirmed = isSuccess && confirmation === 'confirmed'
  const confirmationFailed = isSuccess && confirmation === 'failed'
  // The budget ran out without an answer. Distinct from 'confirming' on purpose: it used to render
  // as the same endless spinner, which is how a successful payment looked identical to a hung page.
  const stillProcessing = isSuccess && confirmation === 'processing'
  // Settled, and settled badly: this return link names a payment we have no record of. Kept apart
  // from every other state because it is the one that must not reassure — "Payment received" over
  // a session nobody has heard of is a claim we cannot make.
  const sessionUnmatched = isSuccess && confirmation === 'unmatched'
  const inProgress = isSuccess && !paymentConfirmed && !confirmationFailed && !sessionUnmatched
  const Icon = !isSuccess || confirmationFailed || sessionUnmatched
    ? CircleX
    : paymentConfirmed
      ? CircleCheck
      : stillProcessing
        ? Clock
        : Loader2
  const title = !isSuccess
    ? 'Payment cancelled'
    : paymentConfirmed
      ? 'Payment confirmed'
      : sessionUnmatched
        ? 'Payment could not be matched'
        : confirmationFailed
          ? 'Payment received'
          : stillProcessing
            ? 'Payment received'
            : 'Confirming payment'
  const description = !isSuccess
    ? 'No payment was taken. You can return to your account and try again when ready.'
    : paymentConfirmed
      ? 'Thanks. Your payment and order status are now up to date.'
      : sessionUnmatched
        ? 'This return link does not match any payment we hold. If money left your account, My orders will show the order and the restaurant can look it up from your receipt.'
        : confirmationFailed
          ? 'Thanks. We could not confirm it on this page, but Stripe notifies us directly and your order updates on its own.'
          : stillProcessing
            ? 'Thanks. Stripe is still finishing up. Your order updates on its own, and My orders will show it either way.'
            : 'Thanks. We are checking the payment directly with Stripe.'

  return (
    <main className="login-screen">
      <Card className="login-card payment-result-card">
        <CardHeader>
          <p className="eyebrow">DineFlow</p>
          <CardTitle asChild><h1>{title}</h1></CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="form-grid">
          <div className={`confirm-status ${isSuccess && !confirmationFailed && !sessionUnmatched ? 'success' : 'error'}`}>
            {/* The spinner is the progress claim. It stops when the answer is in, whichever answer
                it is — a turning spinner over a settled error is what made this page read as busy
                for the rest of the budget. */}
            <Icon size={22} className={inProgress ? 'animate-spin' : undefined} />
            <span>
              {!isSuccess
                ? 'Payment was cancelled'
                : paymentConfirmed
                  ? 'Payment confirmed'
                  : sessionUnmatched
                    ? 'No matching payment found'
                    : confirmationFailed
                      ? 'Confirmation unavailable on this page'
                      : stillProcessing
                        ? 'Still confirming with Stripe'
                        : 'Payment confirmation in progress'}
            </span>
          </div>
          <p className="auth-note">
            {confirmationMessage || unusableSessionMessage || (isSuccess
              ? 'You can safely return to your account while confirmation finishes.'
              : 'Your order has not been paid yet.')}
          </p>
          {isSuccess ? (
            <p className="auth-note">Your receipt is available from My orders.</p>
          ) : null}
          {stillProcessing ? (
            <Button variant="outline" onClick={() => void confirmPayment()}>
              <RefreshCw size={18} />
              Check again
            </Button>
          ) : null}
          <Button asChild>
            <Link to="/my-orders">
              <ClipboardList size={18} />
              View my orders
            </Link>
          </Button>
          {menuReturnPath ? (
            <Button variant="outline" asChild>
              <Link to={menuReturnPath}>
                <Utensils size={18} />
                Back to menu
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </main>
  )
}
