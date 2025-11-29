import type { HistoryResponse } from "./history-schema";

export const mockHistory: HistoryResponse = {
  positives: [
    "Two-day history of worsening sore throat with painful swallowing",
    "Subjective fevers peaking at 101°F and responsive to acetaminophen",
    "Reports tender anterior cervical lymph nodes",
  ],
  negatives: [
    "Denies drooling, trismus, or voice changes",
    "No cough, rhinorrhea, or lower respiratory complaints",
    "No recent travel, new medications, or known sick contacts",
  ],
  summary:
    "Patient describes a 48-hour history of progressively painful sore throat with low-grade fevers and tender anterior nodes but no airway compromise, systemic toxicity, or lower respiratory symptoms.",
  investigations: [
    "Rapid antigen detection test for Group A Streptococcus",
    "Consider throat culture if RADT negative but suspicion remains high",
  ],
  assessment:
    "Presentation is most consistent with uncomplicated streptococcal pharyngitis in a hemodynamically stable adult without airway compromise.",
  plan: [
    "Initiate appropriate antibiotic therapy if RADT positive",
    "Symptomatic relief with NSAIDs or acetaminophen and adequate hydration",
    "Advise return precautions for worsening dysphagia, dyspnea, or neck swelling",
  ],
};

