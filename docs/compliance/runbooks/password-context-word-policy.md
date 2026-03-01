# Password Context-Word Policy (ASVS V6.1.2)

## Purpose

Define and maintain the context-specific words that must not be allowed in workforce and patient-facing passwords.

## Scope

- Account creation and password reset/change flows
- Workforce users (super admin, org admin, provider)
- Patient-facing authentication where password rules apply

## Control Mapping

- ASVS control: `V6.1.2`
- Related enforcement control: `V6.2.11`

## Context-Word Categories

The denylist must include organization-specific and deployment-specific terms that make passwords easy to guess:

- Organization names and aliases
  - legal entity name(s)
  - clinic/brand abbreviations
- Product and application identifiers
  - `health-assist`, `healthassist`, `mymd`
  - public domain names and host labels
- Environment and system identifiers
  - environment tags (for example: `prod`, `staging`, `dev`)
  - internal system or tenant names used in user communications
- Department and role words
  - `admin`, `provider`, `doctor`, `physician`, `support`
  - approved business-unit terms

## Normalization and Matching Rules

Inputs are normalized before comparison:

- case-insensitive comparison
- strip whitespace and common separators (`-`, `_`, `.`, `/`)
- include obvious permutations and common substitutions
  - examples: `healthassist`, `health-assist`, `h3althassist`
- check both full password and substantial substrings against denylist tokens

## Governance

- Control owner: Security + Engineering
- Policy approver: Security lead (and Compliance when required)
- Last review: 2026-02-26
- Next review: 2026-03-26
- Review cadence: monthly, and immediately after:
  - rebranding/domain changes
  - new tenant/clinic naming patterns
  - security incident requiring password policy updates

## Change Control Procedure

1. Security proposes denylist updates.
2. Engineering validates impact and compatibility in auth flows.
3. Changes are reviewed and approved in PR with security reviewer.
4. Evidence links are updated in `docs/compliance/launch-evidence-matrix.md`.
5. Changes are communicated to affected teams.

## Emergency Update Procedure

For active threat intelligence or incident response:

1. Security creates expedited denylist additions.
2. Engineering deploys as urgent security change.
3. Post-deploy validation is recorded the same day.
4. Normal governance review is completed within 2 business days.

## Required Evidence for Audit

- Current version of this policy and approval history
- Linked implementation references for password checks
- Test evidence showing blocked context-word patterns
- Reviewer verification notes and closure record in the launch evidence matrix
