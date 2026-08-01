"use client";

/**
 * Preferred-pharmacy picker for the online booking form.
 *
 * Searches the clinic's mirrored OSCAR pharmacy directory, so a pick carries an id OSCAR already
 * knows and can be set as the patient's preferred pharmacy straight away. Anything not in that
 * directory falls back to free text, which is saved on the booking for staff to reconcile.
 *
 * Optional by design: nothing here can block a booking, and a failed search silently degrades to
 * the manual entry path rather than showing the patient an error about a directory they've never
 * heard of.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PharmacySelection } from "@/lib/pharmacy-selection";

type SearchResult = {
  id: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  fax: string;
};

type Props = {
  clinicSlug: string;
  value: PharmacySelection | null;
  onChange: (value: PharmacySelection | null) => void;
};

const DEBOUNCE_MS = 250;
const MIN_QUERY_LEN = 2;

const INPUT_CLASS =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

export default function PharmacyPicker({ clinicSlug, value, onChange }: Props) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [manual, setManual] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualCity, setManualCity] = useState("");

  // A slow response for an earlier keystroke must not overwrite a newer one's results.
  const requestSeq = useRef(0);

  const runSearch = useCallback(
    async (q: string) => {
      const seq = ++requestSeq.current;
      setSearching(true);
      try {
        const res = await fetch(
          `/api/booking/${encodeURIComponent(clinicSlug)}/pharmacy-search?q=${encodeURIComponent(q)}`,
        );
        const data = await res.json();
        if (seq !== requestSeq.current) return;

        if (data.directoryEmpty) {
          // No directory to search — drop straight into manual entry, no error shown.
          setManual(true);
          setResults([]);
          return;
        }
        setResults(Array.isArray(data.pharmacies) ? data.pharmacies : []);
      } catch {
        if (seq === requestSeq.current) setResults([]);
      } finally {
        if (seq === requestSeq.current) setSearching(false);
      }
    },
    [clinicSlug],
  );

  useEffect(() => {
    if (manual || value || term.trim().length < MIN_QUERY_LEN) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => void runSearch(term.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [term, manual, value, runSearch]);

  function selectPharmacy(p: SearchResult) {
    onChange({
      source: "DIRECTORY",
      pharmacyId: p.id,
      name: p.name,
      address: p.address || undefined,
      city: p.city || undefined,
      phone: p.phone || undefined,
      fax: p.fax || undefined,
    });
    setResults([]);
    setTerm("");
  }

  function commitManual(name: string, city: string) {
    const trimmed = name.trim();
    onChange(
      trimmed
        ? { source: "FREE_TEXT", name: trimmed, city: city.trim() || undefined }
        : null,
    );
  }

  function clear() {
    onChange(null);
    setTerm("");
    setResults([]);
    setManual(false);
    setManualName("");
    setManualCity("");
  }

  if (value) {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Preferred pharmacy (optional)
        </label>
        <div className="flex items-start justify-between gap-3 border border-gray-300 rounded-lg px-3 py-2">
          <div className="text-sm">
            <p className="font-medium text-gray-800">{value.name}</p>
            {(value.address || value.city) && (
              <p className="text-gray-500 text-xs">
                {[value.address, value.city].filter(Boolean).join(", ")}
              </p>
            )}
            {value.source === "FREE_TEXT" && (
              <p className="text-gray-400 text-xs mt-0.5">
                We&apos;ll confirm this pharmacy with you.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={clear}
            className="text-gray-400 hover:text-gray-600 text-sm shrink-0"
            aria-label="Remove selected pharmacy"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  if (manual) {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Preferred pharmacy (optional)
        </label>
        <input
          type="text"
          placeholder="Pharmacy name"
          value={manualName}
          onChange={(e) => setManualName(e.target.value)}
          onBlur={() => commitManual(manualName, manualCity)}
          className={INPUT_CLASS}
        />
        <input
          type="text"
          placeholder="City"
          value={manualCity}
          onChange={(e) => setManualCity(e.target.value)}
          onBlur={() => commitManual(manualName, manualCity)}
          className={`${INPUT_CLASS} mt-2`}
        />
        <button
          type="button"
          onClick={() => {
            setManual(false);
            setManualName("");
            setManualCity("");
            onChange(null);
          }}
          className="text-xs text-blue-600 underline mt-1"
        >
          Search the pharmacy list instead
        </button>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Preferred pharmacy (optional)
      </label>
      <input
        type="text"
        placeholder="Start typing a pharmacy name or address"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        className={INPUT_CLASS}
        autoComplete="off"
      />

      {results.length > 0 && (
        <ul className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => selectPharmacy(p)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50"
              >
                <span className="block text-sm text-gray-800">{p.name}</span>
                {(p.address || p.city) && (
                  <span className="block text-xs text-gray-500">
                    {[p.address, p.city].filter(Boolean).join(", ")}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {term.trim().length >= MIN_QUERY_LEN && !searching && results.length === 0 && (
        <p className="text-xs text-gray-500 mt-1">No matches.</p>
      )}

      <button
        type="button"
        onClick={() => setManual(true)}
        className="text-xs text-blue-600 underline mt-1"
      >
        Can&apos;t find it? Enter it manually
      </button>
    </div>
  );
}
