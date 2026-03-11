"use client";

import Image from "next/image";
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

const MAX_STT_AUDIO_BYTES = 100 * 1024 * 1024;

const initialDraft: SoapDraft = {
  subjective: "",
  objective: "",
  assessment: "",
  plan: "",
};

function composeUnifiedSoapText(draft: SoapDraft): string {
  return [
    "Subjective:",
    draft.subjective || "",
    "",
    "Objective:",
    draft.objective || "",
    "",
    "Assessment:",
    draft.assessment || "",
    "",
    "Plan:",
    draft.plan || "",
  ].join("\n");
}

function parseUnifiedSoapText(value: string): SoapDraft | null {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  const pattern =
    /Subjective:\s*([\s\S]*?)\n\s*Objective:\s*([\s\S]*?)\n\s*Assessment:\s*([\s\S]*?)\n\s*Plan:\s*([\s\S]*)$/i;
  const match = normalized.match(pattern);
  if (!match) return null;
  return {
    subjective: (match[1] || "").trim(),
    objective: (match[2] || "").trim(),
    assessment: (match[3] || "").trim(),
    plan: (match[4] || "").trim(),
  };
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export default function PhysicianTranscriptionPage() {
  const router = useRouter();
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);
  const [patientSearchError, setPatientSearchError] = useState<string | null>(null);
  const [patientIdentityMessage, setPatientIdentityMessage] = useState<string | null>(null);
  const [patientIdentityResolution, setPatientIdentityResolution] = useState<"existing" | "new" | null>(
    null,
  );
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  const [newPatientFullName, setNewPatientFullName] = useState("");
  const [newPatientDob, setNewPatientDob] = useState("");
  const chiefComplaint = "";
  const [activeWorkflowTab, setActiveWorkflowTab] = useState<"capture" | "review">("capture");

  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const timerIntervalRef = useRef<number | null>(null);

  const [soapVersionId, setSoapVersionId] = useState<string | null>(null);
  const [encounterId, setEncounterId] = useState<string | null>(null);
  const [lifecycleState, setLifecycleState] = useState<"DRAFT" | "FINALIZED_FOR_EXPORT" | null>(null);
  const [, setSnapshotLabel] = useState<string>("");
  const [draft, setDraft] = useState<SoapDraft>(initialDraft);
  const [reviewText, setReviewText] = useState<string>(composeUnifiedSoapText(initialDraft));
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [copyFeedbackState, setCopyFeedbackState] = useState<"idle" | "copied">("idle");
  const copyFeedbackTimeoutRef = useRef<number | null>(null);

  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<TranscriptionListItem[]>([]);
  const [deletingSnapshotId, setDeletingSnapshotId] = useState<string | null>(null);
  const [deletingAllSnapshots, setDeletingAllSnapshots] = useState(false);
  const [showStartNewConfirm, setShowStartNewConfirm] = useState(false);

  const hasNewPatientIdentity = useMemo(
    () => newPatientFullName.trim().length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(newPatientDob.trim()),
    [newPatientFullName, newPatientDob],
  );
  const canCreateNewPatient = useMemo(
    () => patientIdentityResolution === "new" && hasNewPatientIdentity,
    [patientIdentityResolution, hasNewPatientIdentity],
  );
  const canGenerate = useMemo(
    () =>
      transcript.trim().length >= 10 &&
      (Boolean(selectedPatient?.id) || canCreateNewPatient) &&
      !actionLoading,
    [selectedPatient?.id, transcript, canCreateNewPatient, actionLoading],
  );
  const generateDisabledReason = useMemo(() => {
    if (transcript.trim().length < 10) return "Add transcript text first.";
    if (!hasNewPatientIdentity) {
      return "Enter patient name and DOB.";
    }
    if (!selectedPatient?.id && !canCreateNewPatient) {
      return "Click Continue to resolve patient identity.";
    }
    return null;
  }, [transcript, selectedPatient?.id, hasNewPatientIdentity, canCreateNewPatient]);
  const canCopySoap = useMemo(() => reviewText.trim().length > 0, [reviewText]);

  useEffect(() => {
    void loadHistory();
  }, []);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
      if (timerIntervalRef.current) {
        window.clearInterval(timerIntervalRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  function formatElapsed(secs: number): string {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

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

  async function continuePatientIdentity() {
    const fullName = newPatientFullName.trim().replace(/\s+/g, " ");
    const dob = newPatientDob.trim();
    if (fullName.length < 3) {
      setPatientSearchError("Enter at least 3 characters for patient name.");
      setPatientIdentityMessage(null);
      setPatientIdentityResolution(null);
      setSelectedPatient(null);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      setPatientSearchError("Enter DOB in YYYY-MM-DD format.");
      setPatientIdentityMessage(null);
      setPatientIdentityResolution(null);
      setSelectedPatient(null);
      return;
    }
    setPatientSearchError(null);
    setPatientIdentityMessage(null);
    setPatientSearchLoading(true);
    try {
      const res = await fetch("/api/patients/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: fullName, dob, limit: 10 }),
      });
      if (res.status === 401) {
        router.push("/auth/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Search failed");
      const matches = Array.isArray(data?.patients) ? (data.patients as PatientSearchResult[]) : [];
      const normalizedInputName = fullName.toLowerCase();
      const exactMatch = matches.find((patient) => {
        const normalizedPatientName = patient.fullName.trim().replace(/\s+/g, " ").toLowerCase();
        const patientDob = (patient.dateOfBirth || "").slice(0, 10);
        return normalizedPatientName === normalizedInputName && patientDob === dob;
      });
      const resolvedPatient = exactMatch || matches[0] || null;
      if (resolvedPatient) {
        setSelectedPatient(resolvedPatient);
        setPatientIdentityResolution("existing");
        setPatientIdentityMessage("Existing patient found and selected.");
      } else {
        setSelectedPatient(null);
        setPatientIdentityResolution("new");
        setPatientIdentityMessage("No match found. A new patient will be created on Generate SOAP.");
      }
    } catch (err) {
      setPatientSearchError(err instanceof Error ? err.message : "Search failed");
      setPatientIdentityMessage(null);
      setPatientIdentityResolution(null);
      setSelectedPatient(null);
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
    if (wavBlob.size > MAX_STT_AUDIO_BYTES) {
      throw new Error("Recording is too long. Keep each clip under 100MB and try again.");
    }
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
      timerIntervalRef.current = window.setInterval(() => {
        setRecordingElapsed((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      setRecordingError(err instanceof Error ? err.message : "Unable to start recording.");
    }
  }

  async function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (timerIntervalRef.current) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
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
            !selectedPatient?.id && canCreateNewPatient
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
      const nextDraft = {
        subjective: data?.draft?.subjective || "",
        objective: data?.draft?.objective || "",
        assessment: data?.draft?.assessment || "",
        plan: data?.draft?.plan || "",
      };
      setDraft(nextDraft);
      setReviewText(composeUnifiedSoapText(nextDraft));
      setActiveWorkflowTab("review");
      setActionSuccess("SOAP draft generated.");
      await loadHistory();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to generate SOAP");
    } finally {
      setActionLoading(false);
    }
  }

  async function saveDraft() {
    if (!soapVersionId) return;
    const parsedDraft = parseUnifiedSoapText(reviewText);
    if (!parsedDraft) {
      setActionError("Invalid SOAP format. Keep the headers: Subjective, Objective, Assessment, Plan.");
      return;
    }
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch("/api/physician/transcription/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soapVersionId, draft: parsedDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to save draft");
      setDraft(parsedDraft);
      setReviewText(composeUnifiedSoapText(parsedDraft));
      setActionSuccess("SOAP draft saved.");
      await loadHistory();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to save draft");
    } finally {
      setActionLoading(false);
    }
  }

  async function finalizeAndSaveToEmr() {
    if (!soapVersionId) return;
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      if (lifecycleState !== "FINALIZED_FOR_EXPORT") {
        const finalizeRes = await fetch("/api/physician/transcription/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ soapVersionId }),
        });
        const finalizeData = await finalizeRes.json().catch(() => ({}));
        if (!finalizeRes.ok) {
          throw new Error(finalizeData?.error || "Failed to finalize SOAP before EMR save");
        }
        setLifecycleState("FINALIZED_FOR_EXPORT");
        if (typeof finalizeData?.snapshotLabel === "string") setSnapshotLabel(finalizeData.snapshotLabel);
        setTranscript("");
      }

      const idempotencyKey =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      const exportRes = await fetch("/api/physician/transcription/mark-exported", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soapVersionId,
          idempotencyKey,
          destinationSystem: "manual_copy_paste",
        }),
      });
      const exportData = await exportRes.json().catch(() => ({}));
      if (!exportRes.ok) {
        throw new Error(exportData?.error || "Finalized, but failed to record EMR save");
      }
      setActionSuccess(exportData?.message || "Finalized and saved to EMR.");
      await loadHistory();
      setActiveWorkflowTab("capture");
      setSelectedPatient(null);
      setPatientIdentityResolution(null);
      setPatientIdentityMessage(null);
      setNewPatientFullName("");
      setNewPatientDob("");
      setPatientSearchError(null);
      clearEditorState();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to finalize and save to EMR");
    } finally {
      setActionLoading(false);
    }
  }

  async function copySoapText() {
    if (!canCopySoap) return;
    setActionError(null);
    setActionSuccess(null);
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error("Clipboard is not available in this browser.");
      }
      await navigator.clipboard.writeText(reviewText);
      setCopyFeedbackState("copied");
      if (copyFeedbackTimeoutRef.current) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
      copyFeedbackTimeoutRef.current = window.setTimeout(() => {
        setCopyFeedbackState("idle");
        copyFeedbackTimeoutRef.current = null;
      }, 1500);
      setActionSuccess("SOAP copied. You can now paste it into your EMR.");
    } catch (err) {
      setCopyFeedbackState("idle");
      setActionError(err instanceof Error ? err.message : "Failed to copy SOAP text");
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
      const nextDraft = {
        subjective: data?.draft?.subjective || "",
        objective: data?.draft?.objective || "",
        assessment: data?.draft?.assessment || "",
        plan: data?.draft?.plan || "",
      };
      setDraft(nextDraft);
      setReviewText(composeUnifiedSoapText(nextDraft));
      setTranscript(data?.draftTranscript || "");
      if (typeof data?.snapshotLabel === "string") setSnapshotLabel(data.snapshotLabel);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to load SOAP version");
    }
  }

  function clearEditorState() {
    setSoapVersionId(null);
    setEncounterId(null);
    setLifecycleState(null);
    setDraft(initialDraft);
    setReviewText(composeUnifiedSoapText(initialDraft));
    setTranscript("");
    setRecordingElapsed(0);
  }

  async function deleteSnapshot(item: TranscriptionListItem) {
    if (!window.confirm("Delete this snapshot from Recent snapshots?")) return;
    setDeletingSnapshotId(item.transcriptionSessionId);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch(
        `/api/physician/transcription/snapshots/${encodeURIComponent(item.transcriptionSessionId)}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to delete snapshot");
      if (item.soapVersionId === soapVersionId) {
        clearEditorState();
      }
      setActionSuccess("Snapshot deleted.");
      await loadHistory();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete snapshot");
    } finally {
      setDeletingSnapshotId(null);
    }
  }

  async function deleteAllSnapshots() {
    if (!window.confirm("Delete all recent snapshots? This cannot be undone.")) return;
    setDeletingAllSnapshots(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch("/api/physician/transcription/snapshots", {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to delete all snapshots");
      clearEditorState();
      setActionSuccess(
        `Deleted ${typeof data?.deletedCount === "number" ? data.deletedCount : 0} snapshots.`,
      );
      await loadHistory();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete all snapshots");
    } finally {
      setDeletingAllSnapshots(false);
    }
  }

  return (
    <>
      <SessionKeepAlive redirectTo="/auth/login" />
      <div className="min-h-screen bg-slate-100">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
            <Image
              src="/LogoFinal.png"
              alt="Health Assist AI logo"
              width={112}
              height={26}
              className="mx-auto mb-2 h-[38px] w-[114px] object-contain sm:h-[50px] sm:w-[150px]"
              priority
            />
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-[1.1rem] font-semibold text-slate-900">Transcription</h1>
              </div>
              <button
                type="button"
                onClick={() => router.push("/physician/dashboard")}
                className="px-3 py-1.5 text-[0.7rem] font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Back to dashboard
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 space-y-4">
                <p className="text-sm font-medium text-slate-700">Search or add new patient</p>
                <form
                  className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void continuePatientIdentity();
                  }}
                >
                  <input
                    type="text"
                    value={newPatientFullName}
                    onChange={(e) => {
                      setNewPatientFullName(e.target.value);
                      setSelectedPatient(null);
                      setPatientIdentityResolution(null);
                      setPatientIdentityMessage(null);
                      setPatientSearchError(null);
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    placeholder="First name Last name"
                  />
                  <input
                    type="date"
                    value={newPatientDob}
                    onChange={(e) => {
                      setNewPatientDob(e.target.value);
                      setSelectedPatient(null);
                      setPatientIdentityResolution(null);
                      setPatientIdentityMessage(null);
                      setPatientSearchError(null);
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  />
                  <button
                    type="submit"
                    disabled={patientSearchLoading}
                    className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:bg-slate-400"
                  >
                    {patientSearchLoading ? "Resolving..." : "Continue"}
                  </button>
                </form>
                {patientSearchError && <p className="text-sm text-red-700">{patientSearchError}</p>}
                {patientIdentityMessage && (
                  <p
                    className={`text-sm ${
                      patientIdentityResolution === "existing" ? "text-emerald-700" : "text-slate-600"
                    }`}
                  >
                    {patientIdentityMessage}
                  </p>
                )}
                {selectedPatient && (
                  <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-emerald-900">Selected patient</p>
                      <p className="text-sm text-emerald-900">{selectedPatient.fullName}</p>
                      <p className="text-xs text-emerald-800">
                        DOB: {selectedPatient.dateOfBirth || "—"} •{" "}
                        {selectedPatient.primaryPhone || selectedPatient.email || "No contact"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPatient(null);
                        setPatientIdentityResolution(null);
                        setPatientIdentityMessage(null);
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-emerald-900 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-100"
                    >
                      Edit patient
                    </button>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 space-y-4">
                <div className="flex items-center justify-start">
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                    <button
                      type="button"
                      onClick={() => setActiveWorkflowTab("capture")}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                        activeWorkflowTab === "capture"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Capture transcript
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveWorkflowTab("review")}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                        activeWorkflowTab === "review"
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Review and export
                    </button>
                  </div>
                </div>
                {activeWorkflowTab === "capture" && (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      {isRecording ? (
                        <>
                          <button
                            type="button"
                            onClick={stopRecording}
                            disabled={transcriptLoading}
                            className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-slate-400"
                          >
                            Stop transcription
                          </button>
                          <span className="font-mono text-sm font-semibold text-slate-700 tabular-nums">
                            {formatElapsed(recordingElapsed)}
                          </span>
                        </>
                      ) : transcript.trim().length > 0 && !soapVersionId ? (
                        <>
                          <button
                            type="button"
                            onClick={startRecording}
                            disabled={transcriptLoading}
                            className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400"
                          >
                            Resume
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowStartNewConfirm(true)}
                            disabled={transcriptLoading}
                            className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400"
                          >
                            Start New
                          </button>
                          {recordingElapsed > 0 && (
                            <span className="font-mono text-sm font-semibold text-slate-500 tabular-nums">
                              {formatElapsed(recordingElapsed)}
                            </span>
                          )}
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setRecordingElapsed(0); startRecording(); }}
                          disabled={transcriptLoading}
                          className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400"
                        >
                          Start transcription
                        </button>
                      )}
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
                      <p className={`text-xs ${generateDisabledReason === "Enter patient name and DOB." ? "text-red-500" : "text-slate-500"}`}>{generateDisabledReason}</p>
                    )}
                  </>
                )}
                {activeWorkflowTab === "review" && (
                  <>
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={copySoapText}
                        disabled={!canCopySoap || actionLoading}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-60"
                      >
                        {copyFeedbackState === "copied" ? "Copied!" : "Copy SOAP"}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      <textarea
                        value={reviewText}
                        onChange={(e) => setReviewText(e.target.value)}
                        rows={16}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder={"Subjective:\n\nObjective:\n\nAssessment:\n\nPlan:"}
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
                        onClick={finalizeAndSaveToEmr}
                        disabled={!soapVersionId || actionLoading}
                        className="px-4 py-2 text-sm font-medium text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:bg-slate-400"
                      >
                        Finalize &amp; Save to EMR
                      </button>
                    </div>
                    <p className="text-xs text-slate-500">
                      Lifecycle: {lifecycleState || "—"} {encounterId ? `• Encounter ${encounterId}` : ""}
                    </p>
                    {actionError && <p className="text-sm text-red-700">{actionError}</p>}
                    {actionSuccess && <p className="text-sm text-green-700">{actionSuccess}</p>}
                  </>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-[1.1rem] font-semibold text-slate-900">Recent snapshots</h2>
                <button
                  type="button"
                  onClick={deleteAllSnapshots}
                  disabled={historyLoading || historyItems.length === 0 || deletingAllSnapshots}
                  className="px-3 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-60"
                >
                  {deletingAllSnapshots ? "Deleting..." : "Delete All"}
                </button>
              </div>
              {historyLoading ? (
                <p className="text-sm text-slate-600">Loading...</p>
              ) : historyItems.length === 0 ? (
                <p className="text-sm text-slate-600">No transcription snapshots yet.</p>
              ) : (
                <div className="space-y-2">
                  {historyItems.map((item) => (
                    <div
                      key={item.transcriptionSessionId}
                      className="rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => loadSoapVersion(item.soapVersionId)}
                          className="flex-1 text-left hover:bg-slate-50 rounded-md"
                        >
                          <div className="text-sm font-medium text-slate-900">{item.patientName}</div>
                          <div className="text-xs text-slate-500">
                            v{item.version} • {item.lifecycleState} • {formatDateTime(item.createdAt)}
                          </div>
                          {item.previewSummary && (
                            <div className="text-xs text-slate-600 mt-1 line-clamp-2">{item.previewSummary}</div>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSnapshot(item)}
                          disabled={deletingSnapshotId === item.transcriptionSessionId}
                          className="shrink-0 px-2 py-1 text-xs font-medium text-red-700 bg-white border border-red-300 rounded hover:bg-red-50 disabled:opacity-60"
                        >
                          {deletingSnapshotId === item.transcriptionSessionId ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {showStartNewConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50">
          <div className="mx-4 max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <p className="text-sm text-slate-800">
              Are you sure you want to start new? The current transcript will be deleted.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowStartNewConfirm(false)}
                className="px-3 py-1.5 text-sm font-medium text-slate-700 rounded-lg border border-slate-300 bg-white hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowStartNewConfirm(false);
                  setTranscript("");
                  setRecordingElapsed(0);
                  startRecording();
                }}
                className="px-3 py-1.5 text-sm font-medium text-white rounded-lg bg-slate-900 hover:bg-slate-800"
              >
                Okay
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
