# Backup and Restore Drill Report

- Drill date: 2026-03-02
- Owner: Manucher Mehraein (Ops)
- Environment: Staging (production-like)

## Scenario Coverage

1. Full environment restore simulation
2. Point-in-time data restore simulation
3. Selective dataset restore simulation

## Timing and Targets

- Target RTO: 4 hours
- Target RPO: 1 hour
- Observed RTO: 2 hours 10 minutes
- Observed RPO: 35 minutes
- Result: within target

## Integrity and Access Validation

- Application boot and authentication checks: pass
- PHI route authorization checks: pass
- Audit logging path validation: pass

## Corrective Actions

- No blocking issues identified.
- Next scheduled drill: 2026-06-02

## Approval

- Ops approver: Manucher Mehraein
- Approval date: 2026-03-02
