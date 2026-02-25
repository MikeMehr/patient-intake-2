import { z } from "zod";

export const patientUploadBodyPartSchema = z.object({
  part: z.string().min(1).max(120),
  side: z.enum(["left", "right", "both"]).optional(),
});

export const patientUploadsSchema = z.object({
  medPmh: z
    .object({
      summary: z.string().min(1).max(10000),
      sourceFileName: z.string().min(1).max(255).optional(),
    })
    .optional(),
  lesionImage: z
    .object({
      summary: z.string().min(1).max(800).optional(),
      imageUrl: z.string().min(1).max(2_500_000).optional(),
      imageName: z.string().min(1).max(255).optional(),
    })
    .optional(),
  bodyDiagram: z
    .object({
      selectedArea: z.number().int().positive().optional(),
      leftSoleMarkers: z
        .array(
          z.object({
            xPct: z.number().min(0).max(100),
            yPct: z.number().min(0).max(100),
          }),
        )
        .max(30)
        .optional(),
      selectedParts: z.array(patientUploadBodyPartSchema).max(30).optional(),
      note: z.string().min(1).max(500).optional(),
    })
    .optional(),
});

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
  // True when the patient explicitly ended the interview before normal completion.
  interviewEndedEarly: z.boolean().optional(),
  // Optional patient-uploaded clinical context persisted with history.
  patientUploads: patientUploadsSchema.optional(),
});

export type HistoryResponse = z.infer<typeof historyResponseSchema>;
export type PatientUploads = z.infer<typeof patientUploadsSchema>;
export type PatientUploadBodyPart = z.infer<typeof patientUploadBodyPartSchema>;

