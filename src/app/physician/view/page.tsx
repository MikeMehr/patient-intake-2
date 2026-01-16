"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PatientSession } from "@/lib/session-store";
import { jsPDF } from "jspdf";

function PhysicianViewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionCode = searchParams.get("code");

  const [session, setSession] = useState<PatientSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  const [rxMedication, setRxMedication] = useState("");
  const [rxStrength, setRxStrength] = useState("");
  const [rxSig, setRxSig] = useState("");
  const [rxQuantity, setRxQuantity] = useState("");
  const [rxRefills, setRxRefills] = useState("");
  const [rxNotes, setRxNotes] = useState("");
  const [rxStatus, setRxStatus] = useState<string | null>(null);
  const [rxSaving, setRxSaving] = useState(false);
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
  const labPrefillRequestedRef = useRef(false);
  const [labPrefillStatus, setLabPrefillStatus] = useState<string | null>(null);

  const parsedRxFromHistory = useMemo(() => {
    if (!session?.history) return { med: "", strength: "", sig: "", notes: "" };
    const history: any = session.history;
    const planItems: string[] = [];
    if (Array.isArray(history.plan)) {
      planItems.push(...history.plan);
    } else if (history.plan && typeof history.plan === "string") {
      planItems.push(history.plan);
    }
    // Take first item containing a dosage hint
    const dosageRegex = /\b(\d+ ?(mg|mcg|g|tabs?|tablets?|caps?|puffs?|units?))/i;
    let med = "";
    let strength = "";
    let sig = "";
    let notes = "";
    for (const item of planItems) {
      if (!item) continue;
      const m = dosageRegex.exec(item);
      if (m) {
        strength = m[1];
        const parts = item.split(",");
        med = parts[0].trim();
        sig = parts.slice(1).join(", ").trim();
        break;
      }
    }
    if (!med && planItems.length) {
      notes = planItems.join("\n");
    }
    return { med, strength, sig, notes };
  }, [session]);

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
          body: JSON.stringify({ sessionCode, action: "labs" }),
        });
        if (!res.ok) {
          // If HIPAA mode blocks (503) or other errors, leave empty
          setLabPrefillStatus("AI lab suggestions unavailable.");
          labPrefillRequestedRef.current = false; // allow retry on re-select
          return;
        }
        const data = await res.json();
        if (typeof data.result === "string" && data.result.trim().length > 0) {
          setLabLabsInput(data.result.trim());
          setLabPrefillStatus("AI lab suggestions applied.");
        } else {
          setLabPrefillStatus("No AI lab suggestions returned.");
          labPrefillRequestedRef.current = false; // allow retry on re-select
        }
      } catch {
        // Swallow errors and leave the box empty
        setLabPrefillStatus("AI lab suggestions unavailable.");
        labPrefillRequestedRef.current = false; // allow retry on re-select
      }
    };
    fetchAiLabs();
  }, [aiAction, labLabsInput, sessionCode]);

  useEffect(() => {
    if (aiAction === "prescription") {
      if (!rxMedication && parsedRxFromHistory.med) setRxMedication(parsedRxFromHistory.med);
      if (!rxStrength && parsedRxFromHistory.strength) setRxStrength(parsedRxFromHistory.strength);
      if (!rxSig && parsedRxFromHistory.sig) setRxSig(parsedRxFromHistory.sig);
      if (!rxNotes && parsedRxFromHistory.notes) setRxNotes(parsedRxFromHistory.notes);
    }
  }, [aiAction, parsedRxFromHistory, rxMedication, rxNotes, rxSig, rxStrength]);

  useEffect(() => {
    const maybeLoadPrescription = async () => {
      if (aiAction !== "prescription" || !sessionCode) return;
      try {
        const res = await fetch(`/api/prescriptions?code=${sessionCode}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.medication) {
          setRxMedication(data.medication || "");
          setRxStrength(data.strength || "");
          setRxSig(data.sig || "");
          setRxQuantity(data.quantity || "");
          setRxRefills(data.refills || "");
          setRxNotes(data.notes || "");
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
  }, [aiAction, sessionCode]);

  useEffect(() => {
    const loadLabList = async () => {
      if (!sessionCode) return;
      setLabListLoading(true);
      setLabListError(null);
      try {
        const res = await fetch(`/api/lab-requisitions?code=${sessionCode}`);
        if (!res.ok) {
          throw new Error("Failed to load lab requisitions");
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
    loadLabList();
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

  const handleGenerateLabPdf = async () => {
    if (!sessionCode) {
      setLabStatus("Session code missing; cannot save requisition.");
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
      const doc = new jsPDF();
      const leftX = 14;
      const rightX = 120;
      let y = 16;

      doc.setFontSize(12);
      doc.text(`Patient: ${labPatientName || "N/A"}`, leftX, y);
      y += 6;
      doc.text(`Email: ${labPatientEmail || "N/A"}`, leftX, y);

      let yRight = 16;
      doc.text(`Physician: ${labPhysicianName || "N/A"}`, rightX, yRight);
      yRight += 6;
      doc.text(`Clinic: ${labClinicName || "N/A"}`, rightX, yRight);
      yRight += 6;
      doc.text(`Address: ${labClinicAddress || "N/A"}`, rightX, yRight);

      y = Math.max(y, yRight) + 10;
      doc.setFontSize(13);
      doc.text("Labs requested", leftX, y);
      doc.setFontSize(12);
      y += 6;
      labs.forEach((lab) => {
        doc.text(`• ${lab}`, leftX + 2, y);
        y += 6;
      });

      y += 4;
      doc.setFontSize(13);
      doc.text("Additional Instructions", leftX, y);
      doc.setFontSize(12);
      y += 6;
      const instructions = labInstructions || "None";
      const wrapped = doc.splitTextToSize(instructions, 180);
      doc.text(wrapped, leftX, y);

      const pdfDataUri = doc.output("datauristring");
      const pdfBase64 = pdfDataUri.split(",")[1];
      doc.save("lab-requisition.pdf");

      const res = await fetch("/api/lab-requisitions", {
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
          pdfBase64,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to save lab requisition.");
      }

      setLabStatus("Lab requisition saved and downloaded.");
    } catch (error) {
      setLabStatus(
        error instanceof Error ? error.message : "Failed to generate or save requisition.",
      );
    } finally {
      setLabSaving(false);
    }
  };

  const handleGenerateRxPdf = async () => {
    if (!sessionCode) {
      setRxStatus("Session code missing; cannot save prescription.");
      return;
    }

    if (!rxMedication || !rxSig) {
      setRxStatus("Medication and Sig are required.");
      return;
    }

    setRxStatus(null);
    setRxSaving(true);

    try {
      const doc = new jsPDF();
      const leftX = 14;
      const rightX = 120;
      let y = 16;

      doc.setFontSize(12);
      doc.text(`Patient: ${labPatientName || "N/A"}`, leftX, y);
      y += 6;
      doc.text(`Email: ${labPatientEmail || "N/A"}`, leftX, y);

      let yRight = 16;
      doc.text(`Prescriber: ${labPhysicianName || "N/A"}`, rightX, yRight);
      yRight += 6;
      doc.text(`Clinic: ${labClinicName || "N/A"}`, rightX, yRight);
      yRight += 6;
      doc.text(`Address: ${labClinicAddress || "N/A"}`, rightX, yRight);

      y = Math.max(y, yRight) + 10;
      doc.setFontSize(13);
      doc.text("Prescription", leftX, y);
      doc.setFontSize(12);
      y += 8;
      doc.text(`Medication: ${rxMedication}`, leftX, y); y += 6;
      doc.text(`Strength: ${rxStrength || "N/A"}`, leftX, y); y += 6;
      doc.text(`Sig: ${rxSig}`, leftX, y); y += 6;
      doc.text(`Quantity: ${rxQuantity || "N/A"}`, leftX, y); y += 6;
      doc.text(`Refills: ${rxRefills || "0"}`, leftX, y); y += 6;
      if (rxNotes) {
        const wrappedNotes = doc.splitTextToSize(`Notes: ${rxNotes}`, 180);
        doc.text(wrappedNotes, leftX, y);
        y += wrappedNotes.length * 6;
      }

      const pdfDataUri = doc.output("datauristring");
      const pdfBase64 = pdfDataUri.split(",")[1];
      doc.save("prescription.pdf");

      const res = await fetch("/api/prescriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionCode,
          patientName: labPatientName,
          patientEmail: labPatientEmail,
          physicianName: labPhysicianName,
          clinicName: labClinicName,
          clinicAddress: labClinicAddress,
          medication: rxMedication,
          strength: rxStrength,
          sig: rxSig,
          quantity: rxQuantity,
          refills: rxRefills,
          notes: rxNotes,
          pdfBase64,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to save prescription.");
      }

      setRxStatus("Prescription saved and downloaded.");
    } catch (error) {
      setRxStatus(error instanceof Error ? error.message : "Failed to generate or save prescription.");
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
                  <p className="text-base text-slate-900 whitespace-pre-wrap">
                    {session.history.summary}
                  </p>
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
                {session.history.assessment && (
                  <div>
                    <p className="text-sm font-medium text-slate-700 mb-2">Assessment</p>
                    <p className="text-base text-slate-900 whitespace-pre-wrap">
                      {session.history.assessment}
                    </p>
                  </div>
                )}
                {session.history.plan && (
                  <div>
                    <p className="text-sm font-medium text-slate-700 mb-2">Plan</p>
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
                  </div>
                )}
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
                    <option value="prescription">Generate prescription (PDF)</option>
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
                        {labSaving ? "Saving..." : "Generate & download PDF"}
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Medication name
                        </label>
                        <input
                          value={rxMedication}
                          onChange={(e) => setRxMedication(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Strength
                        </label>
                        <input
                          value={rxStrength}
                          onChange={(e) => setRxStrength(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Sig (directions)
                        </label>
                        <input
                          value={rxSig}
                          onChange={(e) => setRxSig(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Quantity
                        </label>
                        <input
                          value={rxQuantity}
                          onChange={(e) => setRxQuantity(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Refills
                        </label>
                        <input
                          value={rxRefills}
                          onChange={(e) => setRxRefills(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Notes
                        </label>
                        <input
                          value={rxNotes}
                          onChange={(e) => setRxNotes(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleGenerateRxPdf()}
                        disabled={rxSaving}
                        className={`px-4 py-2 text-sm font-medium text-white rounded-lg ${
                          rxSaving ? "bg-slate-400 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800"
                        }`}
                      >
                        {rxSaving ? "Saving..." : "Generate & download PDF"}
                      </button>
                      {rxStatus && <span className="text-sm text-slate-700">{rxStatus}</span>}
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
                      <a
                        href={`/api/lab-requisitions?code=${sessionCode}&id=${item.id}`}
                        className="text-sm text-slate-700 hover:text-slate-900 underline"
                      >
                        Download PDF
                      </a>
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
