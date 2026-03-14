/**
 * Returns the configured PHI retention window in hours.
 * Reads PHI_RETENTION_HOURS from the environment; defaults to 12.
 * All PHI tables (patient_sessions, patients, patient_encounters,
 * soap_note_versions, physician_transcription_sessions, emr_exports,
 * lab_requisitions, prescriptions) are purged after this many hours.
 */
export function getPhiRetentionHours(): number {
  const configured = Number(process.env.PHI_RETENTION_HOURS);
  return Number.isFinite(configured) && configured > 0 ? configured : 12;
}
