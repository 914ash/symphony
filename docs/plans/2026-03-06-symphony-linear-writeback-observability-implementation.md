# Symphony Linear Write-Back and Full Observability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add conservative Linear write-back (detailed completion comment + done-state transition) gated by verification evidence, and expose full real-time verification/write-back telemetry in Symphony APIs and dashboard.

**Architecture:** Extend the tracker with Linear mutation APIs, enrich worker/orchestrator runtime state with verification and write-back status, and expose that state through `/api/v1/state`, `/api/v1/:issue`, and the operator dashboard. Completion is eligible only when a run exits normally and verification gates pass using both structured check output and workspace evidence.

**Tech Stack:** Node.js 20+, TypeScript, Vitest, native HTTP server UI, Linear GraphQL API.

---

## Implementation Notes

- Follow TDD for each task: fail test first, minimal code, pass test, then refactor.
- Keep changes DRY and YAGNI: only add fields and flows required by approved design.
- Use these helper skills while implementing:
  - `@superpowers:test-driven-development`
  - `@superpowers:verification-before-completion`
  - `@superpowers:requesting-code-review` (before final handoff)

### Task 1: Add Write-Back and Verification Config Surface

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Test: `tests/config.test.ts`

**Step 1: Write the failing test**

Add tests in `tests/config.test.ts` that assert:
- `tracker.writeback.enabled` defaults to `false`
- `tracker.writeback.done_state` can be parsed from workflow YAML
- `verification.required_kinds` and `verification.workspace_signals` are parsed

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/config.test.ts`
Expected: FAIL on missing config fields/types.

**Step 3: Write minimal implementation**

Update `src/types.ts` to add:
- `TrackerWritebackConfig`
- `VerificationConfig`
- corresponding fields on `TrackerConfig` / `ServiceConfig`

Update `src/config.ts` to:
- provide defaults
- parse frontmatter keys into typed config
- validate required `done_state` when write-back enabled

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/config.test.ts`
Expected: PASS.

**Step 5: Commit**

Run:
```bash
git add src/types.ts src/config.ts tests/config.test.ts
git commit -m "feat(config): add writeback and verification settings"
```

### Task 2: Extend Tracker Adapter with Linear Mutations

**Files:**
- Modify: `src/tracker.ts`
- Test: `tests/tracker.test.ts`

**Step 1: Write the failing test**

Add tests in `tests/tracker.test.ts` for:
- creating an issue comment mutation
- resolving done-state id by state name
- updating issue state mutation
- expected errors when GraphQL returns errors

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/tracker.test.ts`
Expected: FAIL because mutation methods do not exist.

**Step 3: Write minimal implementation**

In `src/tracker.ts`:
- extend `TrackerAdapter` interface with:
  - `createIssueComment(issueId, body)`
  - `markIssueCompleted(issueId, doneStateName)`
  - `resolveDoneStateId(doneStateName)`
- implement Linear GraphQL queries/mutations with typed payload parsing
- add caching for resolved done-state ids

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/tracker.test.ts`
Expected: PASS.

**Step 5: Commit**

Run:
```bash
git add src/tracker.ts tests/tracker.test.ts
git commit -m "feat(tracker): add linear comment and state mutation support"
```

### Task 3: Add Verification Result Structures to Worker Outputs

**Files:**
- Modify: `src/worker.ts`
- Modify: `src/types.ts`
- Test: `tests/conformance/session-and-turn-count.test.ts`
- Test: `tests/conformance/turn-count-executed-turns.test.ts`

**Step 1: Write the failing test**

Add/adjust tests to assert worker returns:
- run summary fields (`started_at`, `finished_at`, `duration_ms`)
- verification list shape with default empty list

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/conformance/session-and-turn-count.test.ts tests/conformance/turn-count-executed-turns.test.ts`
Expected: FAIL on missing worker result properties.

**Step 3: Write minimal implementation**

In `src/worker.ts`:
- return richer result object from `runWorkerAttempt`
- initialize verification records list (empty first; structured wiring for future population)
- include run timing fields

Update type declarations in `src/types.ts`.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/conformance/session-and-turn-count.test.ts tests/conformance/turn-count-executed-turns.test.ts`
Expected: PASS.

**Step 5: Commit**

Run:
```bash
git add src/worker.ts src/types.ts tests/conformance/session-and-turn-count.test.ts tests/conformance/turn-count-executed-turns.test.ts
git commit -m "feat(worker): return run and verification summary metadata"
```

### Task 4: Implement Completion Eligibility and Write-Back Flow in Orchestrator

**Files:**
- Modify: `src/orchestrator.ts`
- Modify: `src/types.ts`
- Test: `tests/scheduling.test.ts`
- Create: `tests/orchestrator-writeback.test.ts`

**Step 1: Write the failing test**

Create `tests/orchestrator-writeback.test.ts` covering:
- normal exit + verification pass => comment then done-state mutation
- verification missing/failing => no state transition
- comment success + state failure => partial status and retry
- terminal state already reached externally => write-back skipped

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/orchestrator-writeback.test.ts`
Expected: FAIL because orchestration write-back pipeline does not exist.

**Step 3: Write minimal implementation**

In `src/orchestrator.ts`:
- add per-run completion record and status enums
- compute eligibility using:
  - worker verification summary
  - workspace evidence scan helper
- implement write-back sequence: comment then state update
- add idempotency marker based on `run_id`
- add retry scheduling for partial write-back failures

Update `src/types.ts` with new runtime/write-back types.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/orchestrator-writeback.test.ts`
Expected: PASS.

