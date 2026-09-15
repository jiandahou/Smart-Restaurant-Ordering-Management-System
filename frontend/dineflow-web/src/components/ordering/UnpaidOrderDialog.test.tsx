import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { CustomerOrder } from '@/api/auth'
import type { UnpaidOrderPrompt } from '@/lib/unpaidOrderPrompt'
import { UnpaidOrderDialog } from './UnpaidOrderDialog'

const currencyFormatter = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

function prompt(remainingMs = 12 * 60_000): UnpaidOrderPrompt {
  return {
    order: {
      id: 'order-1',
      orderNumber: 'ORD-1234',
      totalAmount: 42,
      orderItems: [
        {
          id: 'line-1',
          itemNameSnapshot: 'Tandoori Platter',
          quantity: 2,
          unitPrice: 17,
          note: 'No coriander',
          selectedOptions: [{ id: 'o1', optionNameSnapshot: 'Extra spicy' }],
        },
        {
          id: 'line-2',
          itemNameSnapshot: 'Masala Chai',
          quantity: 1,
          unitPrice: 8,
          note: null,
          selectedOptions: [],
        },
      ],
    } as unknown as CustomerOrder,
    expiresAt: new Date('2026-08-12T10:12:00Z'),
    remainingMs,
  }
}

function renderDialog(overrides: Partial<Parameters<typeof UnpaidOrderDialog>[0]> = {}) {
  const props = {
    prompt: prompt(),
    currencyFormatter,
    onContinue: vi.fn(),
    onCancel: vi.fn().mockResolvedValue(undefined),
    onDismiss: vi.fn(),
    ...overrides,
  }

  render(<UnpaidOrderDialog {...props} />)
  return props
}

/**
 * A customer who bounced off the payment screen has an order holding stock and a pickup number.
 * Without being told, they start a second order on top of the first and then find the dish sold
 * out by their own forgotten order.
 */
describe('telling a returning customer about their unpaid order', () => {
  it('shows nothing when there is no unpaid order', () => {
    renderDialog({ prompt: null })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('names the order and what it is holding', () => {
    renderDialog()

    expect(screen.getByText('ORD-1234')).toBeInTheDocument()
    expect(screen.getByText('$42.00')).toBeInTheDocument()
  })

  /** Doing nothing is a legitimate answer, but only once its consequence is stated. */
  it('states that it expires on its own and how long is left', () => {
    renderDialog()

    expect(screen.getByText('12 minutes')).toBeInTheDocument()
    expect(screen.getByText(/expires on its own/i)).toBeInTheDocument()
    expect(screen.getByText(/will not be charged/i)).toBeInTheDocument()
  })

  it('offers all three ways out', () => {
    renderDialog()

    expect(screen.getByRole('button', { name: /continue to payment/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel this order now/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /leave it for now/i })).toBeInTheDocument()
  })

  it('sends the customer back to payment', async () => {
    const props = renderDialog()

    await userEvent.click(screen.getByRole('button', { name: /continue to payment/i }))

    expect(props.onContinue).toHaveBeenCalled()
  })

  it('cancels the order on request', async () => {
    const props = renderDialog()

    await userEvent.click(screen.getByRole('button', { name: /cancel this order now/i }))

    await waitFor(() => expect(props.onCancel).toHaveBeenCalled())
  })

  it('dismisses without touching the order', async () => {
    const props = renderDialog()

    await userEvent.click(screen.getByRole('button', { name: /leave it for now/i }))

    expect(props.onDismiss).toHaveBeenCalled()
    expect(props.onCancel).not.toHaveBeenCalled()
  })

  /** Cancelling is a round trip; a second click would try to cancel an order already going away. */
  it('locks the choices while a cancellation is in flight', async () => {
    let release: () => void = () => {}
    const onCancel = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    renderDialog({ onCancel })

    await userEvent.click(screen.getByRole('button', { name: /cancel this order now/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /continue to payment/i })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: /leave it for now/i })).toBeDisabled()

    release()
  })

  /** "An order" is not something anyone can decide about without checking what is in it. */
  it('can be expanded to show what was ordered', async () => {
    renderDialog()

    expect(screen.getByText(/what is in this order/i)).toBeInTheDocument()
    expect(screen.getByText(/3 items/)).toBeInTheDocument()

    await userEvent.click(screen.getByText(/what is in this order/i))

    expect(screen.getByText('Tandoori Platter')).toBeInTheDocument()
    expect(screen.getByText('Masala Chai')).toBeInTheDocument()
    expect(screen.getByText('Extra spicy')).toBeInTheDocument()
    expect(screen.getByText(/No coriander/)).toBeInTheDocument()
    // Line total, not unit price: two platters at 17 each.
    expect(screen.getByText('$34.00')).toBeInTheDocument()
  })

  /** Collapsed by default so the three choices below it are not buried under a list. */
  it('starts collapsed', () => {
    renderDialog()

    expect(screen.getByRole('group')).not.toHaveAttribute('open')
  })
})

/**
 * The dialog footer defaults to flex-col-reverse. Left alone it put "Leave it for now" at the top,
 * where the weakest choice read as the heading of the group, and pushed the main action furthest
 * from the thumb.
 */
describe('the order the choices are offered in', () => {
  it('leads with paying and ends with doing nothing', () => {
    renderDialog()

    const footer = screen.getByRole('button', { name: /continue to payment/i }).parentElement!
    const labels = [...footer.querySelectorAll('button')].map((b) => b.textContent?.trim())

    expect(footer).toHaveClass('flex-col')
    expect(footer).not.toHaveClass('flex-col-reverse')
    expect(labels[0]).toMatch(/continue to payment/i)
    expect(labels[labels.length - 1]).toMatch(/leave it for now/i)
  })
})

/**
 * Wanting the same meal again otherwise means finding every dish and option by hand, while the
 * unpaid order sits there holding exactly those portions.
 */
describe('copying the order back into the cart', () => {
  it('offers to add the items when there is a cart to add them to', async () => {
    const onCopyToCart = vi.fn().mockResolvedValue(undefined)
    renderDialog({ onCopyToCart })

    await userEvent.click(screen.getByRole('button', { name: /add these items to my cart/i }))

    expect(onCopyToCart).toHaveBeenCalled()
  })

  it('hides the option when there is nowhere to copy to', () => {
    renderDialog({ onCopyToCart: undefined })

    expect(screen.queryByRole('button', { name: /add these items to my cart/i })).not.toBeInTheDocument()
  })

  /** Two writes to the same cart at once is how a customer ends up with the order twice. */
  it('locks the other choices while copying', async () => {
    let release: () => void = () => {}
    const onCopyToCart = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    renderDialog({ onCopyToCart })

    await userEvent.click(screen.getByRole('button', { name: /add these items to my cart/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /cancel this order now/i })).toBeDisabled(),
    )
    release()
  })
})

/**
 * "Continue to payment" promises something a restaurant without Stripe cannot do; the checkout
 * screen is where both choices live.
 */
describe('naming the main action for what the restaurant can actually do', () => {
  it('offers payment when the restaurant takes cards', () => {
    renderDialog({ onlinePaymentsEnabled: true })

    expect(screen.getByRole('button', { name: /continue to payment/i })).toBeInTheDocument()
  })

  it('avoids promising payment when online payment is unavailable', () => {
    renderDialog({ onlinePaymentsEnabled: false })

    expect(screen.queryByRole('button', { name: /continue to payment/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /finish this order/i })).toBeInTheDocument()
  })
})
