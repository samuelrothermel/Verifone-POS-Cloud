# Open Questions

## Blockers before another sale

- **Account entity UUID:** Set `VF_SITE_ENTITY_ID` to this merchant's UUID from its own status response. Do not reuse the UUID from the support example. The local app now requires this value and sends it as `x-site-entity-id`.
- **Verify routing fix:** Has the entity header plus exact status `POIID` resolved `Device with this serial number does not exist` for this account? The app now uses `POI 0200240550006587` exactly and blocks a mismatch, but no sale with the account UUID has been confirmed.
- **Sale endpoint:** The support example used `/oidc/poscloud/nexo/payment/async`; the local app uses `/poscloud/nexo/v2/payment`. Is the async endpoint required for this merchant, and is the entity header required on both?
- **Sandbox test cards:** Which test cards or FakeProcessor values approve? A support thread reports real Visa and Maestro cards were declined in sandbox.
- **Connection Status request:** What method, endpoint, headers, and body does the physical-terminal Integrator Collection use? The public guide names the request but does not publish its schema.
- **PSDK startup:** What is the cause and remediation for Connect Express reporting `PSDK connection failed` on the terminals? Capture the exact code/status if available.
- **Provider contract:** Is an enabled Braintree FakeProcessor contract associated with the P630's Central POI and intended sandbox organization/merchant account?
- **VHQ Customer ID:** What does Customer ID `PayPal_Dev` represent for this VHQ profile?

## Later phases

- Where, if anywhere, does POS Cloud expose the Braintree legacy transaction ID?
- What is the documented linked-refund request/linking schema for this solution?
- What Braintree sandbox GraphQL version and status assertions apply to the in-store MAID?
- What FakeProcessor decline scenario is supported for this account?