**Step 5: Run nearby orchestrator tests**

Run: `npm run test -- tests/scheduling.test.ts tests/workflow.test.ts`
Expected: PASS with no regressions.

**Step 6: Commit**

Run:
```bash
git add src/orchestrator.ts src/types.ts tests/orchestrator-writeback.test.ts tests/scheduling.test.ts tests/workflow.test.ts
git commit -m "feat(orchestrator): gate completion and perform conservative linear writeback"
```

### Task 5: Expose New Observability Fields in HTTP APIs

**Files:**
- Modify: `src/http-server.ts`
- Test: `tests/conformance/http-issue-detail.test.ts`
- Test: `tests/conformance/issue-detail-endpoint.test.ts`

**Step 1: Write the failing test**

Update conformance tests to assert new payload fields:
- verification summary
- completion decision reason
- write-back status and error
- run duration and phase

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/conformance/http-issue-detail.test.ts tests/conformance/issue-detail-endpoint.test.ts`
Expected: FAIL on missing response fields.

**Step 3: Write minimal implementation**

In `src/http-server.ts`:
- include new fields from orchestrator snapshots in JSON endpoints
- preserve existing response contracts and status codes

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/conformance/http-issue-detail.test.ts tests/conformance/issue-detail-endpoint.test.ts`
Expected: PASS.

**Step 5: Commit**

Run:
```bash
git add src/http-server.ts tests/conformance/http-issue-detail.test.ts tests/conformance/issue-detail-endpoint.test.ts
git commit -m "feat(api): expose verification and writeback observability fields"
```

### Task 6: Upgrade Dashboard for Full Real-Time Observability

**Files:**
- Modify: `src/http-server.ts`
- Test: `tests/manual/ui_smoke.py`

**Step 1: Write the failing test/check**

Update `tests/manual/ui_smoke.py` assertions for new UI indicators:
- per-issue verification status
- write-back status
- last check info
- phase/runtime/retry cues

**Step 2: Run check to verify gap**

Run: `python tests/manual/ui_smoke.py`
Expected: FAIL or missing assertions for new telemetry.

**Step 3: Write minimal implementation**

In `src/http-server.ts` dashboard renderer:
- add metrics/cards for completion eligibility and write-back counts
- add columns for `phase`, `verification`, `last_check`, `writeback`, `duration`, `retry`, `workspace`
- add recent event feed panel
- keep mobile readability and auto-refresh behavior

**Step 4: Run check to verify pass**

Run: `python tests/manual/ui_smoke.py`
Expected: PASS and screenshots generated in `artifacts/screenshots`.

**Step 5: Commit**

Run:
```bash
git add src/http-server.ts tests/manual/ui_smoke.py artifacts/screenshots/ui-smoke-report.json
git commit -m "feat(ui): add full real-time verification and writeback telemetry"
```

### Task 7: End-to-End Verification and Regression Sweep

**Files:**
- Modify if needed: failing files from test output

**Step 1: Run targeted suite**

Run:
```bash
npm run test -- tests/config.test.ts tests/tracker.test.ts tests/orchestrator-writeback.test.ts tests/conformance/http-issue-detail.test.ts tests/conformance/issue-detail-endpoint.test.ts
```
Expected: PASS.

**Step 2: Run conformance regression**

Run: `npm run test:conformance`
Expected: PASS (or explicitly documented known failures unrelated to this feature).

**Step 3: Build**

Run: `npm run build`
Expected: successful TypeScript compilation.

**Step 4: Manual runtime check**

Run:
```bash
npm run dev -- WORKFLOW.md --port 3000
```
Then:
- open `http://127.0.0.1:3000`
- trigger `/api/v1/refresh`
- verify live status cards/tables update and write-back statuses are visible

**Step 5: Commit final fixes**

Run:
```bash
git add -A
git commit -m "test: finalize writeback and observability verification"
```

### Task 8: Documentation and Operator Guidance

**Files:**
- Modify: `README.md`
- Modify: `WORKFLOW.example.md`
- Optionally modify: `WORKFLOW.md` (if local defaults are needed)

**Step 1: Write the failing doc check**

Create checklist items to confirm docs include:
- new write-back config keys
- verification gate behavior
- what appears in UI and APIs

**Step 2: Update docs minimally**

Document:
- enabling write-back safely
- required done state and verification settings
- expected comment format and observability fields

**Step 3: Verify docs are accurate**

Run: quick manual compare against code paths in `src/config.ts`, `src/orchestrator.ts`, `src/http-server.ts`.
Expected: docs match implemented behavior.

**Step 4: Commit**

Run:
```bash
git add README.md WORKFLOW.example.md WORKFLOW.md
git commit -m "docs: document linear writeback gating and observability"
```

## Done Criteria

- Write-back is disabled by default and safe when enabled.
- Issue completion transition happens only when verification eligibility passes.
- Completion comment includes rich run/build verification details.
- `/api/v1/state` and `/api/v1/:issue` expose verification + write-back telemetry.
- Dashboard shows full real-time lifecycle and write-back observability.
- Tests and build pass, and manual UI smoke evidence is captured.
