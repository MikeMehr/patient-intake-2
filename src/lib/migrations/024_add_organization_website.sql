-- Migration 024: Add website URL to organizations for patient post-submit redirect

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS website_url VARCHAR(512);

