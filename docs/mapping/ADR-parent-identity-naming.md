# ADR: Parent Identity and Reference Naming

Date: 2026-03-11
Status: Accepted
Decision Makers: SIS Engineering

## Context

The system currently uses internal relational naming (`studentRefId`) in backend models and routes. Product direction for parent-facing features requires public identity alignment around `eaglesId` and avoiding legacy `studentId` ambiguity.

A global rename of internal references would be high-risk and unnecessary for parent-facing clarity.

## Decision

- Public parent contracts use:
  - `eaglesId` as canonical child identity.
  - `eaglesRefId` as parent-facing opaque reference.
- Public parent contracts do not use `studentId`.
- Existing internal `studentRefId` remains unchanged in current admin/store/schema internals.
- Mapping between `studentRefId` and `eaglesRefId` is internal server responsibility.

## Consequences

Positive:

- Parent API naming stays aligned with product language (`eaglesId`).
- Existing admin/store code avoids risky wide refactor.
- Implementation can move faster with lower regression risk.

Tradeoff:

- Dual naming exists across system boundaries (`studentRefId` internal, `eaglesRefId` external), requiring explicit contract tests.

## Rejected Alternatives

- Full internal rename from `studentRefId` to `eaglesRefId`.
  - Rejected due to high migration and regression risk for low immediate value.

- Keep exposing `studentRefId` in parent APIs.
  - Rejected due to product-level naming mismatch and readability concerns.

## Guardrails

- Parent OpenAPI spec must not define `studentId` fields.
- Parent route tests must assert `eaglesId`/`eaglesRefId` presence where applicable.
- Admin/internal APIs may continue using `studentRefId` until a separate dedicated migration ADR is approved.
