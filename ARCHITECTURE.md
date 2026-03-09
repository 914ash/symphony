# Architecture Map

This file defines the expected high-level shape of systems built in this workspace.

## Layering
Preferred dependency direction:
1. `types/schemas` (pure contracts, DTOs, validation)
2. `domain` (business rules, no framework coupling)
3. `adapters` (db, network, queue, filesystem)
4. `orchestration/services` (use-case flows)
5. `interfaces` (CLI/API/UI entry points)

Rules:
- Lower layers never import higher layers.
- External integrations are isolated in adapters.
- Side effects stay out of pure domain logic.

## Boundary Contracts
- Validate all external input at boundaries.
- Normalize to internal canonical shapes before domain logic.
- Return typed error envelopes for predictable handling.

## Operational Requirements
- Critical paths must emit structured logs with correlation ids.
- Long-running flows should expose progress and failure checkpoints.
- Every major component should have a clear owner in docs or code metadata.

## Change Policy
- Prefer additive changes before breaking interface changes.
- Break interface contracts only with explicit migration notes in `docs/design-docs/`.
- Record major tradeoffs and rationale close to code and in docs.
