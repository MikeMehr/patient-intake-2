// window.gtag exists only under /booking (see src/app/booking/layout.tsx) and
// is absent under ad blockers — tracking must never affect the booking itself.
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackBookingConfirmed(): void {
  try {
    // GA4 event: mark "booking_confirmed" as a key event in GA4, then import it
    // into Google Ads as the real booked-appointment conversion. No PII params.
    window.gtag?.("event", "booking_confirmed");
    // Direct Google Ads conversion — active once a website conversion action
    // exists in the Ads account and its label is provided at build time.
    const label = process.env.NEXT_PUBLIC_GADS_BOOKING_CONVERSION_LABEL;
    if (label) {
      window.gtag?.("event", "conversion", { send_to: `AW-644041535/${label}` });
    }
  } catch {
    // Analytics failures must never break the confirmation screen.
  }
}
