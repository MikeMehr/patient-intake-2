# ASVS V1 L2 Runbook (Encoding and Sanitization)

This runbook maps ASVS V1 L2 control evidence for controls currently in scope:
`V1.1.1`, `V1.1.2`, `V1.3.4`, `V1.3.6`, `V1.3.7`, `V1.3.10`, `V1.3.11`, `V1.5.2`.

## Control Coverage

- `V1.1.1` Canonicalization before processing
  - Code: `src/lib/canonicalization.ts`, `src/lib/patient-phi.ts`, `src/lib/lab-requisition-mapping.ts`
  - Tests: `src/lib/patient-phi.test.ts`, `src/lib/security-regressions.test.ts`

- `V1.1.2` Output encoding/escaping before interpreter use
  - Code: `src/app/physician/view/page.tsx`, `public/eforms/1.1LabRequisition/LabDecisionSupport4_Feb2019.js`, `src/proxy.ts`
  - Tests: `src/lib/security-regressions.test.ts`

- `V1.3.4` Command injection resistance
  - Code: server routes avoid shell execution primitives in workflow paths
  - Tests: `src/lib/security-regressions.test.ts`

- `V1.3.6` SSRF protections on outbound calls
  - Code: `src/lib/outbound-url.ts`, `src/lib/oscar/client.ts`, `src/app/api/admin/organizations/[id]/emr/oscar/route.ts`, `src/lib/invitation-pdf-summary.ts`, `src/app/api/speech/stt/route.ts`, `src/app/api/speech/tts/route.ts`
  - Tests: `src/lib/outbound-url.test.ts`, `src/app/api/admin/organizations/[id]/emr/oscar/route.test.ts`, `src/app/api/speech/tts/route.test.ts`, `src/lib/invitation-pdf-summary.test.ts`

- `V1.3.7` Template/code-injection resistance
  - Code: callback-based timers in lab eForm and CSP tightening in `src/proxy.ts` for non-eForm routes
  - Tests: `src/lib/security-regressions.test.ts`

- `V1.3.10` Format-string safety
  - Code: no untrusted format-template execution introduced in target routes, plus safe JSON parsing in model-output flows (`src/lib/safe-json.ts`, `src/app/api/lab-requisitions/generate/route.ts`, `src/app/api/physician/transcription/generate/route.ts`)
  - Tests: `src/lib/safe-json.test.ts`, `src/app/api/lab-requisitions/generate/route.test.ts`

- `V1.3.11` Mail/system interpreter injection safety
  - Code: canonicalization and strict parsing utilities used ahead of downstream processing; unsafe HTML sink removal in affected UI/eForm path
  - Tests: `src/lib/security-regressions.test.ts`

- `V1.5.2` Safe deserialization of untrusted data
  - Code: `src/lib/safe-json.ts`, `src/lib/auth.ts`, `src/lib/patient-phi.ts`, `src/app/api/history/route.ts`, `src/app/api/lab-requisitions/generate/route.ts`, `src/app/api/physician/transcription/generate/route.ts`, `src/app/api/emr/oscar/patient-details/route.ts`
  - Tests: `src/lib/safe-json.test.ts`, `src/lib/auth.test.ts`, `src/lib/patient-phi.test.ts`, `src/app/api/lab-requisitions/generate/route.test.ts`

## Review Cadence

- Security review owner: Engineering/Security
- Re-review trigger: any new outbound integration, parser change, or eForm/templating change
- Periodic review: monthly with ASVS CSV refresh
