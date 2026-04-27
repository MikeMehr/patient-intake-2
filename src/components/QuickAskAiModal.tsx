"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { languageOptions } from "@/lib/speech-language";
import { convertToWav, getMicrophoneErrorMessage, MAX_STT_AUDIO_BYTES } from "@/lib/audio-utils";

interface QuickAskAiModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function QuickAskAiModal({ isOpen, onClose }: QuickAskAiModalProps) {
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [language, setLanguage] = useState("en");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const stopRecordingCleanup = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current = null;
    mediaStreamRef.current = null;
    mediaChunksRef.current = [];
    setIsRecording(false);
    setIsTranscribing(false);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopRecordingCleanup();
      setQuestion("");
      setResponse("");
      setMicError(null);
      setAiError(null);
      setIsLoading(false);
    }
  }, [isOpen, stopRecordingCleanup]);

  useEffect(() => {
    return () => stopRecordingCleanup();
  }, [stopRecordingCleanup]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  async function handleMicClick() {
    if (isRecording) {
      setIsRecording(false);
      const recorder = mediaRecorderRef.current;
      const mimeType = recorder?.mimeType || "audio/webm";

      await new Promise<void>((resolve) => {
        if (!recorder || recorder.state === "inactive") { resolve(); return; }
        recorder.onstop = () => resolve();
        recorder.stop();
      });

      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());

      const blob = new Blob(mediaChunksRef.current, { type: mimeType });
      mediaChunksRef.current = [];

      if (!blob.size) return;

      setIsTranscribing(true);
      setMicError(null);
      try {
        const wavBlob = await convertToWav(blob);
        if (wavBlob.size > MAX_STT_AUDIO_BYTES) {
          throw new Error("Recording is too long.");
        }
        const formData = new FormData();
        formData.append("audio", new File([wavBlob], "recording.wav", { type: "audio/wav" }));
        formData.append("language", language);
        const res = await fetch("/api/speech/stt", { method: "POST", body: formData });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Transcription failed");
        const text = typeof data?.text === "string" ? data.text.trim() : "";
        if (text && isMountedRef.current) {
          setQuestion((prev) => {
            const separator = prev.trim() ? " " : "";
            return prev + separator + text;
          });
        }
      } catch (err) {
        if (isMountedRef.current) setMicError(getMicrophoneErrorMessage(err));
      } finally {
        if (isMountedRef.current) setIsTranscribing(false);
      }
    } else {
      setMicError(null);
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
        setMicError(getMicrophoneErrorMessage(err));
      }
    }
  }

  async function handleSubmit() {
    const prompt = question.trim();
    if (!prompt || isLoading || isTranscribing) return;
    setIsLoading(true);
    setAiError(null);
    setResponse("");
    try {
      const res = await fetch("/api/physician/quick-ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!isMountedRef.current) return;
      if (!res.ok) {
        setAiError(data.error || "Request failed.");
        return;
      }
      if (typeof data.result !== "string") {
        setAiError("Unexpected response format.");
        return;
      }
      setResponse(data.result.trim());
    } catch {
      if (isMountedRef.current) setAiError("Network error. Please try again.");
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }

  function handleCopy() {
    if (!response) return;
    try {
      navigator.clipboard.writeText(response);
      setCopyFeedback(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) setCopyFeedback(false);
      }, 1500);
    } catch {
      // clipboard unavailable — silently ignore
    }
  }

  if (!isOpen) return null;

  const error = micError || aiError;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isRecording) onClose();
      }}
    >
      <div className="max-w-xl w-full mx-4 bg-white rounded-xl border border-slate-200 shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Ask AI</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Type a medical question..."
            rows={5}
            className="w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-900 resize-y focus:outline-none focus:ring-2 focus:ring-slate-400 placeholder:text-slate-400"
            disabled={isLoading}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
            }}
          />

          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}

          {response && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">AI Response</p>
              <div className="max-h-64 overflow-y-auto rounded-lg bg-slate-50 p-3 text-sm text-slate-800 whitespace-pre-wrap border border-slate-200">
                {response}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-200">
          <div className="flex items-center gap-2">
            {/* Language selector */}
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={isRecording || isTranscribing || isLoading}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:opacity-50"
            >
              {languageOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {/* Mic button */}
            <button
              type="button"
              onClick={handleMicClick}
              disabled={isTranscribing || isLoading}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isRecording
                  ? "bg-red-50 border-red-300 text-red-700 hover:bg-red-100"
                  : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {isTranscribing ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Transcribing...
                </>
              ) : isRecording ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  Stop
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  Speak
                </>
              )}
            </button>
          </div>

          <div className="flex items-center gap-2">
            {response && (
              <button
                type="button"
                onClick={handleCopy}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                {copyFeedback ? "Copied!" : "Copy"}
              </button>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!question.trim() || isLoading || isTranscribing || isRecording}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Answering...
                </>
              ) : (
                "Ask"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
