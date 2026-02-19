"use client";

import { useEffect, useMemo, useRef, useState, Suspense, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PatientSession } from "@/lib/session-store";
import { jsPDF } from "jspdf";
import { CLINICAL_ASSISTIVE_DISCLAIMER } from "@/lib/clinical-safety";

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

function PhysicianViewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionCode = searchParams.get("code");

  const [session, setSession] = useState<PatientSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditingHpi, setIsEditingHpi] = useState(false);
  const [hpiSummaryDraft, setHpiSummaryDraft] = useState("");
  const [hpiAssessmentDraft, setHpiAssessmentDraft] = useState("");
  const [hpiPlanDraft, setHpiPlanDraft] = useState("");
  const [hpiSaving, setHpiSaving] = useState(false);
  const [hpiSaveError, setHpiSaveError] = useState<string | null>(null);
  const [hpiSaveSuccess, setHpiSaveSuccess] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
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
  const rxSignatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rxSignatureDrawingRef = useRef(false);

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

  const handleBack = () => {
    router.push("/physician/dashboard");
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
    setHpiSummaryDraft(session?.history?.summary || "");
    setHpiAssessmentDraft(session?.history?.assessment || "");
    const existingPlan = session?.history?.plan;
    const planText = Array.isArray(existingPlan)
      ? existingPlan.join("\n")
      : typeof existingPlan === "string"
        ? existingPlan
        : "";
    setHpiPlanDraft(planText);
    setHpiSaveError(null);
    setHpiSaveSuccess(null);
    setIsEditingHpi(true);
  };

  const handleCancelHpiEdit = () => {
    setHpiSummaryDraft(session?.history?.summary || "");
    setHpiAssessmentDraft(session?.history?.assessment || "");
    const existingPlan = session?.history?.plan;
    const planText = Array.isArray(existingPlan)
      ? existingPlan.join("\n")
      : typeof existingPlan === "string"
        ? existingPlan
        : "";
    setHpiPlanDraft(planText);
    setHpiSaveError(null);
    setHpiSaveSuccess(null);
    setIsEditingHpi(false);
  };

  const handleSaveHpiEdit = async () => {
    if (!sessionCode) {
      setHpiSaveError("Session code is missing.");
      return;
    }

    const trimmedSummary = hpiSummaryDraft.trim();
    const trimmedAssessment = hpiAssessmentDraft.trim();
    const normalizedPlan = hpiPlanDraft
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    if (trimmedSummary.length < 10 || trimmedSummary.length > 1500) {
      setHpiSaveError("Summary must be between 10 and 1500 characters.");
      return;
    }
    if (trimmedAssessment.length < 10 || trimmedAssessment.length > 1500) {
      setHpiSaveError("Assessment must be between 10 and 1500 characters.");
      return;
    }
    if (normalizedPlan.length < 1 || normalizedPlan.length > 6) {
      setHpiSaveError("Plan must include between 1 and 6 items (one per line).");
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
          historySummary: trimmedSummary,
          historyAssessment: trimmedAssessment,
          historyPlan: normalizedPlan,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save HPI summary.");
      }

      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          history: {
            ...prev.history,
            summary: trimmedSummary,
            assessment: trimmedAssessment,
            plan: normalizedPlan,
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
    setHpiSummaryDraft(session?.history?.summary || "");
    setHpiAssessmentDraft(session?.history?.assessment || "");
    const existingPlan = session?.history?.plan;
    const planText = Array.isArray(existingPlan)
      ? existingPlan.join("\n")
      : typeof existingPlan === "string"
        ? existingPlan
        : "";
    setHpiPlanDraft(planText);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCode]);

  useEffect(() => {
    loadPrescriptionList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCode]);

  const computeLabs = () => {
    const raw = labLabsInput
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    let labs = [...raw];

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

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-semibold text-slate-900">
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
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        {/* Patient Information */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            Patient Information
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-slate-500">Name</p>
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
            <div>
              <p className="text-sm text-slate-500">Phone</p>
              <p className="text-base font-medium text-slate-900">
                {session.patientProfile?.primaryPhone?.trim() || "—"}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Alternate Phone</p>
              <p className="text-base font-medium text-slate-900">
                {session.patientProfile?.secondaryPhone?.trim() || "—"}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500">Health Care Number</p>
              <p className="text-base font-medium text-slate-900">
                {session.patientProfile?.insuranceNumber?.trim() || "—"}
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-sm text-slate-500">Address</p>
              <p className="text-base text-slate-900">{session.patientProfile?.address?.trim() || "—"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-sm text-slate-500">Chief Complaint</p>
              <p className="text-base text-slate-900">{session.chiefComplaint}</p>
            </div>
          </div>
        </div>

        {/* History Summary */}
        {session.history && (
          <>
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">
                History of Present Illness
              </h2>
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">Summary</p>
                  {isEditingHpi ? (
                    <textarea
                      value={hpiSummaryDraft}
                      onChange={(e) => setHpiSummaryDraft(e.target.value)}
                      rows={6}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                      disabled={hpiSaving}
                    />
                  ) : (
                    <p className="text-base text-slate-900 whitespace-pre-wrap">
                      {session.history.summary}
                    </p>
                  )}
                </div>
                {(session.history as any).medPmhSummary && (
                  <div>
                    <p className="text-sm font-medium text-slate-700 mb-2">
                      Medications / PMH (uploaded photo)
                    </p>
                    <p className="text-base text-slate-900 whitespace-pre-wrap">
                      {(session.history as any).medPmhSummary}
                    </p>
                  </div>
                )}
                {Array.isArray((session.history as any).physicalFindings) &&
                  (session.history as any).physicalFindings.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-slate-700 mb-2">
                        Physical Findings
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-base text-slate-900">
                        {(session.history as any).physicalFindings.map(
                          (item: string, idx: number) => (
                            <li key={idx}>{item}</li>
                          ),
                        )}
                      </ul>
                    </div>
                  )}
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">Assessment</p>
                  {isEditingHpi ? (
                    <textarea
                      value={hpiAssessmentDraft}
                      onChange={(e) => setHpiAssessmentDraft(e.target.value)}
                      rows={4}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                      disabled={hpiSaving}
                    />
                  ) : (
                    <p className="text-base text-slate-900 whitespace-pre-wrap">
                      {session.history.assessment}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">Plan</p>
                  {isEditingHpi ? (
                    <textarea
                      value={hpiPlanDraft}
                      onChange={(e) => setHpiPlanDraft(e.target.value)}
                      rows={4}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                      disabled={hpiSaving}
                      placeholder="One plan item per line"
                    />
                  ) : (
                    <>
                      {Array.isArray(session.history.plan) ? (
                        <ul className="list-disc list-inside space-y-1 text-base text-slate-900">
                          {(session.history.plan as string[]).map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-base text-slate-900 whitespace-pre-wrap">
                          {session.history.plan as string}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="mt-5">
                {hpiSaveError && (
                  <p className="text-sm text-red-600 mb-2">{hpiSaveError}</p>
                )}
                {hpiSaveSuccess && (
                  <p className="text-sm text-green-700 mb-2">{hpiSaveSuccess}</p>
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
                  ) : (
                    <button
                      onClick={handleStartHpiEdit}
                      className="px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    AI help with HPI
                  </h3>
                  <p className="text-sm text-slate-600 mt-1">
                    Ask the AI to draft a referral note, suggest labs, or handle a custom request using the collected HPI.
                  </p>
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {CLINICAL_ASSISTIVE_DISCLAIMER}
                  </p>
                </div>
              </div>

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
                        <p className="mt-1 text-xs text-slate-500">{labPrefillStatus}</p>
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
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {CLINICAL_ASSISTIVE_DISCLAIMER}
                    </div>
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
                        <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          {CLINICAL_ASSISTIVE_DISCLAIMER}
                        </p>
                        <p className="text-sm text-slate-900 whitespace-pre-wrap">
                          {aiResponse}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

          {/* Previous Prescriptions */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Previous prescriptions
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  Saved prescriptions for this session.
                </p>
              </div>
            </div>
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
          </div>

          {/* Previous Lab Requisitions */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Previous lab requisitions
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  Saved requisitions for this session with download links.
                </p>
              </div>
            </div>
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
          </div>
          </>
        )}

        {/* Complete Intake History (Guided Interview Transcript) */}
        {Array.isArray(session.transcript) ? (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Complete Intake History
            </h2>
            {session.transcript.length > 0 ? (
              <div>
                <button
                  onClick={() => setShowTranscript(!showTranscript)}
                  className="flex items-center justify-between w-full text-left text-sm font-medium text-slate-700 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 rounded-lg p-2 -ml-2"
                >
                  <span>Guided Interview Questions & Answers ({session.transcript.length} messages)</span>
                  <svg
                    className={`w-5 h-5 transform transition-transform ${showTranscript ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showTranscript && (
                  <div className="mt-3 space-y-4 border-t border-slate-200 pt-4">
                    {session.transcript.map((message, index) => (
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
                          {message.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-slate-500 italic">
                No interview transcript available for this session.
                {process.env.NODE_ENV === "development" && (
                  <div className="mt-2 text-xs text-slate-400 space-y-1">
                    <div>Debug: transcript is an empty array (length: {session.transcript.length})</div>
                    <div>This session may have been saved before the transcript feature was added, or the interview had no messages.</div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Complete Intake History
            </h2>
            <div className="text-sm text-slate-500 italic">
              Transcript data is not available or in an unexpected format.
              {process.env.NODE_ENV === "development" && (
                <div className="mt-2 text-xs text-slate-400 space-y-1">
                  <div>Debug: transcript type = {typeof session.transcript}, isArray = {Array.isArray(session.transcript) ? "true" : "false"}</div>
                  <div>Has history: {session.history ? "yes" : "no"}</div>
                  <div>History keys: {session.history ? Object.keys(session.history).join(", ") : "none"}</div>
                  <div>History has transcript: {session.history && (session.history as any).transcript ? "yes" : "no"}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Image Analysis */}
        {session.imageSummary && (
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
                    errorDiv.innerHTML = `<p className="text-sm text-red-600">Failed to load image. Image URL may be invalid.</p>`;
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

        {/* Patient Profile */}
        {session.patientProfile && (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Patient Profile
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-slate-500">Age</p>
                <p className="text-base font-medium text-slate-900">{session.patientProfile.age}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Sex</p>
                <p className="text-base font-medium text-slate-900 capitalize">{session.patientProfile.sex}</p>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-slate-500">Past Medical History</p>
                <p className="text-base text-slate-900">{session.patientProfile.pmh}</p>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-slate-500">Family History</p>
                <p className="text-base text-slate-900">{session.patientProfile.familyHistory}</p>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-slate-500">Current Medications</p>
                <p className="text-base text-slate-900">{session.patientProfile.currentMedications}</p>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-slate-500">Allergies</p>
                <p className="text-base text-slate-900">{session.patientProfile.allergies}</p>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-slate-500">Family Doctor</p>
                <p className="text-base text-slate-900">{session.patientProfile.familyDoctor}</p>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-slate-500">Pharmacy</p>
                <div className="space-y-1">
                  <p className="text-base text-slate-900">
                    <span className="font-medium">Name:</span>{" "}
                    {session.patientProfile.pharmacyName?.trim() || "Not provided"}
                  </p>
                  <p className="text-base text-slate-900">
                    <span className="font-medium">Number:</span>{" "}
                    {session.patientProfile.pharmacyNumber?.trim() || "Not provided"}
                  </p>
                  <p className="text-base text-slate-900">
                    <span className="font-medium">Address:</span>{" "}
                    {[
                      session.patientProfile.pharmacyAddress?.trim() || "",
                      session.patientProfile.pharmacyCity?.trim() || "",
                    ]
                      .filter((value) => value.length > 0)
                      .join(", ") || "Not provided"}
                  </p>
                  <p className="text-base text-slate-900">
                    <span className="font-medium">Phone:</span>{" "}
                    {session.patientProfile.pharmacyPhone?.trim() || "Not provided"}
                  </p>
                  <p className="text-base text-slate-900">
                    <span className="font-medium">Fax:</span>{" "}
                    {session.patientProfile.pharmacyFax?.trim() || "Not provided"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PhysicianViewPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading...</div>}>
      <PhysicianViewContent />
    </Suspense>
  );
}
