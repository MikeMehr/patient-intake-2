"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, Suspense, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PatientSession } from "@/lib/session-store";
import SessionKeepAlive from "@/components/auth/SessionKeepAlive";
import CollapsibleSection from "@/components/CollapsibleSection";
import { mergeDiagramSelectionsForDisplay, type DiagramSelectionInput } from "@/lib/body-diagram-display";
import DiagramViewer from "@/components/DiagramViewer";

type RxMedicationRow = {
  id: string;
  medication: string;
  strength: string;
  sig: string;
  quantity: string;
  refills: string;
  notes: string;
};

type PharmacyFields = {
  pharmacyName: string;
  pharmacyNumber: string;
  pharmacyAddress: string;
  pharmacyCity: string;
  pharmacyPhone: string;
  pharmacyFax: string;
};

const emptyPharmacyFields = (): PharmacyFields => ({
  pharmacyName: "",
  pharmacyNumber: "",
  pharmacyAddress: "",
  pharmacyCity: "",
  pharmacyPhone: "",
  pharmacyFax: "",
});

const pharmacyFieldsFromProfile = (profile?: PatientSession["patientProfile"]): PharmacyFields => ({
  pharmacyName: profile?.pharmacyName?.trim() || "",
  pharmacyNumber: profile?.pharmacyNumber?.trim() || "",
  pharmacyAddress: profile?.pharmacyAddress?.trim() || "",
  pharmacyCity: profile?.pharmacyCity?.trim() || "",
  pharmacyPhone: profile?.pharmacyPhone?.trim() || "",
  pharmacyFax: profile?.pharmacyFax?.trim() || "",
});

const parseCityFromBcAddress = (address: string): string => {
  const trimmed = address.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/,\s*([^,]+?)\s+BC\b/i);
  if (match?.[1]) return match[1].trim();
  return "";
};

const computeAgeFromDob = (dob: string): number | null => {
  // Expect YYYY-MM-DD (from HTML date input). If not, fall back to null.
  const trimmed = dob.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [y, m, d] = trimmed.split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  const birth = new Date(y, m - 1, d);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const hadBirthdayThisYear =
    today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  if (age < 0 || age > 130) return null;
  return age;
};

const makeRxMedicationRow = (
  row: Partial<Omit<RxMedicationRow, "id">> = {},
): RxMedicationRow => ({
  id:
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
  medication: row.medication ?? "",
  strength: row.strength ?? "",
  sig: row.sig ?? "",
  quantity: row.quantity ?? "",
  refills: row.refills ?? "",
  notes: row.notes ?? "",
});

const RX_NOTE_MEDICATION_HINT_REGEX =
  /\b(take|apply|inhale|inject|use|insert|instill|swish|chew|tablet|tablets|capsule|capsules|mg|mcg|ml|bid|tid|qid|qhs|prn|once daily|twice daily|three times daily)\b/i;
const RX_NOTE_NON_MEDICATION_HINT_REGEX =
  /\b(lab|labs|blood work|requisition|cbc|crp|esr|ana|rf|anti-ccp|ferritin|sodium|potassium|x-?ray|mri|ct|ultrasound|referral|refer)\b/i;

const stripOptionalNone = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^none$/i.test(trimmed) ? "" : trimmed;
};

const normalizeListBlock = (value: string): string[] =>
  value
    .split("\n")
    .map((line) => line.trim().replace(/^[-*•]\s+/, ""))
    .filter(Boolean)
    .filter((line) => !/^none$/i.test(line));

const toStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => `${item ?? ""}`.trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return normalizeListBlock(value);
  }
  return [];
};

const formatListSection = (items: string[]): string =>
  items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "None";

type MarkerPoint = { xPct: number; yPct: number };
type DiagramMarkerSelection = {
  part?: string;
  side?: string;
  markers?: MarkerPoint[];
};

const getBodyDiagramImage = (
  part: string,
  side?: string,
  sex?: "female" | "male",
): { src: string; alt: string } => {
  if (part === "foot" && side === "left") {
    return { src: "/Images/Sole.png", alt: "Left sole pain diagram" };
  }
  switch (part) {
    case "foot":
      return { src: "/Images/foot.png", alt: "Foot pain diagram" };
    case "wrist":
    case "hand":
      return { src: "/Images/Hand Wrist.png", alt: "Hand, fingers, and wrist pain diagram" };
    case "elbow":
      return { src: "/Images/Forearm Elbow.png", alt: "Forearm and elbow pain diagram" };
    case "knee":
      return { src: "/Images/knee.png", alt: "Knee pain diagram" };
    case "lower_leg":
      return { src: "/Images/lower leg.png", alt: "Lower leg pain diagram" };
    case "ankle":
      return { src: "/Images/ankle.png", alt: "Ankle pain diagram" };
    case "shoulder":
      return { src: "/Images/Shoulder.png", alt: "Shoulder pain diagram" };
    case "head":
    case "neck":
      return { src: "/Images/Head Face Neck.png", alt: "Head, face, scalp, neck, and thyroid pain diagram" };
    case "hip":
      return { src: "/Images/Hip Upper Leg.png", alt: "Hip and upper leg pain diagram" };
    case "back":
    case "upper_back":
    case "lower_back":
      return { src: "/Images/Thoracic Lumbar Spine.png", alt: "Thoracic and lumbar spine pain diagram" };
    case "chest":
      if (sex === "male") {
        return { src: "/Images/Male Breast.png", alt: "Male chest and breast pain diagram" };
      }
      if (sex === "female") {
        return { src: "/Images/Female Breast.png", alt: "Female chest and breast pain diagram" };
      }
      return { src: "/Images/trunk front .png", alt: "Chest, breast, abdomen, and anterior neck pain diagram" };
    case "abdomen":
      return { src: "/Images/trunk front .png", alt: "Chest, breast, abdomen, and anterior neck pain diagram" };
    default:
      return { src: "/Images/ankle.png", alt: "Body part pain diagram" };
  }
};

const composeUnifiedHpiText = (history: PatientSession["history"]): string => {
  const subjective = stripOptionalNone(history?.summary || "");
  const assessment = stripOptionalNone(history?.assessment || "");
  const physicalFindings = toStringList((history as any)?.physicalFindings);
  const investigations = toStringList((history as any)?.investigations);
  const plan = toStringList((history as any)?.plan);
  const patientFinalComments = stripOptionalNone(
    history?.patientFinalQuestionsCommentsEnglish?.trim()
      ? history.patientFinalQuestionsCommentsEnglish
      : history?.patientFinalQuestionsComments || "",
  );

  return [
    "Subjective:",
    subjective || "None",
    "",
    "Physical Findings:",
    formatListSection(physicalFindings),
    "",
    "Assessment:",
    assessment || "None",
    "",
    "Investigations:",
    formatListSection(investigations),
    "",
    "Plan:",
    formatListSection(plan),
    "",
    "Patient Final Comments:",
    patientFinalComments || "None",
  ].join("\n");
};

type ParsedUnifiedHpi = {
  subjective: string;
  assessment: string;
  physicalFindings: string[];
  investigations: string[];
  plan: string[];
  patientFinalComments: string;
};

const parseUnifiedHpiText = (value: string): ParsedUnifiedHpi | null => {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  const currentOrderPattern =
    /Subjective:\s*([\s\S]*?)\n\s*Physical Findings:\s*([\s\S]*?)\n\s*Assessment:\s*([\s\S]*?)\n\s*Investigations:\s*([\s\S]*?)\n\s*Plan:\s*([\s\S]*?)\n\s*Patient Final Comments:\s*([\s\S]*)$/i;
  const noInvestigationsPattern =
    /Subjective:\s*([\s\S]*?)\n\s*Physical Findings:\s*([\s\S]*?)\n\s*Assessment:\s*([\s\S]*?)\n\s*Plan:\s*([\s\S]*?)\n\s*Patient Final Comments:\s*([\s\S]*)$/i;
  const legacyOrderPattern =
    /Subjective:\s*([\s\S]*?)\n\s*Assessment:\s*([\s\S]*?)\n\s*Physical Findings:\s*([\s\S]*?)\n\s*Plan:\s*([\s\S]*?)\n\s*Patient Final Comments:\s*([\s\S]*)$/i;

  const currentMatch = normalized.match(currentOrderPattern);
  if (currentMatch) {
    return {
      subjective: stripOptionalNone(currentMatch[1] || ""),
      physicalFindings: normalizeListBlock(currentMatch[2] || ""),
      assessment: stripOptionalNone(currentMatch[3] || ""),
      investigations: normalizeListBlock(currentMatch[4] || ""),
      plan: normalizeListBlock(currentMatch[5] || ""),
      patientFinalComments: stripOptionalNone(currentMatch[6] || ""),
    };
  }

  const noInvestigationsMatch = normalized.match(noInvestigationsPattern);
  if (noInvestigationsMatch) {
    return {
      subjective: stripOptionalNone(noInvestigationsMatch[1] || ""),
      physicalFindings: normalizeListBlock(noInvestigationsMatch[2] || ""),
      assessment: stripOptionalNone(noInvestigationsMatch[3] || ""),
      investigations: [],
      plan: normalizeListBlock(noInvestigationsMatch[4] || ""),
      patientFinalComments: stripOptionalNone(noInvestigationsMatch[5] || ""),
    };
  }

  const legacyMatch = normalized.match(legacyOrderPattern);
  if (!legacyMatch) return null;
  return {
    subjective: stripOptionalNone(legacyMatch[1] || ""),
    assessment: stripOptionalNone(legacyMatch[2] || ""),
    physicalFindings: normalizeListBlock(legacyMatch[3] || ""),
    investigations: [],
    plan: normalizeListBlock(legacyMatch[4] || ""),
    patientFinalComments: stripOptionalNone(legacyMatch[5] || ""),
  };
};

const formatHpiUpdatedAt = (value?: string): string => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
};

type HpiSections = {
  subjective: string;
  physicalFindings: string[];
  assessment: string;
  investigations: string[];
  plan: string[];
  patientFinalComments: string;
};

const getHpiSections = (history?: PatientSession["history"]): HpiSections => {
  const subjective = stripOptionalNone(history?.summary || "");
  const assessment = stripOptionalNone(history?.assessment || "");
  const physicalFindings = toStringList((history as any)?.physicalFindings);
  const investigations = toStringList((history as any)?.investigations).map((item) => item.replace(/^[-*•]\s*/, "").trim());
  const plan = toStringList((history as any)?.plan).map((item) => item.replace(/^[-*•]\s*/, "").trim());
  const patientFinalComments = stripOptionalNone(
    history?.patientFinalQuestionsCommentsEnglish?.trim()
      ? history.patientFinalQuestionsCommentsEnglish
      : history?.patientFinalQuestionsComments || "",
  );

  return {
    subjective: subjective || "None",
    physicalFindings,
    assessment: assessment || "None",
    investigations,
    plan,
    patientFinalComments: patientFinalComments || "None",
  };
};

const getHpiAiSummary = (sections: HpiSections): string => {
  const firstSentence = sections.subjective
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .find((part) => part.length > 0 && part.toLowerCase() !== "none");
  if (firstSentence) return firstSentence;

  const fallback = [sections.assessment, ...sections.physicalFindings, ...sections.plan]
    .map((part) => part.trim())
    .find((part) => part.length > 0 && part.toLowerCase() !== "none");
  return fallback || "Clinical summary not available.";
};

function PhysicianViewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionCode = searchParams.get("code");

  const [session, setSession] = useState<PatientSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastFinalCommentsTranslateKeyRef = useRef<string | null>(null);
  const [isEditingHpi, setIsEditingHpi] = useState(false);
  const [hpiCombinedDraft, setHpiCombinedDraft] = useState("");
  const [hpiSaving, setHpiSaving] = useState(false);
  const [hpiSaveError, setHpiSaveError] = useState<string | null>(null);
  const [hpiSaveSuccess, setHpiSaveSuccess] = useState<string | null>(null);
  const [hpiCopyStatus, setHpiCopyStatus] = useState<string | null>(null);
  const [aiAction, setAiAction] = useState<"referral_letter" | "labs" | "custom" | "lab_requisition" | "prescription">("referral_letter");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [labPatientName, setLabPatientName] = useState("");
  const [labPatientEmail, setLabPatientEmail] = useState("");
  const [labPhysicianName, setLabPhysicianName] = useState("");
  const [labClinicName, setLabClinicName] = useState("");
  const [labClinicAddress, setLabClinicAddress] = useState("");
  const [labLabsInput, setLabLabsInput] = useState("");
  const [labInstructions, setLabInstructions] = useState("");
  const [labStatus, setLabStatus] = useState<string | null>(null);
  const [labSaving, setLabSaving] = useState(false);
  const [rxMedications, setRxMedications] = useState<RxMedicationRow[]>([makeRxMedicationRow()]);
  const [rxStatus, setRxStatus] = useState<string | null>(null);
  const [rxSaving, setRxSaving] = useState(false);
  const [rxHasSignature, setRxHasSignature] = useState(false);
  const [isEditingPharmacy, setIsEditingPharmacy] = useState(false);
  const [pharmacySaving, setPharmacySaving] = useState(false);
  const [pharmacySearching, setPharmacySearching] = useState(false);
  const [pharmacyStatus, setPharmacyStatus] = useState<string | null>(null);
  const [pharmacyDraft, setPharmacyDraft] = useState<PharmacyFields>(emptyPharmacyFields);
  const [labList, setLabList] = useState<
    Array<{
      id: string;
      createdAt: string;
      physicianName: string | null;
      clinicName: string | null;
      labs: string[] | null;
    }>
  >([]);
  const [labListLoading, setLabListLoading] = useState(false);
  const [labListError, setLabListError] = useState<string | null>(null);
  const [prescriptionList, setPrescriptionList] = useState<
    Array<{
      id: string;
      createdAt: string;
      physicianName: string | null;
      clinicName: string | null;
      faxStatus: string;
      faxError: string | null;
      faxSentAt: string | null;
      prescriptionStatus: string;
      attestedAt: string | null;
      medications: Array<{
        medication: string;
        strength?: string | null;
        sig: string;
        quantity?: string | null;
        refills?: string | null;
        notes?: string | null;
      }>;
    }>
  >([]);
  const [prescriptionListLoading, setPrescriptionListLoading] = useState(false);
  const [prescriptionListError, setPrescriptionListError] = useState<string | null>(null);
  const labPrefillRequestedRef = useRef(false);
  const [labPrefillStatus, setLabPrefillStatus] = useState<string | null>(null);
  const [formAnswers, setFormAnswers] = useState<{ question: string; answer: string }[] | null>(null);
  const [formAnswersLoading, setFormAnswersLoading] = useState(false);
  const [formAnswersError, setFormAnswersError] = useState<string | null>(null);
  const [filledPdfLoading, setFilledPdfLoading] = useState(false);
  const [filledPdfError, setFilledPdfError] = useState<string | null>(null);
  const rxSignatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rxSignatureDrawingRef = useRef(false);

  // Physician Encounter Notes — recording state
  const [encounterRecording, setEncounterRecording] = useState(false);
  const [encounterTranscript, setEncounterTranscript] = useState("");
  const [encounterTranscriptLoading, setEncounterTranscriptLoading] = useState(false);
  const [encounterMerging, setEncounterMerging] = useState(false);
  const [encounterMergeError, setEncounterMergeError] = useState<string | null>(null);
  const [encounterRecordingError, setEncounterRecordingError] = useState<string | null>(null);
  const encounterMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const encounterMediaStreamRef = useRef<MediaStream | null>(null);
  const encounterMediaChunksRef = useRef<Blob[]>([]);
  const encounterSegmentIndexRef = useRef(0);
  const encounterPendingTranscriptionsRef = useRef<Promise<void>[]>([]);
  const encounterTimerIntervalRef = useRef<number | null>(null);
  const encounterFlushIntervalRef = useRef<number | null>(null);
  const encounterTranscriptRef = useRef("");

  const parsedRxFromHistory = useMemo(() => {
    if (!session?.history) return { medications: [] as Omit<RxMedicationRow, "id">[], notes: "" };
    const history: any = session.history;
    const planItems: string[] = [];
    if (Array.isArray(history.plan)) {
      planItems.push(...history.plan);
    } else if (history.plan && typeof history.plan === "string") {
      planItems.push(history.plan);
    }
    const medWord = "[A-Za-z(][A-Za-z0-9()/-]*";
    const medNamePattern = `${medWord}(?:\\s+${medWord}){0,5}`;
    const medDoseRegex = new RegExp(
      `(${medNamePattern}(?:\\s+${medWord}){0,5}?)\\s+(\\d+\\s?(mg|mcg|g|ml|tabs?|tablets?|caps?|puffs?|units?))\\b`,
      "gi",
    );
    const sigStartRegex = /\b(take|apply|inhale|inject|use|insert|instill|swish|chew)\b/i;
    const medications: Omit<RxMedicationRow, "id">[] = [];
    let notes = "";

    const normalizeMedicationName = (raw: string): string => {
      const normalized = raw
        .trim()
        .replace(/^symptomatic treatment(?: with)?\s+/i, "")
        .replace(/^(with|and|or)\s+/i, "")
        .replace(/^(start|continue|consider|use|take)\s+/i, "")
        .replace(/\s{2,}/g, " ")
        .replace(/[,:;-]+$/, "")
        .trim();
      const segments = normalized.split(/\b(?:and|or)\b/i).map((segment) => segment.trim()).filter(Boolean);
      return segments.length > 0 ? segments[segments.length - 1] : normalized;
    };

    for (const item of planItems) {
      if (!item) continue;
      const normalized = item.replace(/\s+/g, " ").trim();
      const matches = Array.from(normalized.matchAll(medDoseRegex));
      if (matches.length === 0) continue;
      matches.forEach((match, idx) => {
        const matchStart = typeof match.index === "number" ? match.index : 0;
        const fullMatch = match[0] || "";
        const medRaw = match[1] || "";
        const strength = match[2] || "";
        const sigStart = matchStart + fullMatch.length;
        const nextStart =
          idx + 1 < matches.length && typeof matches[idx + 1].index === "number"
            ? (matches[idx + 1].index as number)
            : normalized.length;
        let med = normalizeMedicationName(medRaw);
        let sig = normalized
          .slice(sigStart, nextStart)
          .trim()
          .replace(/^[-,:;\s]+/, "")
          .replace(/\s{2,}/g, " ");

        const medSigBoundary = sigStartRegex.exec(med);
        if (medSigBoundary && medSigBoundary.index > 0) {
          const medOnly = med.slice(0, medSigBoundary.index).trim().replace(/[,:;-]+$/, "");
          const movedSig = med.slice(medSigBoundary.index).trim();
          if (medOnly) med = medOnly;
          if (!sig) sig = movedSig;
        }

        if (!med || !sig) return;
        const exists = medications.some(
          (row) =>
            row.medication.toLowerCase() === med.toLowerCase() &&
            row.strength.toLowerCase() === strength.toLowerCase() &&
            row.sig.toLowerCase() === sig.toLowerCase(),
        );
        if (exists) return;
        medications.push({
          medication: med,
          strength,
          sig,
          quantity: "",
          refills: "",
          notes: "",
        });
      });

      // Fallback for common OTC combos that may be written in one sentence.
      const lower = normalized.toLowerCase();
      const commonMedicationNames = ["acetaminophen", "tylenol", "ibuprofen", "advil", "naproxen", "aleve"];
      commonMedicationNames.forEach((name) => {
        if (!lower.includes(name)) return;
        const hasNameAlready = medications.some((row) => row.medication.toLowerCase().includes(name));
        if (hasNameAlready) return;
        const doseMatch = new RegExp(
          `${name}\\s*(\\d+\\s?(mg|mcg|g|ml|tabs?|tablets?|caps?|puffs?|units?))`,
          "i",
        ).exec(normalized);
        const sigStartAt = lower.indexOf(name);
        const sigFromName =
          sigStartAt >= 0
            ? normalized
                .slice(sigStartAt)
                .replace(new RegExp(`^${name}\\s*(\\d+\\s?(mg|mcg|g|ml|tabs?|tablets?|caps?|puffs?|units?))?`, "i"), "")
                .replace(/^[-,:;\s]+/, "")
                .trim()
            : "";
        if (!sigFromName) return;
        medications.push({
          medication: name[0].toUpperCase() + name.slice(1),
          strength: doseMatch?.[1] || "",
          sig: sigFromName,
          quantity: "",
          refills: "",
          notes: "",
        });
      });
    }
    if (medications.length === 0 && planItems.length) {
      const medicationLikeNoteLines = planItems
        .map((item) => item.trim())
        .filter(Boolean)
        .filter(
          (item) =>
            RX_NOTE_MEDICATION_HINT_REGEX.test(item) &&
            !RX_NOTE_NON_MEDICATION_HINT_REGEX.test(item),
        );
      if (medicationLikeNoteLines.length > 0) {
        notes = medicationLikeNoteLines.join("\n");
      }
    }
    return { medications, notes };
  }, [session]);

  const NO_ROUTINE_LABS_TEXT = "no routine labs recommended";
  const LAB_REQUISITION_PREFILL_PROMPT =
    'Return only routine laboratory tests (blood/urine/stool/swab) relevant to this HPI. Do not include imaging or non-lab diagnostics. If no routine labs are recommended, return exactly: "no routine labs recommended". Output must be one short line only: either that exact phrase or a comma-separated list of lab names with no explanations.';

  const normalizeLabSuggestionPrefill = (raw: string): string => {
    const text = raw.trim();
    if (!text) return NO_ROUTINE_LABS_TEXT;

    const lower = text.toLowerCase();
    if (lower.includes(NO_ROUTINE_LABS_TEXT)) return NO_ROUTINE_LABS_TEXT;
    if (/^(none|no labs?)\.?$/i.test(text)) return NO_ROUTINE_LABS_TEXT;

    const diagnosticKeywords = [
      "x-ray",
      "xray",
      "mri",
      "ct",
      "ultrasound",
      "echo",
      "ecg",
      "ekg",
      "doppler",
      "pet",
      "spirometry",
      "imaging",
    ];

    const normalizedItems = text
      .replace(/\r/g, "")
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .map((item) => item.replace(/^[-*•\d\).\s]+/, "").trim())
      .map((item) => item.replace(/\b(recommended|if indicated)\b/gi, "").trim())
      .map((item) => item.replace(/[.]+$/, "").trim())
      .filter(Boolean)
      .filter((item) => {
        const candidate = item.toLowerCase();
        return !diagnosticKeywords.some((keyword) => candidate.includes(keyword));
      });

    const deduped: string[] = [];
    const seen = new Set<string>();
    normalizedItems.forEach((item) => {
      const key = item.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    });

    return deduped.length > 0 ? deduped.join(", ") : NO_ROUTINE_LABS_TEXT;
  };

  useEffect(() => {
    if (!sessionCode) {
      setError("Session code is required");
      setLoading(false);
      return;
    }

    // Fetch session (API will verify physician ownership)
    fetch(`/api/sessions?code=${sessionCode}`)
      .then((res) => {
        if (res.status === 401) {
          router.push("/auth/login");
          return null;
        }
        if (res.status === 404) {
          throw new Error("Session not found or expired");
        }
        return res.json();
      })
      .then((data) => {
        if (data) {
          if (data.error) {
            setError(data.error);
          } else {
            // Debug logging
            if (process.env.NODE_ENV === "development") {
              console.log("[physician/view] Received session data:", {
                hasTranscript: !!data.transcript,
                transcriptLength: data.transcript?.length || 0,
                transcriptType: Array.isArray(data.transcript) ? "array" : typeof data.transcript,
                hasHistoryTranscript: !!(data.history as any)?.transcript,
                historyTranscriptLength: (data.history as any)?.transcript?.length || 0,
                hasHistory: !!data.history,
                historyKeys: data.history ? Object.keys(data.history) : [],
                fullDataKeys: Object.keys(data),
                hasImageSummary: !!data.imageSummary,
                hasImageUrl: !!data.imageUrl,
                imageUrlType: typeof data.imageUrl,
                imageUrlLength: data.imageUrl ? data.imageUrl.length : 0,
                imageUrlPreview: data.imageUrl ? data.imageUrl.substring(0, 50) + "..." : null,
                imageName: data.imageName,
              });
            }
            
            // Enhanced transcript extraction with multiple fallbacks
            let transcript: import("@/lib/interview-schema").InterviewMessage[] = [];
            
            // Try top-level transcript first
            if (data.transcript && Array.isArray(data.transcript)) {
              transcript = data.transcript;
            }
            // Fallback to history.transcript
            else if ((data.history as any)?.transcript && Array.isArray((data.history as any).transcript)) {
              transcript = (data.history as any).transcript;
            }
            // If transcript exists but is not an array, log warning
            else if (data.transcript || (data.history as any)?.transcript) {
              console.warn("[physician/view] Transcript exists but is not an array:", {
                topLevelType: typeof data.transcript,
                historyType: typeof (data.history as any)?.transcript,
              });
              transcript = [];
            }
            
            // Convert ISO strings back to Date objects
            setSession({
              ...data,
              transcript: transcript, // Always ensure transcript is an array
              completedAt: new Date(data.completedAt),
              viewedAt: data.viewedAt ? new Date(data.viewedAt) : undefined,
            });
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error fetching session:", err);
        setError(err.message || "Failed to load session");
        setLoading(false);
      });
  }, [sessionCode, router]);

  useEffect(() => {
    if (!sessionCode || !session) return;

    const original = session.history?.patientFinalQuestionsComments?.trim() || "";
    const english = session.history?.patientFinalQuestionsCommentsEnglish?.trim() || "";
    const interviewLanguage = (session.history?.interviewLanguage || "").trim().toLowerCase();
    const isEnglishInterview = !interviewLanguage || interviewLanguage.startsWith("en");
    // Retry translation if english is missing OR if it matches the original non-English text
    // (the latter happens when a prior save stored the untranslated text due to an Azure fallback bug).
    const needsTranslation = original && (!english || (!isEnglishInterview && english === original));
    if (!needsTranslation) return;

    const key = `${sessionCode}::${original}`;
    if (lastFinalCommentsTranslateKeyRef.current === key) return;
    lastFinalCommentsTranslateKeyRef.current = key;

    let isActive = true;
    fetch("/api/physician/translate-final-comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionCode }),
    })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as {
          translation?: string;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(payload.error || "Translation failed.");
        }
        const translated = (payload.translation || "").trim();
        if (!translated) return;
        if (!isActive) return;

        setSession((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            history: {
              ...prev.history,
              patientFinalQuestionsCommentsEnglish: translated,
            },
          };
        });
      })
      .catch((err) => {
        // Fall back to original text if translation fails.
        console.warn("[physician/view] Final comments translation failed:", err);
      });

    return () => {
      isActive = false;
    };
  }, [
    sessionCode,
    session?.history?.patientFinalQuestionsComments,
    session?.history?.patientFinalQuestionsCommentsEnglish,
  ]);

  // Auto-generate form answers when session loads and has form questions
  useEffect(() => {
    if (!sessionCode || !session) return;
    const formSummary = (session.history as any)?.formSummary as string | undefined;
    if (!formSummary?.trim()) return;

    // Use cached answers already stored in the session
    const cached = (session.history as any)?.formAnswers;
    if (Array.isArray(cached) && cached.length > 0) {
      setFormAnswers(cached);
      return;
    }

    let isActive = true;
    setFormAnswersLoading(true);
    setFormAnswersError(null);

    fetch("/api/generate-form-answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionCode }),
    })
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as {
          formAnswers?: { question: string; answer: string }[];
          error?: string;
        };
        if (!res.ok) throw new Error(payload.error || "Failed to generate form answers.");
        if (isActive && Array.isArray(payload.formAnswers)) {
          setFormAnswers(payload.formAnswers);
        }
      })
      .catch((err) => {
        if (isActive) {
          setFormAnswersError(err.message || "Unable to generate form responses.");
        }
      })
      .finally(() => {
        if (isActive) setFormAnswersLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [sessionCode, session?.sessionCode]);

  const handleBack = () => {
    router.push("/physician/dashboard");
  };

  function scoreToLabel(score: number): string {
    return (
      ["Not at all", "Several days", "More than half the days", "Nearly every day"][score] ??
      String(score)
    );
  }

  const handleDownloadPhqGadPdf = async () => {
    const r = (session?.history as any)?.phqGadResults as import("@/lib/history-schema").PhqGadResults | undefined;
    if (!r) return;
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const contentX = 15;
    const contentW = pageW - 30;
    let y = 15;
    const lh = 6;

    const phq9SeverityLabel: Record<string, string> = {
      minimal: "Minimal/No Depression",
      mild: "Mild Depression",
      moderate: "Moderate Depression",
      moderately_severe: "Moderately Severe Depression",
      severe: "Severe Depression",
    };
    const gad7SeverityLabel: Record<string, string> = {
      minimal: "Minimal Anxiety",
      mild: "Mild Anxiety",
      moderate: "Moderate Anxiety",
      severe: "Severe Anxiety",
    };

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("PHQ-9 / GAD-7 Screening Results", contentX, y);
    y += lh + 2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Patient: ${session?.patientName || "N/A"}`, contentX, y);
    y += lh;
    doc.text(
      `Date: ${r.completedAt ? new Date(r.completedAt).toLocaleDateString() : "N/A"}`,
      contentX,
      y,
    );
    y += lh + 4;

    // PHQ-9
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(
      `PHQ-9 — Total Score: ${r.phq9.total}/27 (${phq9SeverityLabel[r.phq9.severity] ?? r.phq9.severity})`,
      contentX,
      y,
    );
    y += lh + 1;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    for (let i = 0; i < r.phq9.items.length; i++) {
      const item = r.phq9.items[i];
      const isQ9Alert = i === 8 && item.score > 0;
      if (isQ9Alert) {
        doc.setTextColor(200, 0, 0);
        const lines = doc.splitTextToSize(
          `${i + 1}. ${item.question}: ${scoreToLabel(item.score)} (${item.score}) ⚠ Requires clinical attention`,
          contentW,
        ) as string[];
        doc.text(lines, contentX, y);
        doc.setTextColor(0, 0, 0);
        y += lines.length * lh;
      } else {
        const lines = doc.splitTextToSize(
          `${i + 1}. ${item.question}: ${scoreToLabel(item.score)} (${item.score})`,
          contentW,
        ) as string[];
        doc.text(lines, contentX, y);
        y += lines.length * lh;
      }
      if (y > 270) {
        doc.addPage();
        y = 15;
      }
    }

    y += 4;
    // GAD-7
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(
      `GAD-7 — Total Score: ${r.gad7.total}/21 (${gad7SeverityLabel[r.gad7.severity] ?? r.gad7.severity})`,
      contentX,
      y,
    );
    y += lh + 1;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    for (let i = 0; i < r.gad7.items.length; i++) {
      const item = r.gad7.items[i];
      const lines = doc.splitTextToSize(
        `${i + 1}. ${item.question}: ${scoreToLabel(item.score)} (${item.score})`,
        contentW,
      ) as string[];
      doc.text(lines, contentX, y);
      y += lines.length * lh;
      if (y > 270) {
        doc.addPage();
        y = 15;
      }
    }

    const safeName = (session?.patientName || "patient").replace(/\s+/g, "-").toLowerCase();
    const dateStr = new Date().toISOString().slice(0, 10);
    doc.save(`phq-gad-${safeName}-${dateStr}.pdf`);
  };

  const handleDownloadFormAnswers = () => {
    if (!formAnswers || formAnswers.length === 0) return;
    const patientName = session?.patientName || "patient";
    const lines = formAnswers
      .map((qa, i) => `Q${i + 1}: ${qa.question}\nA:  ${qa.answer}`)
      .join("\n\n");
    const text = `Form Responses — ${patientName}\n${"=".repeat(50)}\n\n${lines}\n`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `form-responses-${patientName.replace(/\s+/g, "-").toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadFilledPdf = async () => {
    if (!sessionCode || !formAnswers || formAnswers.length === 0) return;
    setFilledPdfLoading(true);
    setFilledPdfError(null);
    try {
      const res = await fetch(`/api/fill-form-pdf?code=${encodeURIComponent(sessionCode)}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "Failed to generate filled PDF.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const patientName = session?.patientName || "patient";
      a.download = match?.[1] || `filled-form-${patientName.replace(/\s+/g, "-").toLowerCase()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setFilledPdfError(err instanceof Error ? err.message : "Unable to generate filled PDF.");
    } finally {
      setFilledPdfLoading(false);
    }
  };

  const handleDownloadPatientImages = async () => {
    const patientName = session?.patientName || "patient";
    const safeName = patientName.replace(/\s+/g, "-").toLowerCase();
    const downloads: { url: string; filename: string }[] = [];

    // Collect lesion/uploaded photo
    if (hpiLesionImageUrl) {
      const ext = hpiLesionImageName ? hpiLesionImageName.split(".").pop() || "jpg" : "jpg";
      downloads.push({ url: hpiLesionImageUrl, filename: `${safeName}-lesion-image.${ext}` });
    }

    // Render each body diagram with markers onto a canvas
    for (let i = 0; i < hpiDiagramSelectionsToRender.length; i++) {
      const selection = hpiDiagramSelectionsToRender[i];
      const image = getBodyDiagramImage(
        selection.part,
        selection.side,
        session?.patientProfile?.sex === "male" || session?.patientProfile?.sex === "female"
          ? session.patientProfile.sex
          : undefined,
      );
      const partLabel = selection.side
        ? `${selection.side}-${selection.part}`
        : selection.part;

      await new Promise<void>((resolve) => {
        const img = document.createElement("img");
        img.onload = () => {
          const SIZE = 576;
          const canvas = document.createElement("canvas");
          canvas.width = SIZE;
          canvas.height = SIZE;
          const ctx = canvas.getContext("2d");
          if (!ctx) { resolve(); return; }

          // Draw white background
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, SIZE, SIZE);

          // Draw image with object-contain behavior
          const scale = Math.min(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
          const drawW = img.naturalWidth * scale;
          const drawH = img.naturalHeight * scale;
          const offsetX = (SIZE - drawW) / 2;
          const offsetY = (SIZE - drawH) / 2;
          ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

          // Draw markers — coordinates are stored relative to the image content
          // area (after object-contain letterbox/pillarbox), so apply offsetX/Y
          // and scale to the drawn image dimensions, not the full canvas SIZE.
          ctx.fillStyle = "#dc2626";
          ctx.font = `bold ${Math.round(SIZE * 0.07)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          for (const marker of selection.markers) {
            const mx = offsetX + (marker.xPct / 100) * drawW;
            const my = offsetY + (marker.yPct / 100) * drawH;
            ctx.fillText("X", mx, my);
          }

          canvas.toBlob((blob) => {
            if (blob) {
              downloads.push({
                url: URL.createObjectURL(blob),
                filename: `${safeName}-body-diagram-${partLabel}.png`,
              });
            }
            resolve();
          }, "image/png");
        };
        img.onerror = () => resolve();
        img.src = image.src;
      });
    }

    // Trigger downloads sequentially
    for (const dl of downloads) {
      const a = document.createElement("a");
      a.href = dl.url;
      a.download = dl.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      await new Promise((r) => setTimeout(r, 150));
    }

    // Revoke blob URLs
    for (const dl of downloads) {
      if (dl.url.startsWith("blob:")) URL.revokeObjectURL(dl.url);
    }
  };

  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const handleMarkReviewed = async () => {
    if (!sessionCode) return;
    setReviewing(true);
    setReviewError(null);
    try {
      const res = await fetch("/api/sessions/reviewed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReviewError(data?.error || "Failed to mark reviewed");
        return;
      }
      router.push("/physician/dashboard");
    } catch {
      setReviewError("Failed to mark reviewed");
    } finally {
      setReviewing(false);
    }
  };

  const handleDelete = async () => {
    if (!sessionCode || !confirm("Are you sure you want to delete this session?")) {
      return;
    }

    try {
      const res = await fetch(`/api/sessions?code=${sessionCode}`, {
        method: "DELETE",
      });

      if (res.ok) {
        router.push("/physician/dashboard");
      } else {
        setError("Failed to delete session");
      }
    } catch (err) {
      console.error("Error deleting session:", err);
      setError("Failed to delete session");
    }
  };

  const handleStartHpiEdit = () => {
    setHpiCombinedDraft(composeUnifiedHpiText(session?.history || ({} as PatientSession["history"])));
    setHpiSaveError(null);
    setHpiSaveSuccess(null);
    setHpiCopyStatus(null);
    setIsEditingHpi(true);
  };

  const handleCancelHpiEdit = () => {
    setHpiCombinedDraft(composeUnifiedHpiText(session?.history || ({} as PatientSession["history"])));
    setHpiSaveError(null);
    setHpiSaveSuccess(null);
    setHpiCopyStatus(null);
    setIsEditingHpi(false);
  };

  const handleSaveHpiEdit = async () => {
    if (!sessionCode) {
      setHpiSaveError("Session code is missing.");
      return;
    }

    const parsed = parseUnifiedHpiText(hpiCombinedDraft);
    if (!parsed) {
      setHpiSaveError(
        "Invalid HPI format. Keep the section headers: Subjective, Physical Findings, Assessment, Investigations, Plan, Patient Final Comments.",
      );
      return;
    }

    if (parsed.subjective.length < 10 || parsed.subjective.length > 1500) {
      setHpiSaveError("Subjective must be between 10 and 1500 characters.");
      return;
    }
    if (parsed.assessment.length < 10 || parsed.assessment.length > 1500) {
      setHpiSaveError("Assessment must be between 10 and 1500 characters.");
      return;
    }
    if (parsed.physicalFindings.length > 60) {
      setHpiSaveError("Physical Findings must include at most 60 items.");
      return;
    }
    if (parsed.plan.length > 60) {
      setHpiSaveError("Plan must include at most 60 items.");
      return;
    }
    if (parsed.patientFinalComments.length > 4000) {
      setHpiSaveError("Patient Final Comments must be 4000 characters or less.");
      return;
    }

    setHpiSaving(true);
    setHpiSaveError(null);
    setHpiSaveSuccess(null);

    try {
      const res = await fetch("/api/sessions", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionCode,
          historySummary: parsed.subjective,
          historyAssessment: parsed.assessment,
          historyPlan: parsed.plan,
          historyPhysicalFindings: parsed.physicalFindings,
          historyInvestigations: parsed.investigations,
          historyPatientFinalComments: parsed.patientFinalComments,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save HPI summary.");
      }
      const savedHpiUpdatedAt =
        typeof data?.historyHpiUpdatedAt === "string" && data.historyHpiUpdatedAt.trim().length > 0
          ? data.historyHpiUpdatedAt
          : new Date().toISOString();

      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          history: {
            ...prev.history,
            summary: parsed.subjective,
            assessment: parsed.assessment,
            physicalFindings: parsed.physicalFindings,
            investigations: parsed.investigations,
            plan: parsed.plan,
            patientFinalQuestionsComments: parsed.patientFinalComments || undefined,
            patientFinalQuestionsCommentsEnglish: parsed.patientFinalComments
              ? parsed.patientFinalComments
              : prev.history.patientFinalQuestionsCommentsEnglish,
            hpiUpdatedAt: savedHpiUpdatedAt,
          },
        };
      });
      setIsEditingHpi(false);
      setHpiSaveSuccess("HPI updated.");
    } catch (err) {
      setHpiSaveError(err instanceof Error ? err.message : "Failed to save HPI.");
    } finally {
      setHpiSaving(false);
    }
  };

  const handleCopyHpi = async () => {
    if (!session?.history) return;
    try {
      await navigator.clipboard.writeText(composeUnifiedHpiText(session.history));
      setHpiCopyStatus("HPI copied.");
      setHpiSaveError(null);
    } catch {
      setHpiCopyStatus("Unable to copy HPI.");
    }
  };

  const hasSavedPharmacyName =
    !!session?.patientProfile?.pharmacyName && session.patientProfile.pharmacyName.trim().length > 0;
  const hasAnySavedPharmacy =
    !!session?.patientProfile &&
    [
      session.patientProfile.pharmacyName,
      session.patientProfile.pharmacyNumber,
      session.patientProfile.pharmacyAddress,
      session.patientProfile.pharmacyCity,
      session.patientProfile.pharmacyPhone,
      session.patientProfile.pharmacyFax,
    ].some((value) => (value || "").trim().length > 0);

  const handleCancelPharmacyEdit = () => {
    setPharmacyDraft(pharmacyFieldsFromProfile(session?.patientProfile));
    setPharmacyStatus(null);
    setIsEditingPharmacy(false);
  };

  const handleSearchPharmacy = async () => {
    const pharmacyName = pharmacyDraft.pharmacyName.trim();
    const streetAddress = pharmacyDraft.pharmacyAddress.trim();
    const city = pharmacyDraft.pharmacyCity.trim();

    if (!pharmacyName || !streetAddress || !city) {
      setPharmacyStatus("Enter pharmacy name, street address, and city to search.");
      return;
    }

    setPharmacySearching(true);
    setPharmacyStatus(null);
    try {
      const response = await fetch("/api/pharmacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pharmacyName,
          address: streetAddress,
          city,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        pharmacies?: Array<{
          name: string;
          address: string;
          phone?: string;
          fax?: string;
        }>;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "No pharmacy found for that search.");
      }

      const firstMatch = payload.pharmacies?.[0];
      if (!firstMatch) {
        throw new Error("No pharmacy found for that search.");
      }

      setPharmacyDraft((prev) => ({
        ...prev,
        pharmacyName: firstMatch.name?.trim() || prev.pharmacyName,
        pharmacyAddress: firstMatch.address?.trim() || prev.pharmacyAddress,
        pharmacyCity: parseCityFromBcAddress(firstMatch.address || "") || prev.pharmacyCity,
        pharmacyPhone: firstMatch.phone?.trim() || prev.pharmacyPhone,
        pharmacyFax: firstMatch.fax?.trim() || prev.pharmacyFax,
      }));
      setPharmacyStatus("Pharmacy found. Review details and save.");
    } catch (error) {
      setPharmacyStatus(
        error instanceof Error ? error.message : "Unable to search pharmacy right now.",
      );
    } finally {
      setPharmacySearching(false);
    }
  };

  const handleSavePharmacy = async () => {
    if (!sessionCode) {
      setPharmacyStatus("Session code is missing.");
      return;
    }

    const normalized: PharmacyFields = {
      pharmacyName: pharmacyDraft.pharmacyName.trim(),
      pharmacyNumber: pharmacyDraft.pharmacyNumber.trim(),
      pharmacyAddress: pharmacyDraft.pharmacyAddress.trim(),
      pharmacyCity: pharmacyDraft.pharmacyCity.trim(),
      pharmacyPhone: pharmacyDraft.pharmacyPhone.trim(),
      pharmacyFax: pharmacyDraft.pharmacyFax.trim(),
    };

    setPharmacySaving(true);
    setPharmacyStatus(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionCode,
          ...normalized,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to update pharmacy.");
      }

      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          patientProfile: {
            ...prev.patientProfile,
            ...normalized,
          },
        };
      });
      setPharmacyDraft(normalized);
      setIsEditingPharmacy(false);
      setPharmacyStatus("Pharmacy updated.");
    } catch (err) {
      setPharmacyStatus(err instanceof Error ? err.message : "Failed to update pharmacy.");
    } finally {
      setPharmacySaving(false);
    }
  };

  const handleAiSubmit = async () => {
    if (aiAction === "lab_requisition" || aiAction === "prescription") {
      return;
    }
    if (!sessionCode) {
      setAiError("Session code is missing.");
      return;
    }

    setAiLoading(true);
    setAiError(null);
    setAiResponse("");

    try {
      const res = await fetch("/api/physician/hpi-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionCode,
          action: aiAction,
          prompt: aiPrompt || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to generate AI response.");
      }

      if (typeof data.result !== "string") {
        throw new Error("Unexpected response format from AI service.");
      }

      setAiResponse(data.result.trim());
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Failed to generate AI response.");
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (session) {
      setLabPatientName(session.patientName || "");
      setLabPatientEmail(session.patientEmail || "");
    }
  }, [session]);

  useEffect(() => {
    if (session?.history) {
      setHpiCombinedDraft(composeUnifiedHpiText(session.history));
    } else {
      setHpiCombinedDraft("");
    }
  }, [session?.history]);

  useEffect(() => {
    if (!session?.patientProfile) {
      setPharmacyDraft(emptyPharmacyFields());
      return;
    }
    setPharmacyDraft(pharmacyFieldsFromProfile(session.patientProfile));
  }, [session?.patientProfile]);

  useEffect(() => {
    const fetchAiLabs = async () => {
      if (
        aiAction !== "lab_requisition" ||
        labLabsInput.trim() !== "" ||
        labPrefillRequestedRef.current ||
        !sessionCode
      ) {
        return;
      }
      labPrefillRequestedRef.current = true;
      setLabPrefillStatus("Fetching AI lab suggestions…");
      try {
        const res = await fetch("/api/physician/hpi-actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionCode,
            action: "labs",
            prompt: LAB_REQUISITION_PREFILL_PROMPT,
          }),
        });
        if (!res.ok) {
          // If AI is unavailable, default to explicit no-routine-labs text.
          setLabLabsInput(NO_ROUTINE_LABS_TEXT);
          setLabPrefillStatus("No routine labs recommended.");
          labPrefillRequestedRef.current = false; // allow retry on re-select
          return;
        }
        const data = await res.json();
        if (typeof data.result === "string" && data.result.trim().length > 0) {
          const normalized = normalizeLabSuggestionPrefill(data.result);
          setLabLabsInput(normalized);
          setLabPrefillStatus(
            normalized === NO_ROUTINE_LABS_TEXT
              ? "No routine labs recommended."
              : "AI lab suggestions applied.",
          );
        } else {
          setLabPrefillStatus("No AI lab suggestions returned.");
          labPrefillRequestedRef.current = false; // allow retry on re-select
        }
      } catch {
        // If AI request fails, default to explicit no-routine-labs text.
        setLabLabsInput(NO_ROUTINE_LABS_TEXT);
        setLabPrefillStatus("No routine labs recommended.");
        labPrefillRequestedRef.current = false; // allow retry on re-select
      }
    };
    fetchAiLabs();
  }, [aiAction, labLabsInput, sessionCode]);

  useEffect(() => {
    if (aiAction === "prescription") {
      const hasAnyInput = rxMedications.some((row) =>
        [row.medication, row.strength, row.sig, row.quantity, row.refills, row.notes].some(
          (value) => value.trim().length > 0,
        ),
      );
      if (!hasAnyInput && parsedRxFromHistory.medications.length > 0) {
        setRxMedications(parsedRxFromHistory.medications.map((row) => makeRxMedicationRow(row)));
      }
    }
  }, [aiAction, parsedRxFromHistory, rxMedications]);

  useEffect(() => {
    const maybeLoadPrescription = async () => {
      if (aiAction !== "prescription" || !sessionCode) return;
      try {
        const res = await fetch(`/api/prescriptions?code=${sessionCode}`);
        if (!res.ok) return;
        const data = await res.json();
        const parsedRows = parsedRxFromHistory.medications;
        const incomingRows = Array.isArray(data?.medications)
          ? data.medications
              .map((row: any) =>
                makeRxMedicationRow({
                  medication: row?.medication || "",
                  strength: row?.strength || "",
                  sig: row?.sig || "",
                  quantity: row?.quantity || "",
                  refills: row?.refills || "",
                  notes: row?.notes || "",
                }),
              )
              .filter((row: RxMedicationRow) => row.medication || row.sig || row.notes)
          : [];
        if (incomingRows.length > 0) {
          setRxMedications(mergeRxRows(incomingRows, parsedRows));
        } else if (parsedRows.length > 0) {
          setRxMedications(parsedRows.map((row) => makeRxMedicationRow(row)));
        } else if (data?.medication) {
          setRxMedications([
            makeRxMedicationRow({
              medication: data.medication || "",
              strength: data.strength || "",
              sig: data.sig || "",
              quantity: data.quantity || "",
              refills: data.refills || "",
              notes: data.notes || "",
            }),
          ]);
        }
        if (data?.patientName || data?.patientEmail || data?.physicianName || data?.clinicName || data?.clinicAddress) {
          if (data.patientName) setLabPatientName(data.patientName);
          if (data.patientEmail) setLabPatientEmail(data.patientEmail);
          if (data.physicianName) setLabPhysicianName(data.physicianName);
          if (data.clinicName) setLabClinicName(data.clinicName);
          if (data.clinicAddress) setLabClinicAddress(data.clinicAddress);
        }
      } catch {
        // ignore
      }
    };
    maybeLoadPrescription();
  }, [aiAction, sessionCode, parsedRxFromHistory]);

  const loadLabList = async () => {
    if (!sessionCode) return;
    setLabListLoading(true);
    setLabListError(null);
    try {
      const res = await fetch(`/api/lab-requisitions?code=${sessionCode}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const apiMessage =
          typeof data?.error === "string" && data.error.trim().length > 0
            ? data.error
            : null;
        if (res.status === 404) {
          setLabList([]);
          setLabListError(null);
          return;
        }
        throw new Error(apiMessage || "Failed to load lab requisitions");
      }
      const data = await res.json();
      setLabList(
        (data?.requisitions || []).map((r: any) => ({
          id: r.id,
          createdAt: r.createdAt,
          physicianName: r.physicianName,
          clinicName: r.clinicName,
          labs: Array.isArray(r.labs) ? r.labs : null,
        })),
      );
    } catch (err) {
      setLabListError(err instanceof Error ? err.message : "Failed to load lab requisitions");
    } finally {
      setLabListLoading(false);
    }
  };

  const loadPrescriptionList = async () => {
    if (!sessionCode) return;
    setPrescriptionListLoading(true);
    setPrescriptionListError(null);
    try {
      const res = await fetch(`/api/prescriptions?code=${sessionCode}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 404) {
          setPrescriptionList([]);
          setPrescriptionListError(null);
          return;
        }
        throw new Error(
          typeof data?.error === "string" && data.error.trim().length > 0
            ? data.error
            : "Failed to load prescriptions",
        );
      }
      const data = await res.json();
      const rows = Array.isArray(data?.prescriptions) ? data.prescriptions : [];
      setPrescriptionList(
        rows.map((row: any) => ({
          id: row.id,
          createdAt: row.createdAt,
          physicianName: row.physicianName ?? null,
          clinicName: row.clinicName ?? null,
          faxStatus: typeof row.faxStatus === "string" ? row.faxStatus : "not_sent",
          faxError: typeof row.faxError === "string" ? row.faxError : null,
          faxSentAt: typeof row.faxSentAt === "string" ? row.faxSentAt : null,
          prescriptionStatus:
            typeof row.prescriptionStatus === "string" ? row.prescriptionStatus : "draft",
          attestedAt: typeof row.attestedAt === "string" ? row.attestedAt : null,
          medications: Array.isArray(row.medications) ? row.medications : [],
        })),
      );
    } catch (err) {
      setPrescriptionListError(err instanceof Error ? err.message : "Failed to load prescriptions");
    } finally {
      setPrescriptionListLoading(false);
    }
  };

  useEffect(() => {
    loadLabList();
  }, [sessionCode]);

  useEffect(() => {
    loadPrescriptionList();
  }, [sessionCode]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.physician) {
          const p = data.physician;
          setLabPhysicianName(`${p.firstName ?? ""} ${p.lastName ?? ""}`.trim());
          setLabClinicName(p.clinicName ?? "");
          setLabClinicAddress(p.clinicAddress ?? "");
        }
      })
      .catch(() => {
        // ignore
      });
  }, []);

  useEffect(() => {
    const onEditorSaved = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== "HAA_LAB_REQUISITION_SAVED") return;
      setLabStatus("Requisition saved as a new entry.");
      loadLabList();
    };
    window.addEventListener("message", onEditorSaved);
    return () => window.removeEventListener("message", onEditorSaved);
  }, [sessionCode]);

  useEffect(() => {
    const onPrescriptionEvent = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!event.data || typeof event.data.type !== "string") return;
      if (event.data.type === "HAA_PRESCRIPTION_SAVED") {
        setRxStatus("Prescription saved.");
        loadPrescriptionList();
      }
      if (event.data.type === "HAA_PRESCRIPTION_FAX_UPDATED") {
        setRxStatus("Prescription fax status updated.");
        loadPrescriptionList();
      }
      if (event.data.type === "HAA_PLAN_UPDATED") {
        setRxStatus("Medication details appended to plan.");
        fetch(`/api/sessions?code=${sessionCode}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data && !data.error) {
              setSession((prev) =>
                prev
                  ? {
                      ...prev,
                      history: data.history,
                    }
                  : prev,
              );
            }
          })
          .catch(() => {
            // ignore
          });
      }
    };
    window.addEventListener("message", onPrescriptionEvent);
    return () => window.removeEventListener("message", onPrescriptionEvent);
  }, [sessionCode]);

  const computeLabs = () => {
    const raw = labLabsInput
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const expandedRaw = raw.flatMap((entry) => {
      // Handle compact entries like "basic metabolic panel k" where users omit comma.
      // We split a trailing shorthand lab token into a separate item.
      const trailingTokenMatch = entry.match(/^(.*\S)\s+(k\+?|k|na)$/i);
      if (!trailingTokenMatch) return [entry];
      const base = trailingTokenMatch[1]?.trim();
      const trailing = trailingTokenMatch[2]?.trim();
      if (!base || !trailing) return [entry];
      return [base, trailing];
    });
    let labs = [...expandedRaw];

    const instructions = labInstructions.split(/[\n\.]/).map((s) => s.trim()).filter(Boolean);
    instructions.forEach((line) => {
      const addMatch = line.match(/^add\s+(.+)/i);
      const removeMatch = line.match(/^remove\s+(.+)/i);
      if (addMatch) {
        labs.push(addMatch[1].trim());
      } else if (removeMatch) {
        const target = removeMatch[1].trim().toLowerCase();
        labs = labs.filter((l) => l.toLowerCase() !== target);
      }
    });

    const deduped: string[] = [];
    const seen = new Set<string>();
    labs.forEach((lab) => {
      const key = lab.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(lab);
      }
    });
    return deduped;
  };

  const getCanvasPoint = (event: { clientX: number; clientY: number }, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  };

  const startRxSignatureDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = rxSignatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const point = getCanvasPoint(event, canvas);
    rxSignatureDrawingRef.current = true;
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  };

  const drawRxSignature = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!rxSignatureDrawingRef.current) return;
    const canvas = rxSignatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    event.preventDefault();
    const point = getCanvasPoint(event, canvas);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    setRxHasSignature(true);
  };

  const endRxSignatureDrawing = () => {
    if (!rxSignatureDrawingRef.current) return;
    rxSignatureDrawingRef.current = false;
  };

  const clearRxSignature = () => {
    const canvas = rxSignatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setRxHasSignature(false);
  };

  const updateRxMedicationField = (
    rowId: string,
    field: keyof Omit<RxMedicationRow, "id">,
    value: string,
  ) => {
    setRxMedications((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)),
    );
  };

  const addRxMedicationRow = () => {
    setRxMedications((prev) => [...prev, makeRxMedicationRow()]);
  };

  const removeRxMedicationRow = (rowId: string) => {
    setRxMedications((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((row) => row.id !== rowId);
      return next.length > 0 ? next : [makeRxMedicationRow()];
    });
  };

  const rxMedicationKey = (row: Omit<RxMedicationRow, "id">) =>
    `${row.medication.trim().toLowerCase()}|${row.strength.trim().toLowerCase()}|${row.sig
      .trim()
      .toLowerCase()}`;

  const mergeRxRows = (
    primary: RxMedicationRow[],
    extras: Omit<RxMedicationRow, "id">[],
  ): RxMedicationRow[] => {
    const merged = [...primary];
    const seen = new Set(merged.map((row) => rxMedicationKey(row)));
    extras.forEach((row) => {
      const key = rxMedicationKey(row);
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(makeRxMedicationRow(row));
    });
    return merged;
  };

  const openEditorWindow = (editorUrl: string) => {
    const popup = window.open(editorUrl, "_blank", "width=1420,height=980");
    if (!popup) {
      setLabStatus("Popup blocked. Please allow popups for this site.");
      return;
    }
  };

  const handleGenerateLabPdf = async () => {
    if (!sessionCode) {
      setLabStatus("Session code missing; cannot generate requisition.");
      return;
    }

    const labs = computeLabs();
    if (labs.length === 0) {
      setLabStatus("Add at least one lab before generating.");
      return;
    }

    setLabStatus(null);
    setLabSaving(true);

    try {
      const res = await fetch("/api/lab-requisitions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionCode,
          patientName: labPatientName,
          patientEmail: labPatientEmail,
          physicianName: labPhysicianName,
          clinicName: labClinicName,
          clinicAddress: labClinicAddress,
          labs,
          instructions: labInstructions,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to generate lab requisition.");
      }

      if (typeof data?.editorUrl === "string" && data.editorUrl.trim()) {
        openEditorWindow(data.editorUrl);
      }

      const unmappedSuffix =
        Array.isArray(data?.unmappedTests) && data.unmappedTests.length > 0
          ? ` Unmapped tests will be added to Additional Test Instructions: ${data.unmappedTests.join(", ")}.`
          : "";
      setLabStatus(`Requisition editor opened.${unmappedSuffix}`);
    } catch (error) {
      setLabStatus(
        error instanceof Error ? error.message : "Failed to generate requisition.",
      );
    } finally {
      setLabSaving(false);
    }
  };

  const handleEditLabRequisition = async (requisitionId: string) => {
    if (!sessionCode) return;
    setLabStatus(null);
    try {
      const res = await fetch("/api/lab-requisitions/editor-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionCode,
          requisitionId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to open requisition editor.");
      }
      if (typeof data?.editorUrl === "string" && data.editorUrl.trim()) {
        openEditorWindow(data.editorUrl);
      }
    } catch (error) {
      setLabStatus(error instanceof Error ? error.message : "Failed to open requisition editor.");
    }
  };

  const handleDeleteLabRequisition = async (requisitionId: string) => {
    if (!sessionCode) return;
    const confirmed = window.confirm("Are you sure you want to delete this requisition?");
    if (!confirmed) return;
    setLabStatus(null);
    try {
      const res = await fetch(
        `/api/lab-requisitions?code=${encodeURIComponent(sessionCode)}&id=${encodeURIComponent(requisitionId)}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to delete requisition.");
      }
      await loadLabList();
      setLabStatus("Requisition deleted.");
    } catch (error) {
      setLabStatus(error instanceof Error ? error.message : "Failed to delete requisition.");
    }
  };

  const handleGenerateRxPdf = async () => {
    if (!sessionCode) {
      setRxStatus("Session code missing; cannot generate prescription.");
      return;
    }

    const normalizedRows = rxMedications
      .map((row) => ({
        medication: row.medication.trim(),
        strength: row.strength.trim(),
        sig: row.sig.trim(),
        quantity: row.quantity.trim(),
        refills: row.refills.trim(),
        notes: row.notes.trim(),
      }))
      .filter((row) =>
        [row.medication, row.strength, row.sig, row.quantity, row.refills, row.notes].some(
          (value) => value.length > 0,
        ),
      );

    if (normalizedRows.length === 0) {
      setRxStatus("At least one medication is required.");
      return;
    }

    if (normalizedRows.some((row) => !row.medication || !row.sig)) {
      setRxStatus("Each medication row requires Medication name and Sig.");
      return;
    }
    if (!rxHasSignature || !rxSignatureCanvasRef.current) {
      setRxStatus("Physician signature is required.");
      return;
    }

    setRxStatus(null);
    setRxSaving(true);

    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const frameX = 12;
      const frameY = 10;
      const frameW = pageWidth - 24;
      const frameH = pageHeight - 20;
      const contentX = frameX + 7;
      const contentW = frameW - 14;
      const frameBottomY = frameY + frameH;
      const lineHeight = 5;
      const splitLines = (text: string, width: number): string[] =>
        doc.splitTextToSize(String(text || ""), width) as string[];

      const drawPrescriptionFrame = (isContinuation = false) => {
        doc.setLineWidth(0.5);
        doc.rect(frameX, frameY, frameW, frameH);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text("PRESCRIPTION", contentX, frameY + 9);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text("Draft prescription - requires physician authorization", contentX, frameY + 13);
        doc.setFontSize(9);
        doc.text(isContinuation ? "Continuation" : "Rx", frameX + frameW - 24, frameY + 9);
        doc.setLineWidth(0.2);
        doc.line(contentX, frameY + 15, frameX + frameW - 7, frameY + 15);
      };

      let y = frameY + 21;
      drawPrescriptionFrame(false);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const patientLine = splitLines(`Patient: ${labPatientName || "N/A"}`, contentW / 2 - 2);
      doc.text(patientLine, contentX, y);
      const emailLine = splitLines(`Email: ${labPatientEmail || "N/A"}`, contentW / 2 - 2);
      doc.text(emailLine, contentX + contentW / 2 + 2, y);
      y += Math.max(patientLine.length, emailLine.length) * lineHeight + 1;

      const prescriberLine = splitLines(`Prescriber: ${labPhysicianName || "N/A"}`, contentW / 2 - 2);
      doc.text(prescriberLine, contentX, y);
      const clinicLine = splitLines(`Clinic: ${labClinicName || "N/A"}`, contentW / 2 - 2);
      doc.text(clinicLine, contentX + contentW / 2 + 2, y);
      y += Math.max(prescriberLine.length, clinicLine.length) * lineHeight + 1;

      const addressLines = splitLines(`Clinic address: ${labClinicAddress || "N/A"}`, contentW);
      doc.text(addressLines, contentX, y);
      y += addressLines.length * lineHeight + 2;

      doc.setLineWidth(0.2);
      doc.line(contentX, y, contentX + contentW, y);
      y += 5;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Medication Orders", contentX, y);
      y += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);

      normalizedRows.forEach((row, idx) => {
        const medLabelLines = splitLines(`${idx + 1}. ${row.medication}${row.strength ? ` (${row.strength})` : ""}`, contentW - 6);
        const sigLines = splitLines(`Sig: ${row.sig}`, contentW - 6);
        const quantityLines = splitLines(`Qty: ${row.quantity || "N/A"}   Refills: ${row.refills || "0"}`, contentW - 6);
        const noteLines = row.notes ? splitLines(`Notes: ${row.notes}`, contentW - 6) : [];
        const rowHeight =
          2 +
          medLabelLines.length * lineHeight +
          sigLines.length * lineHeight +
          quantityLines.length * lineHeight +
          (noteLines.length > 0 ? noteLines.length * lineHeight : 0) +
          3;

        if (y + rowHeight + 30 > frameBottomY) {
          doc.addPage();
          drawPrescriptionFrame(true);
          y = frameY + 18;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.text("Medication Orders (cont.)", contentX, y);
          y += 4;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
        }

        doc.rect(contentX, y - 1.5, contentW, rowHeight);
        let rowY = y + 2;
        doc.setFont("helvetica", "bold");
        doc.text(medLabelLines, contentX + 2, rowY);
        rowY += medLabelLines.length * lineHeight;
        doc.setFont("helvetica", "normal");
        doc.text(sigLines, contentX + 2, rowY);
        rowY += sigLines.length * lineHeight;
        doc.text(quantityLines, contentX + 2, rowY);
        rowY += quantityLines.length * lineHeight;
        if (noteLines.length > 0) {
          doc.text(noteLines, contentX + 2, rowY);
        }
        y += rowHeight + 3;
      });

      const signatureCanvas = rxSignatureCanvasRef.current;
      if (signatureCanvas) {
        const signatureBlockHeight = 42;
        if (y + signatureBlockHeight > frameBottomY) {
          doc.addPage();
          drawPrescriptionFrame(true);
          y = frameY + 18;
        }
        y += 3;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text("Prescriber signature", contentX, y);
        const signatureBoxY = y + 2;
        const signatureBoxWidth = 88;
        const signatureBoxHeight = 22;
        doc.rect(contentX, signatureBoxY, signatureBoxWidth, signatureBoxHeight);
        const signatureDataUrl = signatureCanvas.toDataURL("image/png");
        doc.addImage(
          signatureDataUrl,
          "PNG",
          contentX + 1,
          signatureBoxY + 1,
          signatureBoxWidth - 2,
          signatureBoxHeight - 2,
        );
        const dateText = `Date: ${new Date().toLocaleDateString()}`;
        doc.text(dateText, contentX + signatureBoxWidth + 8, signatureBoxY + 8);
        doc.text(`Prescriber: ${labPhysicianName || "N/A"}`, contentX + signatureBoxWidth + 8, signatureBoxY + 15);
      }

      const pdfDataUri = doc.output("datauristring");
      const pdfBase64 = pdfDataUri.split(",")[1];
      const previewToken = `rx-preview-${sessionCode}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const previewPayload = {
        sessionCode,
        patientName: labPatientName,
        patientEmail: labPatientEmail,
        patientSex: session?.patientProfile?.sex || "",
        physicianName: labPhysicianName,
        clinicName: labClinicName,
        clinicAddress: labClinicAddress,
        medications: normalizedRows,
        pdfBase64,
        pharmacy: {
          pharmacyName: session?.patientProfile?.pharmacyName?.trim() || "",
          pharmacyNumber: session?.patientProfile?.pharmacyNumber?.trim() || "",
          pharmacyAddress: session?.patientProfile?.pharmacyAddress?.trim() || "",
          pharmacyCity: session?.patientProfile?.pharmacyCity?.trim() || "",
          pharmacyPhone: session?.patientProfile?.pharmacyPhone?.trim() || "",
          pharmacyFax: session?.patientProfile?.pharmacyFax?.trim() || "",
        },
      };
      window.localStorage.setItem(previewToken, JSON.stringify(previewPayload));
      const previewUrl = `/physician/prescription-preview?code=${encodeURIComponent(
        sessionCode,
      )}&token=${encodeURIComponent(previewToken)}`;
      const opened = window.open(previewUrl, "_blank");
      if (!opened) {
        throw new Error("Popup was blocked. Please allow popups and try again.");
      }
      setRxStatus("Prescription preview opened in a new tab.");
    } catch (error) {
      setRxStatus(
        error instanceof Error ? error.message : "Failed to generate prescription preview.",
      );
    } finally {
      setRxSaving(false);
    }
  };

  const hpiSections = useMemo(() => getHpiSections(session?.history), [session?.history]);
  const hpiAiSummary = useMemo(() => getHpiAiSummary(hpiSections), [hpiSections]);
  const completeIntakeTranscript = useMemo(() => {
    const baseTranscript = Array.isArray(session?.transcript) ? session.transcript : [];
    const finalComments = stripOptionalNone(
      session?.history?.patientFinalQuestionsCommentsEnglish?.trim()
        ? session.history.patientFinalQuestionsCommentsEnglish
        : session?.history?.patientFinalQuestionsComments || "",
    );

    if (!finalComments) return baseTranscript;

    const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
    const normalizedFinalComments = normalize(finalComments);
    const hasFinalCommentAlready = baseTranscript.some(
      (message) => message.role === "patient" && normalize(message.content) === normalizedFinalComments,
    );

    if (hasFinalCommentAlready) return baseTranscript;

    return [...baseTranscript, { role: "patient", content: finalComments }];
  }, [
    session?.transcript,
    session?.history?.patientFinalQuestionsComments,
    session?.history?.patientFinalQuestionsCommentsEnglish,
  ]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Loading session...</p>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="text-center">
          <p className="text-red-600">{error || "Session not found"}</p>
          <button
            onClick={handleBack}
            className="mt-4 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const patientUploads = session.history.patientUploads;
  const hpiMedPmhSummary =
    patientUploads?.medPmh?.summary || (session.history as any).medPmhSummary || "";
  const hpiMedPmhSourceName = patientUploads?.medPmh?.sourceFileName || "";

  const hpiLesionSummary = patientUploads?.lesionImage?.summary || session.imageSummary || "";
  const hpiLesionImageUrl = patientUploads?.lesionImage?.imageUrl || session.imageUrl || "";
  const hpiLesionImageName = patientUploads?.lesionImage?.imageName || session.imageName || "";

  const hpiBodyDiagramArea = patientUploads?.bodyDiagram?.selectedArea;
  const hpiLeftSoleMarkers = patientUploads?.bodyDiagram?.leftSoleMarkers || [];
  const hpiMarkersByPart = patientUploads?.bodyDiagram?.markersByPart || [];
  const hpiBodyDiagramParts = patientUploads?.bodyDiagram?.selectedParts || [];
  const hpiBodyDiagramNote = patientUploads?.bodyDiagram?.note || "";
  const transcriptText = Array.isArray(session.transcript)
    ? session.transcript.map((message) => message?.content || "").join(" ")
    : "";
  const parseLeftSoleMarkersFromText = (text: string) => {
    const matches = text.match(/\((\d{1,3})\s*,\s*(\d{1,3})\)/g) || [];
    const parsed = matches
      .map((tuple) => {
        const match = tuple.match(/\((\d{1,3})\s*,\s*(\d{1,3})\)/);
        if (!match) return null;
        const x = Number(match[1]);
        const y = Number(match[2]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        if (x < 0 || x > 100 || y < 0 || y > 100) return null;
        return { xPct: x, yPct: y };
      })
      .filter((marker): marker is { xPct: number; yPct: number } => Boolean(marker));
    return parsed.slice(0, 30);
  };
  const fallbackMarkerText = `${hpiBodyDiagramNote} ${transcriptText}`;
  const fallbackMarkers =
    hpiLeftSoleMarkers.length === 0 &&
    /left sole markers|marked.*left sole|left sole/i.test(fallbackMarkerText)
      ? parseLeftSoleMarkersFromText(fallbackMarkerText)
      : [];
  const hpiDisplayLeftSoleMarkers =
    hpiLeftSoleMarkers.length > 0 ? hpiLeftSoleMarkers : fallbackMarkers;
  const hasLeftSoleSelection = hpiBodyDiagramParts.some(
    (part) => part.part === "foot" && (part.side === "left" || part.side === "both"),
  );
  const markerSelectionsFromStructured = (Array.isArray(hpiMarkersByPart) ? hpiMarkersByPart : []).reduce<
    Array<{ part: string; side?: "left" | "right"; markers: MarkerPoint[] }>
  >((acc, selection) => {
    const candidate = selection as DiagramMarkerSelection;
    const part = (candidate.part || "").trim();
    const side = candidate.side === "left" || candidate.side === "right" ? candidate.side : undefined;
    const markers = Array.isArray(candidate.markers)
      ? candidate.markers.filter(
          (marker): marker is MarkerPoint =>
            Boolean(
              marker &&
                Number.isFinite(marker.xPct) &&
                Number.isFinite(marker.yPct) &&
                marker.xPct >= 0 &&
                marker.xPct <= 100 &&
                marker.yPct >= 0 &&
                marker.yPct <= 100,
            ),
        )
      : [];
    if (!part || markers.length === 0) {
      return acc;
    }
    acc.push({ part, side, markers: markers.slice(0, 30) });
    return acc;
  }, []);
  const hpiNarrativeText = [
    hpiBodyDiagramNote,
    session.history.summary || "",
    session.history.assessment || "",
    Array.isArray(session.history.physicalFindings) ? session.history.physicalFindings.join(" ") : "",
  ]
    .join(" ")
    .toLowerCase();
  const hasLeftSoleNarrative = /(left\s+(sole|heel|plantar|arch|foot)|\bsole\b|\bplantar\b|\bheel\b)/i.test(
    hpiNarrativeText,
  );
  const shouldRenderLegacyLeftSoleOnly =
    markerSelectionsFromStructured.length === 0 &&
    (hpiDisplayLeftSoleMarkers.length > 0 || hasLeftSoleSelection || hasLeftSoleNarrative);
  const hpiMarkerSelections = shouldRenderLegacyLeftSoleOnly
    ? [{ part: "foot", side: "left" as const, markers: hpiDisplayLeftSoleMarkers }]
    : markerSelectionsFromStructured;
  const hpiDiagramSelectionsToRender = mergeDiagramSelectionsForDisplay({
    markerSelections: hpiMarkerSelections as DiagramSelectionInput[],
    selectedParts: Array.isArray(hpiBodyDiagramParts) ? hpiBodyDiagramParts : [],
  });
  const interviewEndedEarly = session.history?.interviewEndedEarly === true;

  const hasPatientUploadedContext = Boolean(
    hpiMedPmhSummary ||
      hpiLesionSummary ||
      hpiLesionImageUrl ||
      hpiBodyDiagramNote ||
      hpiBodyDiagramArea ||
      hpiMarkerSelections.length > 0 ||
      hpiBodyDiagramParts.length > 0,
  );
  const shouldShowLegacyImageAnalysisCard = Boolean(session.imageSummary && !patientUploads?.lesionImage);
  const patientPrimaryPhone = session.patientProfile?.primaryPhone?.trim() || "";
  const patientSecondaryPhone = session.patientProfile?.secondaryPhone?.trim() || "";
  const patientInsuranceNumber = session.patientProfile?.insuranceNumber?.trim() || "";
  const patientAddress = session.patientProfile?.address?.trim() || "";

  // Encounter recording helpers — same pattern as /physician/transcription/page.tsx
  async function encounterConvertToWav(blob: Blob): Promise<Blob> {
    const audioCtx = new AudioContext({ sampleRate: 16000 });
    try {
      const arrayBuf = await blob.arrayBuffer();
      const decoded = await audioCtx.decodeAudioData(arrayBuf);
      const mono =
        decoded.numberOfChannels === 1
          ? decoded.getChannelData(0)
          : (() => {
              const ch0 = decoded.getChannelData(0);
              const ch1 = decoded.getChannelData(1);
              const mixed = new Float32Array(ch0.length);
              for (let i = 0; i < ch0.length; i += 1) mixed[i] = (ch0[i] + ch1[i]) / 2;
              return mixed;
            })();
      let samples = mono;
      if (decoded.sampleRate !== 16000) {
        const ratio = 16000 / decoded.sampleRate;
        const newLen = Math.round(mono.length * ratio);
        const resampled = new Float32Array(newLen);
        for (let i = 0; i < newLen; i += 1) resampled[i] = mono[Math.round(i / ratio)] ?? 0;
        samples = resampled;
      }
      const numSamples = samples.length;
      const buffer = new ArrayBuffer(44 + numSamples * 2);
      const view = new DataView(buffer);
      const writeStr = (off: number, s: string) => {
        for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
      };
      writeStr(0, "RIFF");
      view.setUint32(4, 36 + numSamples * 2, true);
      writeStr(8, "WAVE");
      writeStr(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true);
      view.setUint32(28, 16000 * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, "data");
      view.setUint32(40, numSamples * 2, true);
      for (let i = 0; i < numSamples; i += 1) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
      return new Blob([buffer], { type: "audio/wav" });
    } finally {
      await audioCtx.close();
    }
  }

  async function encounterTranscribeAudio(audioBlob: Blob): Promise<string> {
    const wavBlob = await encounterConvertToWav(audioBlob);
    const formData = new FormData();
    formData.append("audio", new File([wavBlob], "encounter.wav", { type: "audio/wav" }));
    formData.append("language", "en-US");
    const res = await fetch("/api/speech/stt", { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Transcription failed");
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (!text) throw new Error("No speech detected.");
    return text;
  }

  async function encounterFlushSegment(recorder: MediaRecorder, stream: MediaStream, isFinal: boolean) {
    const mimeType = recorder.mimeType || "audio/webm";
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    const blob = new Blob(encounterMediaChunksRef.current, { type: mimeType });
    encounterMediaChunksRef.current = [];

    if (!isFinal && stream.active) {
      const newRecorder = new MediaRecorder(stream);
      encounterMediaRecorderRef.current = newRecorder;
      newRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) encounterMediaChunksRef.current.push(e.data);
      };
      newRecorder.start(250);
    }

    if (!blob.size) return;
    const idx = encounterSegmentIndexRef.current++;

    const task = (async () => {
      try {
        const text = await encounterTranscribeAudio(blob);
        if (text) {
          setEncounterTranscript((prev) => {
            const parts = prev ? prev.split("\n") : [];
            while (parts.length <= idx) parts.push("");
            parts[idx] = text;
            const next = parts.filter(Boolean).join(" ").trim();
            encounterTranscriptRef.current = next;
            return next;
          });
        }
      } catch (err) {
        setEncounterRecordingError(err instanceof Error ? err.message : "Transcription failed for a segment.");
      }
    })();
    encounterPendingTranscriptionsRef.current.push(task);
  }

  async function startEncounterRecording() {
    setEncounterRecordingError(null);
    setEncounterMergeError(null);
    encounterSegmentIndexRef.current = 0;
    encounterPendingTranscriptionsRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
      });
      const recorder = new MediaRecorder(stream);
      encounterMediaChunksRef.current = [];
      encounterMediaStreamRef.current = stream;
      encounterMediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) encounterMediaChunksRef.current.push(e.data);
      };
      recorder.start(250);
      setEncounterRecording(true);
      encounterFlushIntervalRef.current = window.setInterval(() => {
        const rec = encounterMediaRecorderRef.current;
        const strm = encounterMediaStreamRef.current;
        if (rec && rec.state === "recording" && strm) {
          encounterFlushSegment(rec, strm, false);
        }
      }, 120_000);
    } catch (err) {
      setEncounterRecordingError(err instanceof Error ? err.message : "Unable to access microphone.");
    }
  }

  async function stopEncounterRecording() {
    const recorder = encounterMediaRecorderRef.current;
    const stream = encounterMediaStreamRef.current;
    if (!recorder) return;

    if (encounterFlushIntervalRef.current) {
      window.clearInterval(encounterFlushIntervalRef.current);
      encounterFlushIntervalRef.current = null;
    }
    if (encounterTimerIntervalRef.current) {
      window.clearInterval(encounterTimerIntervalRef.current);
      encounterTimerIntervalRef.current = null;
    }

    setEncounterRecording(false);
    setEncounterTranscriptLoading(true);
    setEncounterRecordingError(null);

    if (recorder.state === "recording" && stream) {
      await encounterFlushSegment(recorder, stream, true);
    }
    if (encounterMediaStreamRef.current) {
      encounterMediaStreamRef.current.getTracks().forEach((t) => t.stop());
      encounterMediaStreamRef.current = null;
    }
    await Promise.allSettled(encounterPendingTranscriptionsRef.current);
    encounterPendingTranscriptionsRef.current = [];
    setEncounterTranscriptLoading(false);

    // Auto-merge with HPI (use ref to get latest value after async state updates)
    const finalTranscript = encounterTranscriptRef.current;
    if (!finalTranscript.trim() || !sessionCode) return;

    setEncounterMerging(true);
    setEncounterMergeError(null);
    try {
      const res = await fetch("/api/physician/hpi-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionCode, action: "merge_transcript", transcript: finalTranscript }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to merge transcript with HPI.");
      const merged = typeof data?.result === "string" ? data.result.trim() : "";
      if (!merged) throw new Error("AI returned empty result.");
      setHpiCombinedDraft(merged);
      setHpiSaveError(null);
      setHpiSaveSuccess(null);
      setHpiCopyStatus(null);
      setIsEditingHpi(true);
      // Scroll to HPI section
      document.getElementById("hpi-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setEncounterMergeError(err instanceof Error ? err.message : "Failed to merge transcript with HPI.");
    } finally {
      setEncounterMerging(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5 mb-6">
          <Image
            src="/LogoFinal.png"
            alt="Health Assist AI logo"
            width={130}
            height={32}
            className="mx-auto mb-3 h-[36px] w-[109px] object-contain sm:h-12 sm:w-[145px]"
            priority
          />
          <div className="flex justify-between items-center">
            <h1 className="text-[1.1rem] font-semibold text-slate-900">
              Patient Intake Summary
            </h1>
            <div className="flex gap-2">
              <button
                onClick={handleBack}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleMarkReviewed}
                disabled={reviewing || Boolean((session.history as any)?.physicianReviewedAt)}
                className="px-4 py-2 text-sm font-medium text-emerald-700 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-50 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {(session.history as any)?.physicianReviewedAt ? "Reviewed" : reviewing ? "Reviewing..." : "Reviewed"}
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          </div>
          {reviewError && (
            <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-800">
              {reviewError}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-slate-500">Patient Name</p>
              <p className="text-base font-medium text-slate-900">{session.patientName}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Email</p>
              <p className="text-base font-medium text-slate-900">{session.patientEmail}</p>
            </div>
            {(typeof session.patientProfile?.age === "number" || session.patientProfile?.dateOfBirth) && (
              <div>
                <p className="text-sm text-slate-500">Age</p>
                <p className="text-base font-medium text-slate-900">
                  {(() => {
                    const dob = session.patientProfile?.dateOfBirth;
                    const ageFromDob = dob ? computeAgeFromDob(dob) : null;
                    if (typeof ageFromDob === "number") return `${ageFromDob}`;
                    if (typeof session.patientProfile?.age === "number") return `${session.patientProfile.age}`;
                    return "—";
                  })()}
                </p>
              </div>
            )}
            <div>
              <p className="text-sm text-slate-500">Date of Birth</p>
              <p className="text-base font-medium text-slate-900">
                {session.patientProfile?.dateOfBirth?.trim() || "—"}
              </p>
            </div>
            {patientPrimaryPhone ? (
              <div>
                <p className="text-sm text-slate-500">Phone</p>
                <p className="text-base font-medium text-slate-900">{patientPrimaryPhone}</p>
              </div>
            ) : null}
            {patientSecondaryPhone ? (
              <div>
                <p className="text-sm text-slate-500">Alternate Phone</p>
                <p className="text-base font-medium text-slate-900">{patientSecondaryPhone}</p>
              </div>
            ) : null}
            {patientInsuranceNumber ? (
              <div>
                <p className="text-sm text-slate-500">Health Care Number</p>
                <p className="text-base font-medium text-slate-900">{patientInsuranceNumber}</p>
              </div>
            ) : null}
            {patientAddress ? (
              <div>
                <p className="text-sm text-slate-500">Address</p>
                <p className="text-base text-slate-900">{patientAddress}</p>
              </div>
            ) : null}
            <div className="col-span-2">
              <CollapsibleSection
                id="patient-medical-history"
                title="Medical History (PMHx, Medications, Allergies)"
                defaultOpen={false}
                showIndicator={[
                  session.patientProfile?.pmh,
                  session.patientProfile?.familyHistory,
                  session.patientProfile?.currentMedications,
                  session.patientProfile?.allergies,
                  session.patientProfile?.familyDoctor,
                  session.patientProfile?.pharmacyName,
                  session.patientProfile?.pharmacyNumber,
                  session.patientProfile?.pharmacyAddress,
                  session.patientProfile?.pharmacyCity,
                  session.patientProfile?.pharmacyPhone,
                  session.patientProfile?.pharmacyFax,
                ].some((v) => v?.trim())}
              >
                <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                  <div className="md:col-span-2">
                    <p className="text-sm text-slate-500">Past Medical History</p>
                    <p className="text-base text-slate-900">{session.patientProfile?.pmh?.trim() || "—"}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-sm text-slate-500">Family History</p>
                    <p className="text-base text-slate-900">{session.patientProfile?.familyHistory?.trim() || "—"}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-sm text-slate-500">Current Medications</p>
                    <p className="text-base text-slate-900">
                      {session.patientProfile?.currentMedications?.trim() || "—"}
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-sm text-slate-500">Allergies</p>
                    <p className="text-base text-slate-900">{session.patientProfile?.allergies?.trim() || "—"}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-sm text-slate-500">Family Doctor</p>
                    <p className="text-base text-slate-900">{session.patientProfile?.familyDoctor?.trim() || "—"}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-sm text-slate-500">Pharmacy</p>
                    <div className="space-y-1">
                      <p className="text-base text-slate-900">
                        <span className="font-medium">Name:</span>{" "}
                        {session.patientProfile?.pharmacyName?.trim() || "Not provided"}
                      </p>
                      <p className="text-base text-slate-900">
                        <span className="font-medium">Number:</span>{" "}
                        {session.patientProfile?.pharmacyNumber?.trim() || "Not provided"}
                      </p>
                      <p className="text-base text-slate-900">
                        <span className="font-medium">Address:</span>{" "}
                        {[
                          session.patientProfile?.pharmacyAddress?.trim() || "",
                          session.patientProfile?.pharmacyCity?.trim() || "",
                        ]
                          .filter((value) => value.length > 0)
                          .join(", ") || "Not provided"}
                      </p>
                      <p className="text-base text-slate-900">
                        <span className="font-medium">Phone:</span>{" "}
                        {session.patientProfile?.pharmacyPhone?.trim() || "Not provided"}
                      </p>
                      <p className="text-base text-slate-900">
                        <span className="font-medium">Fax:</span>{" "}
                        {session.patientProfile?.pharmacyFax?.trim() || "Not provided"}
                      </p>
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
            </div>
          </div>
        </div>

        {/* History Summary */}
        {session.history && (
          <>
            <div id="hpi-section" className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">
                  History of Present Illness
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyHpi}
                    className="px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-60"
                    disabled={!session?.history}
                  >
                    Copy
                  </button>
                  <button
                    onClick={handleStartHpiEdit}
                    className="px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                    disabled={isEditingHpi}
                  >
                    Edit
                  </button>
                </div>
              </div>
              <p className="mb-4 text-sm text-slate-500">
                AI-generated documentation requires physician verification.
              </p>
              {interviewEndedEarly && (
                <p className="mb-4 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-900">
                  Interview ended early by patient request.
                </p>
              )}
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">Chief Complaint</p>
                  <p className="text-base text-slate-900 whitespace-pre-wrap">
                    {session.history?.chiefComplaintEnglish || session.chiefComplaint || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">HPI</p>
                  {isEditingHpi ? (
                    <textarea
                      value={hpiCombinedDraft}
                      onChange={(e) => setHpiCombinedDraft(e.target.value)}
                      rows={16}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                      disabled={hpiSaving}
                      placeholder={"Subjective:\n\nPhysical Findings:\n\nAssessment:\n\nPlan:\n\nPatient Final Comments:"}
                    />
                  ) : (
                    <div className="space-y-5">
                      <div>
                        <p className="text-sm font-medium text-slate-700">AI Summary</p>
                        <div className="mt-1 h-px bg-slate-200" />
                        <p className="mt-2 text-base text-slate-900">{hpiAiSummary}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">Subjective</p>
                        <div className="mt-1 h-px bg-slate-200" />
                        <p className="mt-2 text-base text-slate-900 whitespace-pre-wrap">{hpiSections.subjective}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">Physical Findings</p>
                        <div className="mt-1 h-px bg-slate-200" />
                        {hpiSections.physicalFindings.length > 0 ? (
                          <ul className="mt-2 space-y-1 text-base text-slate-900">
                            {hpiSections.physicalFindings.map((item, index) => (
                              <li key={`${item}-${index}`}>• {item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-base text-slate-900">None</p>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">Assessment</p>
                        <div className="mt-1 h-px bg-slate-200" />
                        <p className="mt-2 text-base text-slate-900 whitespace-pre-wrap">{hpiSections.assessment}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">Investigations</p>
                        <div className="mt-1 h-px bg-slate-200" />
                        {hpiSections.investigations.length > 0 ? (
                          <ul className="mt-2 space-y-1 text-base text-slate-900">
                            {hpiSections.investigations.map((item, index) => (
                              <li key={`${item}-${index}`}>• {item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-base text-slate-900">None</p>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">Plan</p>
                        <div className="mt-1 h-px bg-slate-200" />
                        {hpiSections.plan.length > 0 ? (
                          <ul className="mt-2 space-y-1 text-base text-slate-900">
                            {hpiSections.plan.map((item, index) => (
                              <li key={`${item}-${index}`}>• {item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-base text-slate-900">None</p>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">Patient Final Comments</p>
                        <div className="mt-1 h-px bg-slate-200" />
                        <p className="mt-2 text-base text-slate-900 whitespace-pre-wrap">
                          {hpiSections.patientFinalComments}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                {hasPatientUploadedContext && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-slate-700">
                        Patient Uploaded Context
                      </p>
                      <button
                        onClick={() => { void handleDownloadPatientImages(); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                        title="Download body diagrams and uploaded images for EMR upload"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download
                      </button>
                    </div>
                    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
                      {hpiMedPmhSummary && (
                        <div>
                          <p className="text-sm font-medium text-slate-700">
                            Medications / PMH (uploaded file)
                          </p>
                          {hpiMedPmhSourceName && (
                            <p className="text-xs text-slate-500">Source: {hpiMedPmhSourceName}</p>
                          )}
                          <p className="text-base text-slate-900 whitespace-pre-wrap mt-1">
                            {hpiMedPmhSummary}
                          </p>
                        </div>
                      )}

                      {(hpiLesionImageUrl || hpiLesionSummary) && (
                        <div>
                          <p className="text-sm font-medium text-slate-700">
                            Lesion / Body Photo
                          </p>
                          {hpiLesionImageUrl && (
                            <img
                              src={hpiLesionImageUrl}
                              alt={hpiLesionImageName || "Patient uploaded lesion image"}
                              className="mt-2 max-w-full max-h-80 h-auto rounded-lg border border-slate-200 object-contain bg-white"
                            />
                          )}
                          {hpiLesionImageName && (
                            <p className="mt-2 text-xs text-slate-500">File: {hpiLesionImageName}</p>
                          )}
                          {hpiLesionSummary && (
                            <p className="text-base text-slate-900 whitespace-pre-wrap mt-1">
                              {hpiLesionSummary}
                            </p>
                          )}
                        </div>
                      )}

                      {(hpiBodyDiagramParts.length > 0 ||
                        hpiBodyDiagramArea ||
                        hpiBodyDiagramNote ||
                        hpiMarkerSelections.length > 0) && (
                        <div>
                          <p className="text-sm font-medium text-slate-700">
                            Body Diagram Selection
                          </p>
                          {hpiDiagramSelectionsToRender.map((selection, selectionIndex) => {
                            const image = getBodyDiagramImage(
                              selection.part,
                              selection.side,
                              session?.patientProfile?.sex === "male" || session?.patientProfile?.sex === "female"
                                ? session.patientProfile.sex
                                : undefined,
                            );
                            const partLabel = selection.side
                              ? `${selection.side} ${selection.part}`
                              : selection.part;
                            return (
                              <div
                                key={`${selection.part}-${selection.side || "none"}-${selectionIndex}`}
                                className="mt-3"
                              >
                                <p className="text-sm text-slate-700">
                                  {partLabel.replace(/\b\w/g, (c) => c.toUpperCase())} pain mapping:
                                </p>
                                <DiagramViewer
                                  imageSrc={image.src}
                                  imageAlt={`${image.alt} with selected markers`}
                                  markers={selection.markers}
                                />
                                <p className="mt-2 text-xs text-slate-500">
                                  {selection.markers.length > 0
                                    ? `Coordinates: ${selection.markers
                                        .map(
                                          (marker) => `(${Math.round(marker.xPct)}, ${Math.round(marker.yPct)})`,
                                        )
                                        .join(", ")}`
                                    : "No marker coordinates captured for this selection."}
                                </p>
                              </div>
                            );
                          })}
                          {hpiBodyDiagramArea && (
                            <p className="text-sm text-slate-700 mt-1">Selected area: {hpiBodyDiagramArea}</p>
                          )}
                          {hpiBodyDiagramParts.length > 0 && (
                            <p className="text-sm text-slate-700 mt-1">
                              Selected parts:{" "}
                              {hpiBodyDiagramParts
                                .map((part) =>
                                  part.side ? `${part.side} ${part.part}` : part.part,
                                )
                                .join(", ")}
                            </p>
                          )}
                          {hpiBodyDiagramNote && (
                            <p className="text-base text-slate-900 whitespace-pre-wrap mt-1">
                              {hpiBodyDiagramNote}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-5">
                {hpiSaveError && (
                  <p className="text-sm text-red-600 mb-2">{hpiSaveError}</p>
                )}
                {hpiSaveSuccess && (
                  <p className="text-sm text-green-700 mb-2">{hpiSaveSuccess}</p>
                )}
                {hpiCopyStatus && (
                  <p className="text-sm text-slate-700 mb-2">{hpiCopyStatus}</p>
                )}
                <div className="flex justify-end gap-2">
                  {isEditingHpi ? (
                    <>
                      <button
                        onClick={handleCancelHpiEdit}
                        className="px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                        disabled={hpiSaving}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveHpiEdit}
                        className="px-3 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                        disabled={hpiSaving}
                      >
                        {hpiSaving ? "Saving..." : "Save"}
                      </button>
                    </>
                  ) : null}
                </div>
                {session?.history?.hpiUpdatedAt && (
                  <p className="mt-3 text-xs text-slate-500">
                    Note updated: {formatHpiUpdatedAt(session.history.hpiUpdatedAt)}
                  </p>
                )}
              </div>
            </div>

            {/* Physician Encounter Notes */}
            <div className="mb-6">
              <CollapsibleSection
                id="physician-encounter-notes"
                title="Physician Encounter Notes"
                description="Record your encounter with the patient. When you stop, the transcript is merged with the HPI."
                defaultOpen={false}
              >
                <div className="space-y-4">
                  <p className="text-sm text-slate-500">
                    Record your conversation with the patient — additional history, examination, assessment, and plan. When you stop recording, the transcript will be merged with the existing HPI and open in edit mode for review.
                  </p>

                  {/* Record / Stop button */}
                  <div className="flex items-center gap-3">
                    {!encounterRecording ? (
                      <button
                        onClick={startEncounterRecording}
                        disabled={encounterMerging || encounterTranscriptLoading}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60"
                      >
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-white" />
                        Record
                      </button>
                    ) : (
                      <button
                        onClick={stopEncounterRecording}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-700 rounded-lg hover:bg-slate-800"
                      >
                        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-white" />
                        Stop Recording
                      </button>
                    )}
                    {encounterRecording && (
                      <span className="flex items-center gap-1.5 text-sm text-red-600 font-medium">
                        <span className="inline-block w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                        Recording...
                      </span>
                    )}
                    {encounterTranscriptLoading && !encounterRecording && (
                      <span className="text-sm text-slate-500">Transcribing final segment...</span>
                    )}
                    {encounterMerging && (
                      <span className="text-sm text-slate-500">Merging with HPI...</span>
                    )}
                  </div>

                  {/* Recording transcript */}
                  {encounterTranscript && (
                    <div>
                      <p className="text-xs font-medium text-slate-600 mb-1 uppercase tracking-wide">Recording Transcript</p>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {encounterTranscript}
                      </div>
                    </div>
                  )}

                  {/* Error messages */}
                  {encounterRecordingError && (
                    <p className="text-sm text-red-600">{encounterRecordingError}</p>
                  )}
                  {encounterMergeError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                      <p className="text-sm text-red-700">{encounterMergeError}</p>
                      {encounterTranscript && sessionCode && (
                        <button
                          onClick={() => {
                            setEncounterMergeError(null);
                            setEncounterMerging(true);
                            fetch("/api/physician/hpi-actions", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ sessionCode, action: "merge_transcript", transcript: encounterTranscriptRef.current }),
                            })
                              .then((r) => r.json().catch(() => ({})))
                              .then((data) => {
                                if (!data?.result) throw new Error(data?.error || "Empty result.");
                                setHpiCombinedDraft(data.result.trim());
                                setHpiSaveError(null);
                                setHpiSaveSuccess(null);
                                setHpiCopyStatus(null);
                                setIsEditingHpi(true);
                                document.getElementById("hpi-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                              })
                              .catch((err) => setEncounterMergeError(err instanceof Error ? err.message : "Failed to merge."))
                              .finally(() => setEncounterMerging(false));
                          }}
                          disabled={encounterMerging}
                          className="mt-2 text-sm text-red-700 underline hover:no-underline disabled:opacity-60"
                        >
                          Retry merge
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </CollapsibleSection>
            </div>

            {/* PHQ-9 / GAD-7 Screening Results */}
            {(session.history as any)?.phqGadResults && (() => {
              const r = (session.history as any).phqGadResults as import("@/lib/history-schema").PhqGadResults;
              const phq9SeverityLabel: Record<string, string> = {
                minimal: "Minimal / No Depression",
                mild: "Mild Depression",
                moderate: "Moderate Depression",
                moderately_severe: "Moderately Severe Depression",
                severe: "Severe Depression",
              };
              const gad7SeverityLabel: Record<string, string> = {
                minimal: "Minimal Anxiety",
                mild: "Mild Anxiety",
                moderate: "Moderate Anxiety",
                severe: "Severe Anxiety",
              };
              return (
                <div className="mb-6">
                  <CollapsibleSection
                    id="phq-gad-results"
                    title="PHQ-9 / GAD-7 Screening Results"
                    description="Patient-completed depression and anxiety screening questionnaires."
                    defaultOpen={true}
                    headerRight={
                      <button
                        onClick={(e) => { e.stopPropagation(); void handleDownloadPhqGadPdf(); }}
                        className="px-3 py-1.5 text-sm font-medium text-white bg-slate-700 border border-slate-700 rounded-lg hover:bg-slate-800"
                      >
                        Download PDF
                      </button>
                    }
                  >
                    {/* PHQ-9 */}
                    <div className="mb-5">
                      <p className="text-sm font-semibold text-slate-900 mb-2">
                        PHQ-9 — {r.phq9.total}/27 &mdash; {phq9SeverityLabel[r.phq9.severity] ?? r.phq9.severity}
                      </p>
                      <div className="space-y-2">
                        {r.phq9.items.map((item, i) => {
                          const isQ9Alert = i === 8 && item.score > 0;
                          return (
                            <div
                              key={i}
                              className={`rounded-lg border px-4 py-2 ${
                                isQ9Alert
                                  ? "border-red-300 bg-red-50"
                                  : "border-slate-100 bg-slate-50/60"
                              }`}
                            >
                              <p className={`text-xs font-medium ${isQ9Alert ? "text-red-700" : "text-slate-600"}`}>
                                {i + 1}. {item.question}
                                {isQ9Alert && (
                                  <span className="ml-2 font-semibold">⚠ Requires clinical attention</span>
                                )}
                              </p>
                              <p className={`text-sm font-semibold mt-0.5 ${isQ9Alert ? "text-red-800" : "text-slate-900"}`}>
                                {scoreToLabel(item.score)} ({item.score})
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {/* GAD-7 */}
                    <div>
                      <p className="text-sm font-semibold text-slate-900 mb-2">
                        GAD-7 — {r.gad7.total}/21 &mdash; {gad7SeverityLabel[r.gad7.severity] ?? r.gad7.severity}
                      </p>
                      <div className="space-y-2">
                        {r.gad7.items.map((item, i) => (
                          <div
                            key={i}
                            className="rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-2"
                          >
                            <p className="text-xs font-medium text-slate-600">
                              {i + 1}. {item.question}
                            </p>
                            <p className="text-sm font-semibold text-slate-900 mt-0.5">
                              {scoreToLabel(item.score)} ({item.score})
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CollapsibleSection>
                </div>
              );
            })()}

            {/* PWD Section E6 & F Results */}
            {(session.history as any)?.pwdSectionE6FResults && (() => {
              const r = (session.history as any).pwdSectionE6FResults as import("@/lib/history-schema").PwdSectionE6FResults;
              const deficitLabels: Record<string, string> = {
                consciousness: "Consciousness (orientation, confusion)",
                executive: "Executive (planning, organizing, sequencing, calculations, judgement)",
                language: "Language (oral, auditory, written comprehension or expression)",
                memory: "Memory (ability to learn and recall information)",
                perceptualPsychomotor: "Perceptual psychomotor (visual spatial)",
                psychoticSymptoms: "Psychotic symptoms (delusions, hallucinations, thought disorders)",
                emotionalDisturbance: "Emotional disturbance (e.g. depression, anxiety)",
                motivation: "Motivation (loss of initiative or interest)",
                impulseControl: "Impulse control",
                motorActivity: "Motor activity (goal oriented activity, agitation, repetitive behaviour)",
                attentionConcentration: "Attention or sustained concentration",
              };
              const checkedAreas = Object.entries(r.sectionE6.deficitAreas)
                .filter(([k, v]) => k !== "otherSpecify" && v === true)
                .map(([k]) => deficitLabels[k] ?? k);
              if (r.sectionE6.deficitAreas.otherSpecify) {
                checkedAreas.push(`Other: ${r.sectionE6.deficitAreas.otherSpecify}`);
              }
              return (
                <div className="mb-6">
                  <CollapsibleSection
                    id="pwd-e6f-results"
                    title="PWD Section E6 & F Results"
                    description="Patient-completed PWD Medical Report sections on cognitive function and daily living activities."
                    defaultOpen={true}
                  >
                    {/* Section E6 */}
                    <div className="mb-5">
                      <p className="text-sm font-semibold text-slate-900 mb-2">
                        Section E6 — Cognitive and Emotional Function
                      </p>
                      <p className="text-sm text-slate-700 mb-1">
                        <span className="font-medium">Significant deficits present:</span>{" "}
                        <span className="capitalize">{r.sectionE6.hasDeficits}</span>
                      </p>
                      {checkedAreas.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-medium text-slate-600 mb-1">Areas affected:</p>
                          <ul className="list-disc list-inside space-y-1">
                            {checkedAreas.map((area, i) => (
                              <li key={i} className="text-sm text-slate-700">{area}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {r.sectionE6.functionalSkillsComments && (
                        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                          <p className="text-xs font-medium text-slate-600 mb-0.5">Functional Skills Comments:</p>
                          <p className="text-sm text-slate-700 whitespace-pre-wrap">{r.sectionE6.functionalSkillsComments}</p>
                        </div>
                      )}
                    </div>

                    {/* Section F */}
                    <div>
                      <p className="text-sm font-semibold text-slate-900 mb-2">
                        Section F — Daily Living Activities
                      </p>
                      <p className="text-sm text-slate-700 mb-2">
                        <span className="font-medium">Impairment restricts daily living:</span>{" "}
                        <span className="capitalize">{r.sectionF.isRestricted}</span>
                      </p>
                      {r.sectionF.isRestricted === "yes" && r.sectionF.activities.length > 0 && (
                        <div className="overflow-x-auto mb-3">
                          <table className="w-full text-xs border-collapse">
                            <thead>
                              <tr className="bg-slate-100">
                                <th className="border border-slate-300 px-2 py-1.5 text-left font-semibold text-slate-700">Activity</th>
                                <th className="border border-slate-300 px-2 py-1.5 text-center font-semibold text-slate-700">Restricted?</th>
                                <th className="border border-slate-300 px-2 py-1.5 text-center font-semibold text-slate-700">Type</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.sectionF.activities.map((act, i) => (
                                <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/40"}>
                                  <td className="border border-slate-300 px-2 py-1.5 text-slate-700">{act.activity}</td>
                                  <td className="border border-slate-300 px-2 py-1.5 text-center capitalize text-slate-700">{act.restricted}</td>
                                  <td className="border border-slate-300 px-2 py-1.5 text-center capitalize text-slate-700">{act.restrictionType ?? "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {r.sectionF.periodicExplanation && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 mb-2">
                          <p className="text-xs font-medium text-slate-600 mb-0.5">If Periodic, please explain:</p>
                          <p className="text-sm text-slate-700 whitespace-pre-wrap">{r.sectionF.periodicExplanation}</p>
                        </div>
                      )}
                      {r.sectionF.socialFunctioningExplanation && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 mb-2">
                          <p className="text-xs font-medium text-slate-600 mb-0.5">If Social Functioning is impacted:</p>
                          <p className="text-sm text-slate-700 whitespace-pre-wrap">{r.sectionF.socialFunctioningExplanation}</p>
                        </div>
                      )}
                      {r.sectionF.additionalComments && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 mb-2">
                          <p className="text-xs font-medium text-slate-600 mb-0.5">Additional comments on degree of restriction:</p>
                          <p className="text-sm text-slate-700 whitespace-pre-wrap">{r.sectionF.additionalComments}</p>
                        </div>
                      )}
                      {r.sectionF.assistanceNeeded && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                          <p className="text-xs font-medium text-slate-600 mb-0.5">Assistance needed with Daily Living Activities:</p>
                          <p className="text-sm text-slate-700 whitespace-pre-wrap">{r.sectionF.assistanceNeeded}</p>
                        </div>
                      )}
                    </div>
                  </CollapsibleSection>
                </div>
              );
            })()}

            {/* Form Responses — shown when a form was uploaded with the invitation */}
            {(session.history as any)?.formSummary && (
              <div className="mb-6">
                <CollapsibleSection
                  id="form-responses"
                  title="Form Responses"
                  description="Patient answers extracted from the interview for the uploaded form."
                  defaultOpen={false}
                  headerRight={
                    formAnswers && formAnswers.length > 0 ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownloadFormAnswers(); }}
                          className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                          title="Download as plain text"
                        >
                          .txt
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); void handleDownloadFilledPdf(); }}
                          disabled={filledPdfLoading}
                          className="px-3 py-1.5 text-sm font-medium text-white bg-slate-700 border border-slate-700 rounded-lg hover:bg-slate-800 disabled:opacity-50"
                          title="Download filled PDF form"
                        >
                          {filledPdfLoading ? "Generating…" : "Filled PDF"}
                        </button>
                      </div>
                    ) : undefined
                  }
                >
                  {formAnswersLoading && (
                    <div className="flex items-center gap-2 py-4">
                      <svg className="animate-spin h-4 w-4 text-slate-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <p className="text-sm text-slate-500 animate-pulse">Extracting form responses from interview…</p>
                    </div>
                  )}

                  {formAnswersError && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                      <p className="text-sm text-amber-800">{formAnswersError}</p>
                      <button
                        onClick={() => {
                          setFormAnswersError(null);
                          setFormAnswersLoading(true);
                          fetch("/api/generate-form-answers", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ sessionCode }),
                          })
                            .then(async (res) => {
                              const payload = await res.json().catch(() => ({})) as { formAnswers?: { question: string; answer: string }[]; error?: string };
                              if (!res.ok) throw new Error(payload.error || "Failed");
                              if (Array.isArray(payload.formAnswers)) setFormAnswers(payload.formAnswers);
                            })
                            .catch((err) => setFormAnswersError(err.message || "Retry failed."))
                            .finally(() => setFormAnswersLoading(false));
                        }}
                        className="mt-2 text-xs text-amber-700 underline"
                      >
                        Retry
                      </button>
                    </div>
                  )}

                  {filledPdfError && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 mb-3">
                      <p className="text-sm text-amber-800">{filledPdfError}</p>
                    </div>
                  )}

                  {!formAnswersLoading && !formAnswersError && formAnswers && formAnswers.length > 0 && (
                    <div className="space-y-3">
                      {formAnswers.map((qa, idx) => (
                        <div key={idx} className="rounded-md border border-slate-100 bg-slate-50/60 px-4 py-3">
                          <p className="text-sm font-medium text-slate-700">
                            {idx + 1}. {qa.question}
                          </p>
                          <p className="mt-1 text-base text-slate-900 whitespace-pre-wrap">
                            {qa.answer}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {!formAnswersLoading && !formAnswersError && formAnswers && formAnswers.length === 0 && (
                    <p className="text-sm text-slate-500">No form responses could be extracted from this interview.</p>
                  )}
                </CollapsibleSection>
              </div>
            )}

        {/* Complete Intake History (Guided Interview Transcript) */}
        <div className="mb-6">
          <CollapsibleSection
            id="complete-intake-history"
            title="Complete Intake History"
            description="Guided Interview Questions & Answers"
            defaultOpen={false}
          >
            {completeIntakeTranscript.length > 0 ? (
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-3">
                    Guided Interview Questions & Answers ({completeIntakeTranscript.length} messages)
                  </p>
                  <div className="space-y-4 border-t border-slate-200 pt-4">
                    {completeIntakeTranscript.map((message, index) => (
                      <div
                        key={index}
                        className={`p-3 rounded-lg ${
                          message.role === "assistant"
                            ? "bg-blue-50 border border-blue-200"
                            : "bg-slate-50 border border-slate-200"
                        }`}
                      >
                        <p className="text-xs font-semibold text-slate-600 mb-1 uppercase tracking-wide">
                          {message.role === "assistant" ? "Assistant" : "Patient"}
                        </p>
                        <p className="text-base text-slate-900 whitespace-pre-wrap">
                          {(message as { content: string; content_en?: string }).content_en ?? message.content}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-500 italic">
                  No interview transcript available for this session.
                  {process.env.NODE_ENV === "development" && (
                    <div className="mt-2 text-xs text-slate-400 space-y-1">
                      <div>Debug: transcript is an empty array (length: {completeIntakeTranscript.length})</div>
                      <div>This session may have been saved before the transcript feature was added, or the interview had no messages.</div>
                    </div>
                  )}
                </div>
            )}
          </CollapsibleSection>
        </div>

            <div className="mb-6">
              <CollapsibleSection
                id="ai-help-with-hpi"
                title="AI help with HPI"
                description="Ask the AI to draft a referral note, suggest labs, or handle a custom request using the collected HPI."
                defaultOpen={false}
              >
              <div className="grid gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Action
                  </label>
                  <select
                    value={aiAction}
                    onChange={(e) => setAiAction(e.target.value as typeof aiAction)}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                    disabled={aiLoading}
                  >
                    <option value="referral_letter">Generate referral letter</option>
                    <option value="labs">Suggest labs or imaging</option>
                    <option value="custom">Custom prompt</option>
                    <option value="lab_requisition">Generate lab requisition (PDF)</option>
                    <option value="prescription">Generate prescription</option>
                  </select>
                </div>

                {aiAction === "lab_requisition" ? (
                  <div className="grid gap-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Patient name
                        </label>
                        <input
                          value={labPatientName}
                          onChange={(e) => setLabPatientName(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Patient email
                        </label>
                        <input
                          value={labPatientEmail}
                          onChange={(e) => setLabPatientEmail(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Physician name
                        </label>
                        <input
                          value={labPhysicianName}
                          onChange={(e) => setLabPhysicianName(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Clinic name
                        </label>
                        <input
                          value={labClinicName}
                          onChange={(e) => setLabClinicName(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Clinic address
                        </label>
                        <input
                          value={labClinicAddress}
                          onChange={(e) => setLabClinicAddress(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Labs requested (one per line or comma-separated)
                      </label>
                      <textarea
                        value={labLabsInput}
                        onChange={(e) => setLabLabsInput(e.target.value)}
                        rows={3}
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                      />
                      {labPrefillStatus && (
                        <p
                          className={`mt-1 text-xs ${
                            labPrefillStatus.startsWith("Fetching AI lab suggestions")
                              ? "animate-pulse font-medium text-amber-700"
                              : "text-slate-500"
                          }`}
                        >
                          {labPrefillStatus}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-slate-500">
                        Similar labs are grouped/deduplicated in the PDF.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Additional Instructions (e.g., “add CBC”, “remove Rheum Factor”)
                      </label>
                      <textarea
                        value={labInstructions}
                        onChange={(e) => setLabInstructions(e.target.value)}
                        rows={3}
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        Updates regenerate the PDF with adds/removals applied.
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleGenerateLabPdf}
                        disabled={labSaving}
                        className={`px-4 py-2 text-sm font-medium text-white rounded-lg ${
                          labSaving
                            ? "bg-slate-400 cursor-not-allowed"
                            : "bg-slate-900 hover:bg-slate-800"
                        }`}
                      >
                        {labSaving ? "Opening..." : "Open editable requisition"}
                      </button>
                      {labStatus && (
                        <span className="text-sm text-slate-700">{labStatus}</span>
                      )}
                    </div>
                  </div>
                ) : aiAction === "prescription" ? (
                  <div className="grid gap-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Patient name
                        </label>
                        <input
                          value={labPatientName}
                          onChange={(e) => setLabPatientName(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Patient email
                        </label>
                        <input
                          value={labPatientEmail}
                          onChange={(e) => setLabPatientEmail(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Prescriber name
                        </label>
                        <input
                          value={labPhysicianName}
                          onChange={(e) => setLabPhysicianName(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Clinic name
                        </label>
                        <input
                          value={labClinicName}
                          onChange={(e) => setLabClinicName(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Clinic address
                        </label>
                        <input
                          value={labClinicAddress}
                          onChange={(e) => setLabClinicAddress(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                      </div>
                    </div>

                    <div className="grid gap-4">
                      {rxMedications.map((row, idx) => (
                        <div key={row.id} className="rounded-md border border-slate-200 p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <p className="text-sm font-semibold text-slate-800">{`Medication ${idx + 1}`}</p>
                            {rxMedications.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeRxMedicationRow(row.id)}
                                className="text-xs font-medium text-red-700 underline underline-offset-2 hover:text-red-800"
                              >
                                Remove
                              </button>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">
                                Medication name
                              </label>
                              <input
                                value={row.medication}
                                onChange={(e) => updateRxMedicationField(row.id, "medication", e.target.value)}
                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">
                                Strength
                              </label>
                              <input
                                value={row.strength}
                                onChange={(e) => updateRxMedicationField(row.id, "strength", e.target.value)}
                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                              />
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="md:col-span-2">
                              <label className="block text-sm font-medium text-slate-700 mb-1">
                                Sig (directions)
                              </label>
                              <input
                                value={row.sig}
                                onChange={(e) => updateRxMedicationField(row.id, "sig", e.target.value)}
                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">
                                Quantity
                              </label>
                              <input
                                value={row.quantity}
                                onChange={(e) => updateRxMedicationField(row.id, "quantity", e.target.value)}
                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                              />
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">
                                Refills
                              </label>
                              <input
                                value={row.refills}
                                onChange={(e) => updateRxMedicationField(row.id, "refills", e.target.value)}
                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">
                                Notes
                              </label>
                              <input
                                value={row.notes}
                                onChange={(e) => updateRxMedicationField(row.id, "notes", e.target.value)}
                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-start">
                      <button
                        type="button"
                        onClick={addRxMedicationRow}
                        aria-label="Add another medication"
                        className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-slate-400 bg-white text-3xl leading-none text-slate-800 shadow-sm hover:bg-slate-50"
                      >
                        +
                      </button>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Signature
                      </label>
                      <canvas
                        ref={rxSignatureCanvasRef}
                        width={720}
                        height={180}
                        onPointerDown={startRxSignatureDrawing}
                        onPointerMove={drawRxSignature}
                        onPointerUp={endRxSignatureDrawing}
                        onPointerLeave={endRxSignatureDrawing}
                        onPointerCancel={endRxSignatureDrawing}
                        className="w-full rounded-md border border-slate-300 bg-white"
                        style={{ touchAction: "none" }}
                      />
                      <div className="mt-1 flex items-center justify-between">
                        <p className="text-xs text-slate-500">
                          {`Prescriber name: ${labPhysicianName || "N/A"}`}
                        </p>
                        <button
                          type="button"
                          onClick={clearRxSignature}
                          className="text-xs font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
                        >
                          Clear signature
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleGenerateRxPdf()}
                          disabled={rxSaving}
                          className={`px-4 py-2 text-sm font-medium text-white rounded-lg ${
                            rxSaving ? "bg-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800"
                          }`}
                        >
                          {rxSaving ? "Opening..." : "Generate prescription"}
                        </button>
                        {rxStatus && <span className="text-sm text-slate-700">{rxStatus}</span>}
                      </div>

                      <div className="w-full lg:w-[28rem] rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900">Patient pharmacy</p>
                          <button
                            type="button"
                            onClick={() => {
                              setPharmacyStatus(null);
                              setPharmacyDraft(pharmacyFieldsFromProfile(session?.patientProfile));
                              setIsEditingPharmacy((prev) => !prev);
                            }}
                            className="text-xs font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
                          >
                            {isEditingPharmacy
                              ? "Close"
                              : hasSavedPharmacyName
                                ? "Edit pharmacy"
                                : "Add pharmacy"}
                          </button>
                        </div>

                        {!isEditingPharmacy ? (
                          <div className="space-y-1 text-xs text-slate-700">
                            <p>
                              <span className="font-medium">Name:</span>{" "}
                              {session?.patientProfile?.pharmacyName?.trim() || "Not provided"}
                            </p>
                            <p>
                              <span className="font-medium">Number:</span>{" "}
                              {session?.patientProfile?.pharmacyNumber?.trim() || "Not provided"}
                            </p>
                            <p>
                              <span className="font-medium">Address:</span>{" "}
                              {[
                                session?.patientProfile?.pharmacyAddress?.trim() || "",
                                session?.patientProfile?.pharmacyCity?.trim() || "",
                              ]
                                .filter((value) => value.length > 0)
                                .join(", ") || "Not provided"}
                            </p>
                            <p>
                              <span className="font-medium">Phone:</span>{" "}
                              {session?.patientProfile?.pharmacyPhone?.trim() || "Not provided"}
                            </p>
                            <p>
                              <span className="font-medium">Fax:</span>{" "}
                              {session?.patientProfile?.pharmacyFax?.trim() || "Not provided"}
                            </p>
                            {!hasAnySavedPharmacy && (
                              <p className="pt-1 italic text-slate-500">
                                No pharmacy is saved yet.
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                              <input
                                value={pharmacyDraft.pharmacyName}
                                onChange={(e) =>
                                  setPharmacyDraft((prev) => ({
                                    ...prev,
                                    pharmacyName: e.target.value,
                                  }))
                                }
                                placeholder="Pharmacy name"
                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                              />
                              <input
                                value={pharmacyDraft.pharmacyNumber}
                                onChange={(e) =>
                                  setPharmacyDraft((prev) => ({
                                    ...prev,
                                    pharmacyNumber: e.target.value,
                                  }))
                                }
                                placeholder="Pharmacy number"
                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                              />
                            </div>
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                              <input
                                value={pharmacyDraft.pharmacyAddress}
                                onChange={(e) =>
                                  setPharmacyDraft((prev) => ({
                                    ...prev,
                                    pharmacyAddress: e.target.value,
                                  }))
                                }
                                placeholder="Street address"
                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                              />
                              <input
                                value={pharmacyDraft.pharmacyCity}
                                onChange={(e) =>
                                  setPharmacyDraft((prev) => ({
                                    ...prev,
                                    pharmacyCity: e.target.value,
                                  }))
                                }
                                placeholder="City"
                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                              />
                            </div>
                            <p className="text-[11px] text-slate-500">
                              Search uses the BC community pharmacies directory.
                            </p>
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                              <input
                                value={pharmacyDraft.pharmacyPhone}
                                onChange={(e) =>
                                  setPharmacyDraft((prev) => ({
                                    ...prev,
                                    pharmacyPhone: e.target.value,
                                  }))
                                }
                                placeholder="Phone"
                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                              />
                              <input
                                value={pharmacyDraft.pharmacyFax}
                                onChange={(e) =>
                                  setPharmacyDraft((prev) => ({
                                    ...prev,
                                    pharmacyFax: e.target.value,
                                  }))
                                }
                                placeholder="Fax"
                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                              />
                            </div>
                            <div className="flex items-center gap-3 pt-1">
                              <button
                                type="button"
                                onClick={handleSavePharmacy}
                                disabled={pharmacySaving || pharmacySearching}
                                className={`rounded-md px-3 py-2 text-xs font-medium text-white ${
                                  pharmacySaving || pharmacySearching
                                    ? "cursor-not-allowed bg-slate-400"
                                    : "bg-slate-900 hover:bg-slate-800"
                                }`}
                              >
                                {pharmacySaving ? "Saving..." : "Save pharmacy"}
                              </button>
                              <button
                                type="button"
                                onClick={handleSearchPharmacy}
                                disabled={pharmacySaving || pharmacySearching}
                                className={`rounded-md border px-3 py-2 text-xs font-medium ${
                                  pharmacySaving || pharmacySearching
                                    ? "cursor-not-allowed border-slate-200 text-slate-400"
                                    : "border-slate-300 text-slate-800 hover:bg-slate-100"
                                }`}
                              >
                                {pharmacySearching ? "Searching..." : "Search pharmacy"}
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelPharmacyEdit}
                                disabled={pharmacySaving || pharmacySearching}
                                className="text-xs font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
                              >
                                Cancel
                              </button>
                              {pharmacyStatus && (
                                <span className="text-xs text-slate-700">{pharmacyStatus}</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Additional instructions (optional)
                      </label>
                      <textarea
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        placeholder={
                          aiAction === "custom"
                            ? "e.g., Draft a brief note to neurology focusing on headache red flags."
                            : "Add any specifics or constraints for the response."
                        }
                        rows={3}
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        disabled={aiLoading}
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        Response is shown only here (not saved).
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleAiSubmit}
                        disabled={aiLoading}
                        className={`px-4 py-2 text-sm font-medium text-white rounded-lg ${
                          aiLoading
                            ? "bg-slate-400 cursor-not-allowed"
                            : "bg-slate-900 hover:bg-slate-800"
                        }`}
                      >
                        {aiLoading ? "Generating..." : "Ask AI"}
                      </button>
                      {aiError && (
                        <span className="text-sm text-red-600">{aiError}</span>
                      )}
                    </div>

                    {aiResponse && (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <p className="text-sm font-semibold text-slate-800 mb-2">
                          AI response
                        </p>
                        <p className="text-sm text-slate-900 whitespace-pre-wrap">
                          {aiResponse}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
              </CollapsibleSection>
            </div>

          {/* Previous Prescriptions */}
          <div className="mb-6">
            <CollapsibleSection
              id="previous-prescriptions"
              title="Previous prescriptions"
              description="Saved prescriptions for this session."
              defaultOpen={false}
            >
            {prescriptionListLoading && (
              <p className="text-sm text-slate-500">Loading…</p>
            )}
            {prescriptionListError && (
              <p className="text-sm text-red-600">{prescriptionListError}</p>
            )}
            {!prescriptionListLoading && !prescriptionListError && prescriptionList.length === 0 && (
              <p className="text-sm text-slate-500">No prescriptions yet.</p>
            )}
            {!prescriptionListLoading && !prescriptionListError && prescriptionList.length > 0 && (
              <div className="space-y-3">
                {prescriptionList.map((item) => (
                  <div
                    key={item.id}
                    className="rounded border border-slate-200 p-3 flex flex-col gap-1"
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-slate-800">
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                      <span
                        className={`text-xs font-medium px-2 py-1 rounded-full ${
                          item.faxStatus === "queued"
                            ? "bg-green-100 text-green-800"
                            : item.faxStatus === "failed"
                              ? "bg-red-100 text-red-800"
                              : item.faxStatus === "sending"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {item.faxStatus === "not_sent" ? "Fax: not sent" : `Fax: ${item.faxStatus}`}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600">
                      {item.physicianName || "Physician"} — {item.clinicName || "Clinic"}
                    </div>
                    <div className="text-xs text-slate-600">
                      Status: {item.prescriptionStatus}
                    </div>
                    {item.attestedAt && (
                      <div className="text-xs text-slate-600">
                        Attested: {new Date(item.attestedAt).toLocaleString()}
                      </div>
                    )}
                    {item.faxSentAt && (
                      <div className="text-xs text-slate-600">
                        Faxed: {new Date(item.faxSentAt).toLocaleString()}
                      </div>
                    )}
                    {item.faxStatus === "failed" && item.faxError && (
                      <div className="text-xs text-red-700">
                        Fax error: {item.faxError}
                      </div>
                    )}
                    {item.medications.length > 0 && (
                      <div className="text-xs text-slate-700 space-y-1">
                        {item.medications.map((med, idx) => (
                          <p key={`${item.id}-med-${idx}`}>
                            {`${idx + 1}. ${med.medication}${med.strength ? ` (${med.strength})` : ""} — ${med.sig}`}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            </CollapsibleSection>
          </div>

          {/* Previous Lab Requisitions */}
          <div className="mb-6">
            <CollapsibleSection
              id="previous-lab-requisitions"
              title="Previous lab requisitions"
              description="Saved requisitions for this session with download links."
              defaultOpen={false}
            >
            {labListLoading && (
              <p className="text-sm text-slate-500">Loading…</p>
            )}
            {labListError && (
              <p className="text-sm text-red-600">{labListError}</p>
            )}
            {!labListLoading && !labListError && labList.length === 0 && (
              <p className="text-sm text-slate-500">No requisitions yet.</p>
            )}
            {!labListLoading && !labListError && labList.length > 0 && (
              <div className="space-y-3">
                {labList.map((item) => (
                  <div
                    key={item.id}
                    className="rounded border border-slate-200 p-3 flex flex-col gap-1"
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-slate-800">
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleEditLabRequisition(item.id)}
                          className="text-sm text-slate-700 hover:text-slate-900 underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteLabRequisition(item.id)}
                          className="text-sm text-red-700 hover:text-red-800 underline"
                        >
                          Delete
                        </button>
                        <a
                          href={`/api/lab-requisitions?code=${sessionCode}&id=${item.id}`}
                          className="text-sm text-slate-700 hover:text-slate-900 underline"
                        >
                          Download PDF
                        </a>
                      </div>
                    </div>
                    <div className="text-xs text-slate-600">
                      {item.physicianName || "Physician"} — {item.clinicName || "Clinic"}
                    </div>
                    {item.labs && item.labs.length > 0 && (
                      <div className="text-xs text-slate-700">
                        Labs: {item.labs.join(", ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            </CollapsibleSection>
          </div>
          </>
        )}

        {/* Image Analysis */}
        {shouldShowLegacyImageAnalysisCard && (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Image Analysis
            </h2>
            {session.imageUrl && session.imageUrl.trim() !== "" ? (
              <div className="mb-4">
                <img
                  src={session.imageUrl}
                  alt={session.imageName || "Patient image"}
                  className="max-w-full max-h-96 h-auto rounded-lg border border-slate-200 object-contain"
                  style={{ display: "block" }}
                  onError={(e) => {
                    console.error("[physician/view] Image failed to load:", {
                      imageUrl: session.imageUrl?.substring(0, 50) + "...",
                      imageName: session.imageName,
                      imageUrlLength: session.imageUrl?.length,
                    });
                    // Show error message instead of hiding
                    const errorDiv = document.createElement("div");
                    errorDiv.className = "p-4 bg-red-50 rounded-lg border border-red-200";
                    const message = document.createElement("p");
                    message.className = "text-sm text-red-600";
                    message.textContent = "Failed to load image. Image URL may be invalid.";
                    errorDiv.appendChild(message);
                    (e.target as HTMLImageElement).parentElement?.replaceChild(errorDiv, e.target as HTMLImageElement);
                  }}
                />
                {session.imageName && (
                  <p className="mt-2 text-xs text-slate-500">
                    File: {session.imageName}
                  </p>
                )}
              </div>
            ) : (
              <div className="mb-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-sm text-slate-500 italic">
                  Image not available (image URL missing or empty)
                </p>
                {process.env.NODE_ENV === "development" && (
                  <p className="mt-2 text-xs text-slate-400">
                    Debug: imageUrl = {session.imageUrl ? `"${session.imageUrl.substring(0, 50)}..."` : "null/undefined"}
                  </p>
                )}
              </div>
            )}
            <p className="text-base text-slate-900 whitespace-pre-wrap">
              {session.imageSummary}
            </p>
          </div>
        )}

      </div>
    </div>
  );
}

export default function PhysicianViewPage() {
  return (
    <>
      <SessionKeepAlive redirectTo="/auth/login" />
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading...</div>}>
        <PhysicianViewContent />
      </Suspense>
    </>
  );
}
