"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";

type StateSnapshot = {
  patientSex: string | null;
  patientAge: number | null;
  chiefComplaint: string | null;
  activeComplaint: string | null;
  complaintClass: string | null;
  protocolId: string | null;
  complaints: string[];
  pendingComplaints: string[];
  completedComplaints: string[];
  missingRequiredFields: string[];
  missingRedFlags: string[];
  activeCoveredTopics: string[];
  urgency: "routine" | "elevated";
  escalationReasons: string[];
  historyConfidence: "clear" | "needs_clarification" | "unsafe_to_continue";
  summaryReady: boolean;
  earlyStopReason: string | null;
  deferredIntentHint: string | null;
  questionsAsked: number;
  totalQuestionCount: number | null;
};

type LiveTurn = {
  id: string;
  turn_index: number;
  role: "assistant" | "patient";
  content: string;
  content_en: string | null;
  rationale: string | null;
  state_snapshot: StateSnapshot | null;
  is_summary: boolean;
  created_at: string;
};

export default function MonitorPage() {
  const params = useParams();
  const invitationId = params?.invitationId as string;

  const [turns, setTurns] = useState<LiveTurn[]>([]);
  const [patientName, setPatientName] = useState<string>("");
  const [requestPhqGad, setRequestPhqGad] = useState(false);
  const [guidancePending, setGuidancePending] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [guidanceText, setGuidanceText] = useState("");
  const [submittingGuidance, setSubmittingGuidance] = useState(false);
  const [togglingScreening, setTogglingScreening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRationales, setExpandedRationales] = useState<Set<string>>(new Set());
  const lastTurnIndexRef = useRef(-1);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const latestSnapshot: StateSnapshot | null =
    [...turns].reverse().find((t) => t.role === "assistant" && t.state_snapshot)?.state_snapshot ?? null;

  const firstSnapshot: StateSnapshot | null =
    turns.find((t) => t.role === "assistant" && t.state_snapshot)?.state_snapshot ?? null;

  const doFetch = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/invitations/${invitationId}/live?since=${lastTurnIndexRef.current}`,
      );
      if (res.status === 401) {
        setError("Session expired. Please log in again.");
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      if (data.patientName) setPatientName(data.patientName);
      setRequestPhqGad(Boolean(data.requestPhqGad));
      setGuidancePending(Boolean(data.guidancePending));
      if (data.isCompleted) setIsCompleted(true);

      if (Array.isArray(data.turns) && data.turns.length > 0) {
        const firstNewIndex = data.turns[0].turn_index;
        setTurns((prev) => {
          // If new turns start at index 0 the patient started a fresh session —
          // replace the entire transcript so the monitor shows only the new interview.
          if (firstNewIndex === 0) return data.turns;
          // Otherwise append, deduplicating by id to prevent double-renders on rapid polls.
          const existingIds = new Set(prev.map((t) => t.id));
          const fresh = data.turns.filter((t: LiveTurn) => !existingIds.has(t.id));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
        const last = data.turns[data.turns.length - 1];
        lastTurnIndexRef.current = last.turn_index;
      }
    } catch {
      // Silent — network hiccups should not disrupt the monitor
    }
  }, [invitationId]);

  useEffect(() => {
    doFetch();
    const id = setInterval(doFetch, 4000);
    return () => clearInterval(id);
  }, [doFetch]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  async function handleGuidanceSubmit() {
    if (!guidanceText.trim()) return;
    setSubmittingGuidance(true);
    try {
      await fetch(`/api/invitations/${invitationId}/live`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ physicianGuidance: guidanceText }),
      });
      setGuidanceText("");
      setGuidancePending(true);
    } finally {
      setSubmittingGuidance(false);
    }
  }

  async function handleScreeningToggle(value: boolean) {
    setTogglingScreening(true);
    try {
      await fetch(`/api/invitations/${invitationId}/screening`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestPhqGad: value }),
      });
      setRequestPhqGad(value);
    } finally {
      setTogglingScreening(false);
    }
  }

  function toggleRationale(id: string) {
    setExpandedRationales((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-red-600 text-base">{error}</p>
      </div>
    );
  }

  const chiefComplaint = firstSnapshot?.chiefComplaint ?? null;
  const patientSex = firstSnapshot?.patientSex ?? null;
  const patientAge = firstSnapshot?.patientAge ?? null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-6 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold uppercase tracking-wide text-slate-400">Live Monitor</span>
          <span className="text-slate-300">|</span>
          <span className="text-base font-semibold text-slate-800">{patientName || "Loading…"}</span>
        </div>
        {chiefComplaint && (
          <span className="text-base text-slate-600">
            <span className="font-medium text-slate-500">CC:</span> {chiefComplaint}
          </span>
        )}
        {(patientSex || patientAge) && (
          <span className="text-base text-slate-500">
            {[patientAge ? `${patientAge} y/o` : null, patientSex].filter(Boolean).join(" · ")}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isCompleted ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-700">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              Interview Complete
            </span>
          ) : turns.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-amber-100 text-amber-700">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block" />
              Waiting for patient…
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-700">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse inline-block" />
              Live
            </span>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Transcript — bubbles grow with window width */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {turns.length === 0 && (
            <p className="text-slate-400 text-base text-center mt-16">
              No interview activity yet. The transcript will appear here in real time.
            </p>
          )}
          {turns.map((turn) => {
            if (turn.role === "patient") {
              const displayContent = turn.content_en ?? turn.content;
              const isTranslated = turn.content_en && turn.content_en !== turn.content;
              return (
                <div key={turn.id} className="flex justify-end">
                  <div className="w-[85%] bg-white border border-slate-200 rounded-xl px-5 py-4 shadow-sm">
                    <p className="text-sm font-semibold text-slate-400 mb-1">
                      Patient{isTranslated && <span className="ml-1 font-normal text-slate-300">(translated)</span>}
                    </p>
                    <p className="text-base text-slate-700">{displayContent}</p>
                  </div>
                </div>
              );
            }

            if (turn.is_summary) {
              return (
                <div key={turn.id} className="flex justify-center">
                  <div className="w-[85%] bg-green-50 border border-green-200 rounded-xl px-5 py-4 text-center">
                    <span className="text-base font-semibold text-green-700">Interview concluded — summary generated</span>
                  </div>
                </div>
              );
            }

            const snap = turn.state_snapshot;
            const urgency = snap?.urgency ?? "routine";
            return (
              <div key={turn.id} className="flex justify-start">
                <div className="w-[85%] bg-indigo-50 border border-indigo-200 rounded-xl px-5 py-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-semibold text-indigo-500">AI</p>
                    {urgency === "elevated" && (
                      <span className="px-2 py-0.5 rounded text-sm font-medium bg-amber-100 text-amber-700">
                        Elevated urgency
                      </span>
                    )}
                  </div>
                  <p className="text-base text-slate-800">{turn.content_en ?? turn.content}</p>
                  {turn.rationale && (
                    <div className="mt-2">
                      <button
                        onClick={() => toggleRationale(turn.id)}
                        className="text-sm text-indigo-400 hover:text-indigo-600 flex items-center gap-1"
                      >
                        <span>{expandedRationales.has(turn.id) ? "▲" : "▼"}</span>
                        Rationale
                      </button>
                      {expandedRationales.has(turn.id) && (
                        <p className="mt-1 text-sm text-slate-500 italic border-l-2 border-indigo-200 pl-3">
                          {turn.rationale}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={transcriptEndRef} />
        </div>

        {/* Right: Controls */}
        <aside className="w-88 flex-shrink-0 border-l border-slate-200 bg-white overflow-y-auto flex flex-col" style={{ width: "22rem" }}>
          {/* LLM Decision-Making Panel */}
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 mb-3">AI Status</h2>

            {!latestSnapshot ? (
              <p className="text-sm text-slate-400">Awaiting first interview turn…</p>
            ) : (
              <div className="space-y-3">
                {/* Last rationale */}
                {(() => {
                  const lastRationale = [...turns].reverse().find((t) => t.role === "assistant" && t.rationale)?.rationale;
                  return lastRationale ? (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                      <p className="text-sm font-semibold text-slate-400 mb-1">Last Reasoning</p>
                      <p className="text-sm text-slate-600 italic">{lastRationale}</p>
                    </div>
                  ) : null;
                })()}

                {/* Currently investigating */}
                <div>
                  <p className="text-sm font-semibold text-slate-400 mb-1">Currently Investigating</p>
                  <p className="text-base font-medium text-slate-700">{latestSnapshot.activeComplaint || "—"}</p>
                  {latestSnapshot.complaintClass && (
                    <p className="text-sm text-slate-400">{latestSnapshot.complaintClass}{latestSnapshot.protocolId ? ` · ${latestSnapshot.protocolId}` : ""}</p>
                  )}
                </div>

                {/* Complaint roadmap */}
                {(latestSnapshot.completedComplaints?.length > 0 || latestSnapshot.pendingComplaints?.length > 0) && (
                  <div>
                    <p className="text-sm font-semibold text-slate-400 mb-1">Complaint Roadmap</p>
                    <ul className="space-y-0.5">
                      {latestSnapshot.completedComplaints?.map((c) => (
                        <li key={c} className="text-sm text-slate-400 flex gap-1">
                          <span className="text-green-500">✓</span> {c}
                        </li>
                      ))}
                      {latestSnapshot.activeComplaint && (
                        <li className="text-sm text-indigo-600 font-medium flex gap-1">
                          <span>→</span> {latestSnapshot.activeComplaint}
                        </li>
                      )}
                      {latestSnapshot.pendingComplaints?.map((c) => (
                        <li key={c} className="text-sm text-slate-400 flex gap-1">
                          <span className="text-slate-300">○</span> {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Clinical checklist */}
                {latestSnapshot.missingRequiredFields?.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-slate-400 mb-1">Still Needs</p>
                    <ul className="space-y-0.5">
                      {latestSnapshot.missingRequiredFields.map((f) => (
                        <li key={f} className="text-sm text-slate-500 flex gap-1">
                          <span className="text-amber-400">·</span> {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Red flag monitoring */}
                {latestSnapshot.missingRedFlags?.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-slate-400 mb-1">Monitoring Red Flags</p>
                    <ul className="space-y-0.5">
                      {latestSnapshot.missingRedFlags.map((f) => (
                        <li key={f} className="text-sm text-red-500 flex gap-1">
                          <span>⚑</span> {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Urgency */}
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-400">Urgency:</p>
                  <span
                    className={`px-2 py-0.5 rounded-full text-sm font-medium ${
                      latestSnapshot.urgency === "elevated"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {latestSnapshot.urgency === "elevated" ? "Elevated" : "Routine"}
                  </span>
                </div>
                {latestSnapshot.escalationReasons?.length > 0 && (
                  <ul className="space-y-0.5">
                    {latestSnapshot.escalationReasons.map((r) => (
                      <li key={r} className="text-sm text-amber-600 flex gap-1">
                        <span>↑</span> {r}
                      </li>
                    ))}
                  </ul>
                )}

                {/* History confidence */}
                {latestSnapshot.historyConfidence !== "clear" && (
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-400">History:</p>
                    <span
                      className={`px-2 py-0.5 rounded-full text-sm font-medium ${
                        latestSnapshot.historyConfidence === "unsafe_to_continue"
                          ? "bg-red-100 text-red-700"
                          : "bg-yellow-100 text-yellow-700"
                      }`}
                    >
                      {latestSnapshot.historyConfidence === "unsafe_to_continue"
                        ? "Unsafe to continue"
                        : "Needs clarification"}
                    </span>
                  </div>
                )}

                {/* Progress */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-semibold text-slate-400">Progress</p>
                    <p className="text-sm text-slate-500">
                      {latestSnapshot.questionsAsked}
                      {latestSnapshot.totalQuestionCount ? ` / ~${latestSnapshot.totalQuestionCount}` : ""} questions
                    </p>
                  </div>
                  {latestSnapshot.totalQuestionCount ? (
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div
                        className="bg-indigo-400 h-2 rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, (latestSnapshot.questionsAsked / latestSnapshot.totalQuestionCount) * 100)}%`,
                        }}
                      />
                    </div>
                  ) : null}
                </div>

                {/* Summary ready */}
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${latestSnapshot.summaryReady ? "bg-green-500" : "bg-slate-300"}`}
                  />
                  <p className="text-sm text-slate-500">
                    {latestSnapshot.summaryReady ? "Ready to summarize" : "Still gathering history"}
                  </p>
                </div>

                {/* Deferred hint */}
                {latestSnapshot.deferredIntentHint && (
                  <div className="text-sm text-slate-400">
                    <span className="font-semibold">Deferred: </span>{latestSnapshot.deferredIntentHint}
                  </div>
                )}

                {/* Early stop */}
                {latestSnapshot.earlyStopReason && (
                  <div className="text-sm text-amber-600">
                    <span className="font-semibold">Early stop: </span>{latestSnapshot.earlyStopReason}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Physician Guidance */}
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 mb-2">Guide the AI</h2>
            <p className="text-sm text-slate-400 mb-2">
              Type a note for the AI — it will be included on the patient&apos;s next interview turn.
            </p>
            {guidancePending && (
              <div className="mb-2 flex items-center gap-1.5 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
                Queued — awaiting patient&apos;s next turn
              </div>
            )}
            <textarea
              value={guidanceText}
              onChange={(e) => setGuidanceText(e.target.value)}
              disabled={isCompleted}
              placeholder='e.g. "Ask about family history of diabetes"'
              rows={3}
              className="w-full text-base border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50 disabled:text-slate-400"
            />
            <button
              onClick={handleGuidanceSubmit}
              disabled={submittingGuidance || !guidanceText.trim() || isCompleted}
              className="mt-2 w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submittingGuidance ? "Sending…" : "Send to AI"}
            </button>
          </div>

          {/* Screening Forms */}
          <div className="px-5 py-4">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 mb-2">Screening Forms</h2>
            <p className="text-sm text-slate-400 mb-3">
              Enable mid-interview if not requested at invite time.
            </p>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={requestPhqGad}
                disabled={togglingScreening || isCompleted || requestPhqGad}
                onChange={(e) => handleScreeningToggle(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed"
              />
              <span className="text-base text-slate-700">PHQ-9 / GAD-7 Screening</span>
              {requestPhqGad && (
                <span className="ml-auto px-2 py-0.5 rounded text-sm bg-green-100 text-green-700 font-medium">
                  Enabled
                </span>
              )}
            </label>
            {requestPhqGad && (
              <p className="mt-1 text-sm text-slate-400 pl-7">
                Will appear for the patient on their next interview turn.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
