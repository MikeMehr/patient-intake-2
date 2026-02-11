"use client";

import { useState } from "react";

export default function GenerateLinkPage() {
  const [physicianEmail, setPhysicianEmail] = useState("");
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    // Generate a simple link - in production, you might want to pre-register the session
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const link = `${baseUrl}/?physician=${encodeURIComponent(physicianEmail)}`;
    setGeneratedLink(link);
    setCopied(false);
  };

  const handleCopy = () => {
    if (generatedLink) {
      navigator.clipboard.writeText(generatedLink).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white shadow-xl p-8">
        <h1 className="text-3xl font-semibold text-slate-900 mb-2">
          Generate Patient Intake Link
        </h1>
        <p className="text-sm text-slate-600 mb-6">
          Generate a link to send to your patient. They will complete the intake form and you'll receive a notification when it's done.
        </p>

        <form onSubmit={handleGenerate} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="physician-email" className="text-sm font-medium text-slate-800">
              Your Email (for notifications)
            </label>
            <input
              id="physician-email"
              type="email"
              value={physicianEmail}
              onChange={(e) => setPhysicianEmail(e.target.value)}
              placeholder="physician@clinic.com"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              required
            />
            <p className="text-xs text-slate-500">
              Optional: We'll include this in the patient's session so you can be notified when they complete the form.
            </p>
          </div>

          <button
            type="submit"
            className="w-full rounded-2xl bg-slate-900 px-5 py-3 text-base font-semibold text-white transition hover:bg-slate-800"
          >
            Generate Link
          </button>
        </form>

        {generatedLink && (
          <div className="mt-6 rounded-2xl border-2 border-blue-200 bg-blue-50 px-4 py-4">
            <p className="text-sm font-semibold text-blue-900 mb-2">
              Patient Intake Link Generated
            </p>
            <p className="text-xs text-blue-800 mb-3">
              Send this link to your patient:
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={generatedLink}
                className="flex-1 rounded-xl border border-blue-300 bg-white px-3 py-2 text-xs text-slate-900"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="mt-3 text-[11px] text-blue-700">
              <strong>Note:</strong> When the patient completes the form, they will receive a shareable link to send back to you with their summary. 
              The patient's information is not stored in a database - it's only available temporarily via the link.
            </p>
          </div>
        )}

        <div className="mt-8 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
          <p className="text-xs text-amber-800">
            <strong>How it works:</strong>
          </p>
          <ol className="mt-2 text-xs text-amber-700 space-y-1 list-decimal list-inside">
            <li>Generate a link and send it to your patient</li>
            <li>Patient completes the intake form</li>
            <li>Patient receives a shareable link with their summary</li>
            <li>Patient shares the link back with you</li>
            <li>You view the summary and copy information to your EMR</li>
            <li>Data expires after 24 hours (not stored in database)</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
