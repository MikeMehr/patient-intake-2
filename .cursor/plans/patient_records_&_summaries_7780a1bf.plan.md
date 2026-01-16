---
name: Patient Records & Summaries
overview: ""
todos:
  - id: schema
    content: Add patients and patient_summaries tables
    status: pending
  - id: api
    content: Add APIs to list patients, fetch/create summaries (org-scoped)
    status: pending
    dependencies:
      - schema
  - id: ui-page
    content: Build Patient Records page with list + detail view
    status: pending
    dependencies:
      - api
  - id: ai-context
    content: Include prior summaries in AI prompt when allowed
    status: pending
    dependencies:
      - api
---

# Patient Records & Summaries