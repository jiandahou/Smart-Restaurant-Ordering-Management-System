import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CartSummaryBar } from './CustomerMenuPage'
import type { Cart, CartItem } from '@/api/carts'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

const currencyFormatter = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

function cartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'line-1',
    menuItemId: 'item-1',
    name: 'Veg Spring Rolls',
    imageUrl: null,
    quantity: 1,
    basePrice: 12,
    unitPrice: 12,
    lineTotal: 12,
    note: null,
    selectedOptions: [],
    isAvailable: true,
    isSoldOut: false,
    isOrderable: true,
    unavailableReason: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: null,
    ...overrides,
  } as CartItem
}

function cart(overrides: Partial<Cart> = {}): Cart {
  return {
    id: 'cart-1',
    restaurantId: 'restaurant-1',
    tableId: null,
    tableNumber: null,
    orderType: 'Takeaway',
    status: 'Active',
    customerNote: null,
    expiresAt: '2099-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: null,
    total: 12,
    itemCount: 1,
    items: [cartItem()],
    ...overrides,
  } as Cart
}

function renderBar(props: Partial<Parameters<typeof CartSummaryBar>[0]> = {}) {
  const onClearCart = vi.fn()

  render(
    <MemoryRouter>
    <CartSummaryBar
      cart={cart()}
      currencyFormatter={currencyFormatter}
      menuItemsById={new Map()}
      open
      updatingItemId={null}
      isClearingCart={false}
      isSavingNote={false}
      isCheckingOut={false}
      onOpenChange={vi.fn()}
      onQuantityChange={vi.fn()}
      onOptionQuantityChange={vi.fn()}
      onModifyItem={vi.fn()}
      onRemoveItem={vi.fn()}
      onClearCart={onClearCart}
      onOrderNoteSave={vi.fn()}
      onCheckout={vi.fn()}
      {...props}
    />
    </MemoryRouter>,
  )

  return { onClearCart }
}

const clearButton = () => screen.getByRole('button', { name: /^clear$/i })

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/**
 * Clearing a cart is one tap away from destroying everything in it, so the confirmation is the only
 * thing between the two. A trigger that silently fails to open its dialog looks identical to a
 * button that does nothing at all — no dialog, no error, no change.
 */
describe('the Clear button', () => {
  it('opens the confirmation dialog on click', async () => {
    const user = userEvent.setup()
    renderBar()

    await user.click(clearButton())

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('Clear cart?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep cart/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clear cart/i })).toBeInTheDocument()
  })

  it('opens the confirmation dialog from the keyboard', async () => {
    // The button reaches Radix through `asChild`. If that integration breaks, the element still
    // renders and still focuses — it just stops being a trigger, which the mouse test alone could
    // miss if the handler were attached somewhere else.
    const user = userEvent.setup()
    renderBar()

    clearButton().focus()
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  })

  it('is announced as opening a dialog', async () => {
    renderBar()

    expect(clearButton()).toHaveAttribute('aria-haspopup', 'dialog')
    expect(clearButton()).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not clear anything until the confirmation is accepted', async () => {
    const user = userEvent.setup()
    const { onClearCart } = renderBar()

    await user.click(clearButton())
    await screen.findByRole('alertdialog')

    expect(onClearCart).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /clear cart/i }))

    expect(onClearCart).toHaveBeenCalledTimes(1)
  })

  it('clears nothing when the confirmation is declined', async () => {
    const user = userEvent.setup()
    const { onClearCart } = renderBar()

    await user.click(clearButton())
    await user.click(await screen.findByRole('button', { name: /keep cart/i }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(onClearCart).not.toHaveBeenCalled()
  })

  it('is not offered at all on a cart that can no longer be changed', async () => {
    renderBar({ cart: cart({ status: 'Submitted' }) })

    expect(screen.queryByRole('button', { name: /^clear$/i })).not.toBeInTheDocument()
  })

  it('is not offered on an empty cart', async () => {
    renderBar({ cart: cart({ items: [], itemCount: 0, total: 0 }) })

    expect(screen.queryByRole('button', { name: /^clear$/i })).not.toBeInTheDocument()
  })
})

