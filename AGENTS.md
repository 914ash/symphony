# Harness Engineering Setup

This workspace is configured to follow the Harness Engineering approach.

## Priority Order
1. Legibility over cleverness.
2. Consistency over local optimization.
3. Correctness over speed.
4. Throughput via many small, safe iterations.

## Navigation Order
When context is needed, read in this order:
1. `AGENTS.md` (this file)
2. `ARCHITECTURE.md`
3. `docs/QUALITY_SCORE.md`
4. `docs/PLANS.md`
5. `docs/design-docs/core-beliefs.md`
6. Active plan in `docs/exec-plans/active/`
7. `docs/exec-plans/tech-debt-tracker.md`
8. Product intent in `docs/product-specs/`
9. References in `docs/references/`

## Human Lane vs Agent Lane
- Human lane: intent, priorities, and final tradeoff decisions.
- Agent lane: planning, implementation, tests, docs updates, and cleanup.
- If intent is ambiguous, state assumptions explicitly and proceed with the safest reversible path.

## Required Working Loop
1. Frame the task and constraints in writing.
2. For non-trivial work, create/update an execution plan in `docs/exec-plans/active/`.
3. Implement the smallest useful slice.
4. Verify with tests/checks.
5. Update docs and architecture notes in the same change.
6. Record debt explicitly in `docs/exec-plans/tech-debt-tracker.md`.
7. Re-score quality in `docs/QUALITY_SCORE.md` when risk profile changed.

## Non-Negotiable Engineering Rules
- Define and validate invariants at every boundary.
- Keep interfaces stable; evolve internals behind those interfaces.
- Prefer explicit types/schemas and deterministic behavior.
- Fail loud with actionable errors; no silent degradation on critical paths.
- Instrument critical paths (logs, metrics, traces) before scaling complexity.
- Remove dead code and stale docs quickly.
- Avoid broad rewrites when focused edits can preserve momentum.

## Golden Principles (Entropy Control)
Treat these as defaults for code review and design:
- Surface area is liability.
- Hidden state is a bug magnet.
- Every boundary needs explicit contracts.
- Boring choices win on critical paths.
- Make rollback and repair fast.
- Documentation is operational memory, not decoration.

## Definition Of Done
Work is done only when:
- Behavior is implemented and tested.
- Relevant docs are updated.
- Any new debt is logged with owner, impact, and exit criteria.
- Quality score and plan status reflect the new state.
