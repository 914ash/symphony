# Reliability Standards

## Minimum Expectations
- Explicit retries with bounded backoff for transient failures.
- Idempotency for externally triggered write operations.
- Timeouts on all network calls.
- Clear fail-fast behavior for invariant violations.

## Verification
- Unit tests for failure modes and retries.
- Integration tests for critical-path happy and sad paths.
- Runbook note for top failure scenarios.
