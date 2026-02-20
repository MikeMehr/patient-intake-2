"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SessionKeepAlive from "@/components/auth/SessionKeepAlive";

type PatientSearchResult = {
  id: string;
  fullName: string;
  dateOfBirth: string | null;
  email: string | null;
  primaryPhone: string | null;
};

type SoapDraft = {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
};

type TranscriptionListItem = {
  transcriptionSessionId: string;
  encounterId: string;
  soapVersionId: string;
  patientId: string;
  patientName: string;
  chiefComplaint: string | null;
  lifecycleState: "DRAFT" | "FINALIZED_FOR_EXPORT";
  version: number;
  previewSummary: string | null;
  createdAt: string;
  finalizedForExportAt: string | null;
};

const initialDraft: SoapDraft = {
  subjective: "",
  objective: "",
  assessment: "",
  plan: "",
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export default function PhysicianTranscriptionPage() {
  const router = useRouter();
  const [patientQuery, setPatientQuery] = useState("");
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);
  const [patientSearchError, setPatientSearchError] = useState<string | null>(null);
  const [patientResults, setPatientResults] = useState<PatientSearchResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  const [newPatientFullName, setNewPatientFullName] = useState("");
  const [newPatientDob, setNewPatientDob] = useState("");
  const [chiefComplaint, setChiefComplaint] = useState("");

  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcript, setTranscript] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const [soapVersionId, setSoapVersionId] = useState<string | null>(null);
  const [encounterId, setEncounterId] = useState<string | null>(null);
  const [lifecycleState, setLifecycleState] = useState<"DRAFT" | "FINALIZED_FOR_EXPORT" | null>(null);
  const [snapshotLabel, setSnapshotLabel] = useState<string>("");
  const [draft, setDraft] = useState<SoapDraft>(initialDraft);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<TranscriptionListItem[]>([]);

  const hasNewPatientIdentity = useMemo(
    () => newPatientFullName.trim().length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(newPatientDob.trim()),
    [newPatientFullName, newPatientDob],
  );
  const canGenerate = useMemo(
    () =>
      transcript.trim().length >= 10 &&
      (Boolean(selectedPatient?.id) || hasNewPatientIdentity) &&
      !actionLoading,
    [selectedPatient?.id, transcript, hasNewPatientIdentity, actionLoading],
  );
  const generateDisabledReason = useMemo(() => {
    if (transcript.trim().length < 10) return "Add transcript text first.";
    if (!selectedPatient?.id && !hasNewPatientIdentity) {
      return "Select existing patient or enter new patient full name and DOB.";
    }
    return null;
  }, [transcript, selectedPatient?.id, hasNewPatientIdentity]);

  useEffect(() => {
    void loadHistory();
  }, []);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/physician/transcription/list");
      if (res.status === 401) {
        router.push("/auth/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load transcription history");
      setHistoryItems(Array.isArray(data?.items) ? data.items : []);
      if (typeof data?.snapshotLabel === "string") setSnapshotLabel(data.snapshotLabel);
    } catch (err) {
      console.error("Failed to load transcription history", err);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function searchPatients() {
    const q = patientQuery.trim();
    if (q.length < 3) {
      setPatientSearchError("Enter at least 3 characters.");
      return;
    }
    setPatientSearchError(null);
    setPatientSearchLoading(true);
    try {
      const res = await fetch("/api/patients/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: q, limit: 10 }),
      });
      if (res.status === 401) {
        router.push("/auth/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Search failed");
      setPatientResults(Array.isArray(data?.patients) ? data.patients : []);
    } catch (err) {
      setPatientSearchError(err instanceof Error ? err.message : "Search failed");
      setPatientResults([]);
    } finally {
      setPatientSearchLoading(false);
    }
  }

  async function convertToWav(blob: Blob): Promise<Blob> {
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
      const ratio = 16000 / decoded.sampleRate;
      const newLen = Math.round(mono.length * ratio);
      const samples = new Float32Array(newLen);
      for (let i = 0; i < newLen; i += 1) samples[i] = mono[Math.round(i / ratio)] ?? 0;

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
      view.setUint32(28, 32000, true);
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

  async function cleanTranscript(raw: string): Promise<string> {
    try {
      const res = await fetch("/api/speech/clean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw, language: "English" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return raw;
      return typeof data?.cleaned === "string" && data.cleaned.trim() ? data.cleaned.trim() : raw;
    } catch {
      return raw;
    }
  }

  async function transcribeAudio(audioBlob: Blob): Promise<string> {
    const wavBlob = await convertToWav(audioBlob);
    const formData = new FormData();
    formData.append("audio", new File([wavBlob], "recording.wav", { type: "audio/wav" }));
    formData.append("language", "en");
    const res = await fetch("/api/speech/stt", { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Transcription failed");
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (!text) throw new Error("No speech detected.");
    return cleanTranscript(text);
  }

  async function startRecording() {
    setRecordingError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
      });
      const recorder = new MediaRecorder(stream);
      mediaChunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) mediaChunksRef.current.push(e.data);
      };
      recorder.start(250);
      setIsRecording(true);
    } catch (err) {
      setRecordingError(err instanceof Error ? err.message : "Unable to start recording.");
    }
  }

  async function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    setIsRecording(false);
    setTranscriptLoading(true);
    setRecordingError(null);
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    try {
      const blob = new Blob(mediaChunksRef.current, { type: recorder.mimeType || "audio/webm" });
      mediaChunksRef.current = [];
      if (!blob.size) {
        setRecordingError("No audio captured.");
        return;
      }
      const text = await transcribeAudio(blob);
      setTranscript((prev) => [prev, text].filter(Boolean).join("\n").trim());
    } catch (err) {
      setRecordingError(err instanceof Error ? err.message : "Transcription failed.");
    } finally {
      setTranscriptLoading(false);
    }
  }

  async function generateSoap() {
    if (!canGenerate) return;
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch("/api/physician/transcription/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: selectedPatient?.id || undefined,
          newPatient:
            !selectedPatient?.id && hasNewPatientIdentity
              ? {
                  fullName: newPatientFullName.trim(),
                  dateOfBirth: newPatientDob.trim(),
                }
              : undefined,
          transcript: transcript.trim(),
          chiefComplaint: chiefComplaint.trim() || undefined,
          encounterId: encounterId || undefined,
        }),
      });
      if (res.status === 401) {
        router.push("/auth/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to generate SOAP");
      setSoapVersionId(data.soapVersionId || null);
      setEncounterId(data.encounterId || null);
      setLifecycleState(data.lifecycleState || "DRAFT");
      setSnapshotLabel(typeof data?.snapshotLabel === "string" ? data.snapshotLabel : "");
      setDraft({
        subjective: data?.draft?.subjective || "",
        objective: data?.draft?.objective || "",
        assessment: data?.draft?.assessment || "",
        plan: data?.draft?.plan || "",
      });
      setActionSuccess("SOAP draft generated.");
      setNewPatientFullName("");
      setNewPatientDob("");
      await loadHistory();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to generate SOAP");
    } finally {
      setActionLoading(false);
    }
  }

  async function saveDraft() {
    if (!soapVersionId) return;
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch("/api/physician/transcription/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soapVersionId, draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to save draft");
      setActionSuccess("SOAP draft saved.");
      await loadHistory();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to save draft");
    } finally {
      setActionLoading(false);
    }
  }

  async function finalizeDraft() {
    if (!soapVersionId) return;
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch("/api/physician/transcription/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soapVersionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to finalize draft");
      setLifecycleState("FINALIZED_FOR_EXPORT");
      if (typeof data?.snapshotLabel === "string") setSnapshotLabel(data.snapshotLabel);
      setTranscript("");
      setActionSuccess("SOAP finalized for export. Draft transcript removed.");
      await loadHistory();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to finalize draft");
    } finally {
      setActionLoading(false);
    }
  }

  async function markExported() {
    if (!soapVersionId) return;
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      const res = await fetch("/api/physician/transcription/mark-exported", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soapVersionId,
          idempotencyKey,
          destinationSystem: "manual_copy_paste",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to mark exported");
      setActionSuccess(data?.message || "Marked as exported.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to mark exported");
    } finally {
      setActionLoading(false);
    }
  }

  async function loadSoapVersion(soapId: string) {
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch(`/api/physician/transcription/soap/${encodeURIComponent(soapId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load SOAP version");
      setSoapVersionId(data.soapVersionId || null);
      setEncounterId(data.encounterId || null);
      setLifecycleState(data.lifecycleState || null);
      setDraft({
        subjective: data?.draft?.subjective || "",
        objective: data?.draft?.objective || "",
        assessment: data?.draft?.assessment || "",
        plan: data?.draft?.plan || "",
      });
      setTranscript(data?.draftTranscript || "");
      if (typeof data?.snapshotLabel === "string") setSnapshotLabel(data.snapshotLabel);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to load SOAP version");
    }
  }

  return (
    <>
      <SessionKeepAlive redirectTo="/auth/login" />
      <div className="min-h-screen bg-slate-100">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Physician Transcription</h1>
              <p className="text-sm text-slate-600 mt-1">
                Generate a HealthAssist SOAP snapshot for EMR transfer.
              </p>
              {snapshotLabel && <p className="text-xs text-amber-700 mt-2">{snapshotLabel}</p>}
            </div>
            <button
              type="button"
              onClick={() => router.push("/physician/dashboard")}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Back to dashboard
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 space-y-4">
                <h2 className="text-lg font-semibold text-slate-900">1) Select patient</h2>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={patientQuery}
                    onChange={(e) => setPatientQuery(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    placeholder="Search patient by name"
                  />
                  <button
                    type="button"
                    onClick={searchPatients}
                    disabled={patientSearchLoading}
                    className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:bg-slate-400"
                  >
                    {patientSearchLoading ? "Searching..." : "Search"}
                  </button>
                </div>
                {patientSearchError && <p className="text-sm text-red-700">{patientSearchError}</p>}
                {patientResults.length > 0 && (
                  <div className="space-y-2">
                    {patientResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedPatient(p)}
                        className={`w-full text-left rounded-lg border px-3 py-2 ${
                          selectedPatient?.id === p.id
                            ? "border-slate-900 bg-slate-50"
                            : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <div className="text-sm font-medium text-slate-900">{p.fullName}</div>
                        <div className="text-xs text-slate-500">
                          DOB: {p.dateOfBirth || "—"} • {p.primaryPhone || p.email || "No contact"}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <div className="pt-2 border-t border-slate-200">
                  <p className="text-xs font-medium text-slate-700 mb-2">
                    Or add new patient quickly (for patients not yet in Health Assist)
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={newPatientFullName}
                      onChange={(e) => {
                        setNewPatientFullName(e.target.value);
                        if (e.target.value.trim().length > 0) setSelectedPatient(null);
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      placeholder="First name Last name"
                    />
                    <input
                      type="date"
                      value={newPatientDob}
                      onChange={(e) => {
                        setNewPatientDob(e.target.value);
                        if (e.target.value.trim().length > 0) setSelectedPatient(null);
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 space-y-4">
                <h2 className="text-lg font-semibold text-slate-900">2) Capture transcript</h2>
                <input
                  type="text"
                  value={chiefComplaint}
                  onChange={(e) => setChiefComplaint(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  placeholder="Chief complaint (optional)"
                />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={transcriptLoading}
                    className={`px-4 py-2 text-sm font-medium text-white rounded-lg ${
                      isRecording ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-slate-800"
                    } disabled:bg-slate-400`}
                  >
                    {isRecording ? "Stop transcription" : "Start transcription"}
                  </button>
                  {transcriptLoading && <span className="text-sm text-slate-600">Transcribing...</span>}
                </div>
                {recordingError && <p className="text-sm text-red-700">{recordingError}</p>}
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  rows={8}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  placeholder="Transcript text..."
                />
                <button
                  type="button"
                  onClick={generateSoap}
                  disabled={!canGenerate}
                  className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:bg-slate-400"
                >
                  {actionLoading ? "Generating..." : "Generate SOAP"}
                </button>
                {generateDisabledReason && (
                  <p className="text-xs text-slate-500">{generateDisabledReason}</p>
                )}
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 space-y-4">
                <h2 className="text-lg font-semibold text-slate-900">3) Review and export</h2>
                <div className="grid grid-cols-1 gap-3">
                  <textarea
                    value={draft.subjective}
                    onChange={(e) => setDraft((d) => ({ ...d, subjective: e.target.value }))}
                    rows={4}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Subjective"
                    disabled={!soapVersionId || lifecycleState === "FINALIZED_FOR_EXPORT"}
                  />
                  <textarea
                    value={draft.objective}
                    onChange={(e) => setDraft((d) => ({ ...d, objective: e.target.value }))}
                    rows={3}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Objective"
                    disabled={!soapVersionId || lifecycleState === "FINALIZED_FOR_EXPORT"}
                  />
                  <textarea
                    value={draft.assessment}
                    onChange={(e) => setDraft((d) => ({ ...d, assessment: e.target.value }))}
                    rows={3}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Assessment"
                    disabled={!soapVersionId || lifecycleState === "FINALIZED_FOR_EXPORT"}
                  />
                  <textarea
                    value={draft.plan}
                    onChange={(e) => setDraft((d) => ({ ...d, plan: e.target.value }))}
                    rows={4}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Plan"
                    disabled={!soapVersionId || lifecycleState === "FINALIZED_FOR_EXPORT"}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={saveDraft}
                    disabled={!soapVersionId || lifecycleState === "FINALIZED_FOR_EXPORT" || actionLoading}
                    className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:bg-slate-400"
                  >
                    Save draft
                  </button>
                  <button
                    type="button"
                    onClick={finalizeDraft}
                    disabled={!soapVersionId || lifecycleState === "FINALIZED_FOR_EXPORT" || actionLoading}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:bg-slate-400"
                  >
                    Finalize for export
                  </button>
                  <button
                    type="button"
                    onClick={markExported}
                    disabled={!soapVersionId || lifecycleState !== "FINALIZED_FOR_EXPORT" || actionLoading}
                    className="px-4 py-2 text-sm font-medium text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:bg-slate-400"
                  >
                    Mark as exported
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  Lifecycle: {lifecycleState || "—"} {encounterId ? `• Encounter ${encounterId}` : ""}
                </p>
                {actionError && <p className="text-sm text-red-700">{actionError}</p>}
                {actionSuccess && <p className="text-sm text-green-700">{actionSuccess}</p>}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-3">Recent snapshots</h2>
              {historyLoading ? (
                <p className="text-sm text-slate-600">Loading...</p>
              ) : historyItems.length === 0 ? (
                <p className="text-sm text-slate-600">No transcription snapshots yet.</p>
              ) : (
                <div className="space-y-2">
                  {historyItems.map((item) => (
                    <button
                      key={item.transcriptionSessionId}
                      type="button"
                      onClick={() => loadSoapVersion(item.soapVersionId)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
                    >
                      <div className="text-sm font-medium text-slate-900">{item.patientName}</div>
                      <div className="text-xs text-slate-500">
                        v{item.version} • {item.lifecycleState} • {formatDateTime(item.createdAt)}
                      </div>
                      {item.previewSummary && (
                        <div className="text-xs text-slate-600 mt-1 line-clamp-2">{item.previewSummary}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
