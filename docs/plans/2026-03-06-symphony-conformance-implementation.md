# Symphony Conformance Gap Closure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the Node.js Symphony implementation to spec-conformant behavior for core requirements and shipped extension parity (HTTP + `linear_graphql`) with robust automated verification.

**Architecture:** We will patch the existing modular runtime (tracker, app-server client, orchestrator, HTTP server) instead of rewriting. The work is organized by behavior contracts: protocol/session semantics, tracker normalization, observability, platform launch policy, and dynamic tool extension. Each task is test-first, then minimal implementation, then verification.

**Tech Stack:** Node.js 20+, TypeScript (ESM), Vitest, native `fetch`, existing Symphony modules under `src/`.

---

### Task 1: Add conformance regression test scaffolding

**Files:**
- Create: `tests/conformance/session-and-turn-count.test.ts`
- Create: `tests/conformance/linear-normalization.test.ts`
- Create: `tests/conformance/http-issue-detail.test.ts`
- Modify: `package.json`

**Step 1: Write failing tests for key known gaps**

```ts
// session-and-turn-count.test.ts
it("emits session_id as <thread>-<turn> on turn completion", async () => {
  expect(sessionId).toMatch(/^thread-.+-turn-.+$/);
});

it("reports turn_count from executed turns, not retry attempts", async () => {
  expect(snapshot.running[0].turn_count).toBe(2);
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/conformance/session-and-turn-count.test.ts`  
Expected: FAIL with session/turn_count mismatch assertions.

**Step 3: Add test script aliases for focused conformance runs**

```json
"test:conformance": "vitest run tests/conformance"
```

**Step 4: Run the focused suite**

Run: `npm run test:conformance`  
Expected: FAIL on newly added conformance tests.

**Step 5: Commit**

```bash
git add tests/conformance package.json
git commit -m "test(conformance): add failing specs for session, normalization, and issue-detail contracts"
```

### Task 2: Fix session_id and turn_count semantics

**Files:**
- Modify: `src/types.ts`
- Modify: `src/worker.ts`
- Modify: `src/orchestrator.ts`
- Test: `tests/conformance/session-and-turn-count.test.ts`

**Step 1: Write/extend failing tests for max-turn and early-exit paths**

```ts
it("keeps last turn id in session id when max_turns reached", async () => {
  expect(sessionId).toContain("-turn-");
});
```

**Step 2: Run targeted test**

Run: `npm run test -- tests/conformance/session-and-turn-count.test.ts`  
Expected: FAIL.

**Step 3: Implement minimal changes**

```ts
// types.ts
turnCount: number;
lastTurnId: string | null;

// worker.ts
let lastTurnId: string | null = null;
lastTurnId = turn.turnId;
return { turnsExecuted, sessionId: `${session.threadId}-${lastTurnId ?? "unknown"}` };

// orchestrator.ts
entry.turnCount += 1; // on turn-completed event
turn_count: entry.turnCount;
```

**Step 4: Re-run targeted tests**

Run: `npm run test -- tests/conformance/session-and-turn-count.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/types.ts src/worker.ts src/orchestrator.ts tests/conformance/session-and-turn-count.test.ts
git commit -m "fix(conformance): correct session_id and turn_count semantics"
```

### Task 3: Correct Linear blocker normalization contract

**Files:**
- Modify: `src/tracker.ts`
- Test: `tests/conformance/linear-normalization.test.ts`

**Step 1: Write failing normalization tests**

```ts
it("derives blocked_by from inverse 'blocks' relation source", async () => {
  expect(issue.blockedBy).toEqual([{ id: "x", identifier: "ABC-2", state: "Todo" }]);
});
```

**Step 2: Run targeted test**

Run: `npm run test -- tests/conformance/linear-normalization.test.ts`  
Expected: FAIL.

**Step 3: Update query + mapper**

```ts
// tracker query: request inverse relation structure needed by spec mapping
// mapper: transform inverse blocks relations into blockedBy[]
```

**Step 4: Verify**

Run: `npm run test -- tests/conformance/linear-normalization.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/tracker.ts tests/conformance/linear-normalization.test.ts
git commit -m "fix(tracker): align blocked_by normalization with spec inverse blocks contract"
```

### Task 4: Implement structured session lifecycle logging completeness

**Files:**
- Modify: `src/app-server.ts`
- Modify: `src/orchestrator.ts`
- Test: `tests/conformance/session-and-turn-count.test.ts`

**Step 1: Add failing log-shape assertions**

```ts
it("includes issue_id, issue_identifier, and session_id in session lifecycle logs", () => {
  expect(logLine).toContain("session_id=");
});
```

**Step 2: Run test**

Run: `npm run test -- tests/conformance/session-and-turn-count.test.ts`  
Expected: FAIL.

**Step 3: Add lifecycle log lines**

```ts
logger.info("session_started", { issue_id, issue_identifier, session_id });
logger.info("turn_completed", { issue_id, issue_identifier, session_id });
logger.error("turn_failed", { issue_id, issue_identifier, session_id, error_code });
```

**Step 4: Verify**

Run: `npm run test -- tests/conformance/session-and-turn-count.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/app-server.ts src/orchestrator.ts tests/conformance/session-and-turn-count.test.ts
git commit -m "fix(logging): enforce session lifecycle context fields"
```

### Task 5: Add strict conformance launch mode and explicit compatibility mode

