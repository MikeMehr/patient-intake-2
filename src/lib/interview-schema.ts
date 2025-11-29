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
});

export type PatientProfile = z.infer<typeof patientProfileSchema>;

export const interviewRequestSchema = z.object({
  chiefComplaint: chiefComplaintField,
  patientProfile: patientProfileSchema,
  imageSummary: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(800))
    .optional(),
  transcript: z
    .array(interviewMessageSchema)
    .max(100, "Conversation is too long.")
    .default([]),
});

export type InterviewRequest = z.infer<typeof interviewRequestSchema>;

const interviewQuestionSchema = z.object({
  type: z.literal("question"),
  question: z
    .string()
    .min(4, "Questions must include some detail.")
    .max(240, "Questions must stay under 240 characters."),
  rationale: z
    .string()
    .min(5, "Explain why you are asking.")
    .max(280)
    .optional(),
});

const interviewSummarySchema = historyResponseSchema.extend({
  type: z.literal("summary"),
});

export const interviewResponseSchema = z.discriminatedUnion("type", [
  interviewQuestionSchema,
  interviewSummarySchema,
]);

export type InterviewResponse = z.infer<typeof interviewResponseSchema>;

