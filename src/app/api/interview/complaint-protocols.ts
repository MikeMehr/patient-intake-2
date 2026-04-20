import type {
  ComplaintClass,
  ComplaintProtocol,
  ProtocolCheck,
  ProtocolTopicKey,
  VisitStage,
} from "./protocol-types";

function field(
  key: string,
  label: string,
  coverageTopics: ProtocolTopicKey[],
  promptHint?: string,
): ProtocolCheck {
  return { key, label, coverageTopics, promptHint };
}

export const COMPLAINT_ALIAS_MAPPINGS = [
  { pattern: /\b(?:dm2|t2dm|type 2 dm|type ii diabetes?)\b/gi, replacement: "type 2 diabetes" },
  { pattern: /\b(?:dm1|t1dm|type 1 dm|type i diabetes?)\b/gi, replacement: "type 1 diabetes" },
  { pattern: /\b(?:pre[- ]?dm|predm)\b/gi, replacement: "prediabetes" },
  { pattern: /\bf\/?u\b/gi, replacement: "follow-up" },
  { pattern: /\bfollow\s*up\b/gi, replacement: "follow-up" },
] as const;

export function normalizeComplaintText(complaint: string) {
  let normalized = complaint.toLowerCase();
  COMPLAINT_ALIAS_MAPPINGS.forEach(({ pattern, replacement }) => {
    normalized = normalized.replace(pattern, replacement);
  });

  return normalized.replace(/\s+/g, " ").trim();
}

const ACUTE_CORE_FIELDS: ProtocolCheck[] = [
  field("open_narrative", "patient narrative", [], "Start with an open-ended narrative question."),
  field("duration_onset", "onset and timeline", ["duration/onset"]),
  field("severity", "severity", ["severity"]),
  field("associated_symptoms", "associated symptoms", ["associated symptoms"]),
  field("triggers", "aggravating factors", ["triggers"]),
  field("relieving_factors", "relieving factors", ["relieving factors"]),
];

const PAIN_FIELDS: ProtocolCheck[] = [
  field("location", "symptom location", ["location"]),
  field("quality", "symptom quality", ["quality"]),
  field("function_impact", "functional impact", ["function impact"]),
];

const FOLLOW_UP_FIELDS: ProtocolCheck[] = [
  field("current_symptoms", "current symptoms", ["current symptoms"]),
  field("interval_change", "what improved, worsened, or stayed the same", ["interval change"]),
  field("function_impact", "persistent limitations", ["function impact"]),
  field("work_status", "current work status", ["work status"]),
  field("rehab_progress", "rehab or therapy progress", ["rehab progress"]),
  field("current_red_flags", "current or new red flags", ["current red flags"]),
];

const CARDIO_RED_FLAGS: ProtocolCheck[] = [
  field("exertional_chest_pain", "exertional chest pain or pressure", ["cardiac symptoms"]),
  field("radiation", "radiation to arm, jaw, or back", ["cardiac symptoms"]),
  field("cardio_dyspnea_syncope", "associated dyspnea, diaphoresis, or syncope", [
    "respiratory",
    "loss of consciousness",
  ]),
];

const TRAUMA_RED_FLAGS: ProtocolCheck[] = [
  field("loss_of_consciousness", "loss of consciousness or amnesia", ["loss of consciousness"]),
  field("mechanism_severity", "major mechanism or significant vehicle damage", ["accident details"]),
  field("spine_neuro", "neurologic deficits or spine symptoms", ["neurological"]),
  field("major_injury", "chest, abdominal, or uncontrolled bleeding concerns", [
    "cardiac symptoms",
    "respiratory",
  ]),
];

const MSK_RED_FLAGS: ProtocolCheck[] = [
  field("functional_loss", "inability to weight bear or major functional loss", ["function impact"]),
  field("deformity", "open injury or gross deformity", ["swelling"]),
  field("neurovascular", "neurovascular compromise", ["neurological"]),
  field("compartment_like", "rapid progressive swelling or severe pressure-type pain", ["swelling"]),
];

