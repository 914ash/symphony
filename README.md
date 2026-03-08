# Symphony

![Symphony cover](assets/covers/cover.svg)

Fork-oriented Node.js/TypeScript implementation of the Symphony service specification, with emphasis on verification gating, observability, and operator control.

![Symphony dashboard](artifacts/screenshots/dashboard-desktop.png)
![Symphony API state](artifacts/screenshots/api-state-json.png)

See [docs/landing.md](docs/landing.md) for the full landing page, screenshot tour, and fork positioning.

This repo belongs in the portfolio because it shows how frontier AI orchestration becomes operational software: workers, workflow control, verification evidence, and external-system write-back. That is directly relevant to defense and mission-support environments where autonomy without observability is not acceptable.

## What This Fork Emphasizes

- verification-aware completion logic
- Linear write-back controls and safe done-state transitions
- dashboard and API observability for active runs
- workflow-driven orchestration in a TypeScript service surface

## Why This Repo Exists

The point of this fork is not to claim greenfield authorship. It is to show how a frontier-AI workflow system changes when the design target becomes operational trust: visible state, auditable transitions, and clearer operator control over autonomous execution.

The upstream specification and reference material are preserved locally in:

- `upstream.SPEC.md`
- `upstream.README.md`
- `upstream.elixir.README.md`

## Quick Start

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` or set `LINEAR_API_KEY` in your shell
3. Copy `WORKFLOW.example.md` to a local `WORKFLOW.md`
4. Start the service: `npm run dev -- WORKFLOW.md --port 3000`
5. Open the dashboard or inspect the JSON APIs

## Commands

- `npm test`
- `npm run test:conformance`
- `npm run build`

## Interface Surface

- `symphony [path-to-WORKFLOW.md]`
- optional `--port <int>` enables the HTTP dashboard and API endpoints
- `/api/v1/state`
- `/api/v1/:issue`
- `/api/v1/refresh`

## Why It Matters

This project is part of the frontier-AI investigation side of the portfolio:

- it deals with how agentic systems should be supervised
- it makes verification evidence part of the workflow contract
- it connects autonomous execution to operator trust and downstream systems

See [docs/landing.md](docs/landing.md) and [docs/fork-notes.md](docs/fork-notes.md) for contribution framing and publication notes.
