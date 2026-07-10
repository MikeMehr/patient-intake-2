-- Migration 059: Allow a slot to be rebooked after cancellation.
--
-- Problem
-- -------
-- appointments.slot_id had a plain UNIQUE constraint (appointments_slot_id_key),
-- meaning a slot could only ever have ONE appointment row. But cancelAppointment
-- soft-cancels (sets cancelled_at, keeps the row) and re-opens the slot back to
-- 'OPEN'. When that slot is booked again, confirmAppointment's INSERT collides
-- with the old cancelled row:
--   duplicate key value violates unique constraint "appointments_slot_id_key"
-- which surfaced as an unhandled 500 on POST /api/booking/[slug]/confirm.
--
-- Fix
-- ---
-- Replace the blanket UNIQUE with a PARTIAL unique index that only enforces
-- uniqueness among ACTIVE (non-cancelled) appointments. A slot may now hold many
-- cancelled rows (history) but at most one live booking — which is the real
-- invariant. The FK slot_id -> appointment_slots(id) is unaffected.

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_slot_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_appointment_per_slot
  ON appointments (slot_id)
  WHERE cancelled_at IS NULL;
