-- Outbound patient-email audit log, one row per send attempt from mymd/emailPatient.jsp.
--
-- This table has existed on the live box since 2026-07-21 but its DDL was never captured in
-- the repo - it could only be inferred from the INSERT in emailPatient.jsp. Dumped from
-- production with SHOW CREATE TABLE on 2026-08-09 and committed here so a rebuild does not
-- have to reverse-engineer it.
--
-- The message_id / in_reply_to_id columns are added by mymd_inbox.sql, not here, so this
-- file stays a faithful record of the original table.

CREATE TABLE IF NOT EXISTS `mymd_patient_email_log` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `demographic_no` INT NOT NULL,
  `appointment_no` INT DEFAULT NULL,
  `provider_no`    VARCHAR(6) NOT NULL,
  `to_email`       VARCHAR(255) NOT NULL,
  `subject`        VARCHAR(255) NOT NULL,
  `body`           TEXT NOT NULL COMMENT 'full body including the auto-appended footer',
  `attachments`    VARCHAR(1000) DEFAULT NULL COMMENT 'names + sizes, truncated at 1000 chars',
  `status`         VARCHAR(16) NOT NULL COMMENT 'SENT | FAILED',
  `error_msg`      VARCHAR(512) DEFAULT NULL,
  `sent_datetime`  DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_demo` (`demographic_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
