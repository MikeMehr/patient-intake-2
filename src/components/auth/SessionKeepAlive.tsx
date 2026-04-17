"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";

type Props = {
  redirectTo: string;
  /**
   * Minimum time between pings, in milliseconds.
   * Keep this reasonably high to avoid excess DB writes.
   */
  throttleMs?: number;
  /**
   * Interval between periodic background pings, in milliseconds.
   * Keeps the session alive even when there is no user activity.
   * Defaults to 10 minutes — well within the 30-minute idle timeout.
   */
  intervalMs?: number;
};

export default function SessionKeepAlive({
  redirectTo,
  throttleMs = 60_000,
  intervalMs = 10 * 60 * 1000,
}: Props) {
  const router = useRouter();
  const lastPingAtRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);

  const events = useMemo(
    () => ["mousemove", "keydown", "click", "scroll", "touchstart"] as const,
    [],
  );

  useEffect(() => {
    let disposed = false;

    const ping = async () => {
      if (disposed) return;
      if (inFlightRef.current) return;
      const now = Date.now();
      if (now - lastPingAtRef.current < throttleMs) return;

      inFlightRef.current = true;
      lastPingAtRef.current = now;
      try {
        const res = await fetch("/api/auth/ping", { method: "GET", cache: "no-store" });
        if (res.status === 401) {
          router.push(redirectTo);
        }
      } catch {
        // Ignore transient network errors; the next interaction will retry.
      } finally {
        inFlightRef.current = false;
      }
    };

    const onActivity = () => {
      void ping();
    };

    // If the tab becomes visible again, ping immediately to catch expiry while hidden.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void ping();
      }
    };

    for (const evt of events) {
      window.addEventListener(evt, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Periodic background ping so the session stays alive even with no mouse/keyboard
    // activity (e.g. physician reading notes, tab in background).
    // The throttleMs check inside ping() prevents double-firing with activity pings.
    const intervalId = setInterval(() => {
      void ping();
    }, intervalMs);

    // Do not ping immediately on mount.
    // With token rotation enabled, initial parallel dashboard requests can race and
    // momentarily use the pre-rotation cookie, causing false 401/logouts.

    return () => {
      disposed = true;
      clearInterval(intervalId);
      for (const evt of events) {
        window.removeEventListener(evt, onActivity);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [events, intervalMs, redirectTo, router, throttleMs]);

  return null;
}

