import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
  // Produces a minimal runtime bundle at `.next/standalone` suitable for
  // container/App Service deployments (smaller than shipping the whole repo).
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/lab-requisitions/generate/route": [
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
    "/api/lab-requisitions/generate": [
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
    "/api/lab-requisitions/editor-save/route": [
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
    "/api/lab-requisitions/editor-save": [
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
  },
};

export default nextConfig;
