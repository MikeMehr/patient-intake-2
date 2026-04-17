-- Migration 047: Create emr_connections table for OSCAR EMR integration
CREATE TABLE IF NOT EXISTS emr_connections (
  id                  SERIAL PRIMARY KEY,
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vendor              VARCHAR(50) NOT NULL DEFAULT 'OSCAR',
  base_url            TEXT NOT NULL,
  client_key          TEXT NOT NULL,
  client_secret_enc   TEXT NOT NULL,
  access_token_enc    TEXT,
  token_secret_enc    TEXT,
  status              VARCHAR(50) NOT NULL DEFAULT 'not_connected',
  last_tested_at      TIMESTAMPTZ,
  token_issued_at     TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, vendor)
);
