// Next.js middleware entry point.
// Security headers (CSP, HSTS, X-Frame-Options, etc.) and request ID
// propagation are implemented in proxy.ts and applied here to all routes.
export { proxy as default, config } from "./proxy";
