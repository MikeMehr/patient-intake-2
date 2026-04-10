-- Migration: Add provider_assistants table
-- Assistants are linked to a specific physician and share access to their dashboard.

CREATE TABLE IF NOT EXISTS provider_assistants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    physician_id UUID NOT NULL REFERENCES physicians(id) ON DELETE CASCADE,
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_provider_assistants_physician_id ON provider_assistants(physician_id);
CREATE INDEX IF NOT EXISTS idx_provider_assistants_username ON provider_assistants(username);
CREATE INDEX IF NOT EXISTS idx_provider_assistants_email ON provider_assistants(email);
