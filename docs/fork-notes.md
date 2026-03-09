# Fork Notes

## Positioning

This repo is a fork-oriented implementation effort, not a claim of inventing the Symphony specification from scratch.

## What The Public Story Should Emphasize

- the TypeScript implementation choices visible in this repo
- the dashboard and API surfaces used to inspect active runs
- the verification-aware run lifecycle
- the write-back and completion controls around outside systems such as Linear

## Publication Notes

- local `WORKFLOW.md` was removed from the public repo path
- runtime logs and pid files were removed
- local worktree and workspace artifacts were removed
- `.env` is ignored and replaced with `.env.example`

## Reader Takeaway

The point of the fork is practical: make runs easier to inspect, make completion rules easier to trust, and keep the service small enough to read.
