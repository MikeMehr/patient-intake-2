-- Migration 036: Add booking support to existing tables
-- Adds a public slug to organizations for /booking/[clinicSlug] routing,
-- and a per-physician flag for online booking eligibility.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS slug VARCHAR UNIQUE;

ALTER TABLE physicians
  ADD COLUMN IF NOT EXISTS online_booking_enabled BOOLEAN NOT NULL DEFAULT FALSE;
