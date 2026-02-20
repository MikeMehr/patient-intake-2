-- Migration 019: HIPAA-first transcription snapshot model
-- Canonical SOAP versions + export attempts + pointer-based workflow records.

ALTER TABLE patient_encounters
  ADD COLUMN IF NOT EXISTS encounter_type TEXT NOT NULL DEFAULT 'guided_interview';

ALTER TABLE patient_encounters
  ADD COLUMN IF NOT EXISTS current_soap_version_id UUID;

CREATE TABLE IF NOT EXISTS soap_note_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES patient_encounters(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  physician_id UUID REFERENCES physicians(id) ON DELETE SET NULL,
  version INTEGER NOT NULL,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('DRAFT', 'FINALIZED_FOR_EXPORT')),
  subjective TEXT NOT NULL DEFAULT '',
  objective TEXT NOT NULL DEFAULT '',
  assessment TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  draft_transcript TEXT,
  finalized_for_export_at TIMESTAMP WITH TIME ZONE,
  finalized_by UUID REFERENCES physicians(id) ON DELETE SET NULL,
  content_hash TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_soap_note_versions_encounter_version
  ON soap_note_versions(encounter_id, version);

CREATE INDEX IF NOT EXISTS idx_soap_note_versions_encounter_created
  ON soap_note_versions(encounter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_soap_note_versions_patient_created
  ON soap_note_versions(patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_soap_note_versions_lifecycle
  ON soap_note_versions(lifecycle_state);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_patient_encounters_current_soap_version'
  ) THEN
    ALTER TABLE patient_encounters
      ADD CONSTRAINT fk_patient_encounters_current_soap_version
      FOREIGN KEY (current_soap_version_id)
      REFERENCES soap_note_versions(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS physician_transcription_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  physician_id UUID NOT NULL REFERENCES physicians(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id UUID NOT NULL REFERENCES patient_encounters(id) ON DELETE CASCADE,
  soap_version_id UUID NOT NULL REFERENCES soap_note_versions(id) ON DELETE CASCADE,
  preview_summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_physician_transcription_sessions_physician_created
  ON physician_transcription_sessions(physician_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_physician_transcription_sessions_patient_created
  ON physician_transcription_sessions(patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS emr_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  soap_version_id UUID NOT NULL REFERENCES soap_note_versions(id) ON DELETE CASCADE,
  encounter_id UUID NOT NULL REFERENCES patient_encounters(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  physician_id UUID REFERENCES physicians(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  idempotency_key TEXT NOT NULL,
  external_reference_id TEXT,
  destination_system TEXT,
  destination_clinic TEXT,
  export_method TEXT NOT NULL DEFAULT 'manual_copy_paste',
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_emr_exports_version_idempotency
  ON emr_exports(soap_version_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_emr_exports_encounter_created
  ON emr_exports(encounter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_emr_exports_status_created
  ON emr_exports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS physician_phi_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  physician_id UUID REFERENCES physicians(id) ON DELETE SET NULL,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  encounter_id UUID REFERENCES patient_encounters(id) ON DELETE SET NULL,
  soap_version_id UUID REFERENCES soap_note_versions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_physician_phi_audit_physician_created
  ON physician_phi_audit_log(physician_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_physician_phi_audit_patient_created
  ON physician_phi_audit_log(patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_physician_phi_audit_event_created
  ON physician_phi_audit_log(event_type, created_at DESC);
