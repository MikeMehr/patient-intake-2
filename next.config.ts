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
    ];
  },
};

export default nextConfig;
