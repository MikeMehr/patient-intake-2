import { z } from "zod";

export const patientUploadBodyPartSchema = z.object({
  part: z.string().min(1).max(120),
  side: z.enum(["left", "right", "both"]).optional(),
});

export const diagramMarkerSchema = z.object({
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
});

export const bodyDiagramMarkersByPartSchema = z.object({
  part: z.string().min(1).max(120),
  side: z.enum(["left", "right"]).optional(),
  markers: z.array(diagramMarkerSchema).max(30),
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
      // Legacy numbered-area field. Kept for backward compatibility with old sessions.
      selectedArea: z.number().int().positive().optional(),
      // Legacy left-sole-only field. Kept for backward compatibility with old sessions.
      leftSoleMarkers: z.array(diagramMarkerSchema).max(30).optional(),
      markersByPart: z.array(bodyDiagramMarkersByPartSchema).max(30).optional(),
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

// PWD Medical Report — Section E6 & F results
export const pwdSectionE6FResultsSchema = z.object({
  sectionE6: z.object({
    hasDeficits: z.enum(["yes", "no", "unknown"]),
    deficitAreas: z.object({
      consciousness: z.boolean(),
      executive: z.boolean(),
      language: z.boolean(),
      memory: z.boolean(),
      perceptualPsychomotor: z.boolean(),
      psychoticSymptoms: z.boolean(),
      emotionalDisturbance: z.boolean(),
      motivation: z.boolean(),
      impulseControl: z.boolean(),
      motorActivity: z.boolean(),
      attentionConcentration: z.boolean(),
      otherSpecify: z.string().max(500),
    }),
    functionalSkillsComments: z.string().max(2000),
  }),
  sectionF: z.object({
    isRestricted: z.enum(["yes", "no", "unknown"]),
    activities: z.array(
      z.object({
        activity: z.string().min(1).max(200),
        restricted: z.enum(["yes", "no", "unknown"]),
        restrictionType: z.enum(["continuous", "periodic"]).nullable(),
      })
    ).max(20),
    periodicExplanation: z.string().max(2000),
    socialFunctioningExplanation: z.string().max(2000),
    additionalComments: z.string().max(2000),
    assistanceNeeded: z.string().max(2000),
  }),
  completedAt: z.string().datetime().optional(),
});

export type PwdSectionE6FResults = z.infer<typeof pwdSectionE6FResultsSchema>;

// PHQ-9 / GAD-7 screening result schemas
export const phqGadItemSchema = z.object({
  question: z.string().min(1).max(500),
  score: z.number().int().min(0).max(3),
});

export const phqGadResultsSchema = z.object({
  phq9: z.object({
    items: z.array(phqGadItemSchema).length(9),
    total: z.number().int().min(0).max(27),
    severity: z.enum(["minimal", "mild", "moderate", "moderately_severe", "severe"]),
  }),
  gad7: z.object({
    items: z.array(phqGadItemSchema).length(7),
    total: z.number().int().min(0).max(21),
    severity: z.enum(["minimal", "mild", "moderate", "severe"]),
  }),
  completedAt: z.string().datetime().optional(),
});

export type PhqGadResults = z.infer<typeof phqGadResultsSchema>;

export const historyResponseSchema = z.object({
  positives: z.array(z.string()).min(1).max(6),
  negatives: z.array(z.string()).min(1).max(6),
  physicalFindings: z.array(z.string()).min(0).max(6).optional(),
  summary: z.string().min(10).max(2500),
  investigations: z.array(z.string()).min(0).max(6),
  assessment: z.string().min(10).max(1500),
  plan: z.array(z.string()).min(1).max(6),
  patientFinalQuestionsComments: z.string().min(1).max(2000).optional(),
  // The language used by the patient during the guided interview (e.g. "fa", "en").
  interviewLanguage: z.string().min(2).max(12).optional(),
  // English-only view for clinician; persisted to avoid repeated translation calls.
  patientFinalQuestionsCommentsEnglish: z.string().min(1).max(4000).optional(),
  // English translation of the chief complaint for clinician display.
  chiefComplaintEnglish: z.string().min(1).max(1000).optional(),
  // True when the patient explicitly ended the interview before normal completion.
  interviewEndedEarly: z.boolean().optional(),
  // Optional patient-uploaded clinical context persisted with history.
  patientUploads: patientUploadsSchema.optional(),
  // PHQ-9 and GAD-7 screening results (present when physician requested screening).
  phqGadResults: phqGadResultsSchema.optional(),
  // PWD Medical Report Section E6 & F results (present when physician requested this form).
  pwdSectionE6FResults: pwdSectionE6FResultsSchema.optional(),
});

export type HistoryResponse = z.infer<typeof historyResponseSchema>;
export type PatientUploads = z.infer<typeof patientUploadsSchema>;
export type PatientUploadBodyPart = z.infer<typeof patientUploadBodyPartSchema>;

