import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const createPublicPaymentSession = vi.fn()

vi.mock('@/api/carts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createPublicPaymentSession: (...args: unknown[]) => createPublicPaymentSession(...args),
}))

const { CheckoutPage } = await import('./CheckoutPage')
type CheckoutNavigationState = import('./CheckoutPage').CheckoutNavigationState

const navigationState: CheckoutNavigationState = {
  order: {
    id: 'order-1',
    restaurantId: 'restaurant-1',
    tableId: 'table-1',
    tableNumber: 'P2',
    customerId: null,
    orderNumber: 'ORD-MOBILE-001',
    currency: 'AUD',
    orderType: 0,
    status: 0,
    paymentStatus: 'Pending',
    paymentMethod: 'Online',
    totalAmount: 25,
    customerNote: null,
    scheduledTime: null,
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: null,
    orderItems: [],
  },
  cartId: 'cart-1',
  participantToken: 'test-participant-token',
  currency: 'AUD',
  restaurantName: 'Mobile Test Restaurant',
  restaurantLegalBusinessName: 'Mobile Test Restaurant Pty Ltd',
  restaurantAbn: null,
  gstRegistered: true,
  pricesIncludeGst: true,
  refundContactEmail: '',
  customerSurchargeNotice: null,
  tableNumber: 'P2',
  paymentPolicy: 'PayAtCounterAllowed',
  onlinePaymentsEnabled: true,
}

function renderCheckout() {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/checkout', state: navigationState }]}>
      <Routes>
        <Route path="/checkout" element={<CheckoutPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('checkout recovery without navigation state', () => {
  it('returns an empty or stale checkout to My Orders instead of the undefined root route', async () => {
    render(
      <MemoryRouter initialEntries={['/checkout']}>
        <Routes>
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/my-orders" element={<p>Recovered in My Orders</p>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Recovered in My Orders')).toBeInTheDocument()
  })
})

/**
 * Stripe's expired Checkout page is a dead end — it says the session timed out and offers no link
 * back to the restaurant and no retry. Replacing DineFlow with it left the customer with nothing but
 * the browser Back button, so Checkout now opens beside this page instead of on top of it.
 */
describe('handing the customer over to hosted Checkout', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    createPublicPaymentSession.mockReset()
  })

  it('keeps this page alive with a retry when Checkout opened in its own tab', async () => {
    const tab = { location: { assign: vi.fn() }, focus: vi.fn(), close: vi.fn(), closed: false, opener: {} }
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    createPublicPaymentSession.mockResolvedValue({
      orderId: 'order-1',
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
    })

    renderCheckout()
    await userEvent.click(screen.getByRole('button', { name: /^pay a\$/i }))

    await waitFor(() => expect(screen.getByText('Payment opened in a new tab')).toBeInTheDocument())
    expect(tab.location.assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1')
    // The way back that Stripe's expired page does not provide.
    expect(screen.getByRole('button', { name: /start payment again/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /check this order/i })).toBeInTheDocument()
  })

  it('does not draw a panel on a page it just navigated away from', async () => {
    // Popup blocked: the customer is sent to Checkout in this very tab, so there is no page left.
    vi.spyOn(window, 'open').mockReturnValue(null)
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as Location)
    createPublicPaymentSession.mockResolvedValue({
      orderId: 'order-1',
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
    })

    renderCheckout()
    await userEvent.click(screen.getByRole('button', { name: /^pay a\$/i }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1'))
    expect(screen.queryByText('Payment opened in a new tab')).not.toBeInTheDocument()
  })

  it('closes the waiting tab when the session could not be created', async () => {
    const tab = { location: { assign: vi.fn() }, focus: vi.fn(), close: vi.fn(), closed: false, opener: {} }
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    createPublicPaymentSession.mockRejectedValue(new Error('Stripe is unavailable'))

    renderCheckout()
    await userEvent.click(screen.getByRole('button', { name: /^pay a\$/i }))

    await waitFor(() => expect(tab.close).toHaveBeenCalled())
    expect(tab.location.assign).not.toHaveBeenCalled()
  })
})

describe('CheckoutPage mobile counter payment option', () => {
  it('allows the dine-in title and supporting copy to wrap inside the button', () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/checkout', state: navigationState }]}>
        <Routes>
          <Route path="/checkout" element={<CheckoutPage />} />
        </Routes>
      </MemoryRouter>,
    )

    const button = screen.getByRole('button', { name: /pay at counter after your meal/i })
    const title = screen.getByText('Pay at counter after your meal')
    const description = screen.getByText('Confirm this order now and settle the bill when you are ready')

    expect(button).toHaveClass('h-auto', 'whitespace-normal', 'px-3')
    expect(title).toHaveClass('break-words', 'min-w-0')
    expect(description).toHaveClass('w-full', 'break-words')
    // min-w-0 is what lets the title row shrink below its content and wrap. It must never stretch:
    // a full-width text block pushes the icon to the far edge, which is what left this option's
    // icon and label lined up with nothing, least of all the online button above it.
    expect(title.parentElement).toHaveClass('min-w-0')
    expect(title.parentElement).not.toHaveClass('flex-1')
    expect(title.parentElement).not.toHaveClass('w-full')
  })

  it('lays the counter option out like the online button above it', () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/checkout', state: navigationState }]}>
        <Routes>
          <Route path="/checkout" element={<CheckoutPage />} />
        </Routes>
      </MemoryRouter>,
    )

    const counter = screen.getByRole('button', { name: /pay at counter after your meal/i })
    const title = screen.getByText('Pay at counter after your meal')

    // Both choices centre their icon and label as one group; the counter option used to left-align
    // its text instead, so the two buttons read as different kinds of control.
    expect(counter).toHaveClass('justify-center', 'text-center')
    expect(title.parentElement).toHaveClass('items-center')
  })
})

/**
 * The refresh case: choosing counter payment used to live only in React state, so reloading the
 * page put a settled order back in front of the customer with a "Pay" button on it.
 */
describe('reopening checkout after a refresh', () => {
  it('confirms the order instead of billing again when it is set to counter payment', () => {
    render(
      <MemoryRouter
        initialEntries={[{
          pathname: '/checkout',
          state: {
            ...navigationState,
            order: { ...navigationState.order, paymentMethod: 'PayAtCounter' },
          },
        }]}
      >
        <Routes>
          <Route path="/checkout" element={<CheckoutPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Order placed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^pay a\$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pay at counter/i })).not.toBeInTheDocument()
  })

  it('still offers payment for an order that has not chosen counter payment', () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/checkout', state: navigationState }]}>
        <Routes>
          <Route path="/checkout" element={<CheckoutPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: /^pay a\$/i })).toBeInTheDocument()
    expect(screen.queryByText('Order placed')).not.toBeInTheDocument()
  })
})
