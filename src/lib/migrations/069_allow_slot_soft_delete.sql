-- Migration 069: Allow soft-deleting appointment slots
-- A slot that was ever booked is still referenced by its (cancelled)
-- appointment row, so the FK from appointments.slot_id blocks a hard DELETE.
-- Those slots are soft-deleted instead: status = 'DELETED'. Every slot
-- listing filters by an explicit status whitelist, so DELETED slots are
-- invisible to both the org admin and public booking pages while the
-- appointment history keeps its start/end times.

ALTER TABLE appointment_slots DROP CONSTRAINT IF EXISTS chk_slot_status;
ALTER TABLE appointment_slots ADD CONSTRAINT chk_slot_status
  CHECK (status IN ('OPEN', 'BLOCKED', 'HELD', 'BOOKED', 'DELETED'));
