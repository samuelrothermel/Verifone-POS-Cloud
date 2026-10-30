# Project TODO

## Current state

- [x] Local Node.js operator console with status check and manually confirmed $1.00 sale.
- [x] Sandbox URL guard, server-side credentials, unique sale references, and no automatic payment retries.
- [x] Separate app, POS Cloud API, and terminal setup documentation.
- [ ] Rotate the Verifone API key exposed in earlier `.env` attachments.
- [ ] Resolve the P630 Connect Express/PSDK connection failure.
- [ ] Obtain and inspect the official Integrator Collection's Connection Status and Sale requests.
- [x] Use the exact POIID returned by status, including its `POI ` prefix.
- [x] Add `x-site-entity-id` support and block sales without the configured entity UUID.
- [ ] Set `VF_SITE_ENTITY_ID` to this merchant's UUID from its own status response.
- [ ] Verify the entity-header fix with the account UUID and a confirmed sandbox test card.
- [ ] Confirm whether this merchant should use `/poscloud/nexo/v2/payment` or `/poscloud/nexo/payment/async`.
- [ ] Verify the P630 POI has the intended enabled Braintree FakeProcessor provider contract.
- [ ] Complete one successful physical $1.00 sale and confirm it in the Braintree sandbox Control Panel.

## Gate

Do not implement the broader transaction matrix or Braintree verification until the first physical sale succeeds. The code change is in place, but the account UUID, endpoint behavior, and payment routing are not yet verified.

## After the first successful sale

- [ ] Add read-only Braintree GraphQL verification using the documented sandbox API/version.
- [ ] Add only POS Cloud operations whose request/response details are verified in Verifone documentation or the official collection.
- [ ] Add masked JSONL request/response logging with sensitive fields removed.
- [ ] Build the test matrix and summary table.
- [ ] Record the masked successful request/response and hand-off notes.