**Files:**
- Modify: `src/shell.ts`
- Modify: `src/config.ts`
- Modify: `src/types.ts`
- Test: `tests/conformance/session-and-turn-count.test.ts`

**Step 1: Add failing tests for launch policy behavior**

```ts
it("uses bash -lc in strict conformance mode", async () => {
  expect(cmd.command).toBe("bash");
  expect(cmd.args[0]).toBe("-lc");
});
```

**Step 2: Run test**

Run: `npm run test -- tests/conformance/session-and-turn-count.test.ts`  
Expected: FAIL.

**Step 3: Implement policy**

```ts
// codex.launch_mode: "strict" | "compatible"
// strict -> require bash -lc or fail startup
// compatible -> current platform fallback behavior
```

**Step 4: Verify**

Run: `npm run test -- tests/conformance/session-and-turn-count.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/shell.ts src/config.ts src/types.ts tests/conformance/session-and-turn-count.test.ts
git commit -m "feat(conformance): add strict bash launch mode with explicit compatibility fallback"
```

### Task 6: Implement optional `linear_graphql` dynamic tool extension

**Files:**
- Create: `src/dynamic-tools/linear-graphql.ts`
- Modify: `src/app-server.ts`
- Modify: `src/tracker.ts`
- Modify: `src/config.ts`
- Test: `tests/conformance/linear-graphql-tool.test.ts`

**Step 1: Write failing tool-contract tests**

```ts
it("returns success=false for unsupported tool names without stalling", async () => {
  expect(result.error).toBe("unsupported_tool_call");
});

it("executes single-operation linear_graphql call with configured auth", async () => {
  expect(result.success).toBe(true);
});
```

**Step 2: Run tests**

Run: `npm run test -- tests/conformance/linear-graphql-tool.test.ts`  
Expected: FAIL.

**Step 3: Implement tool handler + wiring**

```ts
// app-server request handler:
// - parse tool name + args
// - if linear_graphql enabled: validate {query, variables}
// - reject multi-operation docs
// - execute against configured endpoint/auth
// - return structured result payload
```

**Step 4: Verify**

Run: `npm run test -- tests/conformance/linear-graphql-tool.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/dynamic-tools/linear-graphql.ts src/app-server.ts src/tracker.ts src/config.ts tests/conformance/linear-graphql-tool.test.ts
git commit -m "feat(extension): implement linear_graphql dynamic tool contract"
```

### Task 7: Enrich issue-detail API payload and recent event tracking

**Files:**
- Modify: `src/types.ts`
- Modify: `src/orchestrator.ts`
- Modify: `src/http-server.ts`
- Test: `tests/conformance/http-issue-detail.test.ts`

**Step 1: Write failing API contract tests**

```ts
it("returns issue detail payload with recent_events and running metadata", async () => {
  expect(body).toHaveProperty("recent_events");
  expect(Array.isArray(body.recent_events)).toBe(true);
});
```

**Step 2: Run tests**

Run: `npm run test -- tests/conformance/http-issue-detail.test.ts`  
Expected: FAIL.

**Step 3: Implement event ring buffer + payload mapping**

```ts
// RunningEntry.recentEvents: [{at,event,message}]
// append on each codex event, keep last N (e.g., 50)
// expose in /api/v1/:issue_identifier response
```

**Step 4: Verify**

Run: `npm run test -- tests/conformance/http-issue-detail.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/types.ts src/orchestrator.ts src/http-server.ts tests/conformance/http-issue-detail.test.ts
git commit -m "feat(observability): add recent event tracking and richer issue detail API payload"
```

### Task 8: Full conformance verification run and docs update

**Files:**
- Modify: `README.md`
- Create: `docs/plans/2026-03-06-symphony-conformance-audit-results.md`

**Step 1: Run full test/build checks**

Run: `npm run build`  
Expected: PASS.

Run: `npm run test`  
Expected: PASS.

Run: `npm run test:conformance`  
Expected: PASS.

**Step 2: Run real integration smoke with valid Linear + Codex app-server**

Run: `node dist/index.js WORKFLOW.md --port 3000`  
Expected: service starts, `/api/v1/state` responds 200, at least one dispatch when active issues exist.

**Step 3: Document behavior + configuration flags**

```md
- strict vs compatible launch mode
- linear_graphql extension toggle and constraints
- conformance test command set
```

**Step 4: Final commit**

```bash
git add README.md docs/plans/2026-03-06-symphony-conformance-audit-results.md
git commit -m "docs(conformance): publish implementation/audit outcomes and runbook"
```

### Task 9: Final sign-off checklist

**Files:**
- No new files required

**Step 1: Verify Section 18.1 matrix item-by-item**

Run: `rg -n "18.1 Required for Conformance|17\\." upstream.SPEC.md`  
Expected: checklist available for manual sign-off.

**Step 2: Record pass/partial/fail table in audit results doc**

Run: manual checklist completion.

**Step 3: Confirm no outstanding TODOs in critical paths**

Run: `rg -n "TODO|FIXME" src tests`  
Expected: no unresolved critical TODO in runtime paths.

**Step 4: Tag handoff milestone**

```bash
git tag -a symphony-conformance-v1 -m "Symphony conformance closure"
```

**Step 5: Final verification before merge**

Run: `npm run build && npm run test && npm run test:conformance`  
Expected: PASS.

