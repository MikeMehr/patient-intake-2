-- Initial Schema: Core tables for patient intake system

-- Physicians table
CREATE TABLE IF NOT EXISTS physicians (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    clinic_name VARCHAR(255) NOT NULL,
    unique_slug VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE
);

-- Physician sessions table (for authentication)
CREATE TABLE IF NOT EXISTS physician_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token VARCHAR(255) UNIQUE NOT NULL,
    physician_id UUID REFERENCES physicians(id) ON DELETE CASCADE,
    username VARCHAR(255) NOT NULL,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    clinic_name VARCHAR(255),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Patient sessions table (for patient intake data)
CREATE TABLE IF NOT EXISTS patient_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    physician_id UUID NOT NULL REFERENCES physicians(id) ON DELETE CASCADE,
    session_code VARCHAR(255) UNIQUE NOT NULL,
    patient_name VARCHAR(255) NOT NULL,
    patient_email VARCHAR(255) NOT NULL,
    chief_complaint TEXT NOT NULL,
    patient_profile JSONB NOT NULL,
    history JSONB NOT NULL,
    image_summary TEXT,
    image_url TEXT,
    image_name VARCHAR(255),
    completed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    viewed_by_physician BOOLEAN DEFAULT FALSE,
    viewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Password reset tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    physician_id UUID NOT NULL REFERENCES physicians(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_physicians_username ON physicians(username);
CREATE INDEX IF NOT EXISTS idx_physicians_email ON physicians(email);
CREATE INDEX IF NOT EXISTS idx_physicians_unique_slug ON physicians(unique_slug);
CREATE INDEX IF NOT EXISTS idx_physician_sessions_token ON physician_sessions(token);
CREATE INDEX IF NOT EXISTS idx_physician_sessions_physician_id ON physician_sessions(physician_id);
CREATE INDEX IF NOT EXISTS idx_patient_sessions_physician_id ON patient_sessions(physician_id);
CREATE INDEX IF NOT EXISTS idx_patient_sessions_session_code ON patient_sessions(session_code);
CREATE INDEX IF NOT EXISTS idx_patient_sessions_created_at ON patient_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_physician_id ON password_reset_tokens(physician_id);

