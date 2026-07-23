import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OrderProgressStepper } from './OrderProgressStepper'

describe('OrderProgressStepper', () => {
  it('marks the current step for an in-progress order', () => {
    render(<OrderProgressStepper status={2} />)

    const preparingStep = screen.getByText('Preparing').closest('li')
    expect(preparingStep).toHaveAttribute('aria-current', 'step')
  })

  it('renders a terminal state for cancelled orders instead of the progress track', () => {
    render(<OrderProgressStepper status={5} />)

    expect(screen.getByText('Order cancelled')).toBeInTheDocument()
    expect(screen.queryByText('Preparing')).not.toBeInTheDocument()
  })
})
