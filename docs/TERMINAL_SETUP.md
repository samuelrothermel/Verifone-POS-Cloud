# Terminal and Account Setup

This guide separates Verifone Central account/POI configuration, VHQ device management, terminal-local app setup, and the local console. A successful check in one system does not prove the others are configured.

## Which system does what?

| System           | Purpose                                                                              | Example/check                                         |
| ---------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Verifone Central | Merchant account, Points of Interaction, payment provider contracts, API credentials | POI and its associated provider contract              |
| VHQ              | Device fleet, hierarchy, device status, heartbeat/diagnostics                        | Device Profile and Device Status                      |
| Terminal         | POS Cloud settings and local payment application                                     | POS Cloud enabled/URL; Connect Express/PSDK state     |
| POS Cloud API    | Cloud connectivity, terminal status, payment requests                                | Status, Connection Status collection request, Sale    |
| Local console    | Merchant-POS test UI                                                                 | Uses `.env`, checks status, sends the controlled sale |

The US Verifone Central sandbox portal, VHQ test portal, and POS Cloud API base URL are different services. Do not use a VHQ or Central web URL as `VF_BASE_URL`.

## Verifone Central

1. Confirm the sandbox organization and merchant account are the intended ones.
2. In **Administration → Points of Interaction**, inspect the POI for the target device. Record the POI display name, organization, status, Terminal ID, Device ID, and device serial separately.
3. Confirm which Payment Provider Contract is associated with that POI. In **Administration → Payment (Provider) Contracts**, inspect contract status, organization, processor, supported channels, currencies, and payment types. Verifone says payment methods configured in provider contracts are linked to POIs; contact Verifone to correct contract associations rather than editing unsupported fields.
4. Create/use the Verifone Central API user UID and API key for POS Cloud. Keep them out of screenshots and shared documents.

Sources: [Points of Interaction](https://docs.verifone.com/verifone-central-getting-started/verifone-central/administration-tools/points-of-interaction), [Payment Provider Contracts](https://docs.verifone.com/verifone-central-getting-started/verifone-central/administration-tools/payment-provider-contracts), [Basic Authentication](https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/basic-authentication).

## VHQ device management

In VHQ, check the device profile's serial number, model, hierarchy/location assignment, device status, software version, heartbeat, and diagnostic results.

VHQ documents **Active** as registered and assigned to a hierarchy. **Pending Hierarchy Assignment** means assignment did not complete successfully. Do not manually toggle status as a troubleshooting guess; capture the current value for Verifone support.

VHQ heartbeat and card-reader tests are useful device-health signals. They do not prove that the Central POI is linked to the intended payment provider contract or that POS Cloud can route a sale.

Source: [VHQ Device Status](https://docs.verifone.com/support-us/verifone-hq/device-management/editing-devices/device-status).

## Terminal-local configuration

For POS Cloud physical-terminal testing, Verifone documents these settings:

1. Open **Verifone Launcher → Device Manager → Transaction Options → Terminal.1**.
2. Confirm `POS Cloud Enabled = 1`.
3. Confirm `POS Cloud URL` is the correct regional API URL.
4. Launch Connect Express as required by the device setup. Its setup flow should reach **SETUP COMPLETE** and then its POS home screen. The exact persistent `PSDK connection failed` message is not documented; capture any status/error code and contact Verifone if it persists.

Sources: [Testing Transaction Capabilities](https://docs.verifone.com/pos-cloud/pos-cloud-guide/readme-1/testing/testing-transaction-capabilities), [Connect Express Setup](https://docs.verifone.com/functional-specification/android-global-payment-app/readme/out_of_box/vpos_setup), [PSDK Connect to a Terminal](https://docs.verifone.com/psdk/reference-material/code-labs/connect-to-a-terminal).

## Local app configuration

The local Node console reads `.env` from the workspace root:

| Variable            | Use                                                                  |
| ------------------- | -------------------------------------------------------------------- |
| `VF_BASE_URL`       | Regional POS Cloud sandbox API base URL                              |
| `VF_API_USER`       | Verifone Central API user UID                                        |
| `VF_API_KEY`        | Verifone Central API key                                             |
| `VF_SERIAL_NUMBER`  | Physical serial used for status lookup                               |
| `VF_POI_ID`         | P630's exact `POIID` returned by status, including the `POI ` prefix |
| `VF_SITE_ENTITY_ID` | P630's entity UUID from status; sent as `x-site-entity-id` on sales  |

The app binds only to `127.0.0.1`. It does not call Braintree to process payments. Braintree credentials are not needed for the status check or first sale.

## Readiness gates

Before a sale, verify each layer independently:

- Central: correct sandbox POI and enabled provider contract association.
- VHQ: correct serial and hierarchy/status; capture any device diagnostic error.
- Terminal: POS Cloud enabled, correct regional URL, Connect Express setup completed, and no PSDK connection error.
- API: status request succeeds, then run the official collection's Connection Status request. The public guide does not publish that request's schema.
- Payment target: P630 uses `VF_POI_ID` and `VF_SITE_ENTITY_ID`, and the app blocks a mismatch with fresh status. V660p uses its fresh status `POIID` and `entityUID`; the app blocks sale if the terminal is not connected or either identifier is missing.

The PSDK error is tracked separately; it has not been established as a blocker to POS Cloud API sales. A successful status lookup does not confirm payment routing. Verify the sandbox provider contract before manually confirming a sale.
