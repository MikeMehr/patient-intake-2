"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DateTimeField from "./DateTimeField";

type Physician = { id: string; firstName: string; lastName: string };
type Slot = {
  id: string;
  physicianId: string;
  physicianName: string;
  startTime: string;
  endTime: string;
  status: "OPEN" | "BLOCKED" | "HELD" | "BOOKED";
};

function formatLocalDT(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// Return the set of slot ids that overlap at least one other slot for the same
// physician (half-open interval test). Used to surface/clean up existing overlaps.
function computeOverlapIds(slots: Slot[]): Set<string> {
  const ids = new Set<string>();
  const byPhysician = new Map<string, Slot[]>();
  for (const s of slots) {
    const arr = byPhysician.get(s.physicianId) ?? [];
    arr.push(s);
    byPhysician.set(s.physicianId, arr);
  }
  for (const arr of byPhysician.values()) {
    const sorted = [...arr].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
    for (let i = 0; i < sorted.length; i++) {
      const aEnd = new Date(sorted[i]!.endTime).getTime();
      const aStart = new Date(sorted[i]!.startTime).getTime();
      for (let j = i + 1; j < sorted.length; j++) {
        const bStart = new Date(sorted[j]!.startTime).getTime();
        if (bStart >= aEnd) break; // sorted by start: nothing further overlaps i
        const bEnd = new Date(sorted[j]!.endTime).getTime();
        if (aStart < bEnd && bStart < aEnd) {
          ids.add(sorted[i]!.id);
          ids.add(sorted[j]!.id);
        }
      }
    }
  }
  return ids;
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function SlotsPage() {
  const router = useRouter();
  const [physicians, setPhysicians] = useState<Physician[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [filterPhysicianId, setFilterPhysicianId] = useState("all");
  const [showOverlapsOnly, setShowOverlapsOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().substring(0, 10));
  const [dateTo, setDateTo] = useState(
    new Date(Date.now() + 14 * 86400000).toISOString().substring(0, 10),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add slot modal
  const [showAdd, setShowAdd] = useState(false);
  const [newSlot, setNewSlot] = useState({
    physicianId: "",
    startTime: "",
    endTime: "",
    slotStatus: "OPEN",
  });
  const [bulkMode, setBulkMode] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [overlapWarning, setOverlapWarning] = useState<
    { startTime: string; endTime: string; status: string }[] | null
  >(null);

  function loadSlots() {
    const qs = new URLSearchParams({ dateFrom, dateTo });
    if (filterPhysicianId !== "all") qs.set("physicianId", filterPhysicianId);

    setLoading(true);
    fetch(`/api/org/slots?${qs}`)
      .then((r) => r.json())
      .then((data) => {
        setSlots(data.slots ?? []);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load slots.");
        setLoading(false);
      });
  }

  useEffect(() => {
    fetch("/api/org/providers")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        const list: Physician[] = (data.providers ?? []).map((p: Record<string, string>) => ({
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
        }));
        setPhysicians(list);
        if (list.length > 0) setNewSlot((prev) => ({ ...prev, physicianId: list[0].id }));
      })
      .catch(() => router.push("/org/login"));
  }, [router]);

  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, filterPhysicianId]);

  async function handleToggleStatus(slot: Slot) {
    const newStatus = slot.status === "OPEN" ? "BLOCKED" : "OPEN";
    await fetch(`/api/org/slots/${slot.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotStatus: newStatus }),
    });
    loadSlots();
  }

  async function handleDelete(slot: Slot) {
    await fetch(`/api/org/slots/${slot.id}`, { method: "DELETE" });
    loadSlots();
  }

  function openAddModal() {
    // Prefill the date (and a sensible default time) so the Date fields are
    // never left blank — that was causing the form to fail/stall.
    const day = dateFrom || new Date().toISOString().substring(0, 10);
    setNewSlot((prev) => ({
      ...prev,
      // Default to the physician currently being filtered, so "Add Slot" matches
      // who you're viewing. Falls back to the existing default when viewing "All".
      physicianId: filterPhysicianId !== "all" ? filterPhysicianId : prev.physicianId,
      startTime: `${day}T09:00`,
      endTime: `${day}T09:30`,
    }));
    setAddError(null);
    setOverlapWarning(null);
    setShowAdd(true);
  }

  function handleAddSlot(e: React.FormEvent) {
    e.preventDefault();
    void submitSlot(false);
  }

  // `force` = true bypasses the server-side overlap check ("Add anyway").
  async function submitSlot(force: boolean) {
    setAddError(null);
    if (!force) setOverlapWarning(null);

    // Validate before touching dates — the Hour/Min/AM-PM fields aren't natively
    // "required", so guard against incomplete entries (which would otherwise make
    // `new Date("").toISOString()` throw and leave the button stuck on "Adding…").
    if (!newSlot.physicianId) {
      setAddError("Please select a physician.");
      return;
    }
    const start = new Date(newSlot.startTime);
    if (!newSlot.startTime || Number.isNaN(start.getTime())) {
      setAddError("Please enter a complete start time (date, hour, minute, AM/PM).");
      return;
    }
    const end = new Date(newSlot.endTime);
    if (!newSlot.endTime || Number.isNaN(end.getTime())) {
      setAddError("Please enter a complete end time (date, hour, minute, AM/PM).");
      return;
    }
    if (end.getTime() <= start.getTime()) {
      setAddError("End time must be after start time.");
      return;
    }

    setAdding(true);
    try {
      const body: Record<string, unknown> = {
        physicianId: newSlot.physicianId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        slotStatus: newSlot.slotStatus,
      };
      if (bulkMode) body.intervalMinutes = intervalMinutes;
      if (force) body.allowOverlap = true;

      const res = await fetch("/api/org/slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (res.status === 409 && data.error === "overlap") {
        // Warn and let the user decide whether to add anyway.
        setOverlapWarning(data.overlaps ?? []);
      } else if (!res.ok) {
        setAddError(data.error ?? "Failed to add slot.");
      } else {
        setOverlapWarning(null);
        setShowAdd(false);
        loadSlots();
      }
    } catch {
      setAddError("Something went wrong while adding the slot. Please try again.");
    } finally {
      setAdding(false);
    }
  }

  const STATUS_COLORS: Record<string, string> = {
    OPEN: "bg-green-100 text-green-700",
    BLOCKED: "bg-gray-100 text-gray-500",
    HELD: "bg-amber-100 text-amber-700",
    BOOKED: "bg-blue-100 text-blue-700",
  };

  const overlapIds = useMemo(() => computeOverlapIds(slots), [slots]);
  const displayedSlots = showOverlapsOnly
    ? slots.filter((s) => overlapIds.has(s.id))
    : slots;

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-4xl mx-auto">
        <button onClick={() => router.push("/org/dashboard")} className="text-blue-600 text-sm mb-4">
          ← Dashboard
        </button>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Appointment Slots</h1>
          <button
            onClick={openAddModal}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition"
          >
            + Add Slot
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <select
            value={filterPhysicianId}
            onChange={(e) => setFilterPhysicianId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All physicians</option>
            {physicians.map((p) => (
              <option key={p.id} value={p.id}>
                Dr. {p.firstName} {p.lastName}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-gray-600">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-gray-600">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          {(overlapIds.size > 0 || showOverlapsOnly) && (
            <button
              type="button"
              onClick={() => setShowOverlapsOnly((v) => !v)}
              className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                showOverlapsOnly
                  ? "bg-amber-600 text-white border-amber-600 hover:bg-amber-700"
                  : "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
              }`}
              title="Slots that overlap another slot for the same physician"
            >
              {showOverlapsOnly ? "Show all" : `⚠ Overlapping (${overlapIds.size})`}
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm mb-4">
            {error}
          </div>
        )}

        {/* Slots table */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <p className="text-gray-400 text-sm p-6 text-center">Loading…</p>
          ) : displayedSlots.length === 0 ? (
            <p className="text-gray-400 text-sm p-6 text-center">
              {showOverlapsOnly
                ? "No overlapping slots in this date range."
                : 'No slots in this date range. Use "+ Add Slot" to create one.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Date & time</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Physician</th>
                  <th className="text-left px-4 py-3 text-gray-600 font-medium">Status</th>
                  <th className="text-right px-4 py-3 text-gray-600 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedSlots.map((slot) => (
                  <tr
                    key={slot.id}
                    className={`border-b border-gray-100 last:border-0 ${
                      overlapIds.has(slot.id) ? "bg-amber-50" : ""
                    }`}
                  >
                    <td className="px-4 py-3 text-gray-800">
                      {formatLocalDT(slot.startTime)}
                      <span className="text-gray-400"> – {formatTime(slot.endTime)}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{slot.physicianName}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[slot.status] ?? ""}`}
                      >
                        {slot.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {(slot.status === "OPEN" || slot.status === "BLOCKED") && (
                        <>
                          <button
                            onClick={() => handleToggleStatus(slot)}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            {slot.status === "OPEN" ? "Block" : "Unblock"}
                          </button>
                          <button
                            onClick={() => handleDelete(slot)}
                            className="text-xs text-red-500 hover:underline"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add slot modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Add Slot</h2>
            {addError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm mb-4">
                {addError}
              </div>
            )}
            {overlapWarning && overlapWarning.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-sm mb-4">
                <p className="font-medium mb-1">
                  ⚠ This overlaps {overlapWarning.length} existing slot
                  {overlapWarning.length === 1 ? "" : "s"} for this physician:
                </p>
                <ul className="list-disc list-inside space-y-0.5 mb-3 max-h-28 overflow-y-auto">
                  {overlapWarning.slice(0, 10).map((o, i) => (
                    <li key={i}>
                      {formatLocalDT(o.startTime)} – {formatTime(o.endTime)}
                      {o.status !== "OPEN" ? ` (${o.status})` : ""}
                    </li>
                  ))}
                  {overlapWarning.length > 10 && <li>…and {overlapWarning.length - 10} more</li>}
                </ul>
                <button
                  type="button"
                  onClick={() => void submitSlot(true)}
                  disabled={adding}
                  className="bg-amber-600 text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
                >
                  {adding ? "Adding…" : "Add anyway"}
                </button>
              </div>
            )}
            <form onSubmit={handleAddSlot} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Physician</label>
                <select
                  required
                  value={newSlot.physicianId}
                  onChange={(e) => setNewSlot((prev) => ({ ...prev, physicianId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  {physicians.map((p) => (
                    <option key={p.id} value={p.id}>
                      Dr. {p.firstName} {p.lastName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start time</label>
                <DateTimeField
                  value={newSlot.startTime}
                  onChange={(v) =>
                    setNewSlot((prev) => ({
                      ...prev,
                      startTime: v,
                      // Convenience: seed the end time from the start the first time
                      // it's set, so the End date isn't accidentally left blank.
                      endTime: prev.endTime ? prev.endTime : v,
                    }))
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End time</label>
                <DateTimeField
                  value={newSlot.endTime}
                  onChange={(v) => setNewSlot((prev) => ({ ...prev, endTime: v }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={newSlot.slotStatus}
                  onChange={(e) => setNewSlot((prev) => ({ ...prev, slotStatus: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="OPEN">OPEN (bookable)</option>
                  <option value="BLOCKED">BLOCKED (unavailable)</option>
                </select>
              </div>
              <div className="border border-blue-100 bg-blue-50 rounded-lg p-3 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bulkMode}
                    onChange={(e) => setBulkMode(e.target.checked)}
                    className="accent-blue-600 w-4 h-4"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Generate multiple slots (split by interval)
                  </span>
                </label>
                {bulkMode && (
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Slot length</label>
                    <select
                      value={intervalMinutes}
                      onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    >
                      {[10, 15, 20, 30, 45, 60].map((n) => (
                        <option key={n} value={n}>{n} minutes</option>
                      ))}
                    </select>
                    {newSlot.startTime && newSlot.endTime && (
                      <p className="text-xs text-blue-600 mt-1">
                        {Math.floor(
                          (new Date(newSlot.endTime).getTime() - new Date(newSlot.startTime).getTime()) /
                            (intervalMinutes * 60 * 1000),
                        )}{" "}
                        slots will be created
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adding}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  {adding ? "Adding…" : "Add Slot"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
