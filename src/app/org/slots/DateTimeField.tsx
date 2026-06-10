"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Friendly date + time field that emits a "YYYY-MM-DDTHH:mm" string (the same
 * format a native datetime-local input produces), so it's a drop-in for the
 * slot form's startTime/endTime. The time is entered as separate Hour / Min /
 * AM-PM controls instead of the browser's native picker (whose minute column
 * renders 00 after 59 and is hard to use).
 */

type AmPm = "AM" | "PM";

type Parsed = { date: string; hour12: string; minute: string; ampm: AmPm };

function parse(value: string): Parsed {
  const m = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!m) return { date: "", hour12: "", minute: "", ampm: "AM" };
  const date = m[1]!;
  const h24 = parseInt(m[2]!, 10);
  const minute = m[3]!;
  const ampm: AmPm = h24 >= 12 ? "PM" : "AM";
  let hour12 = h24 % 12;
  if (hour12 === 0) hour12 = 12;
  return { date, hour12: String(hour12), minute, ampm };
}

function compose(date: string, hour12: string, minute: string, ampm: AmPm): string {
  if (!date || hour12 === "" || minute === "") return "";
  let h = parseInt(hour12, 10);
  const min = parseInt(minute, 10);
  if (!Number.isInteger(h) || !Number.isInteger(min)) return "";
  if (h < 1 || h > 12 || min < 0 || min > 59) return "";
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${date}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export default function DateTimeField({
  value,
  onChange,
  inputClassName = "border border-gray-300 rounded-lg px-3 py-2 text-sm",
}: {
  value: string;
  onChange: (v: string) => void;
  inputClassName?: string;
}) {
  const [date, setDate] = useState("");
  const [hour12, setHour12] = useState("");
  const [minute, setMinute] = useState("");
  const [ampm, setAmpm] = useState<AmPm>("AM");

  // Track what we last emitted so we don't clobber in-progress edits when the
  // parent echoes our own value back. External resets (e.g. "") still sync.
  const lastEmitted = useRef<string | null>(null);
  useEffect(() => {
    if (value === lastEmitted.current) return;
    const p = parse(value);
    setDate(p.date);
    setHour12(p.hour12);
    setMinute(p.minute);
    setAmpm(p.ampm);
  }, [value]);

  function emit(next: Partial<Parsed>) {
    const d = next.date ?? date;
    const h = next.hour12 ?? hour12;
    const mi = next.minute ?? minute;
    const a = next.ampm ?? ampm;
    const composed = compose(d, h, mi, a);
    lastEmitted.current = composed;
    onChange(composed);
  }

  function clampInt(raw: string, min: number, max: number): string {
    if (raw === "") return "";
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return "";
    return String(Math.max(min, Math.min(max, n)));
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col">
        <span className="text-[0.7rem] text-gray-500 mb-0.5">Date</span>
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            emit({ date: e.target.value });
          }}
          className={inputClassName}
        />
      </div>
      <div className="flex flex-col w-16">
        <span className="text-[0.7rem] text-gray-500 mb-0.5">Hour</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={12}
          placeholder="HH"
          value={hour12}
          onChange={(e) => {
            const v = clampInt(e.target.value, 1, 12);
            setHour12(v);
            emit({ hour12: v });
          }}
          className={inputClassName}
        />
      </div>
      <div className="flex flex-col w-16">
        <span className="text-[0.7rem] text-gray-500 mb-0.5">Min</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={59}
          placeholder="MM"
          value={minute}
          onChange={(e) => {
            const v = clampInt(e.target.value, 0, 59);
            setMinute(v);
            emit({ minute: v });
          }}
          onBlur={(e) => {
            // Pad to 2 digits for a tidy display once they leave the field.
            if (e.target.value !== "") {
              const v = String(parseInt(e.target.value, 10)).padStart(2, "0");
              setMinute(v);
            }
          }}
          className={inputClassName}
        />
      </div>
      <div className="flex flex-col">
        <span className="text-[0.7rem] text-gray-500 mb-0.5">AM/PM</span>
        <select
          value={ampm}
          onChange={(e) => {
            const v = e.target.value as AmPm;
            setAmpm(v);
            emit({ ampm: v });
          }}
          className={inputClassName}
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    </div>
  );
}
