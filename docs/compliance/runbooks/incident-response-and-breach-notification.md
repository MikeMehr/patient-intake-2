# Incident Response and Breach Notification Runbook

## Purpose

Provide a repeatable process for identifying, containing, investigating, and reporting security incidents and potential HIPAA breaches.

## Scope

- Application: `patient-intake-2`
- Environments: staging and production
- Data classes: PHI, credentials, access logs, audit trails

## Roles

- Incident Commander: Security lead
- Technical Lead: Engineering lead
- Compliance Lead: Compliance officer
- Legal Lead: Legal counsel
- Communications Lead: Product/Operations

## Severity Levels

- Sev-1: Confirmed PHI breach or active unauthorized PHI exposure
- Sev-2: Suspected PHI exposure or critical security control failure
- Sev-3: Security event with no PHI exposure confirmed

## Workflow

1. Detect and triage
   - Validate alert source and timeframe.
   - Open incident ticket and assign commander.
2. Contain
   - Revoke active sessions/tokens where needed.
   - Disable affected routes/integrations if required.
   - Apply network and access containment controls.
3. Investigate
   - Capture logs, audit records, and system snapshots.
   - Establish affected users, records, and time window.
   - Determine if PHI breach criteria are met.
4. Eradicate and recover
   - Patch root cause.
   - Validate controls and monitor for recurrence.
5. Notify
   - If breach confirmed, execute legal/compliance notification workflow.
6. Post-incident review
   - Record lessons learned and corrective actions.

## Breach Notification Decision Points

- Confirmed unauthorized acquisition/access/use/disclosure of PHI.
- Low probability of compromise determination documented by compliance/legal if notification is not triggered.

## Notification Artifacts

- Internal incident summary
- Affected data and subject list
- Notification timeline log
- Notification templates:
  - impacted individuals
  - regulatory body
  - partner/business notification (as applicable)

## Evidence to Attach

- Incident timeline
- Technical evidence package (logs, audit events)
- Scope analysis and final determination memo
- Corrective action plan with owners and dates
