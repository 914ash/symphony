# Dynamic Dashboard Activity Feed Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the stagnant Symphony dashboard into a "living" operator console by surfacing high-frequency events with synthesized human-readable messages and a global activity feed.

**Architecture:** Enrich `AgentEvent` with synthesized messages in the `Orchestrator`, maintain a global circular buffer of recent events in the `RuntimeState`, and update the dashboard UI to display this feed with a faster 2-second refresh cycle.

**Tech Stack:** Node.js, TypeScript, Vanilla JS/CSS (dashboard).

---

### Task 1: Update Types for Global Event Tracking

**Files:**
- Modify: `src/types.ts`
- Modify: `src/orchestrator.ts`

**Step 1: Update `RuntimeState` interface**

Update `src/types.ts` to include `globalEvents`.

```typescript
export interface RuntimeState {
  running: Map<string, RunningEntry>;
  claimed: Set<string>;
  retryAttempts: Map<string, RetryEntry>;
  completed: Set<string>;
  codexTotals: CodexTotals;
  codexRateLimits: unknown;
  globalEvents: Array<{ at: string; event: string; message: string; issue_identifier: string }>;
}
```

**Step 2: Initialize `globalEvents` in `Orchestrator`**

Update `src/orchestrator.ts` constructor/state initialization.

```typescript
  #state: RuntimeState = {
    // ... other fields
    globalEvents: []
  };
```

**Step 3: Commit**

```bash
git add src/types.ts src/orchestrator.ts
git commit -m "feat: add globalEvents to runtime state"
```

### Task 2: Implement Event Synthesis and Global Tracking

**Files:**
- Modify: `src/orchestrator.ts`
- Create: `tests/orchestrator-events.test.ts`

**Step 1: Write the failing test**

Create `tests/orchestrator-events.test.ts` to verify message synthesis for `turn_completed` and global event population.

```typescript
import { describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";

describe("Orchestrator: Event Synthesis", () => {
  it("synthesizes messages for turn events and populates global feed", async () => {
    // Setup minimal orchestrator and emit a turn_completed event with null message
    // Verify entry.lastCodexMessage is "Completed turn #1"
    // Verify orchestrator.getStateSnapshot().global_events has the entry
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator-events.test.ts`
Expected: FAIL

**Step 3: Implement synthesis in `#handleCodexEvent`**

Modify `src/orchestrator.ts`:
- In `#handleCodexEvent`, if `event.message` is null/empty and `event.event` is `turn_completed`, set `entry.lastCodexMessage = `Completed turn #${entry.turnCount}``.
- Handle `turn_started` similarly.
- Push the enriched event to `this.#state.globalEvents`.
- Keep `globalEvents` capped at 50 items.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator-events.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/orchestrator.ts tests/orchestrator-events.test.ts
git commit -m "feat: synthesize event messages and track global feed"
```

### Task 3: Expose Global Feed in State Snapshot

**Files:**
- Modify: `src/orchestrator.ts`

**Step 1: Update `getStateSnapshot`**

Modify `src/orchestrator.ts` to include `global_events` in the returned object.

```typescript
  getStateSnapshot() {
    // ...
    return {
      // ...
      global_events: this.#state.globalEvents
    };
  }
```

**Step 2: Verify snapshot**

Run existing dashboard tests or a quick manual check.

**Step 3: Commit**

```bash
git add src/orchestrator.ts
git commit -m "feat: expose global events in state snapshot"
```

### Task 4: Upgrade Dashboard UI with Live Feed

**Files:**
- Modify: `src/http-server.ts`

**Step 1: Add CSS for Activity Feed**

Update `renderDashboard` style block:
- Add styles for `.event-feed`, `.event-item`, and color coding for event types.

**Step 2: Add Activity Feed Panel**

Update `renderDashboard` HTML body:
- Add a new `<section class="panel">` for "Live Activity Feed".

**Step 3: Update Client-Side JS**

Update the `render()` and `pollState()` functions in `renderDashboard`:
- Update `POLL_MS` to `2000`.
- Implement `renderGlobalEvents()` to populate the new feed panel.
- Ensure the feed auto-scrolls or shows the most recent at the top.

**Step 4: Manual Verification**

Run `npm run dev` and verify:
- "Last Message" column now updates on every turn.
- "Live Activity Feed" panel shows a scrolling history of events.
- UI feels responsive with 2s polling.

**Step 5: Commit**

```bash
git add src/http-server.ts
git commit -m "feat: add live activity feed panel and speed up dashboard refresh"
```
