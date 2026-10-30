# POS Cloud API Calls

This guide covers the API path used by the local console and plain API/Postman calls. It does not cover Verifone Central or VHQ setup; see [TERMINAL_SETUP.md](TERMINAL_SETUP.md).

## Environment and authentication

Use the API base URL for the merchant's boarded region:

| Region  | POS Cloud sandbox API base URL            |
| ------- | ----------------------------------------- |
| US      | `https://uscst-pos.gsc.vficloud.net/oidc` |
| EU/EMEA | `https://cstpos.test-gsc.vfims.com/oidc`  |

POS Cloud Basic Auth uses the Verifone Central user UID and API key:

```text
Authorization: Basic base64(user-uid:api-key)
```

Do not use the Central portal password or Braintree credentials. The local app constructs this header on the server. In Postman, choose **Basic Auth** and enter the UID and API key rather than adding a second manual Authorization header.

Sources: [Basic Authentication](https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/basic-authentication), [POS Cloud API specification](https://docs.verifone.com/pos-cloud/pos-cloud-api-specifications/specifications/cst-api-specification/financial-services).

## Physical-terminal sequence

Verifone's physical-terminal guide calls for a status request, a separate Connection Status request from the Integrator Collection, then a sale. The public guide does not publish the Connection Status request method, endpoint, or schema; do not invent it. Use the official collection for that request.

### Service status

The local app uses the documented serial-number lookup:

```http
GET /poscloud/nexo/status/{serialNumber}
```

This reports POS Cloud service health and registered POI/POS status. `Response.Result: SUCCESS` means POS Cloud answered successfully. `POIState: CONNECTED` means that POI is connected to POS Cloud. Neither value proves a payment request will route successfully.

The status response distinguishes physical `serialNumber` from `POIID`. Verifone support confirmed that the payment request should use the exact `POIID` returned by status, including its `POI ` prefix. The support thread also identified the merchant entity UUID, available in the status response, as a required `x-site-entity-id` request header.

Source: [Health Check](https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/payment-operations/health-check), [Status by Serial Number](https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/payment-operations/status-serial-number).

### Sale

The documented endpoint is:

```http
POST /poscloud/nexo/v2/payment
Content-Type: application/json
Authorization: Basic <credential>
x-site-entity-id: <merchant entity UUID>
```

The v2 body requires `MessageHeader` and `PaymentRequest`. Required header fields include `MessageClass`, `MessageCategory`, `MessageType`, `POIID`, `SaleID`, and `ServiceID`. A basic sale uses `PaymentRequest.SaleData.SaleTransactionID` and `PaymentRequest.PaymentTransaction.AmountsReq` with currency and requested amount. `SaleTransactionID` requires a unique `TransactionID` and `TimeStamp`. Standard sale is `PaymentType: NORMAL`; the API defaults to NORMAL when `PaymentData` is omitted.

The local app sends `$1.00 USD` and creates unique service and sale transaction references. For the P630, it uses `VF_POI_ID` and `VF_SITE_ENTITY_ID` and requires the configured POIID to match fresh status. For the V660p, it uses `POIID` and `entityUID` from the fresh status response. Both requests use `SaleID: VERIFONEPOS` and require `POIState: CONNECTED`; status does not guarantee that the provider is configured to approve the payment.

The support example used `/oidc/poscloud/nexo/payment/async`; this local app still uses the documented v2 endpoint above. Confirm whether the async endpoint is required for this merchant if the entity-header fix does not resolve routing.

Source: [Sale](https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/payment-operations/payments/sale), [Models](https://docs.verifone.com/pos-cloud/pos-cloud-api-specifications/specifications/cst-api-specification/models).

### Transaction status, reports, and payment changes

The console's **Check transaction** action uses `POST /poscloud/nexo/v2/transactionstatus` after a sale attempt. It includes a `TransactionStatusRequest.MessageReference` containing the original sale's `MessageCategory`, `ServiceID`, `SaleID`, and `POIID`; this avoids relying on the endpoint's last-transaction fallback. `SaleToPOIData` is redacted in the console response. A confirmed `FAILURE` permits a retry; a confirmed `SUCCESS` keeps the sale locked until the operator explicitly selects **Start another sale** and checks terminal status again.

The Postman collection also includes `POST /poscloud/nexo/transactionReport`, a read-only historical search. Its example uses an explicit transaction ID; replace that sample value with a real transaction reference. Transaction Status and Transaction Report are separate: one checks a transaction's outcome, while the other searches historical records.

The collection's `Abort` request is not a completed-sale void; it requests cancellation of an active transaction and must be followed by Transaction Status. A completed but unsettled sale uses the documented reversal operation. A settled sale uses a refund (`PaymentData.PaymentType: REFUND`). These payment-changing operations are not implemented in the console yet.

Sources: [Transaction Status](https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/payment-operations/transaction-status), [Transaction Report](https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/payment-operations/transaction-report), [Abort](https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/payment-operations/abort), [Reversal](https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/payment-operations/payments/reversal), [Refund](https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/payment-operations/payments/refund).

### Interpret responses and timeouts

- HTTP 200 is transport-level success only. Check `PaymentResponse.Response.Result` for the NEXO outcome.
- The current device failures contain `Result: FAILURE`, so they are not successful sales.
- A timeout does not prove a payment failed. Query the documented transaction-status endpoint before any retry; never automatically resend a payment.
- The physical-terminal guide allows up to 300 seconds for a payment request if the terminal does not respond. The local app timeout is configurable and must remain within its startup guard.

Sources: [Transaction Status](https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/payment-operations/transaction-status), [Testing Transaction Capabilities](https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/testing/testing-transaction-capabilities).

## Postman versus the local app

The [project Postman collection](../references/POSCloud%20API%20PayPal_postman_collection.json) is useful for isolating authentication and reviewing example requests. A successful status response confirms the credentials work for that request; it does not confirm payment routing. For Connection Status, use the official Integrator Collection because the public docs do not specify that request. Test only with this merchant's own entity UUID and a confirmed sandbox test card; do not reuse identifiers from another merchant.
