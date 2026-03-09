# Symphony

Symphony is a TypeScript workflow service for running jobs with visible state, explicit verification gates, and an optional dashboard.
This repo is a fork, and the point of the fork is clear: make the system easier to inspect, safer to complete, and easier to connect to outside tools without guessing what happened during a run.

![Symphony dashboard](artifacts/screenshots/dashboard-desktop.png)


## What Changed In This Fork

- added verification-aware completion logic
- made active runs easier to inspect through the dashboard and JSON APIs
- tightened write-back and done-state handling for external systems such as Linear
- kept the workflow service small enough to read without losing the operational details

The upstream specification and reference material are preserved locally in:

- `upstream.SPEC.md`
- `upstream.README.md`
- `upstream.elixir.README.md`

## Run Locally

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

## What To Look At First

1. Open the dashboard screenshot above to see the operator view.
2. Read [docs/landing.md](docs/landing.md) for the short walkthrough.
3. Review [docs/fork-notes.md](docs/fork-notes.md) for the fork-specific framing.

## Why It Is Worth Reviewing

Many workflow tools only look clean from the outside. This fork spends its effort on the messy part: when a run is in progress, when it should stop, and what evidence should exist before it marks work done.