const GENERAL_RED_FLAGS: ProtocolCheck[] = [
  field("severe_uncontrolled_pain", "severe uncontrolled pain", ["severity"]),
  field("respiratory_compromise", "breathing difficulty or instability", ["respiratory"]),
  field("neurologic_change", "acute neurologic change", ["neurological"]),
];

function isSoreThroatUriComplaint(complaint: string) {
  return /\b(sore throat|strep|pharyng|tonsil|uri|upper respiratory|congestion|runny nose|rhinorrhea|sinus|cold)\b/i.test(
    complaint,
  );
}

function isAbdominalPainComplaint(complaint: string) {
  return /\b(abdominal pain|stomach pain|belly pain|abd pain)\b/i.test(complaint);
}

function isDiabetesFollowUpComplaint(complaint: string) {
  return /\b(diabet(?:es|ic)?|prediabet(?:es|ic)?|blood sugar|glucose|a1c|hba1c)\b/i.test(
    complaint,
  );
}

function isIronDeficiencyComplaint(complaint: string) {
  return /\b(iron deficiency|low ferritin|ferritin|iron anemia|iron-deficiency anemia|low iron)\b/i.test(
    complaint,
  );
}

function createMinimalHandoffProtocol(complaintClass: ComplaintClass): ComplaintProtocol {
  return {
    id: "minimal-handoff",
    complaintClass,
    requiredFields: [
      field(
        "open_narrative",
        "brief patient narrative",
        [],
        "Ask one brief question to understand what the patient wants addressed, then hand off if the complaint remains unclear.",
      ),
    ],
    redFlags: [],
    virtualExamFields: [],
    photoAppropriate: false,
    stopConditions: {
      minQuestionCount: 1,
      requireRedFlags: false,
      requireRequiredFields: true,
      requireVirtualExamWhenApplicable: false,
    },
  };
}

function createSoreThroatUriProtocol(): ComplaintProtocol {
  return {
    id: "sore-throat-uri",
    complaintClass: "Respiratory",
    requiredFields: [
      field(
        "open_narrative",
        "sore throat or URI narrative",
        [],
        "Open with the throat or URI story and what the patient most wants addressed.",
      ),
      field(
        "duration_onset",
        "onset and timeline",
        ["duration/onset"],
        "Clarify when the sore throat or URI symptoms started and how they have evolved.",
      ),
      field(
        "severity",
        "throat symptom severity",
        ["severity"],
        "Ask how severe the throat symptoms are at their worst.",
      ),
      field(
        "throat_red_flags_screen",
        "airway, swallowing, or deep-neck red-flag screen",
        ["throat red flags", "respiratory"],
        "Ask about trouble swallowing liquids, drooling, muffled voice, neck swelling, or breathing difficulty.",
      ),
      field(
        "uri_symptoms",
        "URI-associated symptoms",
        ["uri symptoms"],
        "Ask only about the most relevant associated URI symptoms such as cough, congestion, rhinorrhea, or fever.",
      ),
      field(
        "infectious_context",
        "infectious exposure or visible throat findings",
        ["infectious context", "exudate"],
        "Ask one short high-yield follow-up about sick contacts, strep exposure, or visible throat findings such as white spots or swollen tonsils if that context is still missing.",
      ),
    ],
    redFlags: [],
    virtualExamFields: [],
    photoAppropriate: false,
    stopConditions: {
      minQuestionCount: 3,
      requireRedFlags: false,
      requireRequiredFields: true,
      requireVirtualExamWhenApplicable: false,
    },
  };
}

