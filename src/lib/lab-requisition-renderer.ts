import * as chromiumModule from "@sparticuz/chromium";
import { chromium as playwrightChromium } from "playwright-core";
import type { LabRequisitionPrefillPayload } from "@/lib/lab-requisition-payload";
import fs from "node:fs";
import path from "node:path";

type ChromiumCompat = {
  args: string[];
  executablePath: () => Promise<string>;
  headless?: boolean | "shell";
};

function getChromiumCompat(): ChromiumCompat {
  const fallback = (chromiumModule as any).default ?? {};
  const args = (chromiumModule as any).args ?? fallback.args;
  const executablePath =
    (chromiumModule as any).executablePath ?? fallback.executablePath;
  const headless = (chromiumModule as any).headless ?? fallback.headless ?? true;

  if (!Array.isArray(args) || typeof executablePath !== "function") {
    throw new Error("Chromium runtime is unavailable in this environment.");
  }

  return {
    args,
    executablePath,
    headless,
  };
}

async function resolveExecutablePath(chromium: ChromiumCompat): Promise<string> {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) {
    return process.env.CHROMIUM_EXECUTABLE_PATH;
  }
  const bundledBinPath = path.join(process.cwd(), "node_modules/@sparticuz/chromium/bin");
  const chromiumWithOptionalPath = chromium as ChromiumCompat & {
    executablePath: (input?: string) => Promise<string>;
  };
  const resolved = fs.existsSync(bundledBinPath)
    ? await chromiumWithOptionalPath.executablePath(bundledBinPath)
    : await chromiumWithOptionalPath.executablePath();
  if (!resolved) {
    throw new Error("Chromium executable path could not be resolved.");
  }
  return resolved;
}

export async function renderLabRequisitionPdf(params: {
  formUrl: string;
  payload: LabRequisitionPrefillPayload;
}): Promise<Buffer> {
  const chromium = getChromiumCompat();
  const executablePath = await resolveExecutablePath(chromium);
  const browser = await playwrightChromium.launch({
    executablePath,
    args: chromium.args,
    headless: chromium.headless === false ? false : true,
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1330, height: 1100 },
    });

    const response = await page.goto(params.formUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const status = response?.status() ?? 0;
    if (status < 200 || status >= 300) {
      throw new Error(`Lab requisition eForm URL returned HTTP ${status}: ${params.formUrl}`);
    }
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    const isErrorPage = await page.evaluate(() => {
      const title = (document.title || "").toLowerCase();
      const bodyText = (document.body?.innerText || "").toLowerCase();
      return (
        title.includes("404") ||
        title.includes("not found") ||
        bodyText.includes("this page could not be found") ||
        bodyText.includes("404")
      );
    });
    if (isErrorPage) {
      throw new Error(`Lab requisition eForm rendered an error page instead of form: ${params.formUrl}`);
    }

    await page.evaluate((payload) => {
      (window as any).__HAA_FORM_READY = false;
      window.postMessage({ type: "HAA_PREFILL", payload }, window.location.origin);
    }, params.payload);

    await page
      .waitForFunction(() => (window as any).__HAA_FORM_READY === true, undefined, { timeout: 6_000 })
      .catch(() => undefined);
    await page.waitForTimeout(700);

    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: {
        top: "0.2in",
        right: "0.2in",
        bottom: "0.2in",
        left: "0.2in",
      },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
