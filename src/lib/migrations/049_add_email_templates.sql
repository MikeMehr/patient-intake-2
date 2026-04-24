-- Migration 049: Email templates and physician email settings

-- Global email templates (super admin master library)
CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Per-physician email templates (own + can shadow global)
CREATE TABLE IF NOT EXISTS physician_email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  physician_id UUID NOT NULL REFERENCES physicians(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  source_template_id UUID REFERENCES email_templates(id),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_physician_email_templates_physician
  ON physician_email_templates(physician_id)
  WHERE deleted_at IS NULL;

-- Per-physician default email body/signature
CREATE TABLE IF NOT EXISTS physician_email_settings (
  physician_id UUID PRIMARY KEY REFERENCES physicians(id) ON DELETE CASCADE,
  default_body TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
