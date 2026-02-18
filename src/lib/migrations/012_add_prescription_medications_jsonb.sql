-- Migration 012: Add medications JSONB array to prescriptions
ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS medications JSONB;
