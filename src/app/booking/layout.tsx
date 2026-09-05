// Google tag for booking-conversion measurement, mounted only under /booking —
// the PHI-bearing surfaces (/admin, /org, physician dashboard) must never load
// third-party analytics. The CSP allows these hosts on /booking paths only
// (see buildCspHeader in src/proxy.ts).
export default function BookingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* Plain async tags rather than next/script: its injected inline loader
          fights the nonce-based CSP, and the bootstrap is a static own-origin file. */}
      <script async src="https://www.googletagmanager.com/gtag/js?id=AW-644041535"></script>
      <script async src="/booking-gtag.js"></script>
    </>
  );
}
