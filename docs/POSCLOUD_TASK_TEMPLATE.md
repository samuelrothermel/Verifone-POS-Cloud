# POS Cloud Task Brief

Copy and fill in the relevant fields when starting a task with the VS Code agent.

## Goal

What should change, and what should the user be able to do afterward?

## Device and Environment

- Device: P630 / V660p / other
- Environment: sandbox
- Current device state or relevant identifiers: share only non-secret, necessary values

## Operation

- Type: read-only / payment-changing
- Endpoint or collection request, if known:
- Is a live sandbox call explicitly requested? yes / no

## Evidence

Provide sanitized observations only, such as HTTP status, NEXO `Response.Result`, `ErrorCondition`, and a short error message. Do not paste credentials, full receipts, card data, EMV payloads, or raw `SaleToPOIData`.

## Constraints

- Preserve existing behavior and unrelated workspace edits.
- Keep tests mocked; do not make real Verifone requests from tests.
- Do not retry an unknown payment outcome. Require explicit confirmation for payment-changing operations.

## Acceptance Criteria

- Expected behavior:
- Safety gates:
- Tests or verification required:
- Documentation to update:
