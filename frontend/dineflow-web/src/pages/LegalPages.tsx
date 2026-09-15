import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { LEGAL_VERSIONS, legalOperator, operatorDisplayName } from '@/legal/legalConfig'

function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const navigate = useNavigate()

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
      return
    }

    if (document.referrer) {
      try {
        const referrer = new URL(document.referrer)
        if (referrer.origin === window.location.origin) {
          window.location.assign(`${referrer.pathname}${referrer.search}${referrer.hash}`)
          return
        }
      } catch {
        // Ignore an invalid referrer and use the safe fallback below.
      }
    }

    navigate('/login', { replace: true })
  }

  return (
    <main className="legal-page">
      <article>
        <Button type="button" variant="outline" className="legal-back-button" onClick={handleBack}>
          <ArrowLeft aria-hidden="true" />
          Back
        </Button>
        <p className="eyebrow">DineFlow legal</p>
        <h1>{title}</h1>
        <p className="legal-updated">Effective and last updated: {updated}</p>
        {children}
      </article>
    </main>
  )
}

export function CustomerTermsPage() {
  return (
    <LegalPage title="Customer Terms and Conditions" updated={LEGAL_VERSIONS.customerTerms}>
      <p>These terms govern your use of DineFlow and orders placed with participating restaurants in Australia.</p>
      <h2>Who you contract with</h2>
      <p>{operatorDisplayName()} provides the ordering platform. The restaurant identified on the menu and checkout page is the supplier of the food and accepts, prepares and fulfils your order. Restaurant contact details are shown on its menu.</p>
      <h2>Orders and availability</h2>
      <p>Your order is an offer to buy the listed items. It is accepted when the restaurant accepts or begins preparing it. Items, preparation times and availability can change. If an item cannot be supplied, the restaurant must contact you or provide an appropriate remedy.</p>
      <h2>Prices and payment</h2>
      <p>Prices are in the currency shown and include GST where the restaurant is registered for GST. Any card, weekend, public-holiday or other surcharge must be disclosed before you submit the order. Online payments are processed by Stripe; DineFlow does not store complete card numbers.</p>
      <h2>Cancellations, problems and refunds</h2>
      <p>Change-of-mind cancellations may be refused after a restaurant accepts or starts preparing an order. Nothing in these terms excludes rights that cannot lawfully be excluded under the Australian Consumer Law. If food is not supplied, is unsafe, materially different from its description or otherwise fails a consumer guarantee, contact the restaurant promptly and request the remedy available under law.</p>
      <h2>Allergies and dietary information</h2>
      <p>Always review the item’s allergen information and tell the restaurant about allergies before ordering. Order notes are not a guarantee that cross-contact can be prevented. For a severe allergy, contact the restaurant directly before ordering. See our <Link to="/allergen-information">allergen information notice</Link>.</p>
      <h2>Acceptable use</h2>
      <p>Do not misuse the service, place fraudulent orders, interfere with security, or access another person’s account or order. We may restrict access where reasonably necessary to protect customers, restaurants or the platform.</p>
      <h2>Service and liability</h2>
      <p>We take reasonable care in operating the platform but online services can experience interruptions. To the extent permitted by law, each party is responsible for loss it causes. Any limitation in these terms is subject to the Australian Consumer Law and other non-excludable rights.</p>
      <h2>Changes and governing law</h2>
      <p>We will publish a new effective date when these terms materially change and seek fresh acceptance where appropriate. Australian law applies, and the courts of the State or Territory in which the relevant restaurant operates have non-exclusive jurisdiction.</p>
      <h2>Contact</h2>
      <p>Platform enquiries: {legalOperator.supportEmail || 'use the Contact page'}. Food, fulfilment and restaurant refund enquiries should first be directed to the restaurant.</p>
    </LegalPage>
  )
}

export function PrivacyPolicyPage() {
  return (
    <LegalPage title="Privacy Policy" updated={LEGAL_VERSIONS.privacyPolicy}>
      <p>{operatorDisplayName()} handles personal information in accordance with this policy and, where applicable, the Privacy Act 1988 (Cth) and Australian Privacy Principles.</p>
      <h2>Information we collect</h2>
      <p>We may collect account details, contact details, restaurant affiliation, orders, table and cart activity, payment and refund references, messages and order notes, authentication data, IP address, device and browser information, audit events, support correspondence, and profile images supplied by you or an identity provider.</p>
      <h2>Why we collect it</h2>
      <p>We use information to create and secure accounts, process and fulfil orders, facilitate payments and refunds, send transactional and security messages, operate printing and restaurant workflows, prevent fraud, provide support, meet legal obligations and improve reliability. We minimise collection to what is reasonably necessary.</p>
      <h2>Who receives it</h2>
      <p>Information may be disclosed to the restaurant receiving your order, Stripe for payments, cloud hosting and storage providers, email providers, Google or Meta when you choose social login, professional advisers, and regulators or law enforcement where required. These providers may process information outside Australia; current hosting and provider locations are documented by us and available on request.</p>
      <h2>Health and allergy information</h2>
      <p>Order notes may reveal allergy or health information. Only provide what is necessary for the restaurant to handle your order. This information is shared with relevant restaurant staff and may appear on kitchen tickets.</p>
      <h2>Security and retention</h2>
      <p>We use access controls, encryption in transit, audit logging and tenant separation. We retain records only for operational, dispute, security, accounting and legal needs, then delete or de-identify them under our retention schedule. Backups expire on a controlled cycle.</p>
      <h2>Your choices and rights</h2>
      <p>You may ask for access to or correction of your personal information, object to direct marketing, or request deletion where retention is not legally or operationally required. We will verify identity before releasing or deleting account information. {/* Saying the right exists and offering nowhere to use it is how a right goes unexercised. */}<Link to="/me/privacy-requests">Make a privacy request</Link> and follow its progress from your account.</p>
      <h2>Marketing</h2>
      <p>We do not treat account creation or a purchase as consent to marketing. Marketing is sent only with an appropriate consent and includes a functional unsubscribe mechanism. Transactional, security and legal notices are not marketing.</p>
      <h2>Complaints and data breaches</h2>
      <p>Contact us with privacy concerns. We will investigate and respond within a reasonable time. Where the Notifiable Data Breaches scheme applies, we assess suspected eligible breaches promptly and notify affected people and the OAIC when required.</p>
      <h2>Contact</h2>
      <p>{legalOperator.privacyEmail || 'Submit a privacy request through the Contact page.'}{legalOperator.address ? ` Postal address: ${legalOperator.address}.` : ''}</p>
    </LegalPage>
  )
}

