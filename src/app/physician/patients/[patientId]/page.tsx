"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { mergeDiagramSelectionsForDisplay, type DiagramSelectionInput } from "@/lib/body-diagram-display";
import DiagramViewer from "./DiagramViewer";

// ── HPI helpers (mirrors physician/view) ────────────────────────────────────
function stripOptionalNone(value: string): string {
  return /^none\.?$/i.test(value.trim()) ? "" : value;
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

type HpiSections = {
  subjective: string;
  physicalFindings: string[];
  assessment: string;
  investigations: string[];
  plan: string[];
  patientFinalComments: string;
};

function getHpiSections(hpi: any): HpiSections {
  const subjective = stripOptionalNone(hpi?.summary || "");
  const assessment = stripOptionalNone(hpi?.assessment || "");
  const physicalFindings = toStringList(hpi?.physicalFindings);
  const investigations = toStringList(hpi?.investigations).map((s) => s.replace(/^[-*•]\s*/, "").trim());
  const plan = toStringList(hpi?.plan).map((s) => s.replace(/^[-*•]\s*/, "").trim());
  const patientFinalComments = stripOptionalNone(
    hpi?.patientFinalQuestionsCommentsEnglish?.trim()
      ? hpi.patientFinalQuestionsCommentsEnglish
      : hpi?.patientFinalQuestionsComments || "",
  );
  return {
    subjective: subjective || "None",
    physicalFindings,
    assessment: assessment || "None",
    investigations,
    plan,
    patientFinalComments: patientFinalComments || "None",
  };
}

function getHpiAiSummary(sections: HpiSections): string {
  const firstSentence = sections.subjective
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .find((p) => p.length > 0 && p.toLowerCase() !== "none");
  if (firstSentence) return firstSentence;
  return [sections.assessment, ...sections.physicalFindings, ...sections.plan]
    .map((p) => p.trim())
    .find((p) => p.length > 0 && p.toLowerCase() !== "none") || "Clinical summary not available.";
}
// ────────────────────────────────────────────────────────────────────────────

type Encounter = {
  id: string;
  occurredAt: string;
  sourceSessionCode: string | null;
  chiefComplaint: string | null;
  hpi: any;
};

type LabRequisition = {
  id: string;
  sessionCode: string;
  patientName: string | null;
  patientEmail: string | null;
  physicianName: string | null;
  clinicName: string | null;
  clinicAddress: string | null;
  labs: unknown;
  instructions: string | null;
  createdAt: string;
};

type PatientPayload = {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  email: string | null;
  primaryPhone: string | null;
  secondaryPhone: string | null;
  address: string | null;
  oscarDemographicNo: string | null;
  hinMasked: string | null;
};

type MarkerPoint = { xPct: number; yPct: number };
type DiagramMarkerSelection = {
  part?: string;
  side?: string;
  markers?: MarkerPoint[];
};

function parseMarkerTuples(text: string): MarkerPoint[] {
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
    .filter((marker): marker is MarkerPoint => Boolean(marker));
  return parsed.slice(0, 30);
}

function getBodyDiagramImage(part: string, side?: string): { src: string; alt: string } {
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
    case "abdomen":
      return { src: "/Images/trunk front .png", alt: "Chest, breast, abdomen, and anterior neck pain diagram" };
    default:
      return { src: "/Images/ankle.png", alt: "Body part pain diagram" };
  }
}

