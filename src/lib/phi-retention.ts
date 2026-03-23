/**
 * Returns the configured PHI retention window in hours.
 * Reads PHI_RETENTION_HOURS from the environment; defaults to 26280 (3 years).
 * Governs DRAFT transcription records, sessions, labs, and prescriptions.
 */
export function getPhiRetentionHours(): number {
  const configured = Number(process.env.PHI_RETENTION_HOURS);
  return Number.isFinite(configured) && configured > 0 ? configured : 26280;
}

/**
 * Returns the retention window in hours for FINALIZED_FOR_EXPORT SOAP records.
 * Reads RETENTION_YEARS from the environment; defaults to 7 years.
 *
 * BUSINESS SETTING — currently 7 years.
 * NOTE: This is a temporary default. Jurisdiction-specific medical record
 * retention laws (e.g. HIPAA, state regulations) may require longer retention
 * periods. Review with legal counsel before reducing this value.
 */
export function getFinalizedRetentionHours(): number {
  const years = Number(process.env.RETENTION_YEARS);
  const validYears = Number.isFinite(years) && years > 0 ? years : 7;
  return validYears * 365 * 24; // convert years → hours
}
