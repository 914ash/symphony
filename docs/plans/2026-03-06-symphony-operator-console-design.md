# Symphony Operator Console Design

Date: 2026-03-06
Status: Approved

## Context

The current Node.js implementation already covers most of the Symphony runtime responsibilities from
`SPEC.md`: workflow loading, typed config, Linear polling, orchestration, retries, workspace
management, Codex app-server integration, and an optional HTTP surface.

The main problem is that the visible app does not present those capabilities clearly. The `/`
dashboard is a thin status page, the HTTP API lacks some operator-grade diagnostics, the normalized
issue model is incomplete compared to the spec, and `npm test` is unreliable because generated
workspace files are collected as tests.

## Review Findings

1. The runtime is substantially implemented already.
2. The operator-facing app under-represents runtime behavior and makes the product look incomplete.
3. The normalized issue model is missing spec fields such as `branch_name` and `url`.
4. Runtime observability is too shallow for real operations.
5. Test discovery is unsafe because generated workspaces are inside the repository and are not
   excluded from Vitest.
6. Runtime reload behavior relies on file watching and should be hardened with defensive reload
   checks during active operation.

## Goal

Keep the existing backend architecture, close the real spec gaps, and turn the optional HTTP
surface into a credible operator console that exposes the runtime features clearly.

## Non-Goals

1. Build a multi-tenant control plane.
2. Introduce a database.
3. Rewrite the orchestrator architecture.
4. Add tracker write automation beyond what Symphony already delegates to the coding agent.
5. Build a separate SPA when server-rendered HTML and the existing REST API are sufficient.

## Architecture

The orchestrator remains the single authoritative runtime state owner. The tracker adapter remains
responsible for normalization from Linear GraphQL payloads into the internal issue model. The HTTP
server remains an optional observability and control surface only.

The implementation will add a lightweight diagnostics layer to the orchestrator, enrich the issue
model and snapshots, and rebuild the `/` route into a richer operator console. The JSON API will
remain the primary machine-readable interface, and the dashboard will render directly from
orchestrator snapshots rather than introducing client-managed state.

## Data Model Changes

The normalized `Issue` model should be extended to include:

1. `branch_name`
2. `url`

The issue snapshot and prompt input should expose these fields when available. Blocker and label
normalization should remain unchanged.

The runtime snapshot should be expanded with bounded operator diagnostics:

1. `workflow_path`
2. `health`
3. `last_poll_at`
4. `last_reconcile_at`
5. `last_refresh_at`
6. `last_reload_at`
7. `recent_errors`

These values should come from in-memory state only and should not require persistent storage.

## Orchestrator Changes

The orchestrator should keep a bounded diagnostics buffer for recent failures and key operational
timestamps. This buffer should capture:

1. Dispatch preflight validation failures
2. Poll/reconcile failures
3. Worker failures
4. Workflow reload failures

The orchestrator should also support defensive reload checks during runtime operations so that
missed filesystem watch events do not leave it on stale workflow state indefinitely.

The runtime state remains restart-safe without a database:

1. Running sessions are in memory only.
2. Retry state is in memory only.
3. Terminal workspace cleanup still happens at startup.
4. The dashboard/API represent the current process state only.

## HTTP API Changes

`GET /api/v1/state` should continue to return the current runtime summary and add operator
diagnostics:

1. `workflow_path`
2. `health`
3. `last_poll_at`
4. `last_reconcile_at`
5. `last_refresh_at`
6. `last_reload_at`
7. `recent_errors`

`GET /api/v1/:issue` should become a full issue drilldown:

1. Full issue metadata including `branch_name`, `url`, `labels`, and blockers
2. Workspace path
3. Attempt counters
4. Running session metadata
5. Retry metadata
6. Recent events

`POST /api/v1/refresh` should keep its current semantics and be surfaced clearly in the dashboard as
an operator action.

## Dashboard Changes

The `/` route should become a real operator console rather than a placeholder page. It should show:

1. Runtime summary cards for running sessions, retry queue, token totals, runtime, and health
2. Recent errors with timestamps and concise messages
3. Running sessions with issue identifiers, state, session IDs, turn counts, last event, and links
   to per-issue detail
4. Retry queue with attempt count, due time, and failure reason
5. Explicit refresh action
6. Drilldown links into `GET /api/v1/:issue`

The dashboard remains server-rendered HTML. It should be visually clearer and more operator-friendly
without becoming required for correctness.

## Testing Strategy

Implementation should be test-first for the gaps that matter:

1. Tracker normalization tests for `branch_name` and `url`
2. Orchestrator snapshot tests for diagnostics and recent errors
3. HTTP API tests for richer `state` and issue-detail payloads
4. Dashboard rendering tests for key status/error/retry content
5. Test discovery configuration so generated workspaces are excluded from `npm test`

Existing conformance tests should stay intact and continue to pass.

## Rollout Plan

1. Fix test discovery and add missing spec-facing tests first.
2. Complete the issue model and tracker normalization.
3. Add orchestrator diagnostics and defensive reload behavior.
4. Expand the REST API to expose the richer state.
5. Rebuild the dashboard on top of the enriched API/snapshot.
6. Verify with unit tests, conformance tests, and a live Linear-backed smoke run.

## Constraints

1. No database.
2. No mock tracker for the main app path.
3. Preserve the current orchestrator ownership model.
4. Preserve restart behavior without requiring persistent state.
5. Do not make the dashboard a correctness dependency.

## Environment Note

This workspace is not a Git repository, so the design cannot be committed here even though the
normal workflow would commit the approved design doc.
