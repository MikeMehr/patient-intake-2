"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Friendly time-of-day field that emits a 24-hour "HH:mm" string (the same
 * format a native <input type="time"> produces), entered as Hour / Min / AM-PM
 * controls instead of the browser's native time picker.
 */

type AmPm = "AM" | "PM";

type Parsed = { hour12: string; minute: string; ampm: AmPm };

function parse(value: string): Parsed {
  const m = value.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return { hour12: "", minute: "", ampm: "AM" };
  const h24 = parseInt(m[1]!, 10);
  const minute = m[2]!;
  const ampm: AmPm = h24 >= 12 ? "PM" : "AM";
  let hour12 = h24 % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12: String(hour12), minute, ampm };
}

function compose(hour12: string, minute: string, ampm: AmPm): string {
  if (hour12 === "" || minute === "") return "";
  let h = parseInt(hour12, 10);
  const min = parseInt(minute, 10);
  if (!Number.isInteger(h) || !Number.isInteger(min)) return "";
  if (h < 1 || h > 12 || min < 0 || min > 59) return "";
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function clampInt(raw: string, min: number, max: number): string {
  if (raw === "") return "";
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return "";
  return String(Math.max(min, Math.min(max, n)));
}

export default function TimeField({
  value,
  onChange,
  inputClassName = "border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500",
}: {
  value: string;
  onChange: (v: string) => void;
  inputClassName?: string;
}) {
  const [hour12, setHour12] = useState("");
  const [minute, setMinute] = useState("");
  const [ampm, setAmpm] = useState<AmPm>("AM");

  const lastEmitted = useRef<string | null>(null);
  useEffect(() => {
    if (value === lastEmitted.current) return;
    const p = parse(value);
    setHour12(p.hour12);
    setMinute(p.minute);
    setAmpm(p.ampm);
  }, [value]);

  function emit(next: Partial<Parsed>) {
    const h = next.hour12 ?? hour12;
    const mi = next.minute ?? minute;
    const a = next.ampm ?? ampm;
    const composed = compose(h, mi, a);
    lastEmitted.current = composed;
    onChange(composed);
  }

  return (
    <div className="flex items-end gap-2">
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
            if (e.target.value !== "") {
              setMinute(String(parseInt(e.target.value, 10)).padStart(2, "0"));
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
