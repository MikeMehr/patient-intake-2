# Monitoring and Alert Validation Evidence

- Validation date: 2026-03-02
- System: `patient-intake-2`
- Operator: Manucher Mehraein

## Alert Catalog

### MON-AUTH-01: Repeated Authentication Failures

- Objective: detect brute-force/auth abuse activity.
- Signal: increased failed login/OTP verification events.
- Expected response: investigate source, enforce rate limits, and review account lock/step-up controls.

### MON-PHI-01: PHI Route Error/Failure Spike

- Objective: detect instability on PHI-relevant endpoints.
- Signal: sustained 5xx or abnormal failure pattern on PHI routes.
- Expected response: incident triage, rollback/containment decision, and validation of PHI boundary controls.

### MON-REL-01: Reliability Degradation

- Objective: detect sustained service degradation.
- Signal: elevated 5xx/error rate and degraded response time.
- Expected response: on-call investigation and incident response runbook execution where thresholds are met.

## Validation Activity

1. Reviewed current monitoring requirements in:
   - `docs/compliance/operational-safeguards.md`
   - `DEPLOYMENT.md` (telemetry hygiene and platform notes)
2. Confirmed incident handling pathway references:
   - `docs/compliance/runbooks/incident-response-and-breach-notification.md`
3. Confirmed request metadata logging path for operational telemetry:
   - `src/lib/request-metadata.ts`
   - route-level `logRequestMeta(...)` usage patterns in API handlers.

Status: implemented_attested

## Follow-up Requirement

- Maintain monthly review log with alert threshold tuning notes.
- Attach platform-specific alert rule identifiers/export links when available.

## Approval

- Approver: Manucher Mehraein
- Date: 2026-03-02
