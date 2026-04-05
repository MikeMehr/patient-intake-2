-- Migration 040: Add oscar_demographic_no to appointments and extend coverage_type constraint
-- oscar_demographic_no stores the Oscar EMR demographic number when the patient was
-- looked up or created in Oscar during booking.
-- EXISTING_OSCAR_PATIENT is added to the coverage_type constraint for patients whose
-- coverage info is already on file in Oscar (no need to re-collect it at booking).

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS chk_coverage_type;
ALTER TABLE appointments ADD CONSTRAINT chk_coverage_type CHECK (
  coverage_type IN (
    'CANADIAN_HEALTH_CARD',
    'PRIVATE_PAY',
    'TRAVEL_INSURANCE',
    'UNINSURED',
    'EXISTING_OSCAR_PATIENT'
  )
);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS oscar_demographic_no TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_oscar_demographic_no
  ON appointments (oscar_demographic_no)
  WHERE oscar_demographic_no IS NOT NULL;