/**
 * While a checkout or a clear is in flight the button is deliberately disabled — emptying the cart
 * midway through either would be incoherent. Recorded here because a disabled trigger is
 * indistinguishable, from the outside, from a broken one: it is worth knowing on purpose.
 */
describe('while another cart action is running', () => {
  it('refuses to open while the cart is already being cleared', async () => {
    const user = userEvent.setup()
    renderBar({ isClearingCart: true })

    expect(clearButton()).toBeDisabled()
    await user.click(clearButton())

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('refuses to open while checkout is running', async () => {
    const user = userEvent.setup()
    renderBar({ isCheckingOut: true })

    expect(clearButton()).toBeDisabled()
    await user.click(clearButton())

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

/**
 * A cart read used to report a line as available while checkout refused it, so the customer met the
 * problem only after pressing the button. The server now sends one verdict and the reason behind
 * it, and the cart has to act on both.
 */
describe('a line that can no longer be ordered', () => {
  const soldOut = cart({
    items: [cartItem({ isOrderable: false, isSoldOut: true, unavailableReason: 'This item has sold out.' })],
  })

  it('blocks checkout instead of letting it fail at the server', () => {
    renderBar({ cart: soldOut })

    expect(screen.getByRole('button', { name: /go to checkout/i })).toBeDisabled()
  })

  it('names the item and says why', () => {
    renderBar({ cart: soldOut })

    expect(screen.getByText(/one item can no longer be ordered/i)).toBeInTheDocument()
    // The line is assembled from several text nodes, so it is matched on the element's whole text.
    expect(screen.getByRole('listitem')).toHaveTextContent('Veg Spring Rolls — This item has sold out.')
  })

  it('counts them when more than one is affected', () => {
    renderBar({
      cart: cart({
        items: [
          cartItem({ isOrderable: false, unavailableReason: 'This item has sold out.' }),
          cartItem({ id: 'line-2', isOrderable: false, unavailableReason: "This item's menu section is no longer being served." }),
        ],
      }),
    })

    expect(screen.getByText(/2 items can no longer be ordered/i)).toBeInTheDocument()
  })

  it('says nothing and allows checkout when every line is fine', () => {
    renderBar()

    expect(screen.queryByText(/can no longer be ordered/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /go to checkout/i })).toBeEnabled()
  })

  it('falls back to a sentence when the server sent no reason', () => {
    renderBar({ cart: cart({ items: [cartItem({ isOrderable: false, unavailableReason: null })] }) })

    expect(screen.getByRole('listitem')).toHaveTextContent('Veg Spring Rolls — No longer available.')
  })
})

/**
 * On a phone the open cart used to grow upward past the top of the screen. It is pinned to the
 * bottom, so the overflow went somewhere nothing could scroll to: the Cart heading, the item count
 * and the Clear button sat above the viewport permanently, and the first item was sliced in half.
 *
 * <p>
 * The panel is now three regions — a header that stays, one scroll area, and an action bar that
 * stays — so the two things a customer needs (what is in the cart, and how to pay for it) are
 * reachable at any viewport height. Asserted structurally: jsdom has no layout, so the classes
 * that produce the behaviour are what can be checked here. The heights themselves were measured in
 * a real browser at 812px and at 420px.
 * </p>
 */
describe('the open cart panel on a small screen', () => {
  it('never grows taller than the screen it is pinned to', () => {
    renderBar()

    const panel = document.querySelector('.fixed.bottom-0')

    expect(panel).toHaveClass('max-h-dvh')
    expect(panel).toHaveClass('flex')
  })

  it('keeps the heading and the Clear button out of the scrolling region', () => {
    renderBar()

    const header = screen.getByRole('heading', { name: /cart/i }).closest('div.shrink-0')

    expect(header).not.toBeNull()
    expect(header).toContainElement(screen.getByRole('button', { name: /^clear$/i }))
  })

  it('scrolls the items rather than the whole panel', () => {
    renderBar()

    const list = document.querySelector('.flex-1.overflow-y-auto')

    expect(list).not.toBeNull()
    expect(list).toHaveClass('min-h-0')
  })

  it('keeps the total and the checkout button reachable', () => {
    renderBar()

    const action = screen.getByRole('button', { name: /go to checkout/i }).closest('div.shrink-0')

    expect(action).not.toBeNull()
    // Capped so it scrolls instead of clipping when the screen is too short for it — a per cent
    // cap resolves to nothing against a flex parent with no definite height.
    expect(action).toHaveClass('max-h-[50dvh]')
    expect(action).toHaveClass('overflow-y-auto')
  })
})

/**
 * Two affordances asked for after using the cart on a phone: the add-on quantity control had no
 * frame, so it read as text with two glyphs beside it rather than something to press — while the
 * item control directly below it was a bordered pill doing the same job. And the panel could only
 * be closed from a small chevron, when the gesture people already expect from a bottom sheet is to
 * swipe it away.
 */
describe('the cart panel on a phone', () => {
  it('offers a grab handle so the swipe is discoverable', () => {
    renderBar()

    const handle = document.querySelector('[aria-hidden="true"].rounded-full.bg-border')

    expect(handle).not.toBeNull()
    // Phone only: on a pointer device the chevron is the obvious control.
    expect(handle).toHaveClass('sm:hidden')
  })

  it('puts the swipe target on the header, where the drag starts', () => {
    renderBar()

    const header = screen.getByRole('heading', { name: /cart/i }).closest('div.touch-pan-y')

    expect(header).not.toBeNull()
  })

  it('keeps the header controls tappable inside the swipe area', async () => {
    // A drag handler that swallowed taps would cost the Clear button and the collapse chevron.
    const user = userEvent.setup()
    renderBar()

    await user.click(screen.getByRole('button', { name: /^clear$/i }))

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  })
})

/**
 * Both controls inside an add-on chip were bare glyphs on a tinted background: the quantity
 * stepper had no frame, and the remove button was a lone cross. People did not know either was
 * pressable — while the item stepper immediately below was a bordered pill doing the same job.
 */
describe('the controls on an add-on', () => {
  const optionId = 'opt-1'

  const withAddOn = () => cart({
    items: [cartItem({
      selectedOptions: [{
        menuItemOptionId: optionId,
        groupNameSnapshot: 'Add-ons',
        optionNameSnapshot: 'Extra roll',
        priceAdjustmentSnapshot: 90,
        quantity: 2,
      }],
    })],
  })

  // The controls only render once the cart line can be matched back to a live menu option, so the
  // map has to carry one. An empty map renders the chip as plain text and asserts nothing.
  const menuItems = () => new Map([['item-1', {
    id: 'item-1',
    name: 'Veg Spring Rolls',
    isAvailable: true,
    isSoldOut: false,
    optionGroups: [{
      id: 'group-1',
      name: 'Add-ons',
      isRequired: false,
      minSelections: 0,
      maxSelections: 3,
      // Both required by getAvailableOptionGroups, which filters on isActive and sorts on
      // displayOrder — an incomplete fixture here silently renders no controls at all.
      isActive: true,
      displayOrder: 1,
      options: [{
        id: optionId,
        groupId: 'group-1',
        name: 'Extra roll',
        priceAdjustment: 90,
        adjustmentType: 0,
        maxQuantity: 3,
        displayOrder: 1,
        isAvailable: true,
      }],
    }],
  } as unknown as Parameters<typeof CartSummaryBar>[0]['menuItemsById'] extends Map<string, infer T> ? T : never]])

  it('frames the quantity stepper like the item stepper', () => {
    renderBar({ cart: withAddOn(), menuItemsById: menuItems() })

    const decrease = screen.getByRole('button', { name: /decrease extra roll/i })

    expect(decrease.parentElement).toHaveClass('rounded-full')
    expect(decrease.parentElement).toHaveClass('border')
  })

  it('frames the remove button so it reads as a control', () => {
    renderBar({ cart: withAddOn(), menuItemsById: menuItems() })

    const remove = screen.getByRole('button', { name: /remove extra roll/i })

    expect(remove).toHaveClass('rounded-full')
    expect(remove.className).toMatch(/border/)
  })
})
