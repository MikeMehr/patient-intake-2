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

export default function PatientChartPage({ params }: { params: { patientId: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const patientIdRaw = params.patientId;
  const patientIdFromParams = useMemo(() => {
    const raw = String(patientIdRaw || "");
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw.trim();
    }
  }, [patientIdRaw]);
  const patientId = useMemo(() => {
    // Fallback for rare cases where Next route params are empty due to caching/deploy mismatch.
    if (patientIdFromParams) return patientIdFromParams;
    const path = typeof pathname === "string" ? pathname : "";
    const prefix = "/physician/patients/";
    if (!path.startsWith(prefix)) return "";
    const last = path.slice(prefix.length).split("/").filter(Boolean)[0] || "";
    try {
      return decodeURIComponent(last).trim();
    } catch {
      return last.trim();
    }
  }, [patientIdFromParams, pathname]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [patient, setPatient] = useState<PatientPayload | null>(null);
  const [encounters, setEncounters] = useState<Encounter[]>([]);

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

