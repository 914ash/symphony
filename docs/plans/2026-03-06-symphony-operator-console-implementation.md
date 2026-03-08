# Symphony Operator Console Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the remaining spec-facing gaps and turn the current HTTP surface into an operator-grade Symphony console.

**Architecture:** Keep the existing Node.js orchestrator, tracker adapter, worker, and HTTP server structure. Add the missing issue fields and runtime diagnostics in the backend first, then rebuild the server-rendered dashboard on top of the enriched snapshots and REST payloads.

**Tech Stack:** Node.js, TypeScript, Vitest, native `http`, Linear GraphQL, Liquid templates, Codex app-server over stdio

---

### Task 1: Stabilize Test Discovery and Add Failing Coverage

**Files:**
- Create: `tests/tracker.test.ts`
- Create: `tests/orchestrator.test.ts`
- Modify: `package.json`
- Modify: `src/tracker.ts`
- Modify: `src/orchestrator.ts`

**Step 1: Write the failing tracker normalization test**

Add `tests/tracker.test.ts` with a focused test that constructs a Linear payload containing:

```ts
branchName: "feature/SYM-1"
url: "https://linear.app/acme/issue/SYM-1/example"
```

Expected assertions:

```ts
expect(issue.branchName).toBe("feature/SYM-1");
expect(issue.url).toBe("https://linear.app/acme/issue/SYM-1/example");
```

**Step 2: Write the failing orchestrator diagnostics test**

Add `tests/orchestrator.test.ts` with a test that verifies the state snapshot includes:

```ts
workflow_path
health
recent_errors
last_poll_at
last_reconcile_at
last_refresh_at
```

Expected: FAIL because those fields do not exist yet.

**Step 3: Exclude generated workspaces from Vitest discovery**

Modify `package.json` to run Vitest against `tests/**/*.test.ts` only, or add an equivalent exclude
for `symphony_workspaces/**`.

**Step 4: Run the targeted failing tests**

Run:

```bash
npm run test -- tests/tracker.test.ts tests/orchestrator.test.ts
```

Expected: FAIL for missing fields/assertions, but no accidental execution of files under
`symphony_workspaces`.

**Step 5: Commit**

Workspace note: this directory is not a Git repository, so skip the commit step here.

### Task 2: Complete the Normalized Issue Model

**Files:**
- Modify: `src/types.ts`
- Modify: `src/tracker.ts`
- Modify: `src/template.ts`
- Test: `tests/tracker.test.ts`

**Step 1: Extend the issue type**

Add the missing fields to `Issue` in `src/types.ts`:

```ts
branchName?: string | null;
url?: string | null;
```

**Step 2: Expand the Linear GraphQL selection set**

Modify the candidate query in `src/tracker.ts` to request the Linear fields needed for:

```ts
branchName
url
```

**Step 3: Normalize and expose the fields**

Update `normalizeIssue()` in `src/tracker.ts` so these values are mapped into the internal issue
model while preserving existing normalization rules for labels and blockers.

**Step 4: Verify prompt compatibility**

Ensure the prompt renderer still receives the full `issue` object and does not break when the new
fields are present but null.

**Step 5: Run the tracker test**

Run:

```bash
npm run test -- tests/tracker.test.ts
```

Expected: PASS.

**Step 6: Commit**

Workspace note: this directory is not a Git repository, so skip the commit step here.

### Task 3: Add Runtime Diagnostics and Defensive Reload Hooks

**Files:**
- Modify: `src/types.ts`
- Modify: `src/orchestrator.ts`
- Modify: `src/service.ts`
- Test: `tests/orchestrator.test.ts`

**Step 1: Add diagnostics state types**

Introduce typed runtime diagnostics for:

```ts
workflowPath
health
lastPollAt
lastReconcileAt
lastRefreshAt
lastReloadAt
recentErrors
```

Use a bounded in-memory array for recent errors.

**Step 2: Record timestamps and failures**

Update orchestrator control flow to record:

1. Poll start/completion time
2. Reconcile completion time
3. Refresh request time
4. Worker failures
5. Dispatch validation failures
6. Poll/reconcile failures

