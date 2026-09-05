"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Countdown for the booking slot hold. Self-contained so the 1-second tick
 * re-renders only this line, not the whole confirm form. Remaining time is
 * derived from Date.now() each tick, so it stays correct after the phone
 * backgrounds the tab and throttles timers. Advisory only — the server
 * enforces held_until on every gated endpoint.
 */
export default function HoldCountdown({
  heldUntil,
  onExpire,
}: {
  heldUntil: string; // ISO timestamp
  onExpire: () => void;
}) {
  const deadline = new Date(heldUntil).getTime();
  const [remainingMs, setRemainingMs] = useState(() => deadline - Date.now());

  // Fire-once signal, not a reactive dependency — keep the latest callback in a ref.
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (Number.isNaN(deadline)) return;
    const id = setInterval(() => {
      const left = deadline - Date.now();
      setRemainingMs(left);
      if (left <= 0) {
        clearInterval(id);
        onExpireRef.current();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (Number.isNaN(deadline)) return null;

  const s = Math.max(0, Math.floor(remainingMs / 1000));
  const mmss = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <p className="text-xs text-blue-500 mt-2" aria-live="off">
      Time remaining to complete this form:{" "}
      <span className={`font-semibold tabular-nums ${s < 60 ? "text-red-600" : "text-blue-700"}`}>
        {mmss}
      </span>
    </p>
  );
}
