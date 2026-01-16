-- Add clinic_address to physicians
ALTER TABLE physicians
ADD COLUMN IF NOT EXISTS clinic_address TEXT;