function computeAgeFromDob(dob: string | null): number | null {
  if (!dob) return null;
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
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function isUuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default function PatientChartPage() {
  const router = useRouter();
  const pathname = usePathname();
  const patientId = useMemo(() => {
    // Derive patientId directly from pathname to avoid async params access in Next 16.
    const path = typeof pathname === "string" ? pathname : "";
    const prefix = "/physician/patients/";
    if (!path.startsWith(prefix)) return "";
    const last = path.slice(prefix.length).split("/").filter(Boolean)[0] || "";
    try {
      return decodeURIComponent(last).trim();
    } catch {
      return last.trim();
    }
  }, [pathname]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [patient, setPatient] = useState<PatientPayload | null>(null);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [labRequisitions, setLabRequisitions] = useState<LabRequisition[]>([]);

  // Per-encounter form answers: encounterId → loaded answers or "loading" or "error"
  const [formAnswersMap, setFormAnswersMap] = useState<
    Map<string, { question: string; answer: string }[] | "loading" | string>
  >(new Map());
  const loadingFormAnswersRef = useRef<Set<string>>(new Set());

  const age = useMemo(() => computeAgeFromDob(patient?.dateOfBirth || null), [patient?.dateOfBirth]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const summary = encounters.slice(0, 10).map((enc) => {
      const bodyDiagram = enc?.hpi?.patientUploads?.bodyDiagram;
      const selectedParts = Array.isArray(bodyDiagram?.selectedParts) ? bodyDiagram.selectedParts.length : 0;
      const markersByPart = Array.isArray(bodyDiagram?.markersByPart) ? bodyDiagram.markersByPart.length : 0;
      const leftSoleMarkers = Array.isArray(bodyDiagram?.leftSoleMarkers)
        ? bodyDiagram.leftSoleMarkers.length
        : 0;
      return {
        encounterId: enc.id,
        selectedParts,
        markersByPart,
        leftSoleMarkers,
      };
    });
    if (summary.length > 0) {
      console.debug("[physician/patients] bodyDiagram render summary", summary);
    }
  }, [encounters]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!isUuid(patientId)) {
          // During client-side navigation we can briefly render with empty params.
          // Don't flash an error unless we have a non-empty, invalid value.
          if (!patientId) {
            return;
          }
          throw new Error(`Invalid patient id: "${patientId}"`);
        }
        const res = await fetch(`/api/patients/${encodeURIComponent(patientId)}`);
        if (res.status === 401) {
          router.push("/auth/login");
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Failed to load patient chart");
        }
        if (cancelled) return;
        setPatient(data?.patient || null);
        const mapped: Encounter[] = Array.isArray(data?.encounters)
          ? data.encounters.map((e: any) => ({
              id: String(e.id),
              occurredAt: String(e.occurredAt),
              sourceSessionCode: e.sourceSessionCode ?? null,
              chiefComplaint: e.chiefComplaint ?? null,
              hpi: e.hpi ?? null,
            }))
          : [];
        setEncounters(mapped);
        const mappedLabRequisitions: LabRequisition[] = Array.isArray(data?.labRequisitions)
          ? data.labRequisitions.map((item: any) => ({
              id: String(item.id),
              sessionCode: String(item.sessionCode || ""),
              patientName: item.patientName ?? null,
              patientEmail: item.patientEmail ?? null,
              physicianName: item.physicianName ?? null,
              clinicName: item.clinicName ?? null,
              clinicAddress: item.clinicAddress ?? null,
              labs: item.labs,
              instructions: item.instructions ?? null,
              createdAt: String(item.createdAt),
            }))
          : [];
        setLabRequisitions(mappedLabRequisitions);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load patient chart");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [patientId, router]);

  async function loadFormAnswers(encounterId: string, sessionCode: string) {
    if (loadingFormAnswersRef.current.has(encounterId)) return;
    loadingFormAnswersRef.current.add(encounterId);
    setFormAnswersMap((prev) => new Map(prev).set(encounterId, "loading"));
    try {
      const res = await fetch("/api/generate-form-answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionCode }),
      });
      const data = await res.json().catch(() => ({})) as { formAnswers?: { question: string; answer: string }[]; error?: string };
      if (!res.ok) throw new Error(data?.error || "Failed to load form responses");
      setFormAnswersMap((prev) => new Map(prev).set(encounterId, Array.isArray(data.formAnswers) ? data.formAnswers : []));
    } catch (err) {
      setFormAnswersMap((prev) => new Map(prev).set(encounterId, err instanceof Error ? err.message : "Failed to load"));
    } finally {
      loadingFormAnswersRef.current.delete(encounterId);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-slate-600">Loading patient chart...</p>
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="min-h-screen bg-slate-100">
        <div className="max-w-5xl mx-auto px-4 py-10">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
            <p className="text-slate-900 font-semibold">Unable to load chart</p>
            <p className="text-slate-600 mt-1 text-sm">{error || "Patient not found."}</p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => router.back()}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
          <Image
            src="/LogoFinal.png"
            alt="Health Assist AI logo"
            width={112}
            height={26}
            className="mx-auto mb-4 h-[38px] w-[114px] object-contain sm:h-[50px] sm:w-[150px]"
            priority
          />
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold text-slate-900 truncate">{patient.fullName}</h1>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-slate-700">
                <div>
                  <span className="text-slate-500">DOB:</span>{" "}
                  {patient.dateOfBirth || "—"}
                  {age != null ? ` (${age}y)` : ""}
                </div>
                <div>
                  <span className="text-slate-500">Email:</span> {patient.email || "—"}
                </div>
                <div>
                  <span className="text-slate-500">Phone:</span> {patient.primaryPhone || "—"}
                </div>
                <div>
                  <span className="text-slate-500">Alt phone:</span> {patient.secondaryPhone || "—"}
                </div>
                <div>
                  <span className="text-slate-500">HIN:</span> {patient.hinMasked || "—"}
                </div>
                <div>
                  <span className="text-slate-500">OSCAR:</span> {patient.oscarDemographicNo || "—"}
                </div>
                <div className="md:col-span-2">
                  <span className="text-slate-500">Address:</span> {patient.address || "—"}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.back()}
              className="shrink-0 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Back
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">Encounters ({encounters.length})</h2>
            <p className="text-sm text-slate-600 mt-1">Most recent on top.</p>
          </div>

          {encounters.length === 0 ? (
            <div className="px-6 py-6 text-sm text-slate-600">No encounters yet.</div>
          ) : (
            <div className="divide-y divide-slate-200">
              {encounters.map((enc) => {
                const hpi = enc.hpi || {};
                const interviewEndedEarly = hpi?.interviewEndedEarly === true;
                const patientUploads = hpi?.patientUploads || {};
                const lesionSummary = patientUploads?.lesionImage?.summary || "";
                const lesionImageUrl = patientUploads?.lesionImage?.imageUrl || "";
                const lesionImageName = patientUploads?.lesionImage?.imageName || "";
                const bodyDiagram = patientUploads?.bodyDiagram || {};
                const bodyDiagramArea = bodyDiagram?.selectedArea;
                const bodyDiagramParts = Array.isArray(bodyDiagram?.selectedParts)
                  ? (bodyDiagram.selectedParts as Array<{ part?: string; side?: string }>)
                  : [];
                const bodyDiagramNote = bodyDiagram?.note || "";
                const structuredMarkersByPart = Array.isArray(bodyDiagram?.markersByPart)
                  ? (bodyDiagram.markersByPart as DiagramMarkerSelection[])
                  : [];
                const structuredMarkers = Array.isArray(bodyDiagram?.leftSoleMarkers)
                  ? (bodyDiagram.leftSoleMarkers as MarkerPoint[])
                  : [];
                const fallbackMarkers =
                  structuredMarkers.length === 0 &&
                  /left sole markers|marked.*left sole|left sole/i.test(bodyDiagramNote)
                    ? parseMarkerTuples(bodyDiagramNote)
                    : [];
                const displayMarkers = structuredMarkers.length > 0 ? structuredMarkers : fallbackMarkers;
                const hasLeftSoleSelection = bodyDiagramParts.some(
                  (part) => part?.part === "foot" && (part?.side === "left" || part?.side === "both"),
                );
                const markerSelectionsFromStructured = structuredMarkersByPart.reduce<
                  Array<{ part: string; side?: "left" | "right"; markers: MarkerPoint[] }>
                >((acc, selection) => {
                  const part = (selection.part || "").trim();
                  const side =
                    selection.side === "left" || selection.side === "right"
                      ? selection.side
                      : undefined;
                  const markers = Array.isArray(selection.markers)
                    ? selection.markers.filter(
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
                const shouldShowLegacyLeftSoleOnly =
                  markerSelectionsFromStructured.length === 0 && (displayMarkers.length > 0 || hasLeftSoleSelection);
                const markerSelections = shouldShowLegacyLeftSoleOnly
                  ? [{ part: "foot", side: "left" as const, markers: displayMarkers }]
                  : markerSelectionsFromStructured;
                const diagramSelectionsToRender = mergeDiagramSelectionsForDisplay({
                  markerSelections: markerSelections as DiagramSelectionInput[],
                  selectedParts: bodyDiagramParts,
                });
                const hasUploadedContext =
                  Boolean(lesionSummary || lesionImageUrl || bodyDiagramNote || bodyDiagramArea) ||
                  bodyDiagramParts.length > 0 ||
                  markerSelections.length > 0 ||
                  shouldShowLegacyLeftSoleOnly;

                return (
                  <details key={enc.id} className="group px-6 py-4">
                    <summary className="cursor-pointer list-none select-none flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">
                          {formatDateTime(enc.occurredAt)}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {enc.chiefComplaint ? `Chief complaint: ${enc.chiefComplaint}` : "Chief complaint: —"}
                          {enc.sourceSessionCode ? ` • Session: ${enc.sourceSessionCode}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-slate-500 transition-transform group-open:rotate-180">
                        ▼
                      </div>
                    </summary>

                    <div className="mt-4 space-y-4 text-sm text-slate-800">
                      {interviewEndedEarly && (
                        <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-900">
                          Interview ended early by patient request.
                        </div>
                      )}

                      {(() => {
                        const sections = getHpiSections(hpi);
                        const aiSummary = getHpiAiSummary(sections);
                        const encFormAnswersState = formAnswersMap.get(enc.id);
                        const cachedFormAnswers = Array.isArray(hpi?.formAnswers) ? hpi.formAnswers as { question: string; answer: string }[] : null;
                        const loadedFormAnswers = Array.isArray(encFormAnswersState) ? encFormAnswersState : null;
                        const formAnswersToShow = loadedFormAnswers ?? cachedFormAnswers;
                        return (
                          <div className="space-y-5">
                            <div>
                              <p className="text-sm font-medium text-slate-700">AI Summary</p>
                              <div className="mt-1 h-px bg-slate-200" />
                              <p className="mt-2 text-base text-slate-900">{aiSummary}</p>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-700">Subjective</p>
                              <div className="mt-1 h-px bg-slate-200" />
                              <p className="mt-2 text-base text-slate-900 whitespace-pre-wrap">{sections.subjective}</p>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-700">Physical Findings</p>
                              <div className="mt-1 h-px bg-slate-200" />
                              {sections.physicalFindings.length > 0 ? (
                                <ul className="mt-2 space-y-1 text-base text-slate-900">
                                  {sections.physicalFindings.map((item, idx) => <li key={idx}>• {item}</li>)}
                                </ul>
                              ) : (
                                <p className="mt-2 text-base text-slate-900">None</p>
                              )}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-700">Assessment</p>
                              <div className="mt-1 h-px bg-slate-200" />
                              <p className="mt-2 text-base text-slate-900 whitespace-pre-wrap">{sections.assessment}</p>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-700">Investigations</p>
                              <div className="mt-1 h-px bg-slate-200" />
                              {sections.investigations.length > 0 ? (
                                <ul className="mt-2 space-y-1 text-base text-slate-900">
                                  {sections.investigations.map((item, idx) => <li key={idx}>• {item}</li>)}
                                </ul>
                              ) : (
                                <p className="mt-2 text-base text-slate-900">None</p>
                              )}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-700">Plan</p>
                              <div className="mt-1 h-px bg-slate-200" />
                              {sections.plan.length > 0 ? (
                                <ul className="mt-2 space-y-1 text-base text-slate-900">
                                  {sections.plan.map((item, idx) => <li key={idx}>• {item}</li>)}
                                </ul>
                              ) : (
                                <p className="mt-2 text-base text-slate-900">None</p>
                              )}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-700">Patient Final Comments</p>
                              <div className="mt-1 h-px bg-slate-200" />
                              <p className="mt-2 text-base text-slate-900 whitespace-pre-wrap">{sections.patientFinalComments}</p>
                            </div>

                            {hpi?.formSummary && (
                              <div>
                                <p className="text-sm font-medium text-slate-700">Form Responses</p>
                                <div className="mt-1 h-px bg-slate-200" />
                                {formAnswersToShow ? (
                                  formAnswersToShow.length > 0 ? (
                                    <div className="mt-2 space-y-3">
                                      {formAnswersToShow.map((qa, idx) => (
                                        <div key={idx} className="rounded-md border border-slate-100 bg-slate-50/60 px-4 py-3">
                                          <p className="text-sm font-medium text-slate-700">{idx + 1}. {qa.question}</p>
                                          <p className="mt-1 text-base text-slate-900 whitespace-pre-wrap">{qa.answer}</p>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="mt-2 text-sm text-slate-500">No form responses extracted.</p>
                                  )
                                ) : encFormAnswersState === "loading" ? (
                                  <p className="mt-2 text-sm text-slate-500 animate-pulse">Loading form responses…</p>
                                ) : typeof encFormAnswersState === "string" ? (
                                  <p className="mt-2 text-sm text-red-600">{encFormAnswersState}</p>
                                ) : enc.sourceSessionCode ? (
                                  <button
                                    type="button"
                                    onClick={() => loadFormAnswers(enc.id, enc.sourceSessionCode!)}
                                    className="mt-2 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                                  >
                                    Load Form Responses
                                  </button>
                                ) : null}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {hasUploadedContext && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                            Patient Uploaded Context
                          </div>

                          {(lesionImageUrl || lesionSummary) && (
                            <div className="mt-3">
                              <div className="text-sm font-medium text-slate-700">Body-part photo</div>
                              {lesionImageUrl && (
                                <img
                                  src={lesionImageUrl}
                                  alt={lesionImageName || "Patient uploaded body-part image"}
                                  className="mt-2 max-h-64 w-auto rounded-lg border border-slate-200 object-contain bg-white"
                                />
                              )}
                              {lesionImageName && (
                                <p className="mt-2 text-xs text-slate-500">File: {lesionImageName}</p>
                              )}
                              {lesionSummary && (
                                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{lesionSummary}</p>
                              )}
                            </div>
                          )}

                          {(markerSelections.length > 0 || bodyDiagramArea || bodyDiagramParts.length > 0 || bodyDiagramNote) && (
                            <div className="mt-4">
                              <div className="text-sm font-medium text-slate-700">Body Diagram Selection</div>

                              {diagramSelectionsToRender.map((selection, selectionIndex) => {
                                const image = getBodyDiagramImage(selection.part, selection.side);
                                const partLabel = selection.side
                                  ? `${selection.side} ${selection.part}`
                                  : selection.part;
                                return (
                                  <div
                                    key={`${selection.part}-${selection.side || "none"}-${selectionIndex}`}
                                    className="mt-2"
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
                                              (marker) =>
                                                `(${Math.round(marker.xPct)}, ${Math.round(marker.yPct)})`,
                                            )
                                            .join(", ")}`
                                        : "No marker coordinates captured for this selection."}
                                    </p>
                                  </div>
                                );
                              })}

                              {bodyDiagramArea && (
                                <p className="mt-2 text-sm text-slate-700">Selected area: {bodyDiagramArea}</p>
                              )}
                              {bodyDiagramParts.length > 0 && (
                                <p className="mt-1 text-sm text-slate-700">
                                  Selected parts:{" "}
                                  {bodyDiagramParts
                                    .map((part) => {
                                      const partName = (part?.part || "").trim();
                                      if (!partName) return "";
                                      const side = (part?.side || "").trim();
                                      return side ? `${side} ${partName}` : partName;
                                    })
                                    .filter((value) => value.length > 0)
                                    .join(", ")}
                                </p>
                              )}
                              {bodyDiagramNote && (
                                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{bodyDiagramNote}</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">
              Lab Requisitions ({labRequisitions.length})
            </h2>
            <p className="text-sm text-slate-600 mt-1">Saved requisitions from encounter sessions.</p>
          </div>

          {labRequisitions.length === 0 ? (
            <div className="px-6 py-6 text-sm text-slate-600">No lab requisitions yet.</div>
          ) : (
            <div className="divide-y divide-slate-200">
              {labRequisitions.map((req) => {
                const labItems = Array.isArray(req.labs) ? req.labs : [];
                return (
                  <details key={req.id} className="group px-6 py-4">
                    <summary className="cursor-pointer list-none select-none flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">
                          {formatDateTime(req.createdAt)}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          Session: {req.sessionCode || "—"}
                          {req.physicianName ? ` • Physician: ${req.physicianName}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-slate-500 transition-transform group-open:rotate-180">
                        ▼
                      </div>
                    </summary>

                    <div className="mt-4 space-y-4 text-sm text-slate-800">
                      <div>
                        <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Labs</div>
                        {labItems.length === 0 ? (
                          <div className="mt-1">—</div>
                        ) : (
                          <ul className="mt-1 list-disc pl-5 space-y-1">
                            {labItems.map((item, idx) => (
                              <li key={idx} className="whitespace-pre-wrap">
                                {typeof item === "string" ? item : JSON.stringify(item)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {req.instructions && req.instructions.trim().length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                            Instructions
                          </div>
                          <div className="mt-1 whitespace-pre-wrap">{req.instructions}</div>
                        </div>
                      )}

                      {(req.clinicName || req.clinicAddress) && (
                        <div>
                          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Clinic</div>
                          <div className="mt-1 whitespace-pre-wrap">
                            {[req.clinicName, req.clinicAddress].filter(Boolean).join(" — ")}
                          </div>
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

