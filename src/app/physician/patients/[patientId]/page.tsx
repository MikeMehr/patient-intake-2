"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

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

  const age = useMemo(() => computeAgeFromDob(patient?.dateOfBirth || null), [patient?.dateOfBirth]);

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
                const plan = Array.isArray(hpi?.plan) ? (hpi.plan as string[]) : [];
                const physicalFindings = Array.isArray(hpi?.physicalFindings) ? (hpi.physicalFindings as string[]) : [];
                const positives = Array.isArray(hpi?.positives) ? (hpi.positives as string[]) : [];
                const negatives = Array.isArray(hpi?.negatives) ? (hpi.negatives as string[]) : [];
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
                const shouldShowLeftSole = displayMarkers.length > 0 || hasLeftSoleSelection;
                const hasUploadedContext =
                  Boolean(lesionSummary || lesionImageUrl || bodyDiagramNote || bodyDiagramArea) ||
                  bodyDiagramParts.length > 0 ||
                  shouldShowLeftSole;

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
                      <div>
                        <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Summary</div>
                        <div className="mt-1 whitespace-pre-wrap">{hpi?.summary || "—"}</div>
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Assessment</div>
                        <div className="mt-1 whitespace-pre-wrap">{hpi?.assessment || "—"}</div>
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Plan</div>
                        {plan.length === 0 ? (
                          <div className="mt-1">—</div>
                        ) : (
                          <ul className="mt-1 list-disc pl-5 space-y-1">
                            {plan.map((item, idx) => (
                              <li key={idx} className="whitespace-pre-wrap">
                                {item}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {(physicalFindings.length > 0 || positives.length > 0 || negatives.length > 0) && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                              Physical findings
                            </div>
                            {physicalFindings.length === 0 ? (
                              <div className="mt-1">—</div>
                            ) : (
                              <ul className="mt-1 list-disc pl-5 space-y-1">
                                {physicalFindings.map((item, idx) => (
                                  <li key={idx} className="whitespace-pre-wrap">
                                    {item}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Positives</div>
                            {positives.length === 0 ? (
                              <div className="mt-1">—</div>
                            ) : (
                              <ul className="mt-1 list-disc pl-5 space-y-1">
                                {positives.map((item, idx) => (
                                  <li key={idx} className="whitespace-pre-wrap">
                                    {item}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Negatives</div>
                            {negatives.length === 0 ? (
                              <div className="mt-1">—</div>
                            ) : (
                              <ul className="mt-1 list-disc pl-5 space-y-1">
                                {negatives.map((item, idx) => (
                                  <li key={idx} className="whitespace-pre-wrap">
                                    {item}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      )}

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

                          {(shouldShowLeftSole || bodyDiagramArea || bodyDiagramParts.length > 0 || bodyDiagramNote) && (
                            <div className="mt-4">
                              <div className="text-sm font-medium text-slate-700">Body Diagram Selection</div>

                              {shouldShowLeftSole && (
                                <div className="mt-2">
                                  <p className="text-sm text-slate-700">Left sole pain mapping:</p>
                                  <div className="relative mt-2 h-72 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white">
                                    <img
                                      src="/Images/Left_Sole.png"
                                      alt="Left sole pain diagram with selected markers"
                                      className="absolute inset-0 h-full w-full object-contain"
                                    />
                                    {displayMarkers.map((marker, index) => (
                                      <div
                                        key={`${marker.xPct}-${marker.yPct}-${index}`}
                                        className="pointer-events-none absolute text-base font-bold text-red-600 drop-shadow-sm"
                                        style={{
                                          left: `${marker.xPct}%`,
                                          top: `${marker.yPct}%`,
                                          transform: "translate(-50%, -50%)",
                                        }}
                                      >
                                        X
                                      </div>
                                    ))}
                                  </div>
                                  {displayMarkers.length > 0 ? (
                                    <p className="mt-2 text-xs text-slate-500">
                                      Coordinates:{" "}
                                      {displayMarkers
                                        .map((marker) => `(${Math.round(marker.xPct)}, ${Math.round(marker.yPct)})`)
                                        .join(", ")}
                                    </p>
                                  ) : (
                                    <p className="mt-2 text-xs text-slate-500">
                                      No marker coordinates were submitted; showing selected left sole diagram.
                                    </p>
                                  )}
                                </div>
                              )}

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

