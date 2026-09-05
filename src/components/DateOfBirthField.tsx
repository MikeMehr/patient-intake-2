"use client";

import { useEffect, useRef, useState } from "react";
import { composeDob, dobProblem, MONTHS, parseDob } from "@/lib/dob";

/**
 * Elderly-friendly date-of-birth field: Month select + typed Day / Year.
 *
 * Replaces the native <input type="date">, whose mobile picker starts at today
 * and forces e.g. a 77-year-old to scroll back 77 years. Emits the same
 * "YYYY-MM-DD" string the native input produces — a full valid date or "",
 * never a partial — so callers can POST the value unchanged.
 */
export default function DateOfBirthField({
  value,
  onChange,
  required = false,
  disabled = false,
  idPrefix = "dob",
  inputClassName = "w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50",
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  disabled?: boolean;
  idPrefix?: string;
  inputClassName?: string;
}) {
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");

  const lastEmitted = useRef<string | null>(null);
  useEffect(() => {
    if (value === lastEmitted.current) return;
    const p = parseDob(value);
    setMonth(p.month);
    setDay(p.day);
    setYear(p.year);
  }, [value]);

  function emit(next: { month?: string; day?: string; year?: string }) {
    const composed = composeDob(next.month ?? month, next.day ?? day, next.year ?? year);
    lastEmitted.current = composed;
    onChange(composed);
  }

  const problem = dobProblem(month, day, year);
  const errorId = `${idPrefix}-error`;

  return (
    <div>
      <div className="grid grid-cols-[1fr_4.5rem_5.5rem] gap-2">
        <div className="flex flex-col">
          <label htmlFor={`${idPrefix}-month`} className="text-xs text-gray-500 mb-0.5">
            Month
          </label>
          <select
            id={`${idPrefix}-month`}
            required={required}
            disabled={disabled}
            autoComplete="bday-month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              emit({ month: e.target.value });
            }}
            className={inputClassName}
          >
            <option value="" disabled>
              Month
            </option>
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label htmlFor={`${idPrefix}-day`} className="text-xs text-gray-500 mb-0.5">
            Day
          </label>
          <input
            id={`${idPrefix}-day`}
            required={required}
            disabled={disabled}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            autoComplete="bday-day"
            placeholder="DD"
            value={day}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "");
              setDay(v);
              emit({ day: v });
            }}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? errorId : undefined}
            className={inputClassName}
          />
        </div>
        <div className="flex flex-col">
          <label htmlFor={`${idPrefix}-year`} className="text-xs text-gray-500 mb-0.5">
            Year
          </label>
          <input
            id={`${idPrefix}-year`}
            required={required}
            disabled={disabled}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="bday-year"
            placeholder="YYYY"
            value={year}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "");
              setYear(v);
              emit({ year: v });
            }}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? errorId : undefined}
            className={inputClassName}
          />
        </div>
      </div>
      {problem && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-600">
          {problem}
        </p>
      )}
    </div>
  );
}
