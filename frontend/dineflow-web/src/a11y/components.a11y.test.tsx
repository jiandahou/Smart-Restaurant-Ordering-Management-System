import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from '@testing-library/user-event'
import { findAccessibilityViolations } from './axe'
import { DashboardCanvas } from '@/components/dashboard/DashboardCanvas'
import type { DashboardWidget } from '@/components/dashboard/dashboardLayout'
import { PasswordRequirements } from '@/components/auth/PasswordRequirements'
import { ReceiptDocumentView } from '@/components/orders/ReceiptDocumentView'
import type { ReceiptDocument } from '@/lib/receipt'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

const widgets: DashboardWidget[] = [
  {
    id: 'alpha',
    title: 'Alpha',
    allowedSizes: [{ w: 1, h: 1 }, { w: 2, h: 1 }],
    render: () => <div data-slot="card">Alpha content</div>,
  },
  {
    id: 'beta',
    title: 'Beta',
    allowedSizes: [{ w: 2, h: 1 }, { w: 1, h: 1 }],
    render: () => <div data-slot="card">Beta content</div>,
  },
]

const receipt: ReceiptDocument = {
  documentTitle: 'TAX INVOICE',
  scopeLabel: 'Counter receipt',
  code: 'P2-007',
  supplier: {
    restaurantName: 'The DineFlow Kitchen',
    legalBusinessName: 'DineFlow Hospitality Pty Ltd',
    abn: '51824753556',
    address: '10 King William Street, Adelaide SA 5000',
    phone: '(08) 5555 0100',
  },
  issuedAt: new Date('2026-08-09T02:00:00Z'),
  currency: 'AUD',
  meta: [{ label: 'Order', value: 'T-001' }],
  items: [{
    id: 'item-1',
    quantity: 2,
    name: 'Butter Chicken',
    baseAmount: 38,
    modifiers: [{ label: 'Naan', amount: 6 }],
    optionGroups: [{ groupName: 'Side', options: ['Rice'] }],
    totalPrice: 44,
    note: null,
  }],
  totalAmount: 44,
  gstAmount: 4,
  amountDue: 0,
  surchargeNotice: null,
  refundContactEmail: 'refunds@example.com',
}

afterEach(cleanup)

describe('accessibility of shipped markup', () => {
  it('the dashboard canvas has no axe violations', async () => {
    const { container } = render(<DashboardCanvas widgets={widgets} storageScope="owner-1" />)

    expect(await findAccessibilityViolations(container)).toEqual([])
  })

  it('the password requirements checklist has no axe violations', async () => {
    const { container } = render(<PasswordRequirements password="short" />)

    expect(await findAccessibilityViolations(container)).toEqual([])
  })

  it('the receipt document has no axe violations', async () => {
    const { container } = render(<ReceiptDocumentView receipt={receipt} visible />)

    expect(await findAccessibilityViolations(container)).toEqual([])
  })

  it('announces which password rules are still outstanding', async () => {
    // The checklist is the only signal of what is missing, so it has to be readable without
    // relying on the colour of the icon.
    render(<PasswordRequirements password="short" />)

    expect(screen.getByText(/Password needs \d+ more of:/)).toBeInTheDocument()
    expect(screen.getByText('At least 8 characters')).toBeInTheDocument()
    // Each unmet rule carries its status in text, not only in the icon's colour.
    expect(screen.getAllByText('— still needed').length).toBeGreaterThan(0)
  })
})

describe('keyboard operation', () => {
  it('reaches and activates the dashboard customize control without a mouse', async () => {
    const user = userEvent.setup()
    render(<DashboardCanvas widgets={widgets} storageScope="owner-1" />)

    const customize = screen.getByRole('button', { name: 'Customize' })

    await user.tab()
    // Tab order may pass through earlier controls; keep going until the control has focus so the
    // test asserts reachability rather than a brittle exact position.
    for (let step = 0; step < 10 && document.activeElement !== customize; step += 1) {
      await user.tab()
    }

    expect(customize).toHaveFocus()

    await user.keyboard('{Enter}')

    // Entering customization mode reveals the per-widget controls and the exit actions.
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide Alpha' })).toBeInTheDocument()
  })
})
