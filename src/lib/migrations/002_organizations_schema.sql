-- Migration 002: Organizations and Multi-User Type Support
-- Adds organizations, organization admins, super admins, and extends physicians table

-- Organizations table
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    business_address TEXT NOT NULL,
    phone VARCHAR(50),
    fax VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Organization users table (for org admins)
CREATE TABLE IF NOT EXISTS organization_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'org_admin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE
);

-- Super admin users table
CREATE TABLE IF NOT EXISTS super_admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE
);

-- Add organization_id and phone to physicians table
ALTER TABLE physicians 
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS phone VARCHAR(50);

-- Update physician_sessions table to support multiple user types
ALTER TABLE physician_sessions
    ADD COLUMN IF NOT EXISTS user_type VARCHAR(50) DEFAULT 'provider',
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS user_id UUID; -- Generic user ID (can be physician_id, org_user_id, or super_admin_id)

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_organizations_email ON organizations(email);
CREATE INDEX IF NOT EXISTS idx_organizations_is_active ON organizations(is_active);
CREATE INDEX IF NOT EXISTS idx_organization_users_username ON organization_users(username);
CREATE INDEX IF NOT EXISTS idx_organization_users_email ON organization_users(email);
CREATE INDEX IF NOT EXISTS idx_organization_users_organization_id ON organization_users(organization_id);
CREATE INDEX IF NOT EXISTS idx_super_admin_users_username ON super_admin_users(username);
CREATE INDEX IF NOT EXISTS idx_super_admin_users_email ON super_admin_users(email);
CREATE INDEX IF NOT EXISTS idx_physicians_organization_id ON physicians(organization_id);
CREATE INDEX IF NOT EXISTS idx_physician_sessions_user_type ON physician_sessions(user_type);
CREATE INDEX IF NOT EXISTS idx_physician_sessions_user_id ON physician_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_physician_sessions_organization_id ON physician_sessions(organization_id);

-- Function to update updated_at timestamp for organizations
CREATE OR REPLACE FUNCTION update_organizations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update updated_at timestamp for organization_users
CREATE OR REPLACE FUNCTION update_organization_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update updated_at timestamp for super_admin_users
CREATE OR REPLACE FUNCTION update_super_admin_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to update updated_at
CREATE TRIGGER update_organizations_updated_at_trigger
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_organizations_updated_at();

CREATE TRIGGER update_organization_users_updated_at_trigger
    BEFORE UPDATE ON organization_users
    FOR EACH ROW EXECUTE FUNCTION update_organization_users_updated_at();

CREATE TRIGGER update_super_admin_users_updated_at_trigger
    BEFORE UPDATE ON super_admin_users
    FOR EACH ROW EXECUTE FUNCTION update_super_admin_users_updated_at();

