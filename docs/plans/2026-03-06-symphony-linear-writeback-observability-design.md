# Symphony Linear Write-Back and Full Observability Design

## Goal

Enable Symphony to automatically write back to Linear when work is truly complete, while exposing full real-time run/build/verification/write-back telemetry in the dashboard and JSON API.

## Decisions

- Write-back policy: conservative state transition (single terminal move), plus detailed run summary comment.
- Completion gate: worker must exit normally and verification evidence must pass.
- Verification source: both structured worker-reported checks and workspace/log evidence.
- UI scope: full observability (operator status + build/test detail + throughput + token/rate limits + event stream).

## Architecture

Add a completion pipeline in orchestrator:

1. Execution (existing worker run lifecycle)
2. Verification capture (structured checks from worker)
3. Verification evidence scan (workspace/log/artifact signals)
4. Completion decision (eligible/ineligible with reason codes)
5. Linear write-back (comment first, then state transition)

Write-back is side-effect isolated from scheduling/polling so mutation failures never block dispatch.

## Component Changes

### Tracker Layer

Extend `TrackerAdapter` with mutation APIs:

- `createIssueComment(issueId: string, body: string): Promise<{ commentId: string }>`
- `markIssueCompleted(issueId: string, doneStateName: string): Promise<{ stateId: string; stateName: string }>`
- `resolveDoneStateId(doneStateName: string): Promise<string>` (cached)

Implement these on `LinearTrackerAdapter` with GraphQL mutations/queries and explicit error codes.

### Worker Layer

Extend worker result to include structured verification records:

- `name`, `kind` (`test`, `build`, `lint`, `check`, `other`)
- `command`
- `status` (`passed`, `failed`, `skipped`, `unknown`)
- `exit_code`
- `duration_ms`
- `evidence` (optional snippet/path references)

Worker still returns turn/session data, now augmented with verification payload.

### Orchestrator Layer

Add per-run record attached to an issue execution:

- `run_id`, `attempt`, `started_at`, `finished_at`, `duration_ms`
- `verification` (structured checks + summary counts)
- `workspace_evidence` (signals from file/log scan)
- `completion_decision` (`eligible` or `ineligible` + reason codes)
- `linear_writeback` (`not_attempted`, `commented`, `state_updated`, `partial`, `failed`, `skipped_terminal`)

On normal worker exit:

1. Build verification summary from structured checks
2. Scan workspace/log evidence according to config signals
3. Evaluate completion gate
4. If eligible, write comment then transition state
5. Persist/emit write-back status for API/UI

## Configuration

Add workflow config keys:

```yaml
tracker:
  writeback:
    enabled: false
    done_state: Done
    comment_template: null
verification:
  required_kinds: ["test", "build"]
  workspace_signals:
    files: []
    patterns: []
```

Notes:

- `tracker.writeback.enabled` defaults `false` for safe rollout.
- `done_state` required when write-back is enabled.
- `comment_template` optional; default generated template includes full run summary.
- `required_kinds` controls policy gate.

## Data Flow

1. Worker runs turns and emits runtime events.
2. Worker returns structured verification records at exit.
3. Orchestrator merges worker verification + workspace evidence.
4. Orchestrator sets completion decision:
   - eligible: normal exit + required verification evidence passed
   - ineligible: any missing/failing required gate
5. If eligible and write-back enabled:
   - post comment containing run summary
   - update issue to configured terminal state
6. Expose result via state/issue APIs and dashboard.

## Write-Back Reliability and Idempotency

- Comment includes `run_id` marker to prevent duplicate comments on retries.
- Mutation ordering is fixed: comment then state update.
- Partial failure handling:
  - comment succeeds + state fails => status `partial`; retry state mutation with backoff.
  - issue already terminal externally => status `skipped_terminal`.
- Mutation errors are logged with issue/session/run identifiers and surfaced in UI/API.

## API and UI Design

### API Extensions

Extend `/api/v1/state` and `/api/v1/:issue` to include:

- run phase and duration
- verification summary (`checks_total`, `checks_passed`, `checks_failed`, `required_gate_passed`)
- latest check details
- workspace evidence summary
- write-back status and latest mutation error
- completion decision and reason codes

### Dashboard Extensions

Add panels/columns for full observability:

- Queue throughput and lifecycle counts
- Per-issue phase (`running`, `verifying`, `writeback`, `retrying`)
- Verification status and last check command/result
- Write-back status (`pending`, `commented`, `state_updated`, `failed`, etc.)
- Retry, runtime, workspace path, last event age
- Recent event stream and top-level failure banners

Preserve auto-refresh behavior and lightweight operator controls.

## Error Handling

- Verification parse failure => ineligible completion with reason code.
- Workspace evidence scan failure => warning + continue with available evidence.
- Linear mutation failure => no crash; issue remains schedulable according to policy.
- API/UI always report last known completion/write-back state to avoid hidden failures.

## Testing Strategy

Add tests at three levels:

1. Tracker mutation unit tests
   - comment mutation success/failure
   - done-state resolution/cache behavior
2. Orchestrator tests
   - completion eligibility matrix
   - comment+state ordering
   - partial failure + retry + idempotency
3. HTTP/dashboard tests
   - new JSON fields in `/api/v1/state` and `/api/v1/:issue`
   - UI rendering for verification/write-back states

Include conformance-style tests for conservative write-back behavior when verification gate is unmet.

## Rollout Plan

1. Ship data model + API fields behind `tracker.writeback.enabled=false`.
2. Enable richer UI with passive telemetry first.
3. Enable write-back in controlled environments.
4. Monitor mutation failure rates and duplicate-prevention behavior.

## Risks and Mitigations

- False positive completion: mitigated by required verification gates + dual evidence.
- Noisy UI: mitigated by phase-based grouping and concise primary indicators.
- Linear workflow mismatch: mitigated by explicit `done_state` config validation at startup.
