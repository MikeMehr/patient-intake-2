"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

function toInputDT(iso: string): string {
  // Strip timezone for datetime-local input
  return iso.substring(0, 16);
}

export default function SlotsPage() {
  const router = useRouter();
  const [physicians, setPhysicians] = useState<Physician[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [filterPhysicianId, setFilterPhysicianId] = useState("all");
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
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

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
    if (!confirm(`Delete slot at ${formatLocalDT(slot.startTime)}?`)) return;
    await fetch(`/api/org/slots/${slot.id}`, { method: "DELETE" });
    loadSlots();
  }

  async function handleAddSlot(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setAddError(null);

    // Convert datetime-local (local time) to ISO — append :00Z is wrong;
    // send as-is and let the server parse (it will treat as UTC if no TZ).
    // datetime-local values are local time — convert to UTC for storage
    const startISO = new Date(newSlot.startTime).toISOString();
    const endISO = new Date(newSlot.endTime).toISOString();

    const res = await fetch("/api/org/slots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        physicianId: newSlot.physicianId,
        startTime: startISO,
        endTime: endISO,
        slotStatus: newSlot.slotStatus,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setAddError(data.error ?? "Failed to add slot.");
    } else {
      setShowAdd(false);
      loadSlots();
    }
    setAdding(false);
  }

  const STATUS_COLORS: Record<string, string> = {
    OPEN: "bg-green-100 text-green-700",
    BLOCKED: "bg-gray-100 text-gray-500",
    HELD: "bg-amber-100 text-amber-700",
    BOOKED: "bg-blue-100 text-blue-700",
  };

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-4xl mx-auto">
        <button onClick={() => router.push("/org/dashboard")} className="text-blue-600 text-sm mb-4">
          ← Dashboard
        </button>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Appointment Slots</h1>
          <button
            onClick={() => setShowAdd(true)}
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
          ) : slots.length === 0 ? (
            <p className="text-gray-400 text-sm p-6 text-center">
              No slots in this date range. Use "+ Add Slot" to create one.
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
                {slots.map((slot) => (
                  <tr key={slot.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3 text-gray-800">{formatLocalDT(slot.startTime)}</td>
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
                <input
                  required
                  type="datetime-local"
                  value={newSlot.startTime}
                  onChange={(e) => setNewSlot((prev) => ({ ...prev, startTime: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End time</label>
                <input
                  required
                  type="datetime-local"
                  value={newSlot.endTime}
                  onChange={(e) => setNewSlot((prev) => ({ ...prev, endTime: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
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