**Step 3: Add defensive workflow refresh behavior**

Update the service/orchestrator interaction so runtime operations can re-validate or re-apply the
latest workflow state even if a filesystem watch event was missed.

**Step 4: Expose the diagnostics in snapshots**

Update `getStateSnapshot()` to include the new fields and compute a simple health summary from
current runtime conditions.

**Step 5: Run the orchestrator test**

Run:

```bash
npm run test -- tests/orchestrator.test.ts
```

Expected: PASS.

**Step 6: Commit**

Workspace note: this directory is not a Git repository, so skip the commit step here.

### Task 4: Expand the REST API for Operator Drilldown

**Files:**
- Modify: `src/http-server.ts`
- Modify: `src/orchestrator.ts`
- Modify: `tests/conformance/issue-detail-endpoint.test.ts`
- Create: `tests/http-dashboard.test.ts`

**Step 1: Extend the issue detail payload**

Update `getIssueSnapshot()` so it includes:

```ts
issue: {
  identifier,
  id,
  title,
  state,
  description,
  priority,
  branch_name,
  url,
  labels,
  blocked_by
}
```

Preserve the existing `running`, `retry`, `workspace`, `attempts`, and `recent_events` sections.

**Step 2: Extend the state payload**

Update `/api/v1/state` response generation so it includes:

```ts
workflow_path
health
last_poll_at
last_reconcile_at
last_refresh_at
last_reload_at
recent_errors
```

**Step 3: Add API assertions**

Extend `tests/conformance/issue-detail-endpoint.test.ts` to verify the richer issue shape and keep
the `issue_not_found` contract unchanged.

**Step 4: Add state payload test coverage**

Create `tests/http-dashboard.test.ts` to verify `/api/v1/state` returns the new diagnostics fields.

**Step 5: Run the HTTP tests**

Run:

```bash
npm run test -- tests/conformance/issue-detail-endpoint.test.ts tests/http-dashboard.test.ts
```

Expected: PASS.

**Step 6: Commit**

Workspace note: this directory is not a Git repository, so skip the commit step here.

### Task 5: Rebuild the Dashboard into an Operator Console

**Files:**
- Modify: `src/http-server.ts`
- Test: `tests/http-dashboard.test.ts`

**Step 1: Replace the minimal HTML renderer**

Rework the dashboard HTML so it includes:

1. System summary cards
2. Health status
3. Running sessions table
4. Retry queue table
5. Recent errors panel
6. Per-issue detail links
7. Refresh control

**Step 2: Render from orchestrator snapshot only**

Do not add separate background state or new persistence. The dashboard must remain a pure rendering
of current orchestrator state.

**Step 3: Add dashboard rendering assertions**

Update `tests/http-dashboard.test.ts` to assert presence of representative content such as:

```ts
"Health"
"Recent Errors"
"Retry Queue"
"/api/v1/SYM-1"
```

**Step 4: Run the dashboard test**

Run:

```bash
npm run test -- tests/http-dashboard.test.ts
```

Expected: PASS.

**Step 5: Commit**

Workspace note: this directory is not a Git repository, so skip the commit step here.

### Task 6: Full Verification and Live Smoke

**Files:**
- Modify: `README.md`
- Test: `tests/**/*.test.ts`

**Step 1: Update README if behavior changed materially**

Document the richer dashboard and expanded API responses in `README.md`.

**Step 2: Run the full automated suite**

Run:

```bash
npm run test
npm run test:conformance
npm run build
```

Expected: PASS for all commands.

**Step 3: Run a live local smoke**

Run the app with a real Linear-backed workflow and verify:

1. `/` loads the richer operator console
2. `/api/v1/state` returns diagnostics fields
3. `/api/v1/<issue>` returns full issue drilldown
4. `POST /api/v1/refresh` returns `202`

**Step 4: Record outcomes**

Capture any remaining gaps in `docs/plans/2026-03-06-symphony-conformance-audit-results.md` or a
new verification note if needed.

**Step 5: Commit**

Workspace note: this directory is not a Git repository, so skip the commit step here.
