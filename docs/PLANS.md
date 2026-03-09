# Planning Workflow

Execution plans are first-class artifacts.

## When A Plan Is Required
Create or update a plan for:
- Multi-step work across files/components
- Refactors with behavioral risk
- Any task expected to take more than one focused coding session

## Where Plans Live
- Active: `docs/exec-plans/active/`
- Completed: `docs/exec-plans/completed/`

Use filename format: `YYYY-MM-DD-short-task-name.md`.

## Plan Template
Each plan should include:
- Objective
- Scope and non-goals
- Constraints and assumptions
- Step-by-step implementation plan
- Verification strategy
- Rollback/fallback strategy
- Status table (pending/in-progress/done)

## Execution Rule
Do not start broad implementation until plan steps and verification are explicit.
