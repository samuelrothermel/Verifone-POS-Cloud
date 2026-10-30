# Troubleshooting Notes

Last updated: 2026-10-30. The entries below are user-reported observations, not credentials. P630 routing remains unresolved; a V660p sandbox sale has been confirmed approved.

## P630

- Physical serial: `552-322-068`; Central describes model P630 Plus-A.
- Central POI details reported: display name `POI 0200240550006587`, Terminal ID `50006587`, Device ID `0200240550006587`, organization `Sams Test Store`.
- Postman POS Cloud status succeeds with `Response.Result: SUCCESS`; `POIState` is `CONNECTED`; response POIID is `POI 0200240550006587`.
- User reports status and Connection Status requests in Postman both succeeded. The exact Connection Status collection request/response has not been recorded here.
- Connect Express/VPOS reports `PSDK connection failed` after launch. Exact PSDK status/error code is not recorded.
- Payment attempts returned HTTP 200 but NEXO `PaymentResponse.Response.Result: FAILURE`, with `Device with this serial number does not exist`. Reported POIID candidates tried were `POI 0200240550006587`, `50006587`, and `552-322-068`.
- In an Oct 21 support thread, Verifone identified the missing `x-site-entity-id` header as the issue in a matching device-not-found case. The header value is the entity UUID for this merchant, available from its status response; do not reuse the other merchant's UUID from that thread.
- Verifone advised using the status API's exact `POIID` (`POI 0200240550006587`, including the prefix). Their working example used `SaleID: VERIFONEPOS` and `/oidc/poscloud/nexo/payment/async`; the local app now sends the header and POIID but remains on `/poscloud/nexo/v2/payment` pending confirmation. The fix has not yet been verified with this account's UUID.
- The support thread reports real Visa and Maestro cards were declined in sandbox. Confirm supported test cards or FakeProcessor values before the next physical sale.
- An earlier request failed parsing because `PaymentRequest.SaleData.SaleTransactionID` was absent. The local app now sends a unique `TransactionID` and ISO date-time `TimeStamp`; later attempts passed parsing but still failed device lookup.
- No successful card prompt, POI transaction result, or Braintree confirmation has been reported. Check the Braintree sandbox before any further payment attempt.
- Status also showed `POSStatus: null` and `lastConnectedPOS: null`. Public docs do not define what those null values mean.

## V660p

- User reports the VHQ test portal `https://uis.uscst.cst.vam.verifone.cloud`, Customer ID `PayPal_Dev`, successful heartbeat, and successful card-reader test.
- Keturah's Oct 21 device list confirms serial `713-363-458`.
- An Oct 21 report said the device had not communicated since Oct 14; heartbeat and card-reader tests later succeeded, so it has reconnected.
- Connect Express/VPOS startup reports `PSDK connection failed`; exact status/error code is not recorded.
- On Oct 30, a sandbox sale was attempted before receipt paper was loaded. The correlated POS Cloud Transaction Status lookup returned HTTP 200 with the original `PaymentResponse.Response.Result: FAILURE`; `outcomeUnknown` was false. Paper was loaded afterward. This is a confirmed failed attempt, not confirmation of a successful payment.
- A subsequent $1.00 sandbox sale returned `transactionResult: SUCCESS`; the nested payment response was also `SUCCESS` and the receipt stated `APPROVED`. This confirms approval for that attempt. Verify it appears in the configured provider sandbox before further reconciliation work.

## Security

The Verifone API key and a Basic Authorization value were included in earlier `.env` attachments. Revoke/rotate the exposed key in Verifone Central before further API calls. Do not put credentials, Authorization values, PANs, track data, or `.env` contents in these notes.

## Sources

- [Health Check](https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/payment-operations/health-check)
- [Testing Transaction Capabilities](https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/testing/testing-transaction-capabilities)
- [POS Cloud Sale](https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/payment-operations/payments/sale)
- [Points of Interaction](https://docs.verifone.com/verifone-central-getting-started/verifone-central/administration-tools/points-of-interaction)