function createAbdominalPainProtocol(): ComplaintProtocol {
  return {
    id: "abdominal-pain",
    complaintClass: "GI",
    requiredFields: [
      field(
        "open_narrative",
        "abdominal pain narrative",
        [],
        "Open with where the abdominal pain is, when it started, and how it has changed.",
      ),
      field(
        "location",
        "abdominal pain location",
        ["location"],
        "Clarify the most important abdominal pain location or region if it is still unclear.",
      ),
      field(
        "duration_onset",
        "onset and timeline",
        ["duration/onset"],
        "Clarify when the abdominal pain started and whether it is constant, intermittent, or worsening.",
      ),
      field(
        "severity",
        "pain severity",
        ["severity"],
        "Ask how severe the abdominal pain is at its worst.",
      ),
      field(
        "abdominal_red_flags_screen",
        "urgent abdominal red-flag screen",
        ["abdominal red flags"],
        "Ask about vomiting, inability to keep fluids down, blood in vomit or stool, fainting, jaundice, or rapidly worsening pain.",
      ),
      field(
        "bowel_symptoms",
        "GI and bowel symptoms",
        ["bowel symptoms"],
        "Ask about nausea, vomiting, diarrhea, constipation, appetite, or bowel-pattern change only if still unclear.",
      ),
      field(
        "urinary_symptoms",
        "urinary symptoms",
        ["urinary symptoms"],
        "Ask about dysuria, frequency, urgency, or blood in the urine when not already covered.",
      ),
      field(
        "pregnancy_context",
        "pregnancy or LMP context",
        ["pregnancy context"],
        "If relevant, ask about pregnancy possibility or the last menstrual period.",
      ),
      field(
        "relieving_factors",
        "relieving factors",
        ["relieving factors"],
        "Ask whether anything makes the abdominal pain better if that is still unclear.",
      ),
    ],
    redFlags: [],
    virtualExamFields: [],
    photoAppropriate: false,
    stopConditions: {
      minQuestionCount: 4,
      requireRedFlags: false,
      requireRequiredFields: true,
      requireVirtualExamWhenApplicable: false,
    },
  };
}

function createDiabetesFollowUpProtocol(): ComplaintProtocol {
  return {
    id: "diabetes-follow-up",
    complaintClass: "General",
    requiredFields: [
      field(
        "open_narrative",
        "diabetes follow-up narrative",
        [],
        "Open with how diabetes has been going lately and what the patient wants to focus on today.",
      ),
      field(
        "duration_onset",
        "diagnosis timeline",
        ["duration/onset"],
        "Clarify when diabetes was diagnosed or how long the patient has been managing it if still unclear.",
      ),
      field(
        "diabetes_treatment",
        "current diabetes treatment and adherence",
        ["diabetes treatment"],
        "Ask about current diabetes medications or treatment and whether they are being taken consistently.",
      ),
      field(
        "glucose_control",
        "recent A1c or glucose control trend",
        ["glucose control"],
        "Ask about the most relevant recent A1c or home glucose trend only if it is still missing.",
      ),
      field(
        "diabetes_red_flags_screen",
        "symptomatic hypo/hyperglycemia or urgent diabetes complications",
        ["diabetes red flags"],
        "Ask about low blood sugar symptoms, severe high blood sugar symptoms, vomiting, confusion, vision loss, or foot infection only if still unclear.",
      ),
    ],
    redFlags: [],
    virtualExamFields: [],
    photoAppropriate: false,
    stopConditions: {
      minQuestionCount: 3,
      requireRedFlags: false,
      requireRequiredFields: true,
      requireVirtualExamWhenApplicable: false,
    },
  };
}

