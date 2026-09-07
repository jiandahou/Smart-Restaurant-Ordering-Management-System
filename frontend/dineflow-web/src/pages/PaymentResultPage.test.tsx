import { StrictMode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaymentResultPage } from './PaymentResultPage'
import { confirmationBudgetMs, confirmationDelaysMs } from '@/lib/paymentConfirmationPolling'

const confirmStripeCheckoutSession = vi.hoisted(() => vi.fn())

vi.mock('../api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/auth')>()),
  confirmStripeCheckoutSession,
}))

// The page waits between attempts; without this every test would spend the real budget.
vi.mock('@/lib/paymentConfirmationPolling', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/paymentConfirmationPolling')>()

  return { ...actual, confirmationDelaysMs: [0, 0, 0] }
})

function renderPage(session = 'cs_test_123') {
  return render(
    <MemoryRouter initialEntries={[`/payment/success?session_id=${session}`]}>
      <PaymentResultPage result="success" />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/**
 * A card payment that settles through a webhook routinely takes longer than the page used to wait.
 * Running out of attempts left it on "Confirming payment" with the spinner still turning, while the
 * database, My Orders and the admin views all agreed the payment was done. The spinner was the
 * terminal state: no refresh, no second look, no end.
 */
describe('when Stripe confirms straight away', () => {
  it('says the payment is confirmed', async () => {
    confirmStripeCheckoutSession.mockResolvedValue({ confirmed: true, message: 'Payment confirmed.' })

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Payment confirmed' })).toBeInTheDocument()
  })

  it('stops asking once it has an answer', async () => {
    confirmStripeCheckoutSession.mockResolvedValue({ confirmed: true, message: 'Payment confirmed.' })

    renderPage()
    await screen.findByRole('heading', { name: 'Payment confirmed' })

    expect(confirmStripeCheckoutSession).toHaveBeenCalledTimes(1)
  })
})

describe('when Stripe is still working after the budget runs out', () => {
  const stillPending = { confirmed: false, message: 'Payment is still processing.' }

  it('does not leave a spinner running forever', async () => {
    confirmStripeCheckoutSession.mockResolvedValue(stillPending)

    renderPage()

    // "Payment received" rather than "Confirming payment": the money arrived, only the confirmation
    // did not, and saying otherwise is what made a successful payment look broken.
    expect(await screen.findByRole('heading', { name: 'Payment received' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Confirming payment' })).not.toBeInTheDocument()
  })

  it('offers another look rather than a dead end', async () => {
    confirmStripeCheckoutSession.mockResolvedValue(stillPending)

    renderPage()

    expect(await screen.findByRole('button', { name: /check again/i })).toBeInTheDocument()
  })

  it('converges when the customer checks again and it has settled', async () => {
    const user = userEvent.setup()
    confirmStripeCheckoutSession.mockResolvedValue(stillPending)

    renderPage()
    await screen.findByRole('button', { name: /check again/i })

    confirmStripeCheckoutSession.mockResolvedValue({ confirmed: true, message: 'Payment confirmed.' })
    await user.click(screen.getByRole('button', { name: /check again/i }))

    expect(await screen.findByRole('heading', { name: 'Payment confirmed' })).toBeInTheDocument()
  })

  it('looks again by itself when the tab comes back', async () => {
    // People switch away while paying, and mobile browsers suspend timers in background tabs — the
    // budget can expire without any of it being spent watching.
    confirmStripeCheckoutSession.mockResolvedValue(stillPending)

    renderPage()
    await screen.findByRole('button', { name: /check again/i })

    confirmStripeCheckoutSession.mockResolvedValue({ confirmed: true, message: 'Payment confirmed.' })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(await screen.findByRole('heading', { name: 'Payment confirmed' })).toBeInTheDocument()
  })

  it('keeps trying for the whole budget before giving up', async () => {
    confirmStripeCheckoutSession.mockResolvedValue(stillPending)

    renderPage()
    await screen.findByRole('button', { name: /check again/i })

    expect(confirmStripeCheckoutSession).toHaveBeenCalledTimes(3)
  })
})

describe('when confirming keeps failing outright', () => {
  it('still ends somewhere the customer can act', async () => {
    // An erroring endpoint must not be less recoverable than a slow one.
    confirmStripeCheckoutSession.mockRejectedValue(new Error('Service unavailable.'))

    renderPage()

    expect(await screen.findByRole('button', { name: /check again/i })).toBeInTheDocument()
    expect(screen.getByText('Service unavailable.')).toBeInTheDocument()
  })
})

describe('when the return link carries no usable session', () => {
  it('says so instead of pretending to confirm', async () => {
    renderPage('not-a-session-id')

    expect(await screen.findByRole('heading', { name: 'Payment received' })).toBeInTheDocument()
    expect(confirmStripeCheckoutSession).not.toHaveBeenCalled()
  })
})

/**
 * The schedule itself, checked separately from the page: these numbers decide whether a real
 * payment converges or the customer is left staring at a spinner.
 */
describe('the polling schedule', () => {
  it('waits long enough for a webhook that is merely slow', async () => {
    const { confirmationBudgetMs: realBudget } = await vi.importActual<
      typeof import('@/lib/paymentConfirmationPolling')
    >('@/lib/paymentConfirmationPolling')

    expect(realBudget).toBeGreaterThanOrEqual(30_000)
  })

  it('backs off instead of asking once a second for a minute', async () => {
    const { confirmationDelaysMs: realDelays } = await vi.importActual<
      typeof import('@/lib/paymentConfirmationPolling')
    >('@/lib/paymentConfirmationPolling')

    expect(realDelays[0]).toBe(0)
    expect(realDelays[realDelays.length - 1]).toBeGreaterThan(realDelays[1])
  })

  it('is bounded, so the page always reaches a state with a way out', () => {
    // The mocked schedule stands in for the real one here; what matters is that it terminates.
    expect(confirmationDelaysMs.length).toBeGreaterThan(0)
    expect(Number.isFinite(confirmationBudgetMs)).toBe(true)
  })
})

/**
 * Every test above renders the page on its own. The application renders it inside `StrictMode`,
 * which mounts, unmounts and mounts again — so the run started by the first mount is cancelled
 * while its request is still in flight, and the guard against starting twice then refuses to start
 * another. The answer came back saying the payment was confirmed and was thrown away for belonging
 * to a cancelled run.
 *
 * <p>
 * Seen on a phone: Apple Pay completed, Stripe recorded the payment, the order was marked paid, and
 * the return page sat on "Payment confirmation in progress" until it was closed. One request, one
 * 200, no state change.
 * </p>
 */
describe('rendered the way the application renders it', () => {
  function renderStrict(session = 'cs_test_123') {
    return render(
      <StrictMode>
        <MemoryRouter initialEntries={[`/payment/success?session_id=${session}`]}>
          <PaymentResultPage result="success" />
        </MemoryRouter>
      </StrictMode>,
    )
  }

  it('shows a confirmed payment as confirmed', async () => {
    confirmStripeCheckoutSession.mockResolvedValue({ confirmed: true, message: 'Payment confirmed.' })

    renderStrict()

    expect((await screen.findAllByText('Payment confirmed')).length).toBeGreaterThan(0)
  })

  /** The remount must not cost the customer a second round trip either. */
  it('does not keep asking after it has the answer', async () => {
    confirmStripeCheckoutSession.mockResolvedValue({ confirmed: true, message: 'Payment confirmed.' })

    renderStrict()
    await screen.findAllByText('Payment confirmed')
    const asked = confirmStripeCheckoutSession.mock.calls.length

    // The mocked schedule is three immediate attempts, so anything still polling would have
    // spent them several times over by now.
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(confirmStripeCheckoutSession.mock.calls.length).toBe(asked)
  })

  /** A payment that genuinely has not settled must still end somewhere the customer can act. */
  it('still gives up honestly when Stripe has nothing yet', async () => {
    confirmStripeCheckoutSession.mockResolvedValue({ confirmed: false, message: 'Not settled yet.' })

    renderStrict()

    expect(await screen.findByRole('button', { name: /check again/i })).toBeTruthy()
  })
})

/**
 * A return link naming a session nobody has heard of.
 *
 * <p>
 * Every failure was treated as "not settled yet", so the page spent its whole budget retrying a
 * 404 while the heading still said "Confirming payment" and the spinner still turned. Nothing was
 * confirming. The answer arrived on the first attempt and was final, and the customer was made to
 * wait to be told it — then told it in words that read like reassurance.
 * </p>
 */
describe('when the session is one we have never heard of', () => {
  const notFound = () => Object.assign(new Error('Checkout session was not found.'), { status: 404 })

  it('stops asking instead of spending the budget on a settled answer', async () => {
    confirmStripeCheckoutSession.mockRejectedValue(notFound())

    renderPage()

    await screen.findByText('No matching payment found')

    expect(confirmStripeCheckoutSession).toHaveBeenCalledTimes(1)
  })

  it('drops the confirming heading rather than leaving progress semantics on screen', async () => {
    confirmStripeCheckoutSession.mockRejectedValue(notFound())

    renderPage()

    await screen.findByText('No matching payment found')

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Payment could not be matched')
    expect(screen.queryByText('Confirming payment')).not.toBeInTheDocument()
    expect(screen.queryByText('Payment confirmation in progress')).not.toBeInTheDocument()
  })

  it('does not claim the payment was received', async () => {
    // The other error state says "Payment received", which is a claim we cannot make about a
    // session we hold no record of.
    confirmStripeCheckoutSession.mockRejectedValue(notFound())

    renderPage()

    await screen.findByText('No matching payment found')

    expect(screen.queryByText('Payment received')).not.toBeInTheDocument()
  })

  it('offers a way on rather than a re-check that cannot help', async () => {
    confirmStripeCheckoutSession.mockRejectedValue(notFound())

    renderPage()

    await screen.findByText('No matching payment found')

    expect(screen.getByRole('link', { name: /view my orders/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /check again/i })).not.toBeInTheDocument()
  })

  it.each([400, 403, 410])('treats %i the same way', async (status) => {
    confirmStripeCheckoutSession.mockRejectedValue(
      Object.assign(new Error('Refused.'), { status }),
    )

    renderPage()

    await screen.findByText('No matching payment found')

    expect(confirmStripeCheckoutSession).toHaveBeenCalledTimes(1)
  })

  it('keeps waiting when the failure is about the moment rather than the session', async () => {
    // A gateway fault says nothing about whether the payment settled, and the webhook may well be
    // on its way. Those are worth the budget.
    confirmStripeCheckoutSession.mockRejectedValue(
      Object.assign(new Error('Bad gateway.'), { status: 502 }),
    )

    renderPage()

    await screen.findByText('Still confirming with Stripe', {}, { timeout: confirmationBudgetMs + 2000 })

    expect(confirmStripeCheckoutSession.mock.calls.length).toBeGreaterThan(1)
  })
})

/**
 * The money arrives for an order that no longer exists.
 *
 * <p>
 * Cancelling an order asks Stripe to close its checkout page, and that request can fail — Stripe
 * unreachable, the session already gone. The page stays chargeable, and a customer who still has
 * the tab open pays for an order the restaurant has already rejected. The payment genuinely
 * succeeds, so every check on this page said confirmed and it told them "your payment and order
 * status are now up to date" — while the refund was already on its way and no food was coming.
 * </p>
 */
describe('when the payment lands on an order that was turned away', () => {
  const turnedAway = {
    confirmed: true,
    orderTurnedAway: true,
    paymentStatus: 'Refunded',
    message: 'The restaurant could not accept this order, so it has been refunded in full.',
  }

  it('does not tell the customer everything is fine', async () => {
    confirmStripeCheckoutSession.mockResolvedValue(turnedAway)

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Order not accepted' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Payment confirmed' })).not.toBeInTheDocument()
  })

  it('says the money is coming back', async () => {
    confirmStripeCheckoutSession.mockResolvedValue(turnedAway)

    renderPage()

    expect(await screen.findByText(/being refunded in full/i)).toBeInTheDocument()
    expect(screen.getByText(/refund on its way/i)).toBeInTheDocument()
  })

  /** The same sentence the refund email carries, so the screen and the inbox agree. */
  it('passes on the explanation the restaurant gave', async () => {
    confirmStripeCheckoutSession.mockResolvedValue(turnedAway)

    renderPage()

    expect(
      await screen.findByText(/could not accept this order, so it has been refunded in full/i),
    ).toBeInTheDocument()
  })

  /**
   * The order is not always turned away before the money lands. Staff reject it seconds after,
   * because the kitchen is out of something or the restaurant is closing — and the page had already
   * stopped looking, so it held a green tick over an order that no longer existed.
   */
  it('corrects itself when the order is turned away after the payment confirmed', async () => {
    confirmStripeCheckoutSession.mockResolvedValue({ confirmed: true, message: 'Payment confirmed.' })

    renderPage()
    await screen.findByRole('heading', { name: 'Payment confirmed' })

    confirmStripeCheckoutSession.mockResolvedValue(turnedAway)
    document.dispatchEvent(new Event('visibilitychange'))

    expect(await screen.findByRole('heading', { name: 'Order not accepted' })).toBeInTheDocument()
  })

  /** Until this the page stopped looking on the customer's behalf and gave them no way to ask. */
  it('offers a way to ask again once the payment has settled', async () => {
    confirmStripeCheckoutSession.mockResolvedValue({ confirmed: true, message: 'Payment confirmed.' })

    renderPage()
    await screen.findByRole('heading', { name: 'Payment confirmed' })

    expect(screen.getByRole('button', { name: /check again/i })).toBeInTheDocument()
  })

  it('settles there rather than falling back to a reassuring state', async () => {
    confirmStripeCheckoutSession.mockResolvedValue(turnedAway)

    renderPage()

    await screen.findByRole('heading', { name: 'Order not accepted' })
    expect(confirmStripeCheckoutSession).toHaveBeenCalledTimes(1)
  })
})
