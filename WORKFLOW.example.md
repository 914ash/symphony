---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: YOUR_PROJECT_SLUG
  active_states: "Todo, In Progress"
  terminal_states: "Closed, Cancelled, Canceled, Duplicate, Done"
  writeback:
    enabled: false
    done_state: "Done"
verification:
  required_kinds: ["test"]
  workspace_signals: ["dist/index.js"]
polling:
  interval_ms: 30000
workspace:
  root: ./symphony_workspaces
hooks:
  timeout_ms: 60000
agent:
  max_concurrent_agents: 10
  max_turns: 20
  max_retry_backoff_ms: 300000
codex:
  command: codex app-server
  launch_mode: compatible
  approval_policy: full-auto
  thread_sandbox: workspace-write
  turn_sandbox_policy: workspace-write
  turn_timeout_ms: 3600000
  read_timeout_ms: 5000
  stall_timeout_ms: 300000
server:
  port: 3000
---
You are working issue {{ issue.identifier }}.

Issue title: {{ issue.title }}
Issue state: {{ issue.state }}

Attempt number: {{ attempt }}

Implement the required changes in the issue workspace and provide a concise completion summary.
