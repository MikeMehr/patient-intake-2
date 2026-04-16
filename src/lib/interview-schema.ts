import { z } from "zod";
import {
  historyRequestSchema,
  historyResponseSchema,
} from "./history-schema";

export const interviewMessageSchema = z.object({
  role: z.enum(["assistant", "patient"]),
  content: z
    .string()
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1, "Messages cannot be empty.")
        .max(1000, "Messages must be shorter than 1000 characters."),
    ),
});

export type InterviewMessage = z.infer<typeof interviewMessageSchema>;

const chiefComplaintField = historyRequestSchema.shape.chiefComplaint;

export const patientProfileSchema = z.object({
  sex: z.enum(["female", "male", "nonbinary", "unspecified"]),
  age: z
    .number()
    .int()
    .min(0, "Age must be a positive number.")
    .max(120, "Age must be realistic."),
  pmh: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(3).max(600)),
  familyHistory: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(3).max(600)),
  familyDoctor: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(3).max(200)),
  currentMedications: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(3).max(600)),
  allergies: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(3).max(600)),
  dateOfBirth: z.preprocess(
    (val) => {
      if (val == null || typeof val !== "string") return undefined;
      const trimmed = val.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    },
    z.string().min(4).max(20).optional(),
  ),
  primaryPhone: z.preprocess(
    (val) => {
      if (val == null || typeof val !== "string") return undefined;
      const trimmed = val.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    },
    z.string().min(3).max(50).optional(),
  ),
  secondaryPhone: z.preprocess(
    (val) => {
      if (val == null || typeof val !== "string") return undefined;
      const trimmed = val.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    },
    z.string().min(3).max(50).optional(),
  ),
  insuranceNumber: z.preprocess(
    (val) => {
      if (val == null || typeof val !== "string") return undefined;
      const trimmed = val.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    },
    z.string().min(3).max(80).optional(),
  ),
  address: z.preprocess(
    (val) => {
      if (val == null || typeof val !== "string") return undefined;
      const trimmed = val.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    },
    z.string().min(4).max(400).optional(),
  ),
  pharmacyName: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(200))
    .optional(),
  pharmacyNumber: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(40))
    .optional(),
  pharmacyAddress: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(300))
    .optional(),
  pharmacyCity: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(120))
    .optional(),
  pharmacyPhone: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(50))
    .optional(),
  pharmacyFax: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(50))
    .optional(),
});

export type PatientProfile = z.infer<typeof patientProfileSchema>;

export const interviewRequestSchema = z.object({
  // Allow empty string on the first turn (before the patient has stated a complaint).
  // The history schema enforces min(3) at session-save time.
  chiefComplaint: z.string().transform((v) => v.trim()),
  patientProfile: patientProfileSchema,
  patientEmail: z
    .string()
    .transform((value) => value.trim())
    .pipe(
      z.string().refine(
        (val) => {
          const isLocalhost =
            process.env.NODE_ENV === "development" && /^[^\s@]+@localhost$/i.test(val);
          const isStandardEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
          return isLocalhost || isStandardEmail;
        },
        "Valid patient email is required."
      )
    ),
  physicianId: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(10, "physicianId is required.")),
  imageSummary: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(800))
    .optional(),
  labReportSummary: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(10000))
    .optional(),
  previousLabReportSummary: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(10000))
    .optional(),
  formSummary: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(10000))
    .optional(),
  medPmhSummary: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(10000))
    .optional(),
  patientBackground: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(10000))
    .optional(),
  interviewGuidance: z.preprocess(
    (val) => {
      if (val == null || typeof val !== "string") return undefined;
      const trimmed = val.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    },
    z.string().min(1).max(50000).optional(),
  ),
  transcript: z
    .array(interviewMessageSchema)
    .max(200, "Conversation is too long.")
    .default([]),
  forceSummary: z.boolean().optional().default(false),
  language: z
    .string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.string().min(2).max(12))
    .optional(),
  deferredIntentHint: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(3).max(500))
    .optional(),
  detectedComplaints: z
    .array(z.string().min(2).max(100))
    .optional()
    .default([]),
});

export type InterviewRequest = z.infer<typeof interviewRequestSchema>;

export const interviewProgressSchema = z.object({
  questionsAsked: z.number().int().min(0),
  approxTotalQuestions: z.number().int().min(0),
});

export type InterviewProgress = z.infer<typeof interviewProgressSchema>;

const interviewQuestionSchema = z.object({
  type: z.literal("question"),
  question: z
    .string()
    .min(4, "Questions must include some detail.")
    .max(1000, "Questions must stay under 1000 characters."),
  rationale: z
    .string()
    .min(5, "Explain why you are asking.")
    .max(280)
    .optional(),
  progress: interviewProgressSchema.optional(),
  requiresLocationMarking: z.boolean().optional(),
  locationBodyParts: z.array(z.string().min(2).max(30)).max(4).optional(),
  requiresPhotoUpload: z.boolean().optional(),
  deferredIntentHint: z.string().min(3).max(500).optional(),
  newComplaints: z.array(z.string().min(2).max(100)).optional(),
});

const interviewSummarySchema = historyResponseSchema.extend({
  type: z.literal("summary"),
  progress: interviewProgressSchema.optional(),
  // LLM-evaluated emergency flag: true only when the patient has active, confirmed
  // red-flag symptoms requiring urgent physician attention (not denied/historical).
  isEmergency: z.boolean().optional(),
});

export const interviewResponseSchema = z.discriminatedUnion("type", [
  interviewQuestionSchema,
  interviewSummarySchema,
]);

export type InterviewResponse = z.infer<typeof interviewResponseSchema>;

