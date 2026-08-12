"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SessionKeepAlive from "@/components/auth/SessionKeepAlive";

type OscarStatus = "QUEUED" | "LINKED" | "FAILED" | null;

interface DirectorySpecialist {
  id: string;
  pathwaysId: number;
  name: string;
  honorific: string | null;
  specialization: string;
  city: string | null;
  billingNumber: string | null;
  waitTime: string | null;
  waitTimeRank: number | null;
  acceptsReferralsViaFax: boolean;
  acceptsReferralsViaPhone: boolean;
  acceptsReferralsViaProvincialPlatform: boolean;
  referralIconKey: string | null;
  oscarStatus: OscarStatus;
}

interface Facets {
  specialties: string[];
  cities: string[];
  totalCount: number;
  lastSyncedAt: string | null;
}

function waitTimeBadgeClass(rank: number | null): string {
  if (rank === null) return "text-slate-600 bg-slate-100";
  if (rank <= 14) return "text-emerald-800 bg-emerald-100";
  if (rank <= 60) return "text-amber-800 bg-amber-100";
  return "text-rose-800 bg-rose-100";
}

function referralMethods(s: DirectorySpecialist): string {
  const methods: string[] = [];
  if (s.acceptsReferralsViaFax) methods.push("Fax");
  if (s.acceptsReferralsViaPhone) methods.push("Phone");
  if (s.acceptsReferralsViaProvincialPlatform) methods.push("Provincial platform");
  return methods.length > 0 ? methods.join(", ") : "Not specified";
}

function formatSyncAge(lastSyncedAt: string | null): string {
  if (!lastSyncedAt) return "Never synced";
  const days = Math.floor((Date.now() - new Date(lastSyncedAt).getTime()) / 86_400_000);
  if (days <= 0) return "Synced today";
  if (days === 1) return "Synced 1 day ago";
  return `Synced ${days} days ago`;
}

