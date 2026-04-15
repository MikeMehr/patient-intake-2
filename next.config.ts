import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Suppress X-Powered-By: Next.js header to avoid advertising framework version.
  poweredByHeader: false,
  serverExternalPackages: [
    "@sparticuz/chromium",
    "playwright-core",
    "applicationinsights",
    "diagnostic-channel",
    "diagnostic-channel-publishers",
  ],
  // Produces a minimal runtime bundle at `.next/standalone` suitable for
  // container/App Service deployments (smaller than shipping the whole repo).
  output: "standalone",
  outputFileTracingIncludes: {
    // Include migration SQL files in the standalone build so the startup
    // migration runner can read them at runtime on Azure.
    "**": ["./src/lib/migrations/**/*.sql"],
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
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, max-age=0" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        source: "/intake/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, max-age=0" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        source: "/physician/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, max-age=0" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      // Static assets bypass middleware, so security headers must be set here.
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
        ],
      },
      {
        source: "/_next/image",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
