# Design Doc: Dynamic Dashboard Activity Feed

**Goal:** Transform the stagnant Symphony dashboard into a "living" operator console by surfacing high-frequency events (turns, tool calls, retries) with synthesized human-readable messages and a global activity feed.

## Architecture

### 1. Event Synthesis (Orchestrator)
The `Orchestrator` currently receives granular events but often passes them through with `null` messages. We will enrich these events before they reach the state snapshot:
- **`turn_completed`**: If message is null, set to `"Completed turn #{turn_count}"`.
- **`turn_started`**: If message is null, set to `"Starting turn #{turn_count + 1}..."`.
- **`retry_scheduled`**: Ensure the attempt count and due time are clearly described.

### 2. Global Event Telemetry (Orchestrator)
We will add a global circular buffer of the last 50 events across *all* issues to the `RuntimeState`. This ensures the operator sees what the service is doing as a whole, even if they aren't looking at a specific issue.

### 3. Dashboard UI Enhancements (HTTP Server)
- **Activity Feed Panel**: A new scrollable panel at the bottom of the dashboard showing a timestamped list of the global event buffer.
- **Faster Heartbeat**: Reduce the auto-refresh interval from 5 seconds to 2 seconds to make the UI feel reactive.
- **Visual Cues**: Add subtle CSS transitions or color coding for different event types (e.g., green for completions, amber for retries, red for failures).

## Data Flow
1. `Worker` emits `AgentEvent`.
2. `Orchestrator.#handleCodexEvent` intercepts, synthesizes a message if missing, and pushes to both per-issue and global event queues.
3. `http-server` pulls the full state (including global events) via `/api/v1/state`.
4. Browser JS renders the new activity feed and updates the "Last Message" column which will now actually change on every turn.

## Verification Plan
- **Unit Tests**: Update `orchestrator.test.ts` to verify global event tracking and message synthesis.
- **E2E Smoke**: Use `ui_smoke.py` to confirm the new activity feed panel is present and populated.
