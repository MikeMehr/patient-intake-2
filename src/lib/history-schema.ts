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
  summary: z.string().min(10).max(600),
  investigations: z.array(z.string()).min(0).max(6),
  assessment: z.string().min(10).max(600),
  plan: z.array(z.string()).min(1).max(6),
});

export type HistoryResponse = z.infer<typeof historyResponseSchema>;

