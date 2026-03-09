# Quality Score

Use this rubric to quantify technical quality and track entropy.

Scoring scale per category: `0` (unacceptable) to `5` (excellent).

## Categories
1. Reliability: correctness, deterministic behavior, failure handling.
2. Security: authn/authz, input validation, secret handling, least privilege.
3. Observability: logs/metrics/traces, diagnosability, alertability.
4. Maintainability: readability, modularity, testability, docs freshness.
5. Operability: deploy safety, rollback path, runbook clarity.

## Current Baseline
- Reliability: 2
- Security: 2
- Observability: 1
- Maintainability: 2
- Operability: 1
- Total: 8/25

## Rules
- Re-score after major changes or incidents.
- Any category below `2` blocks "done" status for critical-path work.
- Link score changes to concrete evidence (tests, dashboards, docs, or code diffs).
