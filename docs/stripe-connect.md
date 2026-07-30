# Stripe Connect production setup

DineFlow uses Stripe Connect **direct charges**. Each customer charge is created
inside the restaurant's connected Stripe account. Stripe processing fees and
payment losses are assigned to that restaurant account; DineFlow can collect an
optional application fee from each order.

The platform also supports an optional one-time restaurant activation fee. Both
platform fees default to zero and can be changed by a PlatformOwner from
**Admin → Restaurants → Payments**.

## Required environment variables

```text
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...
STRIPE_SUCCESS_URL=https://app.example.com/payment/success
STRIPE_CANCEL_URL=https://app.example.com/payment/cancelled
STRIPE_CONNECT_RETURN_URL=https://app.example.com/admin/restaurants?stripeConnect=return
STRIPE_CONNECT_REFRESH_URL=https://app.example.com/admin/restaurants?stripeConnect=refresh
STRIPE_PLATFORM_FEE_SUCCESS_URL=https://app.example.com/admin/restaurants?platformFee=success
STRIPE_PLATFORM_FEE_CANCEL_URL=https://app.example.com/admin/restaurants?platformFee=cancelled
```

Never put Stripe secret keys or webhook signing secrets in frontend environment
variables.

## Webhook destinations

Create two Stripe event destinations that point to:

```text
https://api.example.com/api/payments/stripe/webhook
```

1. **Your account** destination. Store its signing secret in
   `STRIPE_WEBHOOK_SECRET`. Subscribe to:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, and `checkout.session.expired`.
   These events reconcile the optional one-time activation fee.
2. **Connected accounts** destination. Store its separate signing secret in
   `STRIPE_CONNECT_WEBHOOK_SECRET`. Subscribe to:
   `account.updated`, `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `payment_intent.canceled`, `refund.created`, `refund.updated`,
   `refund.failed`, and `charge.refunded`.
   Also subscribe to `charge.dispute.created`, `charge.dispute.updated`, and
   `charge.dispute.closed` so dispute activity appears in DineFlow reports.

The endpoint verifies both secrets, records every Stripe event ID, ignores
duplicates, rejects events from the wrong connected account, and prevents older
events from regressing a settled payment.

## Sandbox testing workflow

Use separate sandbox connected accounts for independent scenarios instead of
trying to move one account backward through onboarding states.

1. **Onboarding happy path:** connect a new restaurant and confirm that Stripe
   receives the restaurant name, contact email, phone, address, and service
   description from DineFlow. The merchant must still supply or confirm legal
   entity, representative, tax, and payout bank details.
2. **Incomplete onboarding:** leave onboarding before submission, return to
   DineFlow, and verify that online payments remain unavailable and the
   restaurant status explains what information is still due.
3. **Successful direct charge:** complete checkout with a Stripe test payment
   method. Confirm that the charge is in the restaurant's connected account and
   that only the configured application fee appears in the platform account.
4. **Declined payment:** use an official Stripe declined-payment test method and
   verify that DineFlow never marks the payment or order as paid.
5. **Refunds:** run both partial and full refunds. Confirm that the refund is
   created in the connected account and that the proportional application fee
   is returned when applicable.
6. **Webhook reliability:** send connected-account events through the local
   Stripe CLI listener, replay an event with the same Stripe event ID, and
   confirm that no duplicate payment, refund, or activity entry is created.
7. **Account remediation:** create additional test connected accounts with
   Stripe's test verification values to exercise requirements-due, verification
   failure, and disabled-payment states.
8. **Reset:** delete the test-mode connected account in Stripe, then clear the
   restaurant's Stripe binding in DineFlow before starting the scenario again.

Only use Stripe-provided test data in a sandbox. Never enter a real person's
identity, tax, bank, or card details for automated testing.

## Go-live checklist

- Apply the latest EF Core migration before starting the new API version.
- Complete the platform's Stripe Connect profile and live-mode activation.
- Connect one test restaurant, finish onboarding, then verify that both
  `charges_enabled` and `payouts_enabled` show as enabled in DineFlow.
- Place and pay a low-value order, then confirm the charge in the restaurant's
  Stripe Dashboard and any application fee in the platform Dashboard.
- Test a full refund and a partial refund. DineFlow issues the refund in the
  restaurant account and asks Stripe to return the corresponding application
  fee.
- Confirm both webhook destinations return HTTP 200, including replaying the
  same event to verify idempotency.
- Repeat the full flow in live mode with a real card before public launch.
