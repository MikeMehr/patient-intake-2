import { z } from "zod";

export const historyRequestSchema = z.object({
  chiefComplaint: z
    .string()
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(3, "Please provide at least 3 characters for the complaint."),
    ),
});

export type HistoryRequest = z.infer<typeof historyRequestSchema>;

export const historyResponseSchema = z.object({
  positives: z.array(z.string()).min(1).max(6),
  negatives: z.array(z.string()).min(1).max(6),
  physicalFindings: z.array(z.string()).min(0).max(6).optional(),
  summary: z.string().min(10).max(1500),
  investigations: z.array(z.string()).min(0).max(6),
  assessment: z.string().min(10).max(1500),
  plan: z.array(z.string()).min(1).max(6),
  patientFinalQuestionsComments: z.string().min(1).max(2000).optional(),
  // The language used by the patient during the guided interview (e.g. "fa", "en").
  interviewLanguage: z.string().min(2).max(12).optional(),
  // English-only view for clinician; persisted to avoid repeated translation calls.
  patientFinalQuestionsCommentsEnglish: z.string().min(1).max(4000).optional(),
});

export type HistoryResponse = z.infer<typeof historyResponseSchema>;

