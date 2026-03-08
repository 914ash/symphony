# Symphony Conformance and Feature-Parity Design

**Date:** 2026-03-06  
**Context:** Node.js Symphony implementation in this repo compared against `openai/symphony` (`SPEC.md` + reference feature set).

## Goal

Close all high-impact conformance gaps so this implementation is production-credible for the full Symphony workflow:
- strict core behavior from `SPEC.md` Section 18.1
- shipped HTTP extension behavior from Section 13.7
- practical parity with upstream "repo skill + app-server" flows where applicable (`linear_graphql`).

## Current State Summary

What works:
- workflow loader/config defaults/reload
- orchestration loop/retry/reconciliation skeleton
- Linear polling + normalization basics
- app-server protocol baseline
- HTTP dashboard + API baseline.

Critical gaps identified:
- `session_id` and `turn_count` semantics are incorrect in multiple flows
- `blocked_by` normalization source does not match spec wording
- logging lacks consistent `session_id` lifecycle context
- Windows launch strategy currently diverges from strict `bash -lc` contract
- optional but upstream-important `linear_graphql` dynamic tool is not implemented
- observability issue detail payload is thinner than recommended baseline.

## Approaches Considered

### Approach A: Patch-only minimal core fixes

Scope:
- Fix only strict 18.1 blockers.

Pros:
- fastest path to "mostly conformant"
- low engineering risk.

Cons:
- misses upstream practical workflows (`linear_graphql`)
- leaves parity gap vs reference implementation.

### Approach B (Recommended): Two-phase closure

Scope:
- Phase 1: hard core conformance fixes.
- Phase 2: extension parity for shipped HTTP + `linear_graphql`.

Pros:
- controlled delivery with measurable checkpoints
- satisfies your ask to validate against both repo features and `SPEC.md`.

Cons:
- slightly longer implementation window.

### Approach C: Full rewrite around upstream architecture

Scope:
- re-architect modules to mirror reference implementation patterns.

Pros:
- long-term alignment.

Cons:
- highest risk/time; unnecessary for current repo maturity.

## Recommended Design

Use **Approach B** with explicit acceptance gates.

### Architecture updates

1. **Protocol correctness layer**
- enforce canonical `session_id` (`threadId-turnId`) per completed/failed turn
- track actual turn count in running entries (not retry attempt count)
- tighten app-server event/state transitions.

2. **Tracker normalization layer**
- update GraphQL query + mapper for inverse `blocks` relation source
- keep pagination/state-refresh contracts unchanged.

3. **Observability and logging layer**
- unify log schema with mandatory `issue_id`, `issue_identifier`, `session_id` where applicable
- enrich `/api/v1/<issue_identifier>` payload with recent events + tracked run metadata.

4. **Launch and platform policy layer**
- make strict `bash -lc` the conformance mode
- keep explicit compatibility fallback as opt-in non-conformance mode.

5. **Dynamic tool extension layer**
- implement optional `linear_graphql` tool execution path with strict input validation and structured tool responses.

### Data flow changes

- Running entry gains `turnCount` and bounded `recentEvents`.
- Worker/app-server callbacks update both token counters and event ring buffer.
- Issue detail endpoint reads from this richer in-memory runtime state.

### Error handling

- Keep existing typed errors.
- Add categories for dynamic tool input validation and operation-count violations.
- Ensure unsupported tool calls continue session without stalling.

## Test Strategy

1. Unit conformance tests for:
- session id + turn count semantics
- blocker normalization
- strict launch mode selection.

2. Protocol behavior tests for:
- unsupported dynamic tool handling
- `linear_graphql` success/error contracts
- user-input-required hard-fail handling.

3. Integration tests for:
- dispatch/reconcile/retry lifecycle
- terminal transition workspace cleanup
- HTTP payload shape baseline (`/api/v1/state`, `/api/v1/<issue>`, `/api/v1/refresh`).

## Acceptance Criteria

- All Section 18.1 checklist items satisfied with code + tests.
- Section 13.7 HTTP extension behavior validated for shipped endpoints.
- `linear_graphql` extension implemented and tested when enabled.
- Regression test suite green (`npm run build`, `npm run test`, targeted integration tests).

## Assumptions

- Keep Linear as the only tracker adapter in this iteration.
- Keep in-memory scheduler state (no persistence), matching current spec recommendation.
- Keep existing UI style for dashboard; focus on contract correctness over visual changes.
