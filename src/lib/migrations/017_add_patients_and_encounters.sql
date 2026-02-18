-- Migration 017: Add patients + patient encounters (guided interview charting)
-- Patients are org-scoped (when organization_id exists) and can be linked to OSCAR demographicNo.
-- HIN is stored encrypted (app-layer) and hashed for lookup.

-- Patients table
CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    primary_physician_id UUID REFERENCES physicians(id) ON DELETE SET NULL,
    oscar_demographic_no TEXT,
    first_name TEXT,
    last_name TEXT,
    full_name TEXT NOT NULL,
    date_of_birth DATE,
    email TEXT,
    primary_phone TEXT,
    secondary_phone TEXT,
    address TEXT,
    hin_enc TEXT,
    hin_hash TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Keep updated_at current for patients
CREATE OR REPLACE FUNCTION update_patients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_patients_updated_at_trigger'
    ) THEN
        CREATE TRIGGER update_patients_updated_at_trigger
            BEFORE UPDATE ON patients
            FOR EACH ROW EXECUTE FUNCTION update_patients_updated_at();
    END IF;
END;
$$;

-- Indexes for patients
CREATE INDEX IF NOT EXISTS idx_patients_org_full_name_lower
    ON patients (organization_id, lower(full_name));

CREATE INDEX IF NOT EXISTS idx_patients_org_dob
    ON patients (organization_id, date_of_birth);

-- OSCAR demographicNo uniqueness within org when present
CREATE UNIQUE INDEX IF NOT EXISTS uq_patients_org_oscar_demographic_no
    ON patients (organization_id, oscar_demographic_no)
    WHERE oscar_demographic_no IS NOT NULL AND oscar_demographic_no <> '';

-- HIN hash uniqueness within org when present
CREATE UNIQUE INDEX IF NOT EXISTS uq_patients_org_hin_hash
    ON patients (organization_id, hin_hash)
    WHERE hin_hash IS NOT NULL AND hin_hash <> '';

-- Encounters table (each completed guided interview becomes an encounter)
CREATE TABLE IF NOT EXISTS patient_encounters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    physician_id UUID REFERENCES physicians(id) ON DELETE SET NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    source_session_code TEXT,
    chief_complaint TEXT,
    hpi_json JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_patient_encounters_patient_occurred_at_desc
    ON patient_encounters (patient_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_encounters_org_occurred_at_desc
    ON patient_encounters (organization_id, occurred_at DESC);

-- Prevent duplicate inserts for the same intake session (when a link exists)
CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_encounters_patient_source_session
    ON patient_encounters (patient_id, source_session_code)
    WHERE source_session_code IS NOT NULL AND source_session_code <> '';

