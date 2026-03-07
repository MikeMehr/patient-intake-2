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
  const text = complaint.toLowerCase();
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
  if (text.match(/\b(shortness of breath|dyspnea|cough|wheeze|respiratory|hemoptysis)\b/)) {
    return "Respiratory";
  }
  if (text.match(/\b(rash|lesion|eczema|hives|wound|ulcer|skin)\b/)) {
    return "Dermatology";
  }
  if (
    text.match(/\b(back pain|neck pain|joint pain|ankle|knee|shoulder|wrist|sprain|strain|musculoskeletal)\b/)
  ) {
    return "MSK";
  }
  return "General";
}

export function getComplaintProtocol(params: {
  complaint: string;
  complaintClass: ComplaintClass;
  visitStage: VisitStage;
}): ComplaintProtocol {
  return createProtocol(params.complaintClass, params.visitStage);
}