export default function SpecialistDirectoryPage() {
  const router = useRouter();

  const [facets, setFacets] = useState<Facets | null>(null);
  const [facetsError, setFacetsError] = useState<string | null>(null);

  const [specialty, setSpecialty] = useState("");
  const [city, setCity] = useState("");
  const [nameQuery, setNameQuery] = useState("");
  const [sort, setSort] = useState<"wait" | "name">("wait");

  const [specialists, setSpecialists] = useState<DirectorySpecialist[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selected, setSelected] = useState<DirectorySpecialist | null>(null);
  const [queueState, setQueueState] = useState<"idle" | "saving" | "error">("idle");
  const [queueError, setQueueError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams();
      if (specialty) params.set("specialty", specialty);
      if (city) params.set("city", city);
      if (nameQuery.trim()) params.set("q", nameQuery.trim());
      params.set("sort", sort);

      const res = await fetch(`/api/physician/specialist-directory?${params.toString()}`);
      if (res.status === 401) {
        router.push("/physician/login");
        return;
      }
      const data = await res.json();
      if (data.error) {
        setSearchError(data.error);
        setSpecialists([]);
      } else {
        setSpecialists(data.specialists || []);
      }
    } catch {
      setSearchError("Failed to search the specialist directory.");
    } finally {
      setLoading(false);
    }
  }, [specialty, city, nameQuery, sort, router]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/physician/specialist-directory/facets");
        if (res.status === 401) {
          router.push("/physician/login");
          return;
        }
        const data = await res.json();
        if (data.error) {
          setFacetsError(data.error);
        } else {
          setFacets(data);
        }
      } catch {
        setFacetsError("Failed to load directory filters.");
      }
    })();
  }, [router]);

  // Debounce the name search only; specialty/city/sort changes search immediately.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(runSearch, nameQuery ? 300 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [specialty, city, sort, nameQuery]);

  // The detail panel renders right above the results table, but with a long results list the
  // physician may have scrolled well past it before clicking a row — scroll it into view so
  // selecting a specialist never looks like nothing happened.
  useEffect(() => {
    if (selected) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selected]);

  const handleQueue = async (s: DirectorySpecialist) => {
    setQueueState("saving");
    setQueueError(null);
    try {
      const res = await fetch("/api/physician/specialist-directory/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bcSpecialistId: s.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setQueueError(data.error || "Failed to queue this specialist.");
        setQueueState("error");
        return;
      }
      const nextStatus: OscarStatus =
        data.result?.outcome === "ALREADY_LINKED" ? "LINKED" : "QUEUED";
      setSelected((prev) => (prev && prev.id === s.id ? { ...prev, oscarStatus: nextStatus } : prev));
      setSpecialists((prev) => prev.map((row) => (row.id === s.id ? { ...row, oscarStatus: nextStatus } : row)));
      setQueueState("idle");
    } catch {
      setQueueError("Failed to queue this specialist.");
      setQueueState("error");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <SessionKeepAlive redirectTo="/physician/login" />

      <div className="relative bg-white rounded-b-none shadow-sm border-b border-slate-200 p-4 sm:p-6 mb-0">
        <div className="flex items-center gap-3">
          <Link href="/physician/dashboard" className="text-sm text-slate-500 hover:text-slate-700 transition">
            ← Dashboard
          </Link>
          <div>
            <h1 className="text-[0.95rem] sm:text-[1.1rem] font-semibold text-slate-900">
              BC Specialist Directory
            </h1>
            <p className="text-[0.7rem] sm:text-[0.8rem] text-slate-500 mt-0.5">
              Search by specialty and city, synced monthly from PathwaysBC.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {facetsError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            {facetsError}
          </div>
        )}

        {facets && facets.totalCount === 0 && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            The directory hasn&apos;t been synced from PathwaysBC yet, so there&apos;s nothing to search.
          </div>
        )}

        {facets && facets.totalCount > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 flex flex-wrap">
            <div className="flex-1 min-w-[160px] px-5 py-3 border-r border-slate-100 last:border-r-0">
              <div className="text-lg font-semibold text-slate-900 tabular-nums">{facets.totalCount}</div>
              <div className="text-xs text-slate-500">Specialists province-wide</div>
            </div>
            <div className="flex-1 min-w-[160px] px-5 py-3 border-r border-slate-100 last:border-r-0">
              <div className="text-lg font-semibold text-slate-900 tabular-nums">{specialists.length}</div>
              <div className="text-xs text-slate-500">Matching your filters</div>
            </div>
            <div className="flex-1 min-w-[160px] px-5 py-3">
              <div className="text-lg font-semibold text-slate-900">{formatSyncAge(facets.lastSyncedAt)}</div>
              <div className="text-xs text-slate-500">Directory freshness</div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide" htmlFor="specialty">
              Specialty
            </label>
            <select
              id="specialty"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 min-w-[180px]"
            >
              <option value="">All specialties</option>
              {(facets?.specialties || []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide" htmlFor="city">
              City
            </label>
            <select
              id="city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 min-w-[160px]"
            >
              <option value="">All cities</option>
              {(facets?.cities || []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              type="text"
              placeholder="Search by name…"
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 min-w-[200px]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Sort by</span>
            <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
              <button
                type="button"
                onClick={() => setSort("wait")}
                className={`px-3 py-2 text-sm border-r border-slate-300 ${
                  sort === "wait" ? "bg-slate-900 text-white font-medium" : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Wait time
              </button>
              <button
                type="button"
                onClick={() => setSort("name")}
                className={`px-3 py-2 text-sm ${
                  sort === "name" ? "bg-slate-900 text-white font-medium" : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Name
              </button>
            </div>
          </div>
        </div>

        {searchError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            {searchError}
          </div>
        )}

        {selected && (
          <div ref={detailRef} className="bg-white rounded-lg shadow-sm border border-slate-200 p-5 scroll-mt-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-base font-semibold text-slate-900">
                  {selected.honorific ? `${selected.honorific} ` : ""}
                  {selected.name}
                </div>
                <div className="text-sm text-slate-500">
                  {selected.specialization}
                  {selected.city ? ` · ${selected.city}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
              <div>
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Avg. wait</div>
                <div className="text-sm text-slate-900 mt-0.5">{selected.waitTime || "Not specified"}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Accepts referrals via</div>
                <div className="text-sm text-slate-900 mt-0.5">{referralMethods(selected)}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">MSP billing number</div>
                <div className="text-sm text-slate-900 mt-0.5">{selected.billingNumber || "Not listed"}</div>
              </div>
            </div>

            {selected.oscarStatus !== "LINKED" && (
              <div className="mt-4 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-900">
                <span className="font-medium">Referring a patient today?</span> You don&apos;t need to wait for
                OSCAR — open their PathwaysBC profile below for the office phone/fax and refer directly, the same
                way you would any specialist.
              </div>
            )}

            <p className="text-xs text-slate-500 mt-4">
              Office phone, fax, and address aren&apos;t mirrored here yet — view the full profile on PathwaysBC for
              contact details.
            </p>

            <div className="flex flex-wrap gap-2 mt-4">
              <a
                href={`https://pathwaysbc.ca/specialists/${selected.pathwaysId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg px-4 py-2 text-sm font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                View full profile on PathwaysBC
              </a>

              {selected.oscarStatus === "LINKED" ? (
                <span className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                  Already in OSCAR
                </span>
              ) : selected.oscarStatus === "QUEUED" ? (
                <span className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium bg-amber-50 text-amber-800 border border-amber-200">
                  Queued — run the OSCAR bookmarklet to add them
                </span>
              ) : (
                <button
                  type="button"
                  disabled={queueState === "saving"}
                  onClick={() => handleQueue(selected)}
                  className="rounded-lg px-4 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {queueState === "saving" ? "Queuing…" : "Add to our OSCAR"}
                </button>
              )}
            </div>

            {queueError && <p className="text-sm text-red-700 mt-2">{queueError}</p>}
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Specialist
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                  City
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Avg. wait — non-urgent
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Referral by
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-sm text-slate-500 text-center">
                    Searching…
                  </td>
                </tr>
              )}
              {!loading && specialists.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-sm text-slate-600 text-center">
                    No specialists match these filters.
                  </td>
                </tr>
              )}
              {!loading &&
                specialists.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelected(s)}
                    className={`cursor-pointer hover:bg-slate-50 ${selected?.id === s.id ? "bg-slate-50" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-slate-900">
                        {s.honorific ? `${s.honorific} ` : ""}
                        {s.name}
                      </div>
                      <div className="text-xs text-slate-500">{s.specialization}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{s.city || "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${waitTimeBadgeClass(
                          s.waitTimeRank,
                        )}`}
                      >
                        {s.waitTime || "Not specified"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{referralMethods(s)}</td>
                    <td className="px-4 py-3">
                      {s.oscarStatus === "LINKED" ? (
                        <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium text-emerald-800 bg-emerald-100">
                          In OSCAR
                        </span>
                      ) : s.oscarStatus === "QUEUED" ? (
                        <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium text-amber-800 bg-amber-100">
                          Queued for OSCAR
                        </span>
                      ) : (
                        <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium text-slate-600 bg-slate-100">
                          Not yet in OSCAR
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
