# Australian compliance release checklist

This is an engineering control checklist, not legal advice. The final policies and contracts must be reviewed against the actual DineFlow legal entity, commercial model, vendors and launch State or Territory.

## Production gate

- Configure the legal operator name, 11-digit ABN, address, privacy email and support email in both backend `Compliance__*` and frontend `VITE_LEGAL_*` variables. Production API startup fails when backend identity values are absent.
- Complete every restaurant's legal business name, ABN, GST status, contact and refund email. Existing restaurants created before the compliance migration must be updated before ordering is enabled.
- Confirm displayed menu prices are final consumer prices. DineFlow does not calculate a weekend, public-holiday or card surcharge; do not configure a surcharge notice unless the charged total already includes the disclosed rule correctly.
- Have Australian counsel approve Customer Terms, Restaurant Platform Terms, Privacy Policy, refunds wording, liability allocation and State/Territory-specific food obligations.
- Verify Stripe, hosting, email and OAuth subprocessors, hosting regions and overseas disclosure countries, then replace the general privacy wording with the verified list.
- Verify all item and modifier ingredients. Use FSANZ required allergen names. Record contains, may-contain/cross-contact risks and review dates.
- Test receipts with GST-registered and non-GST restaurants, including refund evidence and sales above $75 excluding GST.

## Consent evidence

Customer registration records Customer Terms and Privacy Policy versions, timestamp, IP and user agent. Each submitted order separately records Customer Terms, Privacy Policy and Allergen Notice versions. When legal text materially changes, update backend and frontend version constants together and add regression tests.

## Privacy requests

Authenticated users can submit Access, Correction, Deletion or Complaint requests through `POST /api/privacy/requests` and list their requests through `GET /api/privacy/requests/mine`. Operations must verify identity, search primary data and backups, identify records subject to accounting/dispute/security retention, document the decision and communicate it securely.

Deletion is not a blind database cascade. Preserve only records supported by a documented legal or operational basis, minimise identifying fields where possible, revoke tokens, remove OAuth links and avatars, and schedule backup expiry.

## Data breach response

1. Contain the incident without destroying evidence; rotate exposed credentials and isolate affected access.
2. Open an incident record with discovery time, systems, data types, affected people and response owner.
3. Determine whether Privacy Act/NDB obligations apply and assess likely serious harm expeditiously, treating 30 days as the outer assessment limit where the scheme applies.
4. Notify the OAIC and affected people when required, describing the incident and protective steps. Coordinate restaurant/customer communications and preserve copies.
5. Complete root-cause remediation, credential review, restoration test and post-incident actions.

## Marketing controls

Account, order, security and refund messages are transactional. Do not add promotions to them. Before marketing email or SMS is enabled, add a separate unchecked consent, record wording/channel/source/time, maintain a suppression list, identify the legal sender, include a no-login unsubscribe and honour it within five working days.

## Review cadence

Review legal documents, subprocessors, overseas disclosures, retention, allergen data and surcharge configuration at least annually and whenever the business model, provider, jurisdiction or law changes.