function createIronDeficiencyProtocol(): ComplaintProtocol {
  return {
    id: "iron-deficiency-follow-up",
    complaintClass: "General",
    requiredFields: [
      field(
        "open_narrative",
        "iron deficiency follow-up narrative",
        [],
        "Open with how the patient has been feeling and what brought this to their attention.",
      ),
      field(
        "iron_symptoms",
        "symptoms of iron deficiency",
        ["iron symptoms"],
        "Ask about fatigue, weakness, pallor, shortness of breath, palpitations, cold intolerance, hair loss, brittle nails, or difficulty concentrating.",
      ),
      field(
        "iron_supplements",
        "iron supplement intake",
        ["iron supplements"],
        "Ask whether the patient is currently taking any iron supplements — including the name, dose, and how consistently they take them.",
      ),
      field(
        "iron_rich_diet",
        "dietary iron intake",
        ["iron-rich diet"],
        "Ask about foods rich in iron in their diet: red meat, poultry, fish, legumes, spinach, fortified cereals. Ask how often they eat these foods.",
      ),
      field(
        "absorption_factors",
        "factors affecting iron absorption",
        ["iron absorption"],
        "Ask about vitamin C intake with meals (enhances absorption), tea or coffee with meals (inhibits absorption), and any GI symptoms like bleeding, heavy periods, or malabsorption.",
      ),
      field(
        "prior_treatment",
        "prior iron treatment or investigation",
        ["iron prior treatment"],
        "Ask whether they have been treated for low iron or low ferritin before and what the outcome was.",
      ),
      field(
        "iv_iron_history",
        "history of IV iron infusion",
        ["iron supplements"],
        "If the patient has a recurrent or refractory iron deficiency, or reports poor tolerance or inconsistent use of oral iron, ask whether they have ever received IV iron infusion, when it was given, and how they responded.",
      ),
    ],
    redFlags: GENERAL_RED_FLAGS,
    virtualExamFields: [],
    photoAppropriate: false,
    stopConditions: {
      minQuestionCount: 4,
      requireRedFlags: false,
      requireRequiredFields: true,
      requireVirtualExamWhenApplicable: false,
    },
  };
}

function classifyComplaintText(text: string): ComplaintClass {
  if (
    text.match(
      /\b(mva|motor vehicle|car accident|collision|fall|workplace injury|assault|sports injury|trauma)\b/,
    )
  ) {
    return "Trauma";
  }
  if (
    text.match(
      /\b(headache|migraine|weakness|numbness|tingling|vision loss|syncope|faint|dizziness|seizure)\b/,
    )
  ) {
    return "Neuro";
  }
  if (text.match(/\b(chest pain|palpitation|heart|angina|pressure)\b/)) {
    return "Cardio";
  }
  if (
    text.match(/\b(abdominal|stomach|nausea|vomit|diarrhea|constipation|gi bleed|melena|hematemesis)\b/)
  ) {
    return "GI";
  }
  if (
    text.match(
      /\b(sore throat|strep|pharyng|tonsil|uri|upper respiratory|congestion|runny nose|rhinorrhea|sinus|cold)\b/,
    )
  ) {
    return "Respiratory";
  }
  if (text.match(/\b(shortness of breath|dyspnea|cough|wheeze|respiratory|hemoptysis)\b/)) {
    return "Respiratory";
  }
  if (text.match(/\b(rash|lesion|eczema|hives|wound|ulcer|skin)\b/)) {
    return "Dermatology";
  }
  if (
    text.match(
      /\b(back pain|neck pain|joint pain|ankle|knee|elbow|shoulder|wrist|sprain|strain|musculoskeletal)\b/,
    )
  ) {
    return "MSK";
  }
  return "General";
}

function looksLikeUnclearComplaintShorthand(originalComplaint: string, normalizedComplaint: string) {
  if (!originalComplaint.trim()) {
    return false;
  }

  if (
    isDiabetesFollowUpComplaint(normalizedComplaint) ||
    isSoreThroatUriComplaint(normalizedComplaint) ||
    isAbdominalPainComplaint(normalizedComplaint)
  ) {
    return false;
  }

  if (classifyComplaintText(normalizedComplaint) !== "General") {
    return false;
  }

  return /(?:\b[a-z]{1,5}\d[a-z0-9]*\b|\b[a-z]+\/[a-z]+\b|\b[a-z]{2,8}\s*f\/?u\b)/i.test(
    originalComplaint,
  );
}

