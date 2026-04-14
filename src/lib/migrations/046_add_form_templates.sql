-- Migration 046: Add form templates (super admin master library) and physician_forms
-- (per-physician copies, edits, and favourite flags)
--
-- Super Admin creates/deletes form_templates (no edit).
-- Each physician inherits all active templates at query time.
-- A physician_forms row "shadows" a template when the physician edits,
-- hides, or marks it as a favourite — the original template is untouched.

CREATE TABLE IF NOT EXISTS form_templates (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  questions    TEXT        NOT NULL,   -- numbered lines, e.g. "1. Do you have…\n2. …"
  category     TEXT,                   -- folder: "Family Doctors", "GI", "Rheum", etc.
  sort_order   INT         NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ             -- soft delete
);

CREATE TABLE IF NOT EXISTS physician_forms (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  physician_id       UUID        NOT NULL REFERENCES physicians(id) ON DELETE CASCADE,
  name               TEXT        NOT NULL,
  questions          TEXT        NOT NULL,
  category           TEXT,
  -- When non-NULL, this row shadows the matching form_templates row for this physician.
  -- Used for: edits (questions/name differ), favourites (is_favourite=true, no content change),
  --           and hides (deleted_at set, source_template_id set).
  source_template_id UUID        REFERENCES form_templates(id),
  is_favourite       BOOLEAN     NOT NULL DEFAULT FALSE,
  sort_order         INT         NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS physician_forms_physician_id_idx ON physician_forms(physician_id);
CREATE INDEX IF NOT EXISTS physician_forms_source_template_id_idx ON physician_forms(source_template_id);
