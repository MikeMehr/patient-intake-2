"use client";

import { useEffect, useState } from "react";

type StyleRule = {
  id: string;
  noteType: "soap" | "recommendations_imaging" | "recommendations_referrals";
  ruleText: string;
  createdAt: string;
};

const NOTE_TYPE_LABELS: Record<StyleRule["noteType"], string> = {
  soap: "SOAP notes",
  recommendations_imaging: "Imaging requisitions",
  recommendations_referrals: "Referral letters",
};

const NOTE_TYPE_ORDER: StyleRule["noteType"][] = ["soap", "recommendations_imaging", "recommendations_referrals"];

// Lists what the AI has learned from the physician's edits (via the Learn
// buttons) and lets a bad lesson be removed. Fetches lazily on first expand.
export default function LearnedPreferencesPanel({ refreshKey }: { refreshKey: number }) {
  const [expanded, setExpanded] = useState(false);
  const [rules, setRules] = useState<StyleRule[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch("/api/physician/transcription/style-rules");
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(data?.error || "Failed to load learned preferences.");
        setRules(Array.isArray(data?.rules) ? data.rules : []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load learned preferences.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, refreshKey]);

  async function deleteRule(ruleId: string) {
    if (deletingId) return;
    if (!window.confirm("Remove this preference? Future notes will no longer follow it.")) return;
    setDeletingId(ruleId);
    setError(null);
    try {
      const res = await fetch(`/api/physician/transcription/style-rules?id=${encodeURIComponent(ruleId)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to delete preference.");
      setRules((prev) => (prev ? prev.filter((r) => r.id !== ruleId) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete preference.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-xs font-semibold text-slate-700">Learned preferences</span>
        <span className="text-xs text-slate-500">{expanded ? "Hide" : "Show"}</span>
      </button>
      {expanded && (
        <div className="mt-2">
          {loading && <p className="text-xs text-slate-500">Loading…</p>}
          {error && <p className="text-xs text-red-700">{error}</p>}
          {!loading && !error && rules && rules.length === 0 && (
            <p className="text-xs text-slate-500">No learned preferences yet. Edit an AI note and click Learn.</p>
          )}
          {!loading && !error && rules && rules.length > 0 && (
            <div className="space-y-3">
              {NOTE_TYPE_ORDER.map((noteType) => {
                const group = rules.filter((r) => r.noteType === noteType);
                if (group.length === 0) return null;
                return (
                  <div key={noteType}>
                    <p className="text-xs font-medium text-slate-600 mb-1">{NOTE_TYPE_LABELS[noteType]}</p>
                    <ul className="space-y-1">
                      {group.map((rule) => (
                        <li
                          key={rule.id}
                          className="flex items-start justify-between gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5"
                        >
                          <span className="text-sm text-slate-800">{rule.ruleText}</span>
                          <button
                            type="button"
                            onClick={() => void deleteRule(rule.id)}
                            disabled={deletingId !== null}
                            title="Remove this preference"
                            className="text-xs text-slate-400 hover:text-red-600 disabled:text-slate-300"
                          >
                            {deletingId === rule.id ? "…" : "✕"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
