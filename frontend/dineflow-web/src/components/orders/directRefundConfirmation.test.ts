import { describe, expect, it } from 'vitest'
import { canConfirmDirectRefund } from './directRefundConfirmation'

describe('PAY-REF-10 direct refund confirmation', () => {
  it('requires the exact order number for a live refund', () => {
    expect(canConfirmDirectRefund('ORD-2048', 'Live', '')).toBe(false)
    expect(canConfirmDirectRefund('ORD-2048', 'Live', 'ord-2048')).toBe(false)
    expect(canConfirmDirectRefund('ORD-2048', 'Live', ' ORD-2048 ')).toBe(false)
    expect(canConfirmDirectRefund('ORD-2048', 'Live', 'ORD-2048')).toBe(true)
  })

  it('does not require typed confirmation in test mode', () => {
    expect(canConfirmDirectRefund('ORD-2048', 'Test', '')).toBe(true)
  })

  it('blocks while the environment is unknown or unconfigured', () => {
    expect(canConfirmDirectRefund('ORD-2048', null, 'ORD-2048')).toBe(false)
    expect(canConfirmDirectRefund('ORD-2048', 'Unconfigured', 'ORD-2048')).toBe(false)
  })
})
