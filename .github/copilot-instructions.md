# Verifone POS Cloud Project Instructions

## Project Shape

- This is a local Node.js ES-module app using built-in APIs. Preserve that unless a task clearly needs a dependency.
- The console supports the P630 and V660p and binds to loopback only. Keep the existing sandbox URL allowlist.
- Treat `../references/POSCloud API PayPal_postman_collection.json` as a reference. Verify endpoint behavior and schemas against the current POS Cloud docs before implementing them.

## Payment Safety

- Keep payment-changing operations behind explicit user confirmation and fresh terminal status checks.
- Never automatically resend a payment. For an unknown outcome, query correlated Transaction Status and keep the sale locked until resolved.
- A confirmed `FAILURE` may permit a retry. A confirmed `SUCCESS` requires the explicit **Start another sale** action.
- `Abort` is for an in-progress request, not a completed-sale void. Keep reversal and refund as separate workflows with their own eligibility checks.
- Do not initiate real Verifone calls from tests. Use the injected/mock `fetchImpl`; clearly distinguish mocked results from observed sandbox results.

## Data Handling

- Do not log, commit, or include credentials, full receipts, PAN/track data, EMV payloads, or raw `SaleToPOIData` in notes or test output.
- Keep transaction responses sanitized in the UI and logs. Record only the minimum masked facts needed to explain an observed result.

## Changes and Verification

- Read the current implementation and nearby tests before editing; preserve unrelated user changes.
- Add or update focused tests for request payloads, terminal selection, response redaction, and payment/retry gates.
- Run `npm test` after code changes. Tests must remain deterministic and must not contact Verifone.
- Update `README.md` and the relevant files under `docs/` when behavior or observed facts change. Keep documented status aligned with verified observations.
