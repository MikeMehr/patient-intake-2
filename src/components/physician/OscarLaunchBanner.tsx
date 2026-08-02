"use client";

import type { OscarLaunchStatus } from "@/components/physician/useOscarLaunch";

/**
 * Context strip shown when the transcription page was opened from the
 * "Transcribe" button in the OSCAR eChart.
 *
 * Two jobs: tell the doctor which chart this note is bound to (so a note never
 * silently lands on the wrong patient), and say plainly when the automatic
 * hand-back is unavailable so they reach for Copy SOAP instead.
 */
export function OscarLaunchBanner(props: {
  status: OscarLaunchStatus;
  patientName: string | null;
  demographicNo: string | null;
  openerAlive: boolean;
  onNotThisPatient: () => void;
}) {
  const { status, patientName, demographicNo, openerAlive, onNotThisPatient } = props;

  if (status === "resolving") {
    return (
      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
        Loading the patient from OSCAR…
      </div>
    );
  }

  if (status === "resolved") {
    return (
      <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-emerald-900">
            Launched from the OSCAR eChart —{" "}
            <span className="font-semibold">{patientName}</span>
            {demographicNo ? <span className="text-emerald-700"> · OSCAR #{demographicNo}</span> : null}
          </span>
          <button
            type="button"
            onClick={onNotThisPatient}
            className="text-xs text-emerald-800 underline hover:text-emerald-900"
          >
            Not this patient?
          </button>
        </div>
        {!openerAlive ? (
          <p className="mt-1.5 text-xs text-amber-700">
            The OSCAR window is no longer open, so the note can&apos;t be sent back automatically.
            Use Copy SOAP when you&apos;re done.
          </p>
        ) : null}
      </div>
    );
  }

  const message =
    status === "oscar_not_connected"
      ? "OSCAR isn't connected for this clinic, so the patient couldn't be loaded automatically."
      : status === "error"
        ? "Something went wrong loading the patient from OSCAR."
        : "This patient couldn't be found in OSCAR.";

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      {message} Enter the name and date of birth below — you can still record and generate the note.
    </div>
  );
}
