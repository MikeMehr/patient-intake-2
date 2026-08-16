-- Cache + audit trail for AI fax triage.
--
-- One row per physical fax. The cache matters: Incoming Docs reloads the whole page on every
-- Next/Previous, so without it a physician paging back and forth would re-OCR the same fax
-- repeatedly. `payload` is the raw response from Health Assist; a row with a NULL payload records
-- a call that failed.
--
-- fax_ref is a SHA-256 prefix of queueId|pdfDir|pdfName|mtime|size, not the filename, so the
-- sender's fax number does not become the cache key — and an in-place edit (Extract Page, Delete
-- Page, rotate) changes the ref and forces a fresh analysis instead of replaying a stale verdict.

CREATE TABLE IF NOT EXISTS mymd_fax_triage (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  fax_ref     VARCHAR(64)  NOT NULL,
  pdf_name    VARCHAR(255) NOT NULL,
  provider_no VARCHAR(6)   NULL,
  reason      VARCHAR(32)  NOT NULL,
  payload     MEDIUMTEXT   NULL,
  created     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_fax_ref (fax_ref),
  KEY idx_created (created)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
