-- MyMD patient-email inbox mirror for OSCAR.
--
-- Mirrors the info@mymdonline.ca mailbox (GoDaddy cPanel, IMAP) into oscar_db so inbound
-- patient email is visible inside OSCAR and linked to the chart. Written by
-- mymd_mail_sync.py; read by mymd/inbox.jsp and mymd/emailPatient.jsp.
--
-- Apply with:  sudo mysql oscar_db < mymd_inbox.sql
-- Idempotent - safe to re-run.
--
-- Charset note: oscar_db's own default is utf8mb3, but the existing mymd_* tables are
-- utf8mb4_0900_ai_ci. These follow the mymd_* convention explicitly, because email subjects
-- and names routinely contain characters utf8mb3 cannot hold (accents, emoji, CJK).
--
-- Truncation note: this server runs sql_mode=NO_ENGINE_SUBSTITUTION with NO strict mode, so
-- an over-long value is silently truncated rather than rejected. Every VARCHAR written from
-- the network is therefore also capped in mymd_mail_sync.py (see CAPS), so truncation is a
-- deliberate, visible decision instead of silent data loss.

-- ---------------------------------------------------------------------------------------
-- One row per mirrored message.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mymd_inbox_message` (
  `id`              INT NOT NULL AUTO_INCREMENT,
  `account`         VARCHAR(100) NOT NULL COMMENT 'mailbox address, e.g. info@mymdonline.ca',
  `folder`          VARCHAR(64)  NOT NULL COMMENT 'IMAP folder, e.g. INBOX or INBOX.Sent',
  `direction`       ENUM('IN','OUT') NOT NULL DEFAULT 'IN',

  -- Dedupe anchors. UID is only unique within a (folder, UIDVALIDITY) generation; if the
  -- server ever renumbers, UIDVALIDITY changes and the whole folder is rescanned.
  `uid_validity`    BIGINT NOT NULL,
  `imap_uid`        BIGINT NOT NULL,

  -- RFC 5322 threading headers.
  `message_id`      VARCHAR(255) DEFAULT NULL,
  `in_reply_to`     VARCHAR(255) DEFAULT NULL,
  `thread_refs`     TEXT         DEFAULT NULL COMMENT 'References header, space separated',

  `from_email`      VARCHAR(320) NOT NULL,
  `from_name`       VARCHAR(255) DEFAULT NULL,
  `to_emails`       TEXT         DEFAULT NULL,
  `cc_emails`       TEXT         DEFAULT NULL,
  `subject`         VARCHAR(998) DEFAULT NULL,

  -- body_text is always populated: either the text/plain part, or a tag-stripped rendition
  -- of the HTML. The UI renders this by default and only ever shows body_html inside a
  -- script-less sandboxed iframe.
  `body_text`       MEDIUMTEXT   DEFAULT NULL,
  `body_html`       MEDIUMTEXT   DEFAULT NULL,
  `has_attachments` TINYINT(1)   NOT NULL DEFAULT 0,

  -- Path to the stored .eml, relative to the storage root. The raw message is the source of
  -- truth: it survives a Roundcube delete, and it lets a later phase re-parse without going
  -- back to IMAP.
  `raw_path`        VARCHAR(255) DEFAULT NULL,
  -- Set when the message could not be fully parsed. The row is still created so the UID
  -- cursor advances - one malformed message must never wedge the mirror forever.
  `parse_error`     VARCHAR(255) DEFAULT NULL,

  -- Triage hints, so newsletters and bounces do not bury real patient mail in the queue.
  `auto_kind`       VARCHAR(12)  NOT NULL DEFAULT 'NORMAL' COMMENT 'NORMAL|BULK|AUTOREPLY|BOUNCE',
  `spam_score`      VARCHAR(64)  DEFAULT NULL COMMENT 'X-Spam-Status / X-Spam-Score, verbatim',

  -- sent_datetime is LOCAL time (America/Vancouver), matching mymd_patient_email_log.
  -- sent_datetime. Do not "clean this up" to UTC: the two are UNIONed into one chronological
  -- thread in emailPatient.jsp, and MySQL's CONVERT_TZ returns NULL on this box because the
  -- timezone tables were never loaded. All conversion happens in Python/Java.
  `sent_datetime`   DATETIME     DEFAULT NULL COMMENT 'Date: header, local time',
  `received_at`     DATETIME     NOT NULL COMMENT 'when this row was mirrored',

  -- Patient linkage. NULL until matched; match_method records how it happened so a bad
  -- auto-match rule can be found and re-run later. match_count is how many charts share the
  -- address, so the UI can say "3 charts share this address" instead of a bare "unassigned"
  -- - shared family addresses are normal here, not a data-quality bug.
  `demographic_no`  INT          DEFAULT NULL,
  `match_count`     SMALLINT     NOT NULL DEFAULT 0,
  `match_method`    VARCHAR(16)  DEFAULT NULL COMMENT 'EMAIL | MANUAL',

  `status`          VARCHAR(16)  NOT NULL DEFAULT 'NEW' COMMENT 'NEW | HANDLED | IGNORED',
  `handled_by`      VARCHAR(6)   DEFAULT NULL COMMENT 'provider_no',
  `handled_at`      DATETIME     DEFAULT NULL,

  PRIMARY KEY (`id`),
  -- The real dedupe key. Message-ID alone is not safe: it is absent on some mail and the
  -- same value legitimately appears in both INBOX and INBOX.Sent.
  UNIQUE KEY `uk_imap` (`account`, `folder`, `uid_validity`, `imap_uid`),
  KEY `ix_demo`   (`demographic_no`, `sent_datetime`),
  KEY `ix_status` (`status`, `sent_datetime`),
  KEY `ix_from`   (`from_email`(191)),
  KEY `ix_msgid`  (`message_id`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------------------
-- Attachments. Bytes live on disk under /var/lib/OscarDocument/oscar/mymd_inbox/, matching
-- how OSCAR stores documents: it keeps the nightly encrypted mysqldump small and puts the
-- files inside the existing offsite backup's OscarDocument tar.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mymd_inbox_attachment` (
  `id`            INT NOT NULL AUTO_INCREMENT,
  `message_id_fk` INT NOT NULL,
  `filename`      VARCHAR(255) NOT NULL COMMENT 'as supplied by the sender, path-stripped',
  `content_type`  VARCHAR(100) DEFAULT NULL,
  `size_bytes`    BIGINT NOT NULL DEFAULT 0,
  -- Relative to the inbox root. NULL means the part was over the size cap and was recorded
  -- but not stored - deliberately visible rather than silently dropped.
  `stored_path`   VARCHAR(500) DEFAULT NULL,
  `sha256`        CHAR(64) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_msg` (`message_id_fk`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------------------
-- Per-folder sync cursor. inbox.jsp renders last_run_at/last_status in the page header, so
-- a dead poller reads as an explicit error banner instead of an empty inbox.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mymd_inbox_sync_state` (
  `account`      VARCHAR(100) NOT NULL,
  `folder`       VARCHAR(64)  NOT NULL,
  `uid_validity` BIGINT NOT NULL DEFAULT 0,
  `last_uid`     BIGINT NOT NULL DEFAULT 0,
  `last_run_at`  DATETIME     DEFAULT NULL COMMENT 'every run, success or not',
  `last_ok_at`   DATETIME     DEFAULT NULL COMMENT 'last successful run; drives the stale banner',
  `last_status`  VARCHAR(16)  DEFAULT NULL COMMENT 'OK | ERROR',
  `last_error`   VARCHAR(500) DEFAULT NULL,
  -- cPHulk guard. GoDaddy throttles failed logins by source IP, so a poller retrying a wrong
  -- password every couple of minutes would get the clinic's own IP banned from its own
  -- webmail. At >= 3 consecutive auth failures the poller exits without connecting at all,
  -- until an operator clears this.
  `consecutive_errors` INT NOT NULL DEFAULT 0,
  `last_error_kind`    VARCHAR(16) DEFAULT NULL COMMENT 'AUTH | NETWORK | OTHER',
  PRIMARY KEY (`account`, `folder`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------------------
-- Who read what. emailPatient.jsp logs sends but not reads; PIPA wants both, and this is
-- patient correspondence.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mymd_inbox_access_log` (
  `id`            INT NOT NULL AUTO_INCREMENT,
  `provider_no`   VARCHAR(6) NOT NULL,
  `message_id_fk` INT NOT NULL,
  `action`        VARCHAR(16) NOT NULL COMMENT 'VIEW | ATTACH | ASSIGN | HANDLE | IGNORE',
  `detail`        VARCHAR(255) DEFAULT NULL,
  `at_datetime`   DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_msg`  (`message_id_fk`),
  KEY `ix_prov` (`provider_no`, `at_datetime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------------------
-- Extend the outbound log so a reply can be tied to the message it answers, and so a
-- mirrored INBOX.Sent copy can be deduped against the log instead of listed twice.
--
-- This box is MySQL 8.0.46, which does NOT support ALTER TABLE ... ADD COLUMN IF NOT EXISTS
-- (that is MariaDB only). Hence the information_schema guard, which keeps this file re-runnable.
-- ---------------------------------------------------------------------------------------
SET @add_msgid := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE mymd_patient_email_log ADD COLUMN message_id VARCHAR(255) NULL AFTER attachments',
    'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mymd_patient_email_log' AND COLUMN_NAME = 'message_id');
PREPARE st FROM @add_msgid; EXECUTE st; DEALLOCATE PREPARE st;

SET @add_reply := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE mymd_patient_email_log ADD COLUMN in_reply_to_id INT NULL AFTER message_id',
    'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mymd_patient_email_log' AND COLUMN_NAME = 'in_reply_to_id');
PREPARE st FROM @add_reply; EXECUTE st; DEALLOCATE PREPARE st;

SET @add_idx := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE mymd_patient_email_log ADD KEY ix_msgid (message_id(191))',
    'DO 0')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mymd_patient_email_log' AND INDEX_NAME = 'ix_msgid');
PREPARE st FROM @add_idx; EXECUTE st; DEALLOCATE PREPARE st;
