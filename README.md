# Symphony

Symphony is a TypeScript workflow service for running issue-driven coding-agent work as an inspectable, long-lived system instead of a collection of ad hoc scripts. It reads a repo-owned `WORKFLOW.md`, polls Linear for eligible work, creates a dedicated workspace per issue, launches Codex app-server sessions, and keeps reconciling tracker state while the run is active. When you enable the server, it also exposes a dashboard and JSON endpoints so operators can see what is running, what is retrying, which session is attached to which ticket, and what happened most recently without digging through local process state.

This repository is a forked implementation effort, not a claim that the Symphony model originated here. The project lineage matters: the original Symphony specification and public framing are preserved in [upstream.SPEC.md](upstream.SPEC.md), [upstream.README.md](upstream.README.md), and [upstream.elixir.README.md](upstream.elixir.README.md). Those upstream materials define the service shape and reference posture. This repo builds on that lineage with a smaller TypeScript implementation focused on inspectability, verification-aware completion, and public-safe operational documentation.

![Symphony dashboard](artifacts/screenshots/dashboard-desktop.png)


## What This Repo Adds And Builds On

This fork keeps the upstream service model, then makes the runtime easier to operate and easier to trust:

- a polling orchestrator with explicit running, claimed, completed, and retry state
- per-issue workspaces with lifecycle hooks and deterministic workspace naming
- hot reload for `WORKFLOW.md`, so prompt and runtime config changes apply without restarting the service
- an optional HTTP dashboard plus JSON endpoints at `/api/v1/state`, `/api/v1/:issue`, and `/api/v1/refresh`
- session, turn, token, and recent-event tracking so active runs are visible instead of opaque
- guarded Linear write-back flow that can comment and move issues to a done state only when configured verification evidence exists
- an optional `linear_graphql` tool surface for agent sessions when raw Linear GraphQL access is intentionally enabled
- conformance and behavior tests covering config, orchestration, tracker normalization, dashboard/API behavior, and tool handling

Eligibility and completion rules stay repo-controlled: `WORKFLOW.md` defines the Linear project and active states to poll, while verification evidence can require named checks plus workspace signals before write-back moves an issue forward.

In practical terms, the work here is about making Symphony easier to inspect mid-run, safer to complete automatically, and small enough to read end-to-end without losing the operational details that matter.

## Architecture At A Glance

- `src/service.ts` wires together workflow loading, config validation, tracker integration, workspace management, the orchestrator, and optional HTTP serving.
- `src/orchestrator.ts` owns poll-and-dispatch, reconciliation, retries, event aggregation, and write-back coordination.
- `src/worker.ts` runs Codex turns inside the issue workspace and supports optional dynamic tooling.
- `src/http-server.ts` serves the operator dashboard and issue/state APIs.
- `WORKFLOW.example.md` shows the expected contract for tracker settings, workspace behavior, agent limits, verification requirements, and server configuration.

If you want the shortest walkthrough after this README, start with [docs/landing.md](docs/landing.md) and then [docs/fork-notes.md](docs/fork-notes.md).

## Run Locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` or export `LINEAR_API_KEY`.
3. Copy `WORKFLOW.example.md` to a local `WORKFLOW.md` and fill in your Linear project details.
4. Start the service with `npm run dev -- WORKFLOW.md --port 3000`.
5. Open the dashboard or inspect the JSON API.

## Commands

- `npm run dev -- WORKFLOW.md --port 3000`
- `npm test`
- `npm run test:conformance`
- `npm run build`

## Interface Surface

- CLI: `symphony [path-to-WORKFLOW.md]`
- Optional flag: `--port <int>`
- Dashboard: `/`
- API: `/api/v1/state`
- API: `/api/v1/:issue`
- API: `/api/v1/refresh`

## Attribution Notes

Upstream attribution is intentionally kept in-repo, because this code makes the most sense when read as a fork of an existing idea rather than a greenfield product story. The upstream spec and README files remain here as source material for readers who want to compare the original model to this TypeScript implementation and see exactly what was carried forward, tightened, or made more visible.
