-- Compose mode (2026-08-17): emailPatient.jsp?compose=1 sends free-form email with no
-- patient context, so the outbound log's demographic_no must accept NULL. Everything else
-- about the log row is unchanged; NULL demographic_no now means "not linked to a chart".
--
-- Safe to re-run (MODIFY is idempotent). Applied to production 2026-08-17.

ALTER TABLE `mymd_patient_email_log` MODIFY `demographic_no` INT NULL;