export function RestaurantTermsPage() {
  return (
    <LegalPage title="Restaurant Platform Terms" updated={LEGAL_VERSIONS.customerTerms}>
      <p>These terms apply to Australian restaurants using DineFlow. They must be reviewed together with the signed commercial order form before production onboarding.</p>
      <h2>Restaurant responsibilities</h2><p>The restaurant remains the supplier and merchant for customer food orders. It is responsible for licences, food safety, ingredients and allergen accuracy, menu claims, prices, GST, surcharges, fulfilment, receipts, consumer remedies and staff access.</p>
      <h2>Platform services</h2><p>DineFlow provides ordering, account, payment-integration, reporting and printing workflows. Service levels, support hours, fees and included features are those in the applicable order form. Planned maintenance and urgent security work may affect availability.</p>
      <h2>Payments</h2><p>Stripe Connect terms also apply. The restaurant authorises disclosed platform fees and is responsible for Stripe onboarding, chargebacks, refunds, negative balances and the accuracy of settlement information. DineFlow does not permit an undisclosed or unlawful customer surcharge.</p>
      <h2>Customer data</h2><p>Each party must use customer data only for authorised ordering, fulfilment, support, security and legal purposes. The restaurant must not use order contact details for marketing without valid consent. Security incidents and privacy requests must be promptly escalated between the parties.</p>
      <h2>Fair terms and termination</h2><p>Neither party may exclude non-excludable rights. Suspension must be reasonably necessary for security, illegality, non-payment or material breach. Material unilateral price or service changes require notice and a reasonable right to terminate where applicable. On termination, the restaurant may request a reasonable export subject to lawful retention.</p>
      <h2>Liability and disputes</h2><p>Each party is responsible for loss it causes, subject to the signed agreement and Australian law. Nothing excludes liability that cannot lawfully be excluded. The parties should first attempt good-faith escalation before proceedings.</p>
    </LegalPage>
  )
}

export function RefundPolicyPage() {
  return (
    <LegalPage title="Refunds and Cancellations" updated={LEGAL_VERSIONS.customerTerms}>
      <p>This policy supplements, and does not limit, your rights under the Australian Consumer Law.</p>
      <h2>Change of mind</h2><p>A restaurant may decline a change-of-mind cancellation after accepting or beginning to prepare an order. Contact the restaurant immediately if you made a mistake.</p>
      <h2>Order problems</h2><p>For a missing, unsafe, incorrect or materially misdescribed item, keep your order number and contact the restaurant. Depending on the problem and applicable law, a replacement, partial refund or full refund may be appropriate.</p>
      <h2>Payment problems</h2><p>Duplicate or failed-payment concerns can be raised with the restaurant or platform support. Approved card refunds are returned through the original payment method; bank processing time is outside the restaurant’s control. We will not require original packaging where that would unlawfully restrict a consumer guarantee.</p>
    </LegalPage>
  )
}

export function AllergenInformationPage() {
  return (
    <LegalPage title="Allergen and Dietary Information" updated={LEGAL_VERSIONS.allergenNotice}>
      <p>Food allergies can cause severe or life-threatening reactions. Menu allergen declarations are supplied and maintained by each restaurant.</p>
      <h2>Before ordering</h2><p>Check each item and option. Tell the restaurant your specific allergy and ask about ingredients and preparation. For severe allergies, contact the restaurant directly before ordering.</p>
      <h2>Cross-contact</h2><p>Shared kitchens, fryers, utensils, surfaces and suppliers can create cross-contact. A “may contain” statement describes a risk and is not a complete ingredient list. An order note does not confirm that a restaurant can safely accommodate an allergy.</p>
      <h2>Dietary claims</h2><p>Vegetarian, vegan, halal and gluten-free indicators are restaurant-supplied descriptions. Ask the restaurant if you need information about certification, preparation practices or ingredient substitutions.</p>
    </LegalPage>
  )
}

export function ContactPage() {
  const support = legalOperator.supportEmail || legalOperator.privacyEmail
  return (
    <LegalPage title="Contact and Complaints" updated={LEGAL_VERSIONS.privacyPolicy}>
      <h2>Order or food issue</h2><p>Contact the restaurant shown on your menu or order first. Include the order number, date and a concise description; do not email complete card details.</p>
      <h2>Platform support</h2><p>{support ? <a href={`mailto:${support}`}>{support}</a> : 'A production support email must be configured before launch.'}</p>
      <h2>Privacy request</h2><p>{legalOperator.privacyEmail ? <a href={`mailto:${legalOperator.privacyEmail}`}>{legalOperator.privacyEmail}</a> : 'A production privacy email must be configured before launch.'} You may request access, correction or deletion, or make a privacy complaint.</p>
    </LegalPage>
  )
}
