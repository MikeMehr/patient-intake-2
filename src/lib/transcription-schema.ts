import { z } from "zod";

export const soapDraftSchema = z.object({
  subjective: z.string().trim().min(1).max(6000),
  objective: z.string().trim().max(6000).default(""),
  assessment: z.string().trim().min(1).max(6000),
  plan: z.string().trim().min(1).max(6000),
});

export const generateSoapFromTranscriptRequestSchema = z.object({
  patientId: z.string().uuid(),
  transcript: z.string().trim().min(10).max(20000),
  chiefComplaint: z.string().trim().max(1000).optional(),
  encounterId: z.string().uuid().optional(),
});

export const saveSoapDraftRequestSchema = z.object({
  soapVersionId: z.string().uuid(),
  draft: soapDraftSchema,
});

export const finalizeSoapRequestSchema = z.object({
  soapVersionId: z.string().uuid(),
});

export const markExportedRequestSchema = z.object({
  soapVersionId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(8).max(200),
  destinationSystem: z.string().trim().max(200).optional(),
  destinationClinic: z.string().trim().max(200).optional(),
  externalReferenceId: z.string().trim().max(200).optional(),
});

export const transcriptionListItemSchema = z.object({
  transcriptionSessionId: z.string().uuid(),
  encounterId: z.string().uuid(),
  soapVersionId: z.string().uuid(),
  patientId: z.string().uuid(),
  patientName: z.string(),
  chiefComplaint: z.string().nullable(),
  lifecycleState: z.enum(["DRAFT", "FINALIZED_FOR_EXPORT"]),
  version: z.number().int().positive(),
  previewSummary: z.string().nullable(),
  createdAt: z.string(),
  finalizedForExportAt: z.string().nullable(),
});

export type SoapDraft = z.infer<typeof soapDraftSchema>;
