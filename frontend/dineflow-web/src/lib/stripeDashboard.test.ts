import { describe, expect, it } from 'vitest'
import { buildStripeDashboardUrl } from './stripeDashboard'

describe('buildStripeDashboardUrl', () => {
  it('puts the connected account in the path', () => {
    // Without this the operator lands on an empty platform view for Connect direct charges.
    expect(buildStripeDashboardUrl('pi_123', 'acct_456', false))
      .toBe('https://dashboard.stripe.com/acct_456/test/payments/pi_123')
  })

  it('omits the account segment for platform payments', () => {
    expect(buildStripeDashboardUrl('pi_123', null, false))
      .toBe('https://dashboard.stripe.com/test/payments/pi_123')
  })

  it('drops the test segment in live mode', () => {
    expect(buildStripeDashboardUrl('pi_123', 'acct_456', true))
      .toBe('https://dashboard.stripe.com/acct_456/payments/pi_123')
  })

  it('returns null when there is no identifier', () => {
    expect(buildStripeDashboardUrl(null, 'acct_456', false)).toBeNull()
    expect(buildStripeDashboardUrl(undefined, 'acct_456', false)).toBeNull()
    expect(buildStripeDashboardUrl('   ', 'acct_456', false)).toBeNull()
  })

  it('refuses to link seeded demo identifiers', () => {
    expect(buildStripeDashboardUrl('pi_demo_0018', 'acct_456', false)).toBeNull()
    expect(buildStripeDashboardUrl('ch_demo_0018', null, true)).toBeNull()
  })

  it('links a charge the same way as a payment intent', () => {
    expect(buildStripeDashboardUrl('ch_789', 'acct_456', false))
      .toBe('https://dashboard.stripe.com/acct_456/test/payments/ch_789')
  })

  it('links a dispute to the disputes section, not payments', () => {
    // A dispute has its own page carrying the evidence form and the deadline.
    expect(buildStripeDashboardUrl('dp_123', 'acct_456', false, 'disputes'))
      .toBe('https://dashboard.stripe.com/acct_456/test/disputes/dp_123')
  })
})
