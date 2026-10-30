# Verifone POS Cloud Local Console

This local Node.js app acts as a small merchant POS for a boarded Verifone terminal. It sends requests to Verifone POS Cloud, which routes payment processing to the configured provider. The app does not process payments through Braintree and is not a production POS.

## How it works

```text
Browser -> local Node console -> Verifone POS Cloud -> configured provider and terminal
```

- The browser talks only to `http://127.0.0.1:3000`.
- Credentials stay in the local server process.
- **Check status** queries the selected terminal by its physical serial.
- **Review sale** rechecks status, then sends one manually confirmed $1.00 USD sandbox sale. P630 uses its configured `VF_POI_ID` and `VF_SITE_ENTITY_ID`; V660p uses the POIID and `entityUID` returned by its fresh status response.
- Payment requests are not retried automatically. HTTP 200 does not mean the payment succeeded; inspect `PaymentResponse.Response.Result`. A confirmed `FAILURE` permits a retry; after `SUCCESS`, use **Start another sale** to deliberately begin a new sale cycle.

## Current status

P630 status succeeds and reports `CONNECTED`. Verifone support identified the missing `x-site-entity-id` header as the likely cause of the earlier `Device with this serial number does not exist` response. The app sends this header and verifies the P630 POIID against fresh status. A V660p sandbox sale has returned an approved response; verify it in the configured provider sandbox. The P630 routing issue and account-specific provider setup remain open. See [Troubleshooting notes](docs/NOTES.md) and [Open questions](docs/OPEN_QUESTIONS.md).

## Prerequisites

- Node.js 20 or newer.
- A Verifone POS Cloud sandbox account, Central API user/key, and a P630 paired to that sandbox merchant.
- The P630 serial number. This workspace defaults to `552-322-068`; the V660p status check defaults to `713-363-458`.

## Configure and run

1. Keep your existing `.env` in the workspace root. Set `VF_BASE_URL` to the merchant's regional sandbox API URL, `VF_API_USER` to the Verifone Central UID, and `VF_API_KEY` to the Verifone Central API key. The server constructs Basic auth privately; the browser never receives credentials.
2. Set `VF_POI_ID` to the exact P630 `POIID` returned by status, including the `POI ` prefix. Set `VF_SITE_ENTITY_ID` to this merchant's entity UUID from the status response; do not reuse an ID from another merchant or support example. `VF_SERIAL_NUMBER` defaults to `552-322-068`; optional `VF_V660P_SERIAL_NUMBER` defaults to `713-363-458`.
3. Start the server with `npm start` and open `http://127.0.0.1:3000`. The app uses Node built-ins and needs no package install.

The server binds to loopback only and accepts only the documented POS Cloud sandbox base URLs. Do not expose it on a network or forward its port.

## Available requests

- **Check status** sends the documented read-only `GET /poscloud/nexo/status/{serialNumber}` request for the selected P630 or V660p. It displays the status POIID and entity UUID.
- **Review sale** is available for either terminal only after it reports `CONNECTED` and the fresh status response provides its POIID and entity UUID. P630 must also match `VF_POI_ID` and uses `VF_SITE_ENTITY_ID`; V660p uses the identifiers returned by its status check. Each sale requires explicit confirmation. A prior confirmed failure allows a retry; after confirmed success, **Start another sale** must be selected before the next status check and sale.
- **Check transaction** sends a read-only v2 Transaction Status request only after a sale attempt in this server session. It references that sale's original `PAYMENT` identifiers; sensitive `SaleToPOIData` is redacted from the displayed response.

The app does not automatically retry payments. If the sale request times out or returns an ambiguous server error, stop and verify the outcome before attempting another payment. A server restart does not cancel a payment that Verifone may already have processed.

After a response, verify the transaction with the configured provider. For the P630/Braintree setup, check the sandbox Control Panel under the in-store MAID. Record only a masked response in `docs/NOTES.md`. Reversal, refund, pre-auth, provider-specific verification, and the test matrix remain gated until the first sale is confirmed.

Run the local tests with `npm test`. The separate `requests/sale.http` file remains available as a manual reference.

## Guides

- [Postman collection](references/POSCloud%20API%20PayPal_postman_collection.json): Verifone POS Cloud request reference.
- [POS Cloud API calls](docs/POS_CLOUD_API.md): authentication, endpoints, request/response semantics, and retry safety.
- [Terminal and account setup](docs/TERMINAL_SETUP.md): Central, VHQ, device settings, Connect Express, and readiness checks.
- [Troubleshooting notes](docs/NOTES.md): current observed values and request outcomes.
- [Open questions](docs/OPEN_QUESTIONS.md): unresolved account-specific and documentation questions.
- [Project TODO](docs/TODO.md): current implementation and verification backlog.

## Agent Workflow

- [VS Code agent instructions](.github/copilot-instructions.md): project-specific implementation and payment-safety rules.
- [POS Cloud task brief](docs/POSCLOUD_TASK_TEMPLATE.md): reusable task context and acceptance criteria.
