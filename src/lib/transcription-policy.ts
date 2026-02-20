export const HEALTHASSIST_SNAPSHOT_LABEL =
  "HealthAssist snapshot — final authoritative note may differ in clinic EMR";

export const SOAP_LIFECYCLE_STATES = {
  DRAFT: "DRAFT",
  FINALIZED_FOR_EXPORT: "FINALIZED_FOR_EXPORT",
} as const;

export type SoapLifecycleState =
  (typeof SOAP_LIFECYCLE_STATES)[keyof typeof SOAP_LIFECYCLE_STATES];

export const EMR_EXPORT_STATUS = {
  PENDING: "pending",
  SENT: "sent",
  FAILED: "failed",
} as const;

export type EmrExportStatus =
  (typeof EMR_EXPORT_STATUS)[keyof typeof EMR_EXPORT_STATUS];
