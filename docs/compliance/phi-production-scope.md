# PHI Production Scope and Feature Boundary

## Purpose

Define exactly which workflows are in scope for PHI production use and which workflows must remain disabled unless separate controls, approvals, and BAAs are completed.

## In-Scope PHI Workflows (Production)

- Workforce authentication, authorization, and session management.
- Invitation token issuance, OTP verification, and scoped invitation sessions.
- Patient intake completion and chart/session persistence.
- Patient chart lookup and organization-scoped access to encounters.
- PHI audit logging for read/update/delete and session actions.
- Session retention cleanup for PHI-bearing stores.

## Out-of-Scope PHI Workflows (Disabled for Production PHI)

- External AI-assisted generation/translation/transcription routes when `HIPAA_MODE=true`.
  The following routes return HTTP 503 (fail-closed) when `HIPAA_MODE=true`:
  - `POST /api/history` — Google Gemini history generation (chief complaint)
  - `POST /api/analyze-lesion` — Azure OpenAI Vision image analysis (lesion photo)
  - `POST /api/analyze-med-pmh` — Azure OpenAI Vision image analysis (medication/PMH)
  - `POST /api/analyze-form` — Azure OpenAI form analysis
  - `POST /api/analyze-lab-report` — Azure OpenAI lab report analysis
  - `POST /api/interview` — Azure OpenAI interview generation
  - `POST /api/translate` — Azure OpenAI translation
  - `POST /api/speech/stt` — speech-to-text
  - `POST /api/speech/tts` — text-to-speech
  - `POST /api/speech/clean` — speech transcript cleaning
  - `POST /api/lab-requisitions/generate` — AI-assisted lab requisition PDF generation
  - `POST /api/physician/transcription/generate` — transcription generation
  - `POST /api/physician/transcription/ask-ai` — AI-assisted transcription
  - `POST /api/physician/translate-final-comments` — final comment translation
  - `POST /api/physician/hpi-actions` — HPI action generation
- Any vendor path marked `BAA status != executed` in `docs/compliance/vendor-baa-register.md`.
- Marketing claims or UI copy that asserts formal HIPAA compliance before legal sign-off.

## Required Runtime Boundary Controls

- `HIPAA_MODE=true` in production.
- `AUTH_ALLOW_SELF_REGISTER` unset or `false` in production.
- External AI/voice features return fail-closed responses in HIPAA mode.
- Vendor-specific PHI paths must remain disabled when corresponding BAAs are not executed.

## Production Launch Preconditions

- All required BAAs are executed and evidenced.
- Compliance artifact checklist in `docs/compliance/release-candidate-go-no-go.md` is fully checked.
- Launch evidence matrix items for operational/administrative controls are closed.
- Final sign-offs are recorded before enabling PHI production launch communications.

## Verification Evidence

- Runtime config and fail-closed checks for HIPAA mode.
- Security regression tests and route-level tests for gated AI/voice paths.
- Updated launch evidence matrix and release go/no-go report.
