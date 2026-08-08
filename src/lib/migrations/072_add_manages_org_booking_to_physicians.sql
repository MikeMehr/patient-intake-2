-- Migration 072: let a physician also run their clinic's Online Booking Dashboard
-- without a second account.
--
-- Until now a physician-owner needed two logins — an organization_users row for /org/*
-- and a physicians row for /physician/* — and because there is one session cookie for
-- all account types, reaching one meant logging out of the other. This turns Booking
-- Dashboard access into a permission on the physician account instead of a second
-- identity, so one session serves both surfaces at the same time.
--
-- Scope: the booking surface (documents, appointments, slots, settings, video invites).
-- Deliberately NOT included: creating providers, editing another provider's credentials,
-- minting their MFA backup codes, or terminating org-wide sessions. Those stay
-- organization_users-only. See getOrgAdminContext() in src/lib/auth-helpers.ts.
--
-- The grant is read live per request rather than snapshotted into physician_sessions
-- .session_data, so revoking it takes effect immediately WITHOUT logging the physician
-- out of an in-progress recording.
ALTER TABLE physicians
  ADD COLUMN IF NOT EXISTS manages_org_booking BOOLEAN NOT NULL DEFAULT FALSE;

-- created_by_user_id on both document tables holds a bare UUID with no FK. Before this
-- migration it was always an organization_users.id; a granted physician can now create
-- these rows too, so the id alone no longer identifies which table it points at. Record
-- the account type alongside it to keep the PHI-share audit trail unambiguous.
ALTER TABLE patient_document_requests
  ADD COLUMN IF NOT EXISTS created_by_user_type TEXT;

ALTER TABLE document_shares
  ADD COLUMN IF NOT EXISTS created_by_user_type TEXT;
