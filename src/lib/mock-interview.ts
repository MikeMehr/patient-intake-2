import type {
  InterviewMessage,
  InterviewResponse,
  PatientProfile,
} from "./interview-schema";
import { mockHistory } from "./mock-history";

export function mockInterviewStep(
  transcript: InterviewMessage[],
  profile: PatientProfile,
  chiefComplaint: string,
): InterviewResponse {
  const patientTurns = transcript.filter(
    (message) => message.role === "patient",
  ).length;

  const normalizedComplaint = chiefComplaint.toLowerCase();

  const questionForComplaint = (() => {
    if (
      normalizedComplaint.includes("shortness of breath") ||
      normalizedComplaint.includes("dyspnea")
    ) {
      return {
        question:
          "How does the shortness of breath vary with exertion or lying flat?",
        rationale: "Helps stratify pulmonary vs. cardiac causes and severity.",
      };
    }

    if (
      normalizedComplaint.includes("chest pain") ||
      normalizedComplaint.includes("pressure")
    ) {
      return {
        question:
          "Can you describe the chest discomfort—does it radiate, and what triggers or relieves it?",
        rationale:
          "Character and radiation clarify ischemic vs. non-cardiac etiologies.",
      };
    }

    if (
      normalizedComplaint.includes("fever") ||
      normalizedComplaint.includes("sore throat")
    ) {
      return {
        question: "Have you noticed any cough or nasal congestion with this?",
        rationale:
          "Helps differentiate localized pharyngitis from broader respiratory infection.",
      };
    }

    return {
      question: `Can you describe more about the symptoms related to "${chiefComplaint}"?`,
      rationale:
        "Establishes additional context when the intake doesn't match common templates.",
    };
  })();

  if (patientTurns === 0) {
    return {
      type: "question",
      question: questionForComplaint.question,
      rationale: questionForComplaint.rationale,
    };
  }

  if (patientTurns === 1) {
    return {
      type: "question",
      question: "Have you noticed fevers or chills over the last few days?",
      rationale: "Fever pattern clarifies infectious severity and red flags.",
    };
  }

  if (patientTurns === 2) {
    return {
      type: "question",
      question: "Any difficulty swallowing saliva, breathing, or opening your mouth?",
      rationale: "Airway compromise symptoms require urgent escalation.",
    };
  }

  if (patientTurns === 3) {
    return {
      type: "question",
      question: "Have you experienced any associated symptoms like nausea, vomiting, or changes in appetite?",
      rationale: "Associated symptoms help complete the clinical picture and identify red flags.",
    };
  }

  if (patientTurns === 4) {
    return {
      type: "question",
      question: "Are there any factors that make your symptoms better or worse?",
      rationale: "Identifying triggers and relieving factors aids in diagnosis and management.",
    };
  }

  if (patientTurns === 5) {
    return {
      type: "question",
      question: "Have you tried any medications or treatments for this, and if so, what was the response?",
      rationale: "Treatment response provides diagnostic clues and informs management.",
    };
  }

  // Continue asking until we've thoroughly explored the complaint
  if (patientTurns === 6) {
    return {
      type: "question",
      question: "Is there anything else about your symptoms or your health that you think might be relevant?",
      rationale: "Final check for any missed red flags or important details.",
    };
  }

  return {
    type: "summary",
    positives: mockHistory.positives,
    negatives: mockHistory.negatives,
    summary: `${mockHistory.summary} Baseline: ${profile.sex} patient, age ${profile.age}, PMH ${profile.pmh}, current medications ${profile.currentMedications}, family doctor ${profile.familyDoctor}.`,
    investigations: mockHistory.investigations,
    assessment: mockHistory.assessment,
    plan: mockHistory.plan,
  };
}

