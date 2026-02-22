# Temporary Risk Acceptance - P0-4b Transitive Vulnerabilities

## Document Control

- **Status:** Active (temporary)
- **Date Created:** 2026-02-22
- **Owner:** Engineering / Security
- **Repository:** `patient-intake-2`
- **Branch Context:** `security/hipaa-hardening-phase1`
- **Related Work:** P0-4 dependency hardening commit `afc218a`

## 1) Finding Summary

After completing non-breaking dependency remediation in P0-4 (`npm audit fix` without `--force`), the remaining high-severity findings are transitive and tied to the `minimatch <10.2.1` advisory chain.

- Current residual count after P0-4: **18 high**
- Affected chain is primarily within lint/tooling ecosystem dependencies.
- `npm audit` indicates complete auto-remediation requires breaking upgrades (`npm audit fix --force`, including eslint major-version migration path).

## 2) Business Context

This project is in launch hardening with PHI-sensitive workflows. The near-term goal is to reduce exploitable runtime risk while preserving workflow stability and avoiding high-churn breaking changes immediately before launch.

## 3) Risk Decision

- **Decision:** Temporarily accept residual transitive dependency risk from the `minimatch` chain.
- **Rationale:** Full remediation currently requires breaking lint-stack upgrades and broader compatibility validation not suitable for immediate pre-launch freeze window.
- **Expiration Date:** 2026-03-31 (or earlier if P0-4b completes).

## 4) Compensating Controls

The following controls must remain in effect during the exception period:

1. Use lockfile-based installs only (`npm ci`) in CI/CD and release builds.
2. Do not run ad-hoc dependency installs in production build pipeline.
3. Build and deploy only from reviewed, protected branches.
4. Keep dependency updates isolated to dedicated security branches.
5. Continue periodic `npm audit --audit-level=high` checks and document changes.

## 5) Exit Criteria (Exception Closure)

This risk acceptance is considered closed only when all of the following are complete:

1. Controlled lint-stack migration branch is completed (`security/p0-4b-eslint-migration` or equivalent).
2. Residual `minimatch` advisory chain is remediated or reduced to an approved low-risk state.
3. Validation passes:
   - `npm run lint`
   - `npm test`
   - `npm run build`
   - smoke tests for `/auth/login` and `/physician/view`
4. PR includes before/after `npm audit` evidence and dependency diff summary.

## 6) Execution Plan (P0-4b)

1. Create dedicated migration branch.
2. Capture baseline:
   - `npm audit --audit-level=high`
   - `npm ls minimatch eslint eslint-config-next`
3. Perform lint/tooling dependency upgrades in isolation.
4. Resolve lint/config incompatibilities.
5. Re-run validation gates and smoke checks.
6. Document final audit delta and close this exception.

## 7) Approval Record

- **Engineering Lead:** ____________________  **Date:** __________
- **Security/Compliance:** __________________  **Date:** __________
- **Product/Launch Owner:** ________________  **Date:** __________

