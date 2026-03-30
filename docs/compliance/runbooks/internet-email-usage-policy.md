# Internet and Email Usage Policy

## Purpose

Define acceptable use of internet access, email, and electronic communications for all
workforce members (employees, contractors, and authorized collaborators) of Health Assist AI,
and establish safeguards that protect patient PHI, confidential business data, and the
integrity of the platform.

This policy satisfies the administrative safeguard requirement under HIPAA Security Rule
§164.308(a)(1) (Risk Management) and §164.308(a)(5) (Security Awareness and Training),
and is a required acknowledgment in all employment and contractor agreements.

## Scope

This policy applies to:
- All workforce members with access to Health Assist AI systems, repositories, or data
- All devices (company-issued or personal/BYOD) used to access Health Assist AI systems
- All forms of electronic communication: email, chat, file sharing, and web browsing
- All environments: production, staging, and development

## Acceptable Use

### General Principles

- Internet and email access is provided for business purposes. Incidental personal use is
  permitted provided it does not interfere with job duties, consume excessive resources,
  or violate any provision of this policy.
- Workforce members must use good judgment. If an activity would be inappropriate in a
  professional setting, it is inappropriate on Health Assist AI systems.
- Workforce members are responsible for all activity conducted under their credentials.

### Email

- Use your Health Assist AI email account (or approved business account) for all
  business communications.
- Do not transmit PHI via unencrypted email. Patient health information must be shared
  only through the Health Assist AI platform portal or via encrypted, BAA-covered channels.
- Do not use personal email accounts (Gmail, iCloud, Hotmail, etc.) to send, receive, or
  store business-related PHI or confidential data.
- Be alert to phishing attempts. Do not click unsolicited links or open unexpected
  attachments. Report suspicious email to the Security Officer immediately.
- Email is not guaranteed to be private. Health Assist AI may monitor business email
  accounts for security compliance purposes.

### Internet Access

- Do not visit sites that host malicious, illegal, or inappropriate content.
- Do not download software, browser extensions, or plugins onto devices used for
  Health Assist AI work without prior approval from the Security Officer.
- Do not use public or unsecured Wi-Fi networks to access production systems or PHI
  without an active VPN or equivalent encrypted tunnel.
- Do not use browser-based AI tools (e.g., ChatGPT, Gemini) to process, paste, or
  upload any PHI, patient data, or confidential business information.

### File Sharing and Cloud Storage

- Do not store PHI or confidential business data in personal cloud storage accounts
  (Google Drive, Dropbox, iCloud, OneDrive personal, etc.).
- Approved storage for PHI: Health Assist AI production database (Azure PostgreSQL) and
  authorized Azure storage resources only.
- File transfers of confidential data must use encrypted channels.

### Social Media

- Do not post PHI, patient case details, screenshots of the platform, or confidential
  business information on social media or public forums.
- Do not represent personal opinions as the position of Health Assist AI without explicit
  authorization.

## Prohibited Activities

The following are strictly prohibited and may result in immediate termination and legal action:

- Accessing, transmitting, or storing PHI outside of approved Health Assist AI systems
- Sharing credentials with any other person
- Circumventing security controls (VPN, MFA, rate limiting, access controls)
- Using Health Assist AI systems or internet access for illegal activity of any kind
- Downloading, storing, or distributing copyrighted material without a valid license
- Installing unauthorized software on devices used to access Health Assist AI systems
- Accessing systems or data beyond the scope of your role (unauthorized access)
- Using personal email or unapproved messaging apps (WhatsApp, Signal personal accounts,
  SMS) to transmit PHI or confidential business data

## PHI-Specific Rules

- PHI must never leave the approved production environment except through explicitly
  authorized exports that are logged and governed by the minimum necessary standard.
- PHI must not be included in bug reports, support tickets, Slack messages, or
  GitHub issues. Use de-identified or synthetic test data for all debugging.
- PHI must not be stored in development or staging environments.
- Any accidental PHI exposure (email mis-send, file upload to wrong location, etc.)
  must be reported to the Security Officer within 1 hour of discovery.

## Monitoring

Health Assist AI reserves the right to monitor, log, and audit:
- Access to production systems and PHI
- Authentication events and session activity
- Email and file transfer activity on company systems

Monitoring is performed to protect patient data, maintain platform integrity, and ensure
policy compliance. Workforce members have no expectation of privacy on company systems.

## Incident Reporting

Any suspected or confirmed policy violation, phishing attempt, malware, or data incident
must be reported immediately to:

- **Security Officer:** Manucher Mehraein
- **Reporting method:** Direct notification (in person, phone, or secure message)
- **Escalation:** Follow the incident response runbook at
  `docs/compliance/runbooks/incident-response-and-breach-notification.md`

Failure to report a known or suspected incident is itself a policy violation.

## Sanctions

Violations of this policy are subject to the sanctions policy, up to and including:
- Written warning and mandatory retraining
- Revocation of system access
- Termination of employment or contract
- Civil or criminal referral where applicable

## Acknowledgment Requirement

All workforce members must sign or digitally acknowledge this policy:
- Before receiving access to any Health Assist AI system
- Annually at policy refresh
- Immediately following any material policy update

Acknowledgment records are maintained in `docs/compliance/evidence/`.

## Governance

- Policy owner: Security Officer
- Policy approver: Manucher Mehraein
- Effective date: 2026-03-30
- Last review: 2026-03-30
- Next review: 2027-03-30
- Review cadence: Annual, and immediately following any significant incident or regulatory change

## Related Documents

- `docs/compliance/runbooks/incident-response-and-breach-notification.md`
- `docs/compliance/runbooks/password-policy.md`
- `docs/compliance/runbooks/password-context-word-policy.md`
- `docs/compliance/runbooks/access-provisioning-and-review-sop.md`
- `docs/compliance/runbooks/file-upload-security.md`
- `docs/compliance/administrative-safeguards.md`
- `docs/compliance/physical-safeguards.md`
- `src/app/privacy/page.tsx` (public-facing Privacy Policy)