export function resolveComplaintRouting(params: {
  complaint: string;
  visitStage: VisitStage;
}): {
  normalizedComplaint: string;
  complaintClass: ComplaintClass;
  protocol: ComplaintProtocol;
  clarificationHint: string | null;
} {
  const normalizedComplaint = normalizeComplaintText(params.complaint);
  const complaintClass = classifyComplaintText(normalizedComplaint);

  if (isIronDeficiencyComplaint(normalizedComplaint)) {
    return {
      normalizedComplaint,
      complaintClass: "General",
      protocol: createIronDeficiencyProtocol(),
      clarificationHint: null,
    };
  }

  if (isDiabetesFollowUpComplaint(normalizedComplaint)) {
    return {
      normalizedComplaint,
      complaintClass: "General",
      protocol: createDiabetesFollowUpProtocol(),
      clarificationHint: null,
    };
  }

  if (isSoreThroatUriComplaint(normalizedComplaint)) {
    return {
      normalizedComplaint,
      complaintClass,
      protocol: createSoreThroatUriProtocol(),
      clarificationHint: null,
    };
  }

  if (isAbdominalPainComplaint(normalizedComplaint)) {
    return {
      normalizedComplaint,
      complaintClass,
      protocol: createAbdominalPainProtocol(),
      clarificationHint: null,
    };
  }

  if (looksLikeUnclearComplaintShorthand(params.complaint, normalizedComplaint)) {
    return {
      normalizedComplaint,
      complaintClass,
      protocol: createMinimalHandoffProtocol("General"),
      clarificationHint: `what "${params.complaint}" refers to so I can focus on the right concern`,
    };
  }

  return {
    normalizedComplaint,
    complaintClass,
    protocol: createProtocol(complaintClass, params.visitStage),
    clarificationHint: null,
  };
}

