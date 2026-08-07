-- Day-billing audit trail, on the OSCAR box.
--
-- Two jobs:
--   1. The unique key is the real guarantee against double-billing. The row is written BEFORE the
--      claim, so a second attempt at the same visit hits the constraint and nothing is dispatched.
--      Neither the "unbilled" query on the review screen nor a disabled button can promise that.
--   2. It is the rollback key: `SELECT billing_no FROM mymd_billing_log WHERE run_id=? AND
--      decision='BILLED'` is how you find what a run created.
--
-- Codes and identifiers only. No note text, no evidence quote, no patient name — all of that stays
-- in the chart where it already lives.
--
-- Apply by hand:  sudo mysql oscar_db < mymd_billing_log.sql

CREATE TABLE IF NOT EXISTS mymd_billing_log (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id          CHAR(40)     NOT NULL,
  appointment_no  INT          NOT NULL,
  demographic_no  INT          NOT NULL,
  provider_no     VARCHAR(6)   NOT NULL DEFAULT '',
  service_date    DATE         NOT NULL,
  fee_code        VARCHAR(10)  NOT NULL DEFAULT '',
  dx_proposed     VARCHAR(10)  NOT NULL DEFAULT '',
  dx_final        VARCHAR(10)  NOT NULL DEFAULT '',
  -- ai: chosen by the model and validated against icd9. manual: typed by the physician.
  -- dxresearch: taken from the patient's existing coded diagnoses. none: no code.
  dx_source       VARCHAR(12)  NOT NULL DEFAULT 'none',
  confidence      VARCHAR(10)  NOT NULL DEFAULT '',
  hin_province    VARCHAR(6)   NOT NULL DEFAULT '',
  -- 1 when an Ontario version code was split off the number before it went on the claim.
  hin_normalized  TINYINT(1)   NOT NULL DEFAULT 0,
  -- PENDING is written first and replaced once the outcome is known. A row left PENDING means the
  -- JVM died mid-claim: check `billing` for that appointment before re-running.
  decision        VARCHAR(10)  NOT NULL DEFAULT 'PENDING',
  billing_no      INT          NULL,
  operator        VARCHAR(30)  NOT NULL DEFAULT '',
  detail          VARCHAR(500) NOT NULL DEFAULT '',
  created_at      DATETIME     NOT NULL,
  PRIMARY KEY (id),
  -- The double-billing guard.
  UNIQUE KEY uq_claim (appointment_no, service_date, fee_code),
  KEY idx_run (run_id),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
