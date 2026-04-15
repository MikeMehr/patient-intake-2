"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import SessionKeepAlive from "@/components/auth/SessionKeepAlive";

const FORMATS = [
  { value: "", label: "Select a format…" },
  { value: "medical-legal", label: "Medical-Legal Report" },
  { value: "dynacare-insurance", label: "Dynacare Insurance Table" },
  { value: "general", label: "General Clinical Summary" },
];

export default function SummarizingPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [format, setFormat] = useState<string>("");
  const [instructions, setInstructions] = useState<string>("");
  const [report, setReport] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setPdfFile(file);
    setReport("");
    setError(null);
  };

  const handleGenerate = async () => {
    if (!pdfFile) return;
    if (!format && !instructions.trim()) {
      setError("Please select a report format or provide instructions (or both).");
      return;
    }

    setLoading(true);
    setError(null);
    setReport("");

    try {
      const fd = new FormData();
      fd.append("record", pdfFile);
      fd.append("format", format);
      fd.append("instructions", instructions);

      const res = await fetch("/api/physician/summarize-records", {
        method: "POST",
        body: fd,
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to generate report.");
        return;
      }
      setReport(data.report || "");
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select textarea
      const ta = document.getElementById("report-output") as HTMLTextAreaElement | null;
      ta?.select();
    }
  };

  const canGenerate = !!pdfFile && (!!format || !!instructions.trim()) && !loading;

  return (
    <div className="min-h-screen bg-slate-50">
      <SessionKeepAlive redirectTo="/physician/login" />

      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Link
            href="/physician/dashboard"
            className="text-sm text-slate-500 hover:text-slate-700 transition"
          >
            ← Dashboard
          </Link>
          <span className="text-slate-300">/</span>
          <h1 className="text-base font-semibold text-slate-800">Summarizing</h1>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Upload a patient PDF record and generate a structured medical report.
        </p>
      </div>

      {/* Main content */}
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* Upload */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-3">
          <label className="block text-sm font-semibold text-slate-700">
            Medical Record PDF
            <span className="ml-1 font-normal text-slate-400">(required, max 20 MB)</span>
          </label>
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-6 cursor-pointer hover:border-slate-400 transition"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-8 w-8 text-slate-400"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            {pdfFile ? (
              <p className="text-sm text-slate-700 font-medium">{pdfFile.name}</p>
            ) : (
              <p className="text-sm text-slate-500">Click to select a PDF file</p>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={handleFileChange}
          />
          {pdfFile && (
            <button
              type="button"
              onClick={() => { setPdfFile(null); setReport(""); setError(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
              className="text-xs text-slate-400 hover:text-slate-600 transition"
            >
              Remove file
            </button>
          )}
        </div>

        {/* Format + Instructions */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
          <div className="space-y-2">
            <label htmlFor="format-select" className="block text-sm font-semibold text-slate-700">
              Report Format
              <span className="ml-1 font-normal text-slate-400">(optional)</span>
            </label>
            <select
              id="format-select"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              {FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="instructions-input" className="block text-sm font-semibold text-slate-700">
              Instructions
              <span className="ml-1 font-normal text-slate-400">(optional — describe what to include or how to format)</span>
            </label>
            <textarea
              id="instructions-input"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={4}
              placeholder="e.g. Focus on orthopedic injuries and MVA timeline. Include a section on functional limitations."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 resize-y"
            />
          </div>
        </div>

        {/* Generate button */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {loading && (
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            )}
            {loading ? "Generating…" : "Generate Report"}
          </button>
          {!pdfFile && (
            <p className="text-xs text-slate-400">Upload a PDF to enable generation.</p>
          )}
          {pdfFile && !format && !instructions.trim() && (
            <p className="text-xs text-slate-400">Select a format or provide instructions to enable generation.</p>
          )}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Output */}
        {report && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Generated Report</h2>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                {copied ? (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copy to Clipboard
                  </>
                )}
              </button>
            </div>
            <textarea
              id="report-output"
              readOnly
              value={report}
              rows={30}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-800 font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>
        )}
      </div>
    </div>
  );
}
