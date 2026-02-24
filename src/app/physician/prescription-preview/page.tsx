"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CLINICAL_ASSISTIVE_DISCLAIMER,
  PHYSICIAN_ATTESTATION_TEXT,
} from "@/lib/clinical-safety";

type MedicationRow = {
  medication: string;
  strength?: string;
  sig: string;
  quantity?: string;
  refills?: string;
  notes?: string;
};

type PharmacyFields = {
  pharmacyName: string;
  pharmacyNumber: string;
  pharmacyAddress: string;
  pharmacyCity: string;
  pharmacyPhone: string;
  pharmacyFax: string;
};

type PreviewPayload = {
  sessionCode: string;
  patientName: string;
  patientEmail: string;
  patientSex?: string;
  physicianName: string;
  clinicName: string;
  clinicAddress: string;
  medications: MedicationRow[];
  pdfBase64: string;
  pharmacy: PharmacyFields;
  prescriptionId?: string;
};

const emptyPharmacy = (): PharmacyFields => ({
  pharmacyName: "",
  pharmacyNumber: "",
  pharmacyAddress: "",
  pharmacyCity: "",
  pharmacyPhone: "",
  pharmacyFax: "",
});

function PrescriptionPreviewContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const code = searchParams.get("code") || "";

  const [payload, setPayload] = useState<PreviewPayload | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "plan" | "fax">(null);
  const [isEditingPharmacy, setIsEditingPharmacy] = useState(false);
  const [pharmacyDraft, setPharmacyDraft] = useState<PharmacyFields>(emptyPharmacy());
  const [pharmacySaving, setPharmacySaving] = useState(false);
  const [savedPrescriptionId, setSavedPrescriptionId] = useState<string | null>(null);
  const [attestationAccepted, setAttestationAccepted] = useState(false);
  const [attestedAtIso, setAttestedAtIso] = useState<string | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState("");
  const [safetyChecklist, setSafetyChecklist] = useState({
    allergiesReviewed: false,
    interactionsReviewed: false,
    renalRiskReviewed: false,
    giRiskReviewed: false,
    anticoagulantReviewed: false,
    pregnancyReviewed: false,
  });

  useEffect(() => {
    if (!token) {
      setStatus("Missing preview token.");
      return;
    }
    const raw = window.localStorage.getItem(token);
    if (!raw) {
      setStatus("Prescription preview data was not found. Re-generate from Physician View.");
      return;
    }
    try {
      const parsed = JSON.parse(raw) as PreviewPayload;
      if (!parsed?.sessionCode || !Array.isArray(parsed?.medications) || !parsed?.pdfBase64) {
        throw new Error("Invalid prescription payload.");
      }
      setPayload(parsed);
      setPharmacyDraft(parsed.pharmacy || emptyPharmacy());
      if (parsed.patientSex === "male") {
        setSafetyChecklist((prev) => ({ ...prev, pregnancyReviewed: true }));
      }
      if (typeof parsed.prescriptionId === "string" && parsed.prescriptionId.trim().length > 0) {
        setSavedPrescriptionId(parsed.prescriptionId);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load preview.");
    }
  }, [token]);

  const pdfDataUri = useMemo(
    () => (payload?.pdfBase64 ? `data:application/pdf;base64,${payload.pdfBase64}` : ""),
    [payload],
  );

  useEffect(() => {
    if (!payload?.pdfBase64) {
      setPdfBlobUrl("");
      return;
    }
    try {
      const binary = window.atob(payload.pdfBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: "application/pdf" });
      const objectUrl = URL.createObjectURL(blob);
      setPdfBlobUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    } catch {
      setPdfBlobUrl("");
      return;
    }
  }, [payload?.pdfBase64]);

  const notifyParent = (type: string) => {
    if (!window.opener) return;
    try {
      window.opener.postMessage({ type, sessionCode: code || payload?.sessionCode || "" }, window.location.origin);
    } catch {
      // ignore
    }
  };

  const requireAttestation = (): boolean => {
    if (attestationAccepted) {
      return true;
    }
    setStatus("Physician attestation is required before save/export actions.");
    return false;
  };

  const requireSafetyChecklist = (): boolean => {
    const allChecked = Object.values(safetyChecklist).every(Boolean);
    if (allChecked) {
      return true;
    }
    setStatus("Complete all prescription safety checks before save/export actions.");
    return false;
  };

  const savePharmacy = async () => {
    const targetCode = payload?.sessionCode || code;
    if (!targetCode) {
      setStatus("Session code missing.");
      return;
    }
    setPharmacySaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionCode: targetCode,
          ...pharmacyDraft,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save pharmacy.");
      }
      setPayload((prev) => (prev ? { ...prev, pharmacy: { ...pharmacyDraft } } : prev));
      setIsEditingPharmacy(false);
      setStatus("Pharmacy updated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save pharmacy.");
    } finally {
      setPharmacySaving(false);
    }
  };

  const savePrescription = async (): Promise<string> => {
    if (!payload) {
      throw new Error("Prescription payload is unavailable.");
    }
    const res = await fetch("/api/prescriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionCode: payload.sessionCode,
        patientName: payload.patientName,
        patientEmail: payload.patientEmail,
        physicianName: payload.physicianName,
        clinicName: payload.clinicName,
        clinicAddress: payload.clinicAddress,
        medications: payload.medications,
        medication: payload.medications[0]?.medication || "",
        strength: payload.medications[0]?.strength || "",
        sig: payload.medications[0]?.sig || "",
        quantity: payload.medications[0]?.quantity || "",
        refills: payload.medications[0]?.refills || "",
        notes: payload.medications[0]?.notes || "",
        pdfBase64: payload.pdfBase64,
        attestationAccepted,
        attestationText: PHYSICIAN_ATTESTATION_TEXT,
        attestedAt: attestedAtIso,
        safetyChecklist,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || "Failed to save prescription.");
    }
    const newId = typeof data?.id === "string" ? data.id : "";
    if (!newId) {
      throw new Error("Prescription saved but ID was not returned.");
    }
    setSavedPrescriptionId(newId);
    setPayload((prev) => (prev ? { ...prev, prescriptionId: newId } : prev));
    if (token) {
      const raw = window.localStorage.getItem(token);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as PreviewPayload;
          window.localStorage.setItem(token, JSON.stringify({ ...parsed, prescriptionId: newId }));
        } catch {
          // ignore local cache update failures
        }
      }
    }
    notifyParent("HAA_PRESCRIPTION_SAVED");
    return newId;
  };

  const handleSave = async () => {
    if (!payload) return;
    if (!requireSafetyChecklist() || !requireAttestation()) return;
    setBusy("save");
    setStatus(null);
    try {
      await savePrescription();
      setStatus("Prescription saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save prescription.");
    } finally {
      setBusy(null);
    }
  };

  const handleAddToPlan = async () => {
    if (!payload) return;
    if (!requireSafetyChecklist() || !requireAttestation()) return;
    setBusy("plan");
    setStatus(null);
    try {
      const sessionRes = await fetch(`/api/sessions?code=${encodeURIComponent(payload.sessionCode)}`);
      const sessionData = await sessionRes.json().catch(() => ({}));
      if (!sessionRes.ok || sessionData?.error) {
        throw new Error(sessionData?.error || "Failed to load session for plan update.");
      }
      const currentPlan = Array.isArray(sessionData?.history?.plan)
        ? [...sessionData.history.plan]
        : typeof sessionData?.history?.plan === "string" && sessionData.history.plan.trim().length > 0
          ? [sessionData.history.plan.trim()]
          : [];
      const medicationSummary = payload.medications
        .map((row) =>
          [
            row.medication || "",
            row.strength ? `(${row.strength})` : "",
            `Sig: ${row.sig || "N/A"}`,
            `Qty: ${row.quantity || "N/A"}`,
            `Refills: ${row.refills || "0"}`,
            `Notes: ${row.notes || "N/A"}`,
          ]
            .filter(Boolean)
            .join(" "),
        )
        .join(" | ");
      const nextPlanLine = `Prescription: ${medicationSummary}`;
      const updatedPlan = [...currentPlan, nextPlanLine];

      const updateRes = await fetch("/api/sessions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionCode: payload.sessionCode,
          historySummary: String(sessionData?.history?.summary || ""),
          historyAssessment: String(sessionData?.history?.assessment || ""),
          historyPlan: updatedPlan,
        }),
      });
      const updateData = await updateRes.json().catch(() => ({}));
      if (!updateRes.ok || updateData?.error) {
        throw new Error(updateData?.error || "Failed to append medication details to plan.");
      }
      notifyParent("HAA_PLAN_UPDATED");
      setStatus("Medication details added to plan.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to add to plan.");
    } finally {
      setBusy(null);
    }
  };

  const handleFax = async () => {
    if (!payload) return;
    if (!requireSafetyChecklist() || !requireAttestation()) return;
    if (!pharmacyDraft.pharmacyFax.trim()) {
      setStatus("Pharmacy fax is required before faxing.");
      return;
    }
    setBusy("fax");
    setStatus(null);
    try {
      const prescriptionId =
        savedPrescriptionId || (await savePrescription().catch(() => ""));
      if (!prescriptionId) {
        throw new Error("Please save the prescription before faxing.");
      }
      const res = await fetch("/api/prescriptions/fax", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionCode: payload.sessionCode,
          prescriptionId,
          faxNumber: pharmacyDraft.pharmacyFax.trim(),
          pdfBase64: payload.pdfBase64,
          fileName: `prescription-${payload.sessionCode}.pdf`,
          attestationAccepted,
          attestationText: PHYSICIAN_ATTESTATION_TEXT,
          attestedAt: attestedAtIso,
          safetyChecklist,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Fax failed.");
      }
      notifyParent("HAA_PRESCRIPTION_FAX_UPDATED");
      setStatus("Prescription fax queued.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to fax prescription.");
    } finally {
      setBusy(null);
    }
  };

  const handlePrint = () => {
    if (!requireSafetyChecklist() || !requireAttestation()) return;
    const printableSrc = pdfBlobUrl || pdfDataUri;
    if (!printableSrc) return;
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.src = printableSrc;
    document.body.appendChild(frame);
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.open(printableSrc, "_blank");
        setStatus("Opened prescription in a new tab. Use browser print there.");
      }
      setTimeout(() => document.body.removeChild(frame), 1500);
    };
  };

  if (!payload) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10">
        <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Prescription Preview</h1>
          <p className="mt-3 text-sm text-red-600">{status || "Unable to load preview."}</p>
          <button
            type="button"
            onClick={() => window.close()}
            className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Prescription preview</h1>
              <p className="mt-1 text-sm text-slate-600">
                Review details before saving, adding to plan, printing, or faxing.
              </p>
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[15px] text-amber-900">
                {CLINICAL_ASSISTIVE_DISCLAIMER}
              </p>
              <p className="mt-2 text-xs font-semibold text-red-700">
                Draft prescription — requires physician authorization.
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-md border border-slate-200 p-3">
              <p className="text-sm font-semibold text-slate-800">Patient / prescriber</p>
              <div className="mt-2 space-y-1 text-sm text-slate-700">
                <p>Patient: {payload.patientName || "N/A"}</p>
                <p>Email: {payload.patientEmail || "N/A"}</p>
                <p>Prescriber: {payload.physicianName || "N/A"}</p>
                <p>Clinic: {payload.clinicName || "N/A"}</p>
                <p>Address: {payload.clinicAddress || "N/A"}</p>
              </div>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">Pharmacy</p>
                <button
                  type="button"
                  onClick={() => setIsEditingPharmacy((prev) => !prev)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {isEditingPharmacy ? "Close pharmacy edit" : "Edit pharmacy"}
                </button>
              </div>
              {!isEditingPharmacy ? (
                <div className="mt-2 space-y-1 text-sm text-slate-700">
                  <p>Name: {pharmacyDraft.pharmacyName || "Not provided"}</p>
                  <p>Number: {pharmacyDraft.pharmacyNumber || "Not provided"}</p>
                  <p>
                    Address:{" "}
                    {[pharmacyDraft.pharmacyAddress, pharmacyDraft.pharmacyCity]
                      .filter((x) => x.trim().length > 0)
                      .join(", ") || "Not provided"}
                  </p>
                  <p>Phone: {pharmacyDraft.pharmacyPhone || "Not provided"}</p>
                  <p>Fax: {pharmacyDraft.pharmacyFax || "Not provided"}</p>
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  <input
                    value={pharmacyDraft.pharmacyName}
                    onChange={(e) =>
                      setPharmacyDraft((prev) => ({ ...prev, pharmacyName: e.target.value }))
                    }
                    placeholder="Pharmacy name"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    value={pharmacyDraft.pharmacyNumber}
                    onChange={(e) =>
                      setPharmacyDraft((prev) => ({ ...prev, pharmacyNumber: e.target.value }))
                    }
                    placeholder="Pharmacy number"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    value={pharmacyDraft.pharmacyAddress}
                    onChange={(e) =>
                      setPharmacyDraft((prev) => ({ ...prev, pharmacyAddress: e.target.value }))
                    }
                    placeholder="Street address"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    value={pharmacyDraft.pharmacyCity}
                    onChange={(e) =>
                      setPharmacyDraft((prev) => ({ ...prev, pharmacyCity: e.target.value }))
                    }
                    placeholder="City"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    value={pharmacyDraft.pharmacyPhone}
                    onChange={(e) =>
                      setPharmacyDraft((prev) => ({ ...prev, pharmacyPhone: e.target.value }))
                    }
                    placeholder="Phone"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    value={pharmacyDraft.pharmacyFax}
                    onChange={(e) =>
                      setPharmacyDraft((prev) => ({ ...prev, pharmacyFax: e.target.value }))
                    }
                    placeholder="Fax"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={savePharmacy}
                    disabled={pharmacySaving}
                    className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {pharmacySaving ? "Saving..." : "Save pharmacy"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-800">Medication orders</p>
          <div className="mt-3 space-y-2">
            {payload.medications.map((row, idx) => (
              <div key={`${row.medication}-${idx}`} className="rounded border border-slate-200 p-3 text-sm text-slate-700">
                <p className="font-medium">
                  {idx + 1}. {row.medication} {row.strength ? `(${row.strength})` : ""}
                </p>
                <p>Sig: {row.sig}</p>
                <p>Quantity: {row.quantity || "N/A"} | Refills: {row.refills || "0"}</p>
                <p>Notes: {row.notes || "N/A"}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-2">
            <p className="mb-2 text-sm font-semibold text-slate-800">Prescription safety checks</p>
            <div className="grid grid-cols-1 gap-1 text-sm text-slate-800 md:grid-cols-2">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={safetyChecklist.allergiesReviewed}
                  onChange={(e) =>
                    setSafetyChecklist((prev) => ({ ...prev, allergiesReviewed: e.target.checked }))
                  }
                  className="mt-0.5"
                />
                <span>Allergies reviewed</span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={safetyChecklist.interactionsReviewed}
                  onChange={(e) =>
                    setSafetyChecklist((prev) => ({
                      ...prev,
                      interactionsReviewed: e.target.checked,
                    }))
                  }
                  className="mt-0.5"
                />
                <span>Drug interactions reviewed</span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={safetyChecklist.renalRiskReviewed}
                  onChange={(e) =>
                    setSafetyChecklist((prev) => ({ ...prev, renalRiskReviewed: e.target.checked }))
                  }
                  className="mt-0.5"
                />
                <span>Renal disease risk reviewed</span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={safetyChecklist.giRiskReviewed}
                  onChange={(e) =>
                    setSafetyChecklist((prev) => ({ ...prev, giRiskReviewed: e.target.checked }))
                  }
                  className="mt-0.5"
                />
                <span>GI risk factors reviewed</span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={safetyChecklist.anticoagulantReviewed}
                  onChange={(e) =>
                    setSafetyChecklist((prev) => ({
                      ...prev,
                      anticoagulantReviewed: e.target.checked,
                    }))
                  }
                  className="mt-0.5"
                />
                <span>Anticoagulant use reviewed</span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={safetyChecklist.pregnancyReviewed}
                  onChange={(e) =>
                    setSafetyChecklist((prev) => ({
                      ...prev,
                      pregnancyReviewed: e.target.checked,
                    }))
                  }
                  className="mt-0.5"
                />
                <span>
                  Pregnancy status reviewed
                  {payload.patientSex === "male" ? " (not applicable acknowledged)" : ""}
                </span>
              </label>
            </div>
          </div>
          <div className="mb-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-2">
            <label className="flex items-start gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={attestationAccepted}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setAttestationAccepted(checked);
                  setAttestedAtIso(checked ? new Date().toISOString() : null);
                }}
                className="mt-0.5"
              />
              <span>{PHYSICIAN_ATTESTATION_TEXT}</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={busy !== null}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {busy === "save" ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={handleAddToPlan}
              disabled={busy !== null}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {busy === "plan" ? "Adding..." : "Add to plan"}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Print Rx
            </button>
            <button
              type="button"
              onClick={handleFax}
              disabled={busy !== null}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {busy === "fax" ? "Faxing..." : "Fax prescription"}
            </button>
            <button
              type="button"
              onClick={() => {
                notifyParent("HAA_PRESCRIPTION_EDIT_RX");
                window.close();
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Edit Rx
            </button>
            <button
              type="button"
              onClick={() => window.close()}
              className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => window.close()}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
          {status && <p className="mt-3 text-sm text-slate-700">{status}</p>}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          {pdfBlobUrl || pdfDataUri ? (
            <iframe
              title="Prescription PDF preview"
              src={pdfBlobUrl || pdfDataUri}
              className="h-[70vh] w-full rounded-md border border-slate-200"
            />
          ) : (
            <p className="p-4 text-sm text-red-600">PDF preview is unavailable.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PrescriptionPreviewPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-100 px-4 py-10">
          <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">Prescription Preview</h1>
            <p className="mt-3 text-sm text-slate-600">Loading preview...</p>
          </div>
        </div>
      }
    >
      <PrescriptionPreviewContent />
    </Suspense>
  );
}

