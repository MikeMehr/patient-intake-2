-- Per-patient online-booking blocks, toggled from the OSCAR Master Chart
-- ("Block online booking" button on demographiccontrol.jsp — see
-- infrastructure/oscar-patches/booking-block/). A blocked patient who tries to
-- book online is shown the clinic's email address and asked to write in instead.
--
-- Keyed by the OSCAR demographic_no rather than the sparse patients table: the
-- booking flow resolves a demographic_no for every existing patient it matches
-- (lookup-patient), so this is the one identifier both sides agree on.

CREATE TABLE IF NOT EXISTS booking_blocks (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  oscar_demographic_no TEXT        NOT NULL,
  -- OSCAR provider_no of whoever clicked the button; free text, audit only.
  blocked_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, oscar_demographic_no)
);