function createProtocol(complaintClass: ComplaintClass, visitStage: VisitStage): ComplaintProtocol {
  switch (complaintClass) {
    case "Trauma": {
      const followUp = visitStage !== "initial";
      return {
        id: followUp ? "trauma-follow-up" : "trauma-initial",
        complaintClass,
        requiredFields: followUp
          ? [
              field(
                "open_narrative",
                "follow-up narrative",
                [],
                "Use a progression-focused follow-up question rather than accident reconstruction.",
              ),
              ...FOLLOW_UP_FIELDS,
              field("location", "current symptomatic body areas", ["location"]),
              field("severity", "current severity", ["severity"]),
            ]
          : [
              ...ACUTE_CORE_FIELDS,
              ...PAIN_FIELDS,
              field("accident_details", "accident mechanism", ["accident details"]),
              field("accident_response", "ambulance or ER response", ["accident response"]),
              field("previous_injuries", "previous injury history", ["previous injuries"]),
            ],
        redFlags: TRAUMA_RED_FLAGS,
        virtualExamFields: [
          field("range_of_motion", "range of motion", ["range of motion"]),
          field("tenderness", "tenderness", ["tenderness"]),
          field("swelling", "swelling or bruising", ["swelling"]),
          field("neurological", "neurologic symptoms", ["neurological"]),
        ],
        photoAppropriate: false,
        stopConditions: {
          minQuestionCount: followUp ? 5 : 6,
          requireRedFlags: true,
          requireRequiredFields: true,
          requireVirtualExamWhenApplicable: true,
        },
        suppressedTargetsByStage: {
          late_follow_up: ["accident_details", "accident_response", "previous_injuries", "claim_details"],
          documentation_follow_up: ["accident_details", "accident_response", "previous_injuries"],
        },
      };
    }
    case "MSK": {
      const followUp = visitStage !== "initial";
      return {
        id: followUp ? "msk-follow-up" : "msk-acute",
        complaintClass,
        requiredFields: followUp
          ? [
              field(
                "open_narrative",
                "follow-up narrative",
                [],
                "Prioritize current symptoms and progression rather than first-visit history.",
              ),
              ...FOLLOW_UP_FIELDS,
              field("location", "current symptom location", ["location"]),
              field("severity", "current severity", ["severity"]),
            ]
          : [...ACUTE_CORE_FIELDS, ...PAIN_FIELDS],
        redFlags: MSK_RED_FLAGS,
        virtualExamFields: [
          field("range_of_motion", "range of motion", ["range of motion"]),
          field("tenderness", "tenderness", ["tenderness"]),
          field("swelling", "swelling", ["swelling"]),
          field("redness", "redness", ["redness"]),
        ],
        photoAppropriate: false,
        stopConditions: {
          minQuestionCount: followUp ? 5 : 5,
          requireRedFlags: true,
          requireRequiredFields: true,
          requireVirtualExamWhenApplicable: true,
        },
      };
    }
    case "Cardio":
      return {
        id: "cardio-acute",
        complaintClass,
        requiredFields: [
          ...ACUTE_CORE_FIELDS,
          field("location", "symptom location", ["location"]),
          field("quality", "symptom quality", ["quality"]),
        ],
        redFlags: CARDIO_RED_FLAGS,
        virtualExamFields: [],
        photoAppropriate: false,
        stopConditions: {
          minQuestionCount: 4,
          requireRedFlags: true,
          requireRequiredFields: true,
          requireVirtualExamWhenApplicable: false,
        },
      };
    case "Respiratory":
      return {
        id: "respiratory-acute",
        complaintClass,
        requiredFields: [
          ...ACUTE_CORE_FIELDS,
          field("respiratory_symptoms", "respiratory symptoms", ["respiratory"]),
          field("constitutional", "constitutional symptoms", ["constitutional symptoms"]),
        ],
        redFlags: GENERAL_RED_FLAGS,
        virtualExamFields: [],
        photoAppropriate: false,
        stopConditions: {
          minQuestionCount: 4,
          requireRedFlags: true,
          requireRequiredFields: true,
          requireVirtualExamWhenApplicable: false,
        },
      };
    case "Dermatology":
      return {
        id: "dermatology-acute",
        complaintClass,
        requiredFields: [...ACUTE_CORE_FIELDS, field("location", "rash or lesion location", ["location"])],
        redFlags: GENERAL_RED_FLAGS,
        virtualExamFields: [
          field("redness", "redness", ["redness"]),
          field("swelling", "swelling", ["swelling"]),
          field("exudate", "drainage or exudate", ["exudate"]),
        ],
        photoAppropriate: true,
        stopConditions: {
          minQuestionCount: 4,
          requireRedFlags: true,
          requireRequiredFields: true,
          requireVirtualExamWhenApplicable: true,
        },
      };
    case "GI":
      return {
        id: "gi-acute",
        complaintClass,
        requiredFields: [
          ...ACUTE_CORE_FIELDS,
          field("location", "symptom location", ["location"]),
        ],
        redFlags: GENERAL_RED_FLAGS,
        virtualExamFields: [],
        photoAppropriate: false,
        stopConditions: {
          minQuestionCount: 4,
          requireRedFlags: true,
          requireRequiredFields: true,
          requireVirtualExamWhenApplicable: false,
        },
      };
    case "Neuro":
      return {
        id: "neuro-acute",
        complaintClass,
        requiredFields: [
          ...ACUTE_CORE_FIELDS,
          field("neurologic_symptoms", "neurologic symptoms", ["neurological"]),
        ],
        redFlags: GENERAL_RED_FLAGS,
        virtualExamFields: [],
        photoAppropriate: false,
        stopConditions: {
          minQuestionCount: 4,
          requireRedFlags: true,
          requireRequiredFields: true,
          requireVirtualExamWhenApplicable: false,
        },
      };
    case "General":
    default:
      return {
        id: `${complaintClass.toLowerCase()}-acute`,
        complaintClass,
        requiredFields: [...ACUTE_CORE_FIELDS],
        redFlags: GENERAL_RED_FLAGS,
        virtualExamFields: [],
        photoAppropriate: false,
        stopConditions: {
          minQuestionCount: 4,
          requireRedFlags: true,
          requireRequiredFields: true,
          requireVirtualExamWhenApplicable: false,
        },
      };
  }
}

export function classifyComplaint(complaint: string): ComplaintClass {
  return classifyComplaintText(normalizeComplaintText(complaint));
}

export function getComplaintProtocol(params: {
  complaint: string;
  complaintClass: ComplaintClass;
  visitStage: VisitStage;
}): ComplaintProtocol {
  return resolveComplaintRouting({
    complaint: params.complaint,
    visitStage: params.visitStage,
  }).protocol;
}
